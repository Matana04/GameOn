const reservaModel = require('../models/reservaModel');
const quadraModel = require('../models/quadraModel');
const emailService = require('../services/emailService');
const prisma = require('../database/prismaClient');
const { converterParaUTC, formatarISOLocal, converterDeUTC } = require('../utils/dateUtils');
const filaService = require('../services/filaService');
const securityService = require('../services/securityService');
const bloqueioModel = require('../models/bloqueioModel');

// Parseia uma string de data assumindo UTC-3 quando não há timezone explícito,
// evitando dupla conversão quando o servidor já roda em UTC-3.
function parseDateUTC3(s) {
  const hasTZ = s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s);
  return new Date(hasTZ ? s : s + '-03:00');
}

const reservaController = {
  list: async (req, res) => {
    try {
      let reservas;
      
      if (req.user.tipo === 'LOCADOR') {
        reservas = await reservaModel.findByLocador(req.user.id);
      } else {
        reservas = await reservaModel.findByLocatario(req.user.id);
      }
      
      const reservasComSeguranca = securityService.filtrarCodigosSeguranca(
        reservas,
        req.user.id,
        req.user.tipo
      );
      
      res.json(reservasComSeguranca.map(r => ({
        ...r,
        dataInicio: formatarISOLocal(r.dataInicio),
        dataFim: formatarISOLocal(r.dataFim)
      })));
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar reservas', detalhes: error.message });
    }
  },

  getAvailability: async (req, res) => {
    const { quadraId, dataInicio, dataFim } = req.query;

    if (!quadraId || !dataInicio || !dataFim) {
      return res.status(400).json({ 
        erro: 'Parâmetros obrigatórios: quadraId, dataInicio, dataFim (ISO format ou yyyy-MM-dd HH:mm)' 
      });
    }

    try {
      const dataInicioObj = parseDateUTC3(dataInicio);
      const dataFimObj = parseDateUTC3(dataFim);

      if (isNaN(dataInicioObj.getTime()) || isNaN(dataFimObj.getTime())) {
        return res.status(400).json({ erro: 'Formato de data inválido' });
      }

      if (dataInicioObj >= dataFimObj) {
        return res.status(400).json({ erro: 'Data de início deve ser menor que data de fim' });
      }

      const quadra = await quadraModel.findById(quadraId);
      if (!quadra) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      const horariosOK = validarHorariosFuncionamento(quadra, dataInicioObj, dataFimObj);
      if (!horariosOK.valido) {
        return res.status(400).json({ erro: horariosOK.erro });
      }

      const bloqueioQuadra = await prisma.bloqueioQuadra.findFirst({
        where: {
          quadraId: Number(quadraId),
          AND: [
            { dataInicio: { lte: dataFimObj } },
            { dataFim: { gte: dataInicioObj } }
          ]
        }
      });

      if (bloqueioQuadra) {
        return res.json({
          disponivel: false,
          motivo: 'Quadra bloqueada',
          quadra: {
            id: quadra.id,
            nome: quadra.nome,
            esporte: quadra.esporte,
            valorPorHora: quadra.valorPorHora
          },
          periodo: {
            dataInicio: dataInicioObj,
            dataFim: dataFimObj,
            duracao: `${(dataFimObj - dataInicioObj) / 3600000} horas`
          },
          bloqueio: {
            id: bloqueioQuadra.id,
            motivo: bloqueioQuadra.motivo,
            descricao: bloqueioQuadra.descricao,
            dataInicio: bloqueioQuadra.dataInicio,
            dataFim: bloqueioQuadra.dataFim,
            horaInicio: bloqueioQuadra.horaInicio,
            horaFim: bloqueioQuadra.horaFim
          }
        });
      }

      const availability = await reservaModel.findAvailability(Number(quadraId), dataInicioObj, dataFimObj);
      
      res.json({
        disponivel: availability.disponivel,
        quadra: {
          id: quadra.id,
          nome: quadra.nome,
          esporte: quadra.esporte,
          valorPorHora: quadra.valorPorHora
        },
        periodo: {
          dataInicio: dataInicioObj,
          dataFim: dataFimObj,
          duracao: `${(dataFimObj - dataInicioObj) / 3600000} horas`
        },
        conflitos: availability.conflitos.map(c => ({
          id: c.id,
          dataInicio: c.dataInicio,
          dataFim: c.dataFim,
          locatario: c.locatario.nome
        }))
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar disponibilidade', detalhes: error.message });
    }
  },

  create: async (req, res) => {
    const { quadraId, dataInicio, dataFim } = req.body;
    const locatarioId = req.user.id;

    if (!quadraId || !dataInicio || !dataFim) {
      return res.status(400).json({ erro: 'Campos obrigatórios: quadraId, dataInicio, dataFim' });
    }

    if (req.user.tipo !== 'LOCATARIO') {
      return res.status(403).json({ erro: 'Apenas locatários podem fazer reservas' });
    }

    try {
      const dataInicioObj = parseDateUTC3(dataInicio);
      const dataFimObj = parseDateUTC3(dataFim);

      if (isNaN(dataInicioObj.getTime()) || isNaN(dataFimObj.getTime())) {
        return res.status(400).json({ erro: 'Formato de data inválido' });
      }

      if (dataInicioObj >= dataFimObj) {
        return res.status(400).json({ erro: 'Data de início deve ser anterior à data de fim' });
      }

      const agora = new Date();
      if (dataInicioObj < agora) {
        return res.status(400).json({ erro: 'Não é possível fazer reservas no passado' });
      }

      const quadra = await quadraModel.findById(quadraId);
      if (!quadra) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      const bloqueio = await bloqueioModel.buscar(quadra.locadorId, locatarioId);
      if (bloqueio) {
        return res.status(403).json({ erro: 'Você está bloqueado pelo locador desta quadra e não pode realizar reservas' });
      }

      const horariosOK = validarHorariosFuncionamento(quadra, dataInicioObj, dataFimObj);
      if (!horariosOK.valido) {
        return res.status(400).json({ erro: horariosOK.erro });
      }

      const bloqueioQuadra = await prisma.bloqueioQuadra.findFirst({
        where: {
          quadraId: Number(quadraId),
          AND: [
            { dataInicio: { lte: dataFimObj } },
            { dataFim: { gte: dataInicioObj } }
          ]
        }
      });

      if (bloqueioQuadra) {
        return res.status(409).json({
          erro: 'A quadra está bloqueada neste período',
          bloqueio: {
            id: bloqueioQuadra.id,
            motivo: bloqueioQuadra.motivo,
            descricao: bloqueioQuadra.descricao,
            dataInicio: bloqueioQuadra.dataInicio,
            dataFim: bloqueioQuadra.dataFim,
            horaInicio: bloqueioQuadra.horaInicio,
            horaFim: bloqueioQuadra.horaFim
          }
        });
      }

      const conflitos = await reservaModel.findConflicts(Number(quadraId), dataInicioObj, dataFimObj);
      
      if (conflitos.length > 0) {
        try {
          const eligibilidade = await filaService.verificarEligibilidadeFila(
            Number(quadraId),
            dataInicioObj,
            dataFimObj
          );

          const duracao = (dataFimObj - dataInicioObj) / 3600000;
          if (duracao <= 0 || duracao > 24) {
            return res.status(400).json({ erro: 'Duração deve estar entre 0 e 24 horas' });
          }

          const valorTotal = parseFloat(quadra.valorPorHora) * duracao;

          const codigoSegurancaFila = securityService.gerarCodigoSeguranca();

          // Criar reserva com status EM_FILA
          const novaReservaFila = await prisma.reserva.create({
            data: {
              quadraId: Number(quadraId),
              locatarioId: Number(locatarioId),
              dataInicio: dataInicioObj,
              dataFim: dataFimObj,
              valorTotal: parseFloat(valorTotal.toFixed(2)),
              status: 'EM_FILA',
              timezoneOffset: -180,
              codigoSeguranca: codigoSegurancaFila
            },
            include: {
              quadra: { include: { locador: true, horarios: true } },
              locatario: true
            }
          });

          const reservaFila = await filaService.adicionarFila(novaReservaFila);

          return res.status(202).json({
            mensagem: 'A quadra já está reservada para este horário. Você foi adicionado à fila de espera!',
            emFila: true,
            reserva: {
              id: reservaFila.id,
              quadra: {
                id: reservaFila.quadra.id,
                nome: reservaFila.quadra.nome,
                esporte: reservaFila.quadra.esporte
              },
              locatario: reservaFila.locatario.nome,
              periodo: {
                dataInicio: formatarISOLocal(reservaFila.dataInicio),
                dataFim: formatarISOLocal(reservaFila.dataFim),
                duracao: `${(dataFimObj - dataInicioObj) / 3600000} horas`
                duracao: `${(dataFimObj - dataInicioObj) / 3600000} horas`
              },
              valorTotal: reservaFila.valorTotal,
              status: 'EM_FILA',
              posicaoFila: reservaFila.posicaoFila,
              conflitosExistentes: conflitos.map(c => ({
                id: c.id,
                dataInicio: formatarISOLocal(c.dataInicio),
                dataFim: formatarISOLocal(c.dataFim),
                locatario: c.locatario.nome,
                status: c.status
              }))
            }
          });
        } catch (erroFila) {
          return res.status(409).json({ 
            erro: erroFila.message || 'A quadra já possui reserva neste período',
            conflitosExistentes: conflitos.map(c => ({
              id: c.id,
              dataInicio: formatarISOLocal(c.dataInicio),
              dataFim: formatarISOLocal(c.dataFim),
              status: c.status
            }))
          });
        }
      }


      const duracao = (dataFimObj - dataInicioObj) / 3600000;
      if (duracao <= 0 || duracao > 24) {
        return res.status(400).json({ erro: 'Duração deve estar entre 0 e 24 horas' });
      }

      const valorTotal = parseFloat(quadra.valorPorHora) * duracao;

      const codigoSeguranca = securityService.gerarCodigoSeguranca();

      const statusInicial = quadra.requerAprovacao ? 'AGUARDANDO_APROVACAO' : 'RESERVADO';

      const novaReserva = await prisma.$transaction(async (tx) => {
        return tx.reserva.create({
          data: {
            quadraId: Number(quadraId),
            locatarioId: Number(locatarioId),
            dataInicio: dataInicioObj,
            dataFim: dataFimObj,
            valorTotal: parseFloat(valorTotal.toFixed(2)),
            status: statusInicial,
            timezoneOffset: -180,
            codigoSeguranca: codigoSeguranca
          },
          include: {
            quadra: { include: { locador: true, horarios: true } },
            locatario: true
          }
        });
      });

      if (statusInicial === 'AGUARDANDO_APROVACAO') {
        emailService.enviar(
          novaReserva.locatario.email,
          `${novaReserva.quadra.nome} - Sua reserva foi enviada para aprovação`,
          `
            <h2>Reserva enviada para aprovação</h2>
            <p>Olá ${novaReserva.locatario.nome},</p>
            <p>Sua solicitação de reserva foi recebida e está aguardando aprovação do locador.</p>
            <ul>
              <li><strong>Quadra:</strong> ${novaReserva.quadra.nome} (${novaReserva.quadra.esporte})</li>
              <li><strong>Data/Hora:</strong> ${formatarISOLocal(novaReserva.dataInicio)} até ${formatarISOLocal(novaReserva.dataFim)}</li>
              <li><strong>Valor:</strong> R$ ${parseFloat(novaReserva.valorTotal).toFixed(2)}</li>
            </ul>
            <p>Você receberá uma notificação assim que o locador aprovar ou rejeitar sua solicitação.</p>
          `
        );
        emailService.enviar(
          novaReserva.quadra.locador.email,
          `${novaReserva.quadra.nome} - Nova solicitação de reserva`,
          `
            <h2>Nova solicitação de reserva para aprovar</h2>
            <p>Olá ${novaReserva.quadra.locador.nome},</p>
            <p>O locatário <strong>${novaReserva.locatario.nome}</strong> solicitou uma reserva para sua quadra:</p>
            <ul>
              <li><strong>Quadra:</strong> ${novaReserva.quadra.nome}</li>
              <li><strong>Data/Hora:</strong> ${formatarISOLocal(novaReserva.dataInicio)} até ${formatarISOLocal(novaReserva.dataFim)}</li>
              <li><strong>Valor:</strong> R$ ${parseFloat(novaReserva.valorTotal).toFixed(2)}</li>
              <li><strong>Locatário:</strong> ${novaReserva.locatario.nome} (${novaReserva.locatario.email})</li>
            </ul>
            <p>Por favor, aprove ou rejeite esta solicitação em seu painel.</p>
          `
        );
      } else {
        const inicioEmail = formatarParaEmail(novaReserva.dataInicio);
        const fimEmail = formatarParaEmail(novaReserva.dataFim);
        emailService.enviar(
          novaReserva.locatario.email,
          `${novaReserva.quadra.nome} - Quadra reservada para ${inicioEmail.hora} do dia ${inicioEmail.data}!`,
          `
            <h2>Sua quadra foi reservada!</h2>
            <p>Olá ${novaReserva.locatario.nome},</p>
            <p>Sua quadra foi reservada com sucesso às <strong>${inicioEmail.hora}</strong> do dia <strong>${inicioEmail.data}</strong>.</p>
            <ul>
              <li><strong>Quadra:</strong> ${novaReserva.quadra.nome} (${novaReserva.quadra.esporte})</li>
              <li><strong>Horário:</strong> ${inicioEmail.hora} até ${fimEmail.hora}</li>
              <li><strong>Data:</strong> ${inicioEmail.data}</li>
              <li><strong>Valor Total:</strong> R$ ${parseFloat(novaReserva.valorTotal).toFixed(2)}</li>
            </ul>
            <p>Aproveite a quadra!</p>
          `
        );
      }

      const mensagemRetorno = statusInicial === 'AGUARDANDO_APROVACAO'
        ? 'Reserva criada com sucesso! Aguardando aprovação do locador.'
        : 'Reserva confirmada com sucesso!';

      res.status(201).json({
        mensagem: mensagemRetorno,
        reserva: {
          id: novaReserva.id,
          quadra: {
            id: novaReserva.quadra.id,
            nome: novaReserva.quadra.nome,
            esporte: novaReserva.quadra.esporte
          },
          locatario: novaReserva.locatario.nome,
          codigoSeguranca: novaReserva.codigoSeguranca,
          periodo: {
            dataInicio: formatarISOLocal(novaReserva.dataInicio),
            dataFim: formatarISOLocal(novaReserva.dataFim),
            duracao: `${duracao} horas`
          },
          valorTotal: novaReserva.valorTotal,
          status: novaReserva.status
        }
      });
    } catch (error) {
      res.status(400).json({ erro: 'Erro ao criar reserva', detalhes: error.message });
    }
  },

  getById: async (req, res) => {
    const { id } = req.params;

    try {
      const reserva = await reservaModel.findById(id);
      if (!reserva) {
        return res.status(404).json({ erro: 'Reserva não encontrada' });
      }

      if (req.user.tipo === 'LOCADOR' && reserva.quadra.locadorId !== req.user.id) {
        return res.status(403).json({ erro: 'Você não tem permissão para visualizar esta reserva' });
      }
      if (req.user.tipo === 'LOCATARIO' && reserva.locatarioId !== req.user.id) {
        return res.status(403).json({ erro: 'Você não tem permissão para visualizar esta reserva' });
      }

      const reservaComSeguranca = securityService.filtrarCodigosSeguranca(
        reserva,
        req.user.id,
        req.user.tipo
      );

      res.json({
        ...reservaComSeguranca,
        dataInicio: formatarISOLocal(reservaComSeguranca.dataInicio),
        dataFim: formatarISOLocal(reservaComSeguranca.dataFim)
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar reserva', detalhes: error.message });
    }
  },

  updateStatus: async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const statusValidos = ['PENDENTE', 'AGUARDANDO_APROVACAO', 'CANCELADO', 'RESERVADO', 'EM_FILA', 'OFERECIDO_LOCATARIO'];
    if (!status || !statusValidos.includes(status)) {
      return res.status(400).json({ 
        erro: 'Status inválido. Válidos: PENDENTE, AGUARDANDO_APROVACAO, CANCELADO, RESERVADO, EM_FILA, OFERECIDO_LOCATARIO' 
      });
    }

    try {
      const reserva = await reservaModel.findById(id);
      if (!reserva) {
        return res.status(404).json({ erro: 'Reserva não encontrada' });
      }

      const isLocador = req.user.tipo === 'LOCADOR' && reserva.quadra.locadorId === req.user.id;
      const isLocatario = req.user.tipo === 'LOCATARIO' && reserva.locatarioId === req.user.id;

      if (isLocador) {
        const reservaAtualizada = await reservaModel.update(id, { status });

        if (status === 'RESERVADO') {
          emailService.enviar(
            reservaAtualizada.locatario.email,
            `${reservaAtualizada.quadra.nome} - Sua reserva foi APROVADA!`,
            `
              <h2>Sua reserva foi aprovada!</h2>
              <p>Olá ${reservaAtualizada.locatario.nome},</p>
              <p>Ótima notícia! O locador <strong>${reservaAtualizada.quadra.locador.nome}</strong> aprovou sua reserva!</p>
              <ul>
                <li><strong>Quadra:</strong> ${reservaAtualizada.quadra.nome}</li>
                <li><strong>Data/Hora:</strong> ${formatarISOLocal(reservaAtualizada.dataInicio)} até ${formatarISOLocal(reservaAtualizada.dataFim)}</li>
                <li><strong>Valor:</strong> R$ ${parseFloat(reservaAtualizada.valorTotal).toFixed(2)}</li>
              </ul>
              <p>Sua reserva está confirmada! Aproveite a quadra!</p>
            `
          );
        } else if (status === 'CANCELADO') {
          const motivo = req.body?.motivo || '';
          emailService.notificarCancelamentoPorLocador(
            reservaAtualizada.locatario,
            reservaAtualizada.quadra,
            reservaAtualizada,
            motivo
          );
        }

        return res.json({
          mensagem: 'Status da reserva atualizado com sucesso',
          reserva: {
            id: reservaAtualizada.id,
            status: reservaAtualizada.status,
            quadra: reservaAtualizada.quadra.nome,
            locatario: reservaAtualizada.locatario.nome,
            periodo: {
              dataInicio: formatarISOLocal(reservaAtualizada.dataInicio),
              dataFim: formatarISOLocal(reservaAtualizada.dataFim)
            }
          }
        });
      }

      if (isLocatario && status === 'CANCELADO') {
        if (reserva.status === 'CANCELADO') {
          return res.status(400).json({ erro: 'Reserva já foi cancelada' });
        }

        const horasAntecedencia = reserva.quadra.horasAntecedenciaCancelamento ?? 6;
        const horasRestantes = (new Date(reserva.dataInicio) - new Date()) / 3600000;
        if (horasRestantes < horasAntecedencia) {
          return res.status(400).json({
            erro: `Cancelamento não permitido. Esta quadra exige ${horasAntecedencia}h de antecedência para cancelamento sem prejuízo. Restam ${Math.max(0, horasRestantes).toFixed(1)}h para a reserva.`
          });
        }

        if (['RESERVADO', 'AGUARDANDO_APROVACAO'].includes(reserva.status)) {
          await filaService.processarProximaFila(
            reserva.quadraId,
            reserva.dataInicio,
            reserva.dataFim
          );
        }

        const reservaCancelada = await reservaModel.update(id, { status: 'CANCELADO' });

        const motivo = req.body?.motivo || '';
        emailService.notificarCancelamentoPorLocatario(
          reservaCancelada.quadra.locador,
          reservaCancelada.quadra,
          reservaCancelada,
          reservaCancelada.locatario,
          motivo
        );

        return res.json({
          mensagem: 'Reserva cancelada com sucesso',
          reserva: {
            id: reservaCancelada.id,
            status: reservaCancelada.status,
            quadra: reservaCancelada.quadra.nome,
            locatario: reservaCancelada.locatario.nome,
            periodo: {
              dataInicio: formatarISOLocal(reservaCancelada.dataInicio),
              dataFim: formatarISOLocal(reservaCancelada.dataFim)
            }
          }
        });
      }

      return res.status(403).json({ 
        erro: 'Locatário só pode cancelar (status=CANCELADO) sua própria reserva' 
      });

    } catch (error) {
      res.status(400).json({ erro: 'Erro ao atualizar status', detalhes: error.message });
    }
  },

  cancel: async (req, res) => {
    const { id } = req.params;

    try {
      const reserva = await reservaModel.findById(id);
      if (!reserva) {
        return res.status(404).json({ erro: 'Reserva não encontrada' });
      }

      if (req.user.tipo === 'LOCADOR' && reserva.quadra.locadorId !== req.user.id) {
        return res.status(403).json({ erro: 'Você não tem permissão para cancelar esta reserva' });
      }
      if (req.user.tipo === 'LOCATARIO' && reserva.locatarioId !== req.user.id) {
        return res.status(403).json({ erro: 'Você não tem permissão para cancelar esta reserva' });
      }

      if (reserva.status === 'CANCELADO') {
        return res.status(400).json({ erro: 'Reserva já foi cancelada' });
      }

      if (req.user.tipo === 'LOCATARIO') {
        const horasAntecedencia = reserva.quadra.horasAntecedenciaCancelamento ?? 6;
        const horasRestantes = (new Date(reserva.dataInicio) - new Date()) / 3600000;
        if (horasRestantes < horasAntecedencia) {
          return res.status(400).json({
            erro: `Cancelamento não permitido. Esta quadra exige ${horasAntecedencia}h de antecedência para cancelamento sem prejuízo. Restam ${Math.max(0, horasRestantes).toFixed(1)}h para a reserva.`
          });
        }
      }

      if (['RESERVADO', 'AGUARDANDO_APROVACAO'].includes(reserva.status)) {
        console.log(`\n🔄 Processando fila para: ${reserva.quadraId} - ${reserva.dataInicio}`);
        try {
          const proximaFila = await filaService.processarProximaFila(
            reserva.quadraId,
            reserva.dataInicio,
            reserva.dataFim
          );
          if (proximaFila) {
            console.log(`Próximo da fila ofertado: ${proximaFila.locatario.nome}`);
          } else {
            console.log(`Nenhuma fila para este horário`);
          }
        } catch (erroFila) {
          console.error(`Erro ao processar fila: ${erroFila.message}`);
        }
      }

      const reservaCancelada = await reservaModel.update(id, { status: 'CANCELADO' });

      const isLocadorCancelando = req.user.tipo === 'LOCADOR';
      const motivo = req.body?.motivo || '';
      
      if (isLocadorCancelando) {
        emailService.notificarCancelamentoPorLocador(
          reservaCancelada.locatario,
          reservaCancelada.quadra,
          reservaCancelada,
          motivo
        );
      } else {
        emailService.notificarCancelamentoPorLocatario(
          reservaCancelada.quadra.locador,
          reservaCancelada.quadra,
          reservaCancelada,
          reservaCancelada.locatario,
          motivo
        );
      }

      res.json({
        mensagem: 'Reserva cancelada com sucesso',
        reserva: {
          id: reservaCancelada.id,
          status: reservaCancelada.status,
          quadra: reservaCancelada.quadra.nome,
          locatario: reservaCancelada.locatario.nome
        }
      });
    } catch (error) {
      res.status(400).json({ erro: 'Erro ao cancelar reserva', detalhes: error.message });
    }
  },

  getReservasByQuadra: async (req, res) => {
    const { quadraId } = req.params;

    try {
      const quadra = await quadraModel.findById(quadraId);
      if (!quadra) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      const reservas = await reservaModel.findByQuadra(quadraId);

      const reservasComSeguranca = securityService.filtrarCodigosSeguranca(
        reservas,
        req.user.id,
        'LOCADOR'
      );

      res.json({
        quadra: {
          id: quadra.id,
          nome: quadra.nome,
          esporte: quadra.esporte,
          valorPorHora: quadra.valorPorHora
        },
        totalReservas: reservasComSeguranca.length,
        reservas: reservasComSeguranca.map(r => ({
          id: r.id,
          locatario: r.locatario.nome,
          codigoSeguranca: r.codigoSeguranca,
          periodo: {
            dataInicio: formatarISOLocal(r.dataInicio),
            dataFim: formatarISOLocal(r.dataFim)
          },
          status: r.status,
          valorTotal: r.valorTotal
        }))
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar reservas', detalhes: error.message });
    }
  },

  getClientesByQuadra: async (req, res) => {
    try {
      if (req.user.tipo !== 'LOCADOR') {
        return res.status(403).json({ erro: 'Apenas locadores podem acessar esse histórico' });
      }

      const { quadraId } = req.params;
      const quadra = await quadraModel.findById(quadraId);
      if (!quadra) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      if (quadra.locadorId !== req.user.id) {
        return res.status(403).json({ erro: 'Você não tem permissão para visualizar o histórico desta quadra' });
      }

      const reservas = await reservaModel.findClientesByQuadra(quadraId);
      const totalGasto = reservas.reduce((sum, reserva) => sum + parseFloat(reserva.valorTotal), 0);
      const totalClientes = new Set(reservas.map(r => r.locatarioId)).size;

      const reservasComSeguranca = securityService.filtrarCodigosSeguranca(
        reservas,
        req.user.id,
        'LOCADOR'
      );

      res.json({
        quadra: {
          id: quadra.id,
          nome: quadra.nome,
          esporte: quadra.esporte,
          valorPorHora: quadra.valorPorHora
        },
        totalReservas: reservasComSeguranca.length,
        totalClientes,
        totalGasto: parseFloat(totalGasto.toFixed(2)),
        reservas: reservasComSeguranca.map(r => ({
          id: r.id,
          locatario: {
            id: r.locatario.id,
            nome: r.locatario.nome,
            email: r.locatario.email
          },
          codigoSeguranca: r.codigoSeguranca,
          dataInicio: formatarISOLocal(r.dataInicio),
          dataFim: formatarISOLocal(r.dataFim),
          diaReserva: formatarISOLocal(r.dataInicio).split('T')[0],
          valorTotal: r.valorTotal,
          status: r.status
        }))
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar histórico de clientes da quadra', detalhes: error.message });
    }
  },

  getClientesByLocador: async (req, res) => {
    try {
      if (req.user.tipo !== 'LOCADOR') {
        return res.status(403).json({ erro: 'Apenas locadores podem acessar esse recurso' });
      }

      const { locadorId } = req.params;

      if (Number(locadorId) !== req.user.id) {
        return res.status(403).json({ erro: 'Você não tem permissão para acessar os clientes de outro locador' });
      }

      const reservas = await reservaModel.findClientesByLocador(locadorId);

      const clientes = reservas.map(r => ({
        id: r.locatario.id,
        nome: r.locatario.nome,
        email: r.locatario.email,
      }));

      res.json({ clientes });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar clientes do locador', detalhes: error.message });
    }
  },

  getHistoricoLocador: async (req, res) => {
    try {
      if (req.user.tipo !== 'LOCADOR') {
        return res.status(403).json({ erro: 'Apenas locadores podem acessar esse histórico' });
      }

      const reservas = await reservaModel.findHistoricoByLocador(req.user.id);
      const totalGasto = reservas.reduce((sum, reserva) => sum + parseFloat(reserva.valorTotal), 0);
      const totalClientes = new Set(reservas.map(r => r.locatarioId)).size;

      const reservasComSeguranca = securityService.filtrarCodigosSeguranca(
        reservas,
        req.user.id,
        'LOCADOR'
      );

      res.json({
        totalReservas: reservasComSeguranca.length,
        totalClientes,
        totalGasto: parseFloat(totalGasto.toFixed(2)),
        historico: reservasComSeguranca.map(r => ({
          id: r.id,
          quadra: {
            id: r.quadra.id,
            nome: r.quadra.nome,
            esporte: r.quadra.esporte
          },
          locatario: {
            id: r.locatario.id,
            nome: r.locatario.nome,
            email: r.locatario.email
          },
          codigoSeguranca: r.codigoSeguranca,
          dataInicio: formatarISOLocal(r.dataInicio),
          dataFim: formatarISOLocal(r.dataFim),
          diaReserva: formatarISOLocal(r.dataInicio).split('T')[0],
          valorTotal: r.valorTotal,
          status: r.status
        }))
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar histórico do locador', detalhes: error.message });
    }
  },

  getHistoricoLocatario: async (req, res) => {
    try {
      if (req.user.tipo !== 'LOCATARIO') {
        return res.status(403).json({ erro: 'Apenas locatários podem acessar esse histórico' });
      }

      const reservas = await reservaModel.findHistoricoByLocatario(req.user.id);

      const reservasComSeguranca = securityService.filtrarCodigosSeguranca(
        reservas,
        req.user.id,
        'LOCATARIO'
      );

      res.json({
        totalReservas: reservasComSeguranca.length,
        historico: reservasComSeguranca.map(r => ({
          id: r.id,
          quadra: {
            id: r.quadra.id,
            nome: r.quadra.nome,
            esporte: r.quadra.esporte
          },
          dataInicio: formatarISOLocal(r.dataInicio),
          dataFim: formatarISOLocal(r.dataFim),
          diaReserva: formatarISOLocal(r.dataInicio).split('T')[0],
          valorTotal: r.valorTotal,
          status: r.status,
          codigoSeguranca: r.codigoSeguranca
        }))
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar histórico do locatário', detalhes: error.message });
    }
  },

  proximaReserva: async (req, res) => {
    try {
      const locatarioId = req.user.id;

      if (req.user.tipo !== 'LOCATARIO') {
        return res.status(403).json({ erro: 'Apenas locatários podem consultar suas próximas reservas' });
      }

      const reservas = await reservaModel.findByLocatario(locatarioId);

      const agora = new Date();

      const reservasAguardando = reservas
        .filter(r => r.status === 'AGUARDANDO_APROVACAO' && new Date(r.dataInicio) > agora)
        .sort((a, b) => new Date(a.dataInicio) - new Date(b.dataInicio));

      if (reservasAguardando.length > 0) {
        const proxima = reservasAguardando[0];
        const dataInicio = new Date(proxima.dataInicio);
        const tempoRestante = dataInicio - agora;

        const dias = Math.floor(tempoRestante / (1000 * 60 * 60 * 24));
        const horas = Math.floor((tempoRestante % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutos = Math.floor((tempoRestante % (1000 * 60 * 60)) / (1000 * 60));
        const segundos = Math.floor((tempoRestante % (1000 * 60)) / 1000);

        return res.json({
          temReserva: true,
          tipo: 'AGUARDANDO_APROVACAO',
          proximaReserva: {
            id: proxima.id,
            quadra: {
              id: proxima.quadra.id,
              nome: proxima.quadra.nome,
              esporte: proxima.quadra.esporte,
              locador: proxima.quadra.locador.nome
            },
            periodo: {
              dataInicio: formatarISOLocal(proxima.dataInicio),
              dataFim: formatarISOLocal(proxima.dataFim)
            },
            valorTotal: proxima.valorTotal,
            codigoSeguranca: proxima.codigoSeguranca,
            status: proxima.status
          },
          dataSolicitacao: proxima.dataCriacao,
          timer: {
            dias,
            horas,
            minutos,
            segundos,
            formatado: `${dias}d ${horas}h ${minutos}m ${segundos}s`,
            emSegundos: Math.floor(tempoRestante / 1000)
          },
          mensagem: `Sua solicitação de aluguel foi recebida mas ainda aguarda aprovação do locador. Agendado para ${dias}d ${horas}h ${minutos}m ${segundos}s`
        });
      }

      const proximasReservas = reservas
        .filter(r => r.status === 'RESERVADO' && new Date(r.dataInicio) > agora)
        .sort((a, b) => new Date(a.dataInicio) - new Date(b.dataInicio));

      if (proximasReservas.length === 0) {
        return res.json({
          temReserva: false,
          tipo: 'NENHUMA',
          mensagem: 'Você não possui próximas reservas confirmadas ou solicitações pendentes',
          proximaReserva: null
        });
      }

      const proxima = proximasReservas[0];
      const dataInicio = new Date(proxima.dataInicio);

      const tempoRestante = dataInicio - agora;

      const dias = Math.floor(tempoRestante / (1000 * 60 * 60 * 24));
      const horas = Math.floor((tempoRestante % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutos = Math.floor((tempoRestante % (1000 * 60 * 60)) / (1000 * 60));
      const segundos = Math.floor((tempoRestante % (1000 * 60)) / 1000);

      res.json({
        temReserva: true,
        tipo: 'CONFIRMADA',
        proximaReserva: {
          id: proxima.id,
          quadra: {
            id: proxima.quadra.id,
            nome: proxima.quadra.nome,
            esporte: proxima.quadra.esporte,
            locador: proxima.quadra.locador.nome
          },
          periodo: {
            dataInicio: formatarISOLocal(proxima.dataInicio),
            dataFim: formatarISOLocal(proxima.dataFim)
          },
          valorTotal: proxima.valorTotal,
          codigoSeguranca: proxima.codigoSeguranca,
          status: proxima.status
        },
        timer: {
          dias,
          horas,
          minutos,
          segundos,
          formatado: `${dias}d ${horas}h ${minutos}m ${segundos}s`,
          emSegundos: Math.floor(tempoRestante / 1000)
        },
        mensagem: `Sua próxima reserva confirmada começa em ${dias}d ${horas}h ${minutos}m ${segundos}s`
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar próxima reserva', detalhes: error.message });
    }
  },

  proximaReservaLocador: async (req, res) => {
    try {
      const { locatarioId } = req.params;

      if (!locatarioId) {
        return res.status(400).json({ erro: 'ID do locatário é obrigatório' });
      }

      if (req.user.tipo !== 'LOCADOR') {
        return res.status(403).json({ erro: 'Apenas locadores podem consultar próximas reservas de clientes' });
      }

      const reservas = await reservaModel.findByLocatario(Number(locatarioId));

      const minhasQuadras = await prisma.quadra.findMany({
        where: { locadorId: req.user.id }
      });
      const idsMinhasQuadras = minhasQuadras.map(q => q.id);

      const minhasReservas = reservas.filter(r => idsMinhasQuadras.includes(r.quadraId));

      if (minhasReservas.length === 0) {
        return res.status(404).json({ erro: 'Este cliente não possui reservas em suas quadras' });
      }

      const agora = new Date();

      const reservasAguardando = minhasReservas
        .filter(r => r.status === 'AGUARDANDO_APROVACAO' && new Date(r.dataInicio) > agora)
        .sort((a, b) => new Date(a.dataInicio) - new Date(b.dataInicio));

      if (reservasAguardando.length > 0) {
        const proxima = reservasAguardando[0];
        const dataInicio = new Date(proxima.dataInicio);
        const tempoRestante = dataInicio - agora;

        const dias = Math.floor(tempoRestante / (1000 * 60 * 60 * 24));
        const horas = Math.floor((tempoRestante % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutos = Math.floor((tempoRestante % (1000 * 60 * 60)) / (1000 * 60));
        const segundos = Math.floor((tempoRestante % (1000 * 60)) / 1000);

        return res.json({
          temReserva: true,
          tipo: 'AGUARDANDO_APROVACAO',
          locatarioId: Number(locatarioId),
          cliente: proxima.locatario.nome,
          proximaReserva: {
            id: proxima.id,
            quadra: {
              id: proxima.quadra.id,
              nome: proxima.quadra.nome,
              esporte: proxima.quadra.esporte
            },
            periodo: {
              dataInicio: formatarISOLocal(proxima.dataInicio),
              dataFim: formatarISOLocal(proxima.dataFim)
            },
            valorTotal: proxima.valorTotal,
            codigoSeguranca: proxima.codigoSeguranca,
            status: proxima.status
          },
          dataSolicitacao: proxima.dataCriacao,
          timer: {
            dias,
            horas,
            minutos,
            segundos,
            formatado: `${dias}d ${horas}h ${minutos}m ${segundos}s`,
            emSegundos: Math.floor(tempoRestante / 1000)
          },
          mensagem: `${proxima.locatario.nome} solicitou aluguel de ${proxima.quadra.nome} para ${dias}d ${horas}h ${minutos}m ${segundos}s. Aguardando sua aprovação`
        });
      }

      const proximasReservas = minhasReservas
        .filter(r => r.status === 'RESERVADO' && new Date(r.dataInicio) > agora)
        .sort((a, b) => new Date(a.dataInicio) - new Date(b.dataInicio));

      if (proximasReservas.length === 0) {
        return res.json({
          temReserva: false,
          tipo: 'NENHUMA',
          locatarioId: Number(locatarioId),
          cliente: minhasReservas[0]?.locatario?.nome || 'Cliente',
          mensagem: 'Este cliente não possui próximas reservas confirmadas ou solicitações pendentes',
          proximaReserva: null
        });
      }

      const proxima = proximasReservas[0];
      const dataInicio = new Date(proxima.dataInicio);

      const tempoRestante = dataInicio - agora;

      const dias = Math.floor(tempoRestante / (1000 * 60 * 60 * 24));
      const horas = Math.floor((tempoRestante % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutos = Math.floor((tempoRestante % (1000 * 60 * 60)) / (1000 * 60));
      const segundos = Math.floor((tempoRestante % (1000 * 60)) / 1000);

      res.json({
        temReserva: true,
        tipo: 'CONFIRMADA',
        locatarioId: Number(locatarioId),
        cliente: proxima.locatario.nome,
        proximaReserva: {
          id: proxima.id,
          quadra: {
            id: proxima.quadra.id,
            nome: proxima.quadra.nome,
            esporte: proxima.quadra.esporte
          },
          periodo: {
            dataInicio: formatarISOLocal(proxima.dataInicio),
            dataFim: formatarISOLocal(proxima.dataFim)
          },
          valorTotal: proxima.valorTotal,
          codigoSeguranca: proxima.codigoSeguranca,
          status: proxima.status
        },
        timer: {
          dias,
          horas,
          minutos,
          segundos,
          formatado: `${dias}d ${horas}h ${minutos}m ${segundos}s`,
          emSegundos: Math.floor(tempoRestante / 1000)
        },
        mensagem: `${proxima.locatario.nome} tem reserva em ${proxima.quadra.nome} em ${dias}d ${horas}h ${minutos}m ${segundos}s`
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar próxima reserva', detalhes: error.message });
    }
  },

  getReservasLocadorDia: async (req, res) => {
    try {
      if (req.user.tipo !== 'LOCADOR') {
        return res.status(403).json({ erro: 'Apenas locadores podem acessar essa rota' });
      }

      const { data } = req.query;

      if (!data) {
        return res.status(400).json({ erro: 'Parâmetro obrigatório: data (formato: YYYY-MM-DD)' });
      }

      const regexData = /^\d{4}-\d{2}-\d{2}$/;
      if (!regexData.test(data)) {
        return res.status(400).json({ erro: 'Formato de data inválido. Use: YYYY-MM-DD' });
      }

      const [year, month, day] = data.split('-');
      const dataObj = new Date(year, month - 1, day);
      
      if (isNaN(dataObj.getTime())) {
        return res.status(400).json({ erro: 'Data inválida' });
      }

      const reservas = await reservaModel.findByLocadorAndDate(req.user.id, data);

      const reservasComSeguranca = securityService.filtrarCodigosSeguranca(
        reservas,
        req.user.id,
        'LOCADOR'
      );

      res.json({
        data: data,
        totalReservas: reservasComSeguranca.length,
        reservas: reservasComSeguranca.map(r => ({
          id: r.id,
          quadra: {
            id: r.quadra.id,
            nome: r.quadra.nome,
            esporte: r.quadra.esporte,
            valorPorHora: r.quadra.valorPorHora
          },
          locatario: {
            id: r.locatario.id,
            nome: r.locatario.nome,
            telefone: r.locatario.telefone
          },
          codigoSeguranca: r.codigoSeguranca,
          periodo: {
            dataInicio: formatarISOLocal(r.dataInicio),
            dataFim: formatarISOLocal(r.dataFim)
          },
          status: r.status,
          valorTotal: r.valorTotal
        }))
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar reservas do dia', detalhes: error.message });
    }
  },

  bloquearHorario: async (req, res) => {
    const { quadraId, dataInicio, dataFim, motivo } = req.body;
    const locadorId = req.user.id;

    if (!quadraId || !dataInicio || !dataFim) {
      return res.status(400).json({ erro: 'Campos obrigatórios: quadraId, dataInicio, dataFim' });
    }

    try {
      const quadra = await quadraModel.findById(quadraId);
      if (!quadra) return res.status(404).json({ erro: 'Quadra não encontrada' });
      if (quadra.locadorId !== locadorId) {
        return res.status(403).json({ erro: 'Você não tem permissão para bloquear esta quadra' });
      }

      const dataInicioObj = parseDateUTC3(dataInicio);
      const dataFimObj = parseDateUTC3(dataFim);

      if (isNaN(dataInicioObj.getTime()) || isNaN(dataFimObj.getTime())) {
        return res.status(400).json({ erro: 'Formato de data inválido' });
      }
      if (dataInicioObj >= dataFimObj) {
        return res.status(400).json({ erro: 'dataInicio deve ser anterior a dataFim' });
      }

      const bloqueio = await prisma.reserva.create({
        data: {
          quadraId: Number(quadraId),
          locatarioId: locadorId,
          dataInicio: dataInicioObj,
          dataFim: dataFimObj,
          valorTotal: 0,
          status: 'BLOQUEADO',
          timezoneOffset: -180,
        },
      });

      return res.status(201).json({
        mensagem: motivo ? `Horário bloqueado: ${motivo}` : 'Horário bloqueado com sucesso.',
        bloqueio: {
          id: bloqueio.id,
          quadraId: bloqueio.quadraId,
          periodo: {
            dataInicio: formatarISOLocal(bloqueio.dataInicio),
            dataFim: formatarISOLocal(bloqueio.dataFim),
          },
          motivo: motivo ?? null,
          status: bloqueio.status,
        },
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao bloquear horário', detalhes: error.message });
    }
  },

  desbloquearHorario: async (req, res) => {
    const { id } = req.params;
    const locadorId = req.user.id;

    try {
      const reserva = await reservaModel.findById(id);
      if (!reserva) return res.status(404).json({ erro: 'Bloqueio não encontrado' });
      if (reserva.status !== 'BLOQUEADO') {
        return res.status(400).json({ erro: 'Esta entrada não é um bloqueio' });
      }
      if (reserva.quadra.locadorId !== locadorId) {
        return res.status(403).json({ erro: 'Você não tem permissão para remover este bloqueio' });
      }

      await prisma.reserva.delete({ where: { id: Number(id) } });

      return res.json({ mensagem: 'Bloqueio removido com sucesso.' });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao remover bloqueio', detalhes: error.message });
    }
  },
};

/**
 * Valida se o período de reserva está dentro dos horários de funcionamento
 * Funciona como calendários do Outlook: valida dia da semana e horário
 */
function validarHorariosFuncionamento(quadra, dataInicio, dataFim) {
  if (!quadra.horarios || quadra.horarios.length === 0) {
    return { valido: false, erro: 'A quadra não possui horários de funcionamento configurados' };
  }

  const dataAtual = new Date(dataInicio);
  while (dataAtual < dataFim) {
    const diaSemana = dataAtual.getDay();
    const horario = quadra.horarios.find(h => h.diaSemana === diaSemana);

    if (!horario) {
      return { 
        valido: false, 
        erro: `A quadra está fechada no ${obterNomeDia(diaSemana)}` 
      };
    }

    if (dataAtual.toDateString() === dataInicio.toDateString()) {
      const horaInicio = String(dataInicio.getHours()).padStart(2, '0') + ':' + String(dataInicio.getMinutes()).padStart(2, '0');
      if (compararHorarios(horaInicio, horario.horaAbertura) < 0) {
        return { 
          valido: false, 
          erro: `A quadra abre às ${horario.horaAbertura} no ${obterNomeDia(diaSemana)}` 
        };
      }
    }

    if (dataAtual.toDateString() === dataFim.toDateString()) {
      const horaFim = String(dataFim.getHours()).padStart(2, '0') + ':' + String(dataFim.getMinutes()).padStart(2, '0');
      if (compararHorarios(horaFim, horario.horaFechamento) > 0) {
        return { 
          valido: false, 
          erro: `A quadra fecha às ${horario.horaFechamento} no ${obterNomeDia(diaSemana)}` 
        };
      }
    }

    dataAtual.setDate(dataAtual.getDate() + 1);
  }

  return { valido: true };
}

function compararHorarios(hora1, hora2) {
  const [h1, m1] = hora1.split(':').map(Number);
  const [h2, m2] = hora2.split(':').map(Number);
  
  const minutos1 = h1 * 60 + m1;
  const minutos2 = h2 * 60 + m2;
  
  if (minutos1 < minutos2) return -1;
  if (minutos1 > minutos2) return 1;
  return 0;
}

function obterNomeDia(dia) {
  const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  return dias[dia];
}

function formatarParaEmail(data) {
  const d = converterDeUTC(new Date(data));
  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  const ano = d.getUTCFullYear();
  const horas = String(d.getUTCHours()).padStart(2, '0');
  const minutos = String(d.getUTCMinutes()).padStart(2, '0');
  return { data: `${dia}/${mes}/${ano}`, hora: `${horas}:${minutos}` };
}

/**
 * Verificar código de segurança de uma reserva
 * Validação do código é sensível a maiúsculas/minúsculas
 * O código pode ser verificado pelo locador (proprietário da quadra) ou pelo locatário que fez a reserva
 */
reservaController.verificarCodigoSeguranca = async (req, res) => {
  const { id } = req.params;
  const { codigo } = req.body;

  try {
    if (!codigo || typeof codigo !== 'string') {
      return res.status(400).json({ 
        erro: 'Parâmetro obrigatório: codigo (string)' 
      });
    }

    if (!securityService.validarFormatoCodigo(codigo)) {
      return res.status(400).json({ 
        erro: 'Formato de código inválido. Use 4 caracteres alfanuméricos (0-9, A-Z)',
        formatoEsperado: 'XXXX'
      });
    }

    const reserva = await reservaModel.findById(id);
    if (!reserva) {
      return res.status(404).json({ erro: 'Reserva não encontrada' });
    }

    const isLocador = req.user.tipo === 'LOCADOR' && reserva.quadra.locadorId === req.user.id;
    const isLocatario = req.user.tipo === 'LOCATARIO' && reserva.locatarioId === req.user.id;

    if (!isLocador && !isLocatario) {
      return res.status(403).json({ 
        erro: 'Você não tem permissão para verificar o código desta reserva' 
      });
    }

    if (!reserva.codigoSeguranca) {
      return res.status(400).json({ 
        erro: 'Esta reserva não possui código de segurança associado' 
      });
    }

    const codigoFornecido = codigo.toUpperCase();
    const codigoValido = reserva.codigoSeguranca === codigoFornecido;

    if (codigoValido) {
      return res.json({
        valido: true,
        mensagem: 'Código de segurança verificado com sucesso!',
        reserva: {
          id: reserva.id,
          quadra: {
            id: reserva.quadra.id,
            nome: reserva.quadra.nome,
            esporte: reserva.quadra.esporte
          },
          locatario: {
            id: reserva.locatario.id,
            nome: reserva.locatario.nome,
            email: reserva.locatario.email
          },
          periodo: {
            dataInicio: formatarISOLocal(reserva.dataInicio),
            dataFim: formatarISOLocal(reserva.dataFim)
          },
          status: reserva.status,
          valorTotal: reserva.valorTotal
        }
      });
    } else {
      return res.status(400).json({
        valido: false,
        erro: 'Código de segurança incorreto',
        tentativasRestantes: 'Sem limite de tentativas'
      });
    }
  } catch (error) {
    res.status(500).json({ 
      erro: 'Erro ao verificar código de segurança', 
      detalhes: error.message 
    });
  }
};

module.exports = reservaController;
