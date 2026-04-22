const reservaModel = require('../models/reservaModel');
const quadraModel = require('../models/quadraModel');
const emailService = require('../services/emailService');
const prisma = require('../database/prismaClient');
const { converterParaUTC, formatarISOLocal } = require('../utils/dateUtils');
const filaService = require('../services/filaService');

// Parseia uma string de data assumindo UTC-3 quando não há timezone explícito,
// evitando dupla conversão quando o servidor já roda em UTC-3.
function parseDateUTC3(s) {
  const hasTZ = s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s);
  return new Date(hasTZ ? s : s + '-03:00');
}

const reservaController = {
  // Listar todas as reservas do usuário autenticado
  list: async (req, res) => {
    try {
      let reservas;
      
      // Locador vê suas reservas recebidas e locatário vê suas reservas feitas
      if (req.user.tipo === 'LOCADOR') {
        reservas = await reservaModel.findByLocador(req.user.id);
      } else {
        reservas = await reservaModel.findByLocatario(req.user.id);
      }
      
      res.json(reservas.map(r => ({
        ...r,
        dataInicio: formatarISOLocal(r.dataInicio),
        dataFim: formatarISOLocal(r.dataFim)
      })));
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar reservas', detalhes: error.message });
    }
  },

  // Buscar disponibilidades de uma quadra em um período
  getAvailability: async (req, res) => {
    const { quadraId, dataInicio, dataFim } = req.query;

    if (!quadraId || !dataInicio || !dataFim) {
      return res.status(400).json({ 
        erro: 'Parâmetros obrigatórios: quadraId, dataInicio, dataFim (ISO format ou yyyy-MM-dd HH:mm)' 
      });
    }

    try {
      const dataInicioObj = new Date(dataInicio);
      const dataFimObj = new Date(dataFim);

      if (isNaN(dataInicioObj.getTime()) || isNaN(dataFimObj.getTime())) {
        return res.status(400).json({ erro: 'Formato de data inválido' });
      }

      if (dataInicioObj >= dataFimObj) {
        return res.status(400).json({ erro: 'Data de início deve ser menor que data de fim' });
      }

      // Buscar quadra
      const quadra = await quadraModel.findById(quadraId);
      if (!quadra) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      // Verificar horários de funcionamento
      const horariosOK = validarHorariosFuncionamento(quadra, dataInicioObj, dataFimObj);
      if (!horariosOK.valido) {
        return res.status(400).json({ erro: horariosOK.erro });
      }

      // Buscar disponibilidade
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

  // Criar nova reserva
  create: async (req, res) => {
    const { quadraId, dataInicio, dataFim } = req.body;
    const locatarioId = req.user.id;

    // Validações básicas
    if (!quadraId || !dataInicio || !dataFim) {
      return res.status(400).json({ erro: 'Campos obrigatórios: quadraId, dataInicio, dataFim' });
    }

    if (req.user.tipo !== 'LOCATARIO') {
      return res.status(403).json({ erro: 'Apenas locatários podem fazer reservas' });
    }

    try {
      // Parsear datas assumindo UTC-3 quando não há timezone explícito na string
      const dataInicioObj = parseDateUTC3(dataInicio);
      const dataFimObj = parseDateUTC3(dataFim);

      // Validar formato de data
      if (isNaN(dataInicioObj.getTime()) || isNaN(dataFimObj.getTime())) {
        return res.status(400).json({ erro: 'Formato de data inválido' });
      }

      // Validar ordenação de datas
      if (dataInicioObj >= dataFimObj) {
        return res.status(400).json({ erro: 'Data de início deve ser anterior à data de fim' });
      }

      // Validar se a reserva é no futuro (convertendo data atual para timezone local)
      const agora = new Date();
      if (dataInicioObj < agora) {
        return res.status(400).json({ erro: 'Não é possível fazer reservas no passado' });
      }

      // Buscar quadra
      const quadra = await quadraModel.findById(quadraId);
      if (!quadra) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      // Validar horários de funcionamento (usar datas locais para validação)
      const dataInicioLocal = new Date(dataInicio);
      const dataFimLocal = new Date(dataFim);
      const horariosOK = validarHorariosFuncionamento(quadra, dataInicioLocal, dataFimLocal);
      if (!horariosOK.valido) {
        return res.status(400).json({ erro: horariosOK.erro });
      }

      // Validar conflitos de reserva
      const conflitos = await reservaModel.findConflicts(Number(quadraId), dataInicioObj, dataFimObj);
      
      if (conflitos.length > 0) {
        // Há conflito - tentar adicionar à fila
        try {
          const eligibilidade = await filaService.verificarEligibilidadeFila(
            Number(quadraId),
            dataInicioObj,
            dataFimObj
          );

          // Calcular valor total
          const duracao = (dataFimLocal - dataInicioLocal) / 3600000; // Em horas
          if (duracao <= 0 || duracao > 24) {
            return res.status(400).json({ erro: 'Duração deve estar entre 0 e 24 horas' });
          }

          const valorTotal = parseFloat(quadra.valorPorHora) * duracao;

          // Criar reserva com status EM_FILA
          const novaReservaFila = await prisma.reserva.create({
            data: {
              quadraId: Number(quadraId),
              locatarioId: Number(locatarioId),
              dataInicio: dataInicioObj,
              dataFim: dataFimObj,
              valorTotal: parseFloat(valorTotal.toFixed(2)),
              status: 'EM_FILA',
              timezoneOffset: -180
            },
            include: {
              quadra: { include: { locador: true, horarios: true } },
              locatario: true
            }
          });

          // Adicionar à fila (vai gerar email)
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
                duracao: `${(dataFimLocal - dataInicioLocal) / 3600000} horas`
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
          // Não está elegível para fila (menos de 6 horas antes)
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


      // Calcular valor total
      const duracao = (dataFimLocal - dataInicioLocal) / 3600000; // Em horas
      if (duracao <= 0 || duracao > 24) {
        return res.status(400).json({ erro: 'Duração deve estar entre 0 e 24 horas' });
      }

      const valorTotal = parseFloat(quadra.valorPorHora) * duracao;

      // Criar reserva em transação
      const novaReserva = await prisma.$transaction(async (tx) => {
        return tx.reserva.create({
          data: {
            quadraId: Number(quadraId),
            locatarioId: Number(locatarioId),
            dataInicio: dataInicioObj,
            dataFim: dataFimObj,
            valorTotal: parseFloat(valorTotal.toFixed(2)),
            status: 'RESERVADO',
            timezoneOffset: -180 // UTC-3
          },
          include: {
            quadra: { include: { locador: true, horarios: true } },
            locatario: true
          }
        });
      });

      // Enviar email para o locatário confirmando que a reserva foi solicitada
      await emailService.enviar(
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

      // Enviar email para o locador informando que há uma nova reserva para aprovar
      await emailService.enviar(
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

      res.status(201).json({
        mensagem: 'Reserva criada com sucesso! Aguardando aprovação do locador.',
        reserva: {
          id: novaReserva.id,
          quadra: {
            id: novaReserva.quadra.id,
            nome: novaReserva.quadra.nome,
            esporte: novaReserva.quadra.esporte
          },
          locatario: novaReserva.locatario.nome,
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

  // Obter detalhes de uma reserva
  getById: async (req, res) => {
    const { id } = req.params;

    try {
      const reserva = await reservaModel.findById(id);
      if (!reserva) {
        return res.status(404).json({ erro: 'Reserva não encontrada' });
      }

      // Verificar permissão (locador da quadra ou locatário)
      if (req.user.tipo === 'LOCADOR' && reserva.quadra.locadorId !== req.user.id) {
        return res.status(403).json({ erro: 'Você não tem permissão para visualizar esta reserva' });
      }
      if (req.user.tipo === 'LOCATARIO' && reserva.locatarioId !== req.user.id) {
        return res.status(403).json({ erro: 'Você não tem permissão para visualizar esta reserva' });
      }

      res.json({
        ...reserva,
        dataInicio: formatarISOLocal(reserva.dataInicio),
        dataFim: formatarISOLocal(reserva.dataFim)
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar reserva', detalhes: error.message });
    }
  },

  // Atualizar status de reserva (locador aprova/rejeita, locatário cancela)
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

      // Verificar permissões baseado no status que quer atualizar
      const isLocador = req.user.tipo === 'LOCADOR' && reserva.quadra.locadorId === req.user.id;
      const isLocatario = req.user.tipo === 'LOCATARIO' && reserva.locatarioId === req.user.id;

      // Locador pode atualizar para qualquer status
      if (isLocador) {
        const reservaAtualizada = await reservaModel.update(id, { status });

        // Enviar email informando ao locatário
        if (status === 'RESERVADO') {
          await emailService.enviar(
            reservaAtualizada.locatario.email,
            `${reservaAtualizada.quadra.nome} - Sua reserva foi APROVADA! ✅`,
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
          await emailService.enviar(
            reservaAtualizada.locatario.email,
            `${reservaAtualizada.quadra.nome} - Sua reserva foi REJEITADA ❌`,
            `
              <h2>Sua reserva foi rejeitada</h2>
              <p>Olá ${reservaAtualizada.locatario.nome},</p>
              <p>Infelizmente, o locador <strong>${reservaAtualizada.quadra.locador.nome}</strong> não aprovou sua reserva.</p>
              <ul>
                <li><strong>Quadra:</strong> ${reservaAtualizada.quadra.nome}</li>
                <li><strong>Data/Hora:</strong> ${formatarISOLocal(reservaAtualizada.dataInicio)} até ${formatarISOLocal(reservaAtualizada.dataFim)}</li>
              </ul>
              <p>Você pode tentar agendar para outro horário.</p>
            `
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

      // Locatário só pode cancelar sua própria reserva
      if (isLocatario && status === 'CANCELADO') {
        if (reserva.status === 'CANCELADO') {
          return res.status(400).json({ erro: 'Reserva já foi cancelada' });
        }

        // Se é RESERVADO ou AGUARDANDO_APROVACAO, processar fila
        if (['RESERVADO', 'AGUARDANDO_APROVACAO'].includes(reserva.status)) {
          await filaService.processarProximaFila(
            reserva.quadraId,
            reserva.dataInicio,
            reserva.dataFim
          );
        }

        const reservaCancelada = await reservaModel.update(id, { status: 'CANCELADO' });

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

      // Se chegou aqui, locatário tentou atualizar para status não permitido
      return res.status(403).json({ 
        erro: 'Locatário só pode cancelar (status=CANCELADO) sua própria reserva' 
      });

    } catch (error) {
      res.status(400).json({ erro: 'Erro ao atualizar status', detalhes: error.message });
    }
  },

  // Cancelar reserva (locatário ou locador)
  cancel: async (req, res) => {
    const { id } = req.params;

    try {
      const reserva = await reservaModel.findById(id);
      if (!reserva) {
        return res.status(404).json({ erro: 'Reserva não encontrada' });
      }

      // Verificar permissão
      if (req.user.tipo === 'LOCADOR' && reserva.quadra.locadorId !== req.user.id) {
        return res.status(403).json({ erro: 'Você não tem permissão para cancelar esta reserva' });
      }
      if (req.user.tipo === 'LOCATARIO' && reserva.locatarioId !== req.user.id) {
        return res.status(403).json({ erro: 'Você não tem permissão para cancelar esta reserva' });
      }

      // Validar se pode cancelar (não está cancelada)
      if (reserva.status === 'CANCELADO') {
        return res.status(400).json({ erro: 'Reserva já foi cancelada' });
      }

      // Se é RESERVADO ou AGUARDANDO_APROVACAO, processar fila
      if (['RESERVADO', 'AGUARDANDO_APROVACAO'].includes(reserva.status)) {
        console.log(`\n🔄 Processando fila para: ${reserva.quadraId} - ${reserva.dataInicio}`);
        try {
          const proximaFila = await filaService.processarProximaFila(
            reserva.quadraId,
            reserva.dataInicio,
            reserva.dataFim
          );
          if (proximaFila) {
            console.log(`✅ Próximo da fila ofertado: ${proximaFila.locatario.nome}`);
          } else {
            console.log(`ℹ️ Nenhuma fila para este horário`);
          }
        } catch (erroFila) {
          console.error(`❌ Erro ao processar fila: ${erroFila.message}`);
        }
      }

      const reservaCancelada = await reservaModel.update(id, { status: 'CANCELADO' });

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

  // Listar reservas de uma quadra específica (para validação de conflitos)
  getReservasByQuadra: async (req, res) => {
    const { quadraId } = req.params;

    try {
      const quadra = await quadraModel.findById(quadraId);
      if (!quadra) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      const reservas = await reservaModel.findByQuadra(quadraId);

      res.json({
        quadra: {
          id: quadra.id,
          nome: quadra.nome,
          esporte: quadra.esporte,
          valorPorHora: quadra.valorPorHora
        },
        totalReservas: reservas.length,
        reservas: reservas.map(r => ({
          id: r.id,
          locatario: r.locatario.nome,
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

  // Listar clientes e histórico de reservas para uma quadra específica
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

      res.json({
        quadra: {
          id: quadra.id,
          nome: quadra.nome,
          esporte: quadra.esporte,
          valorPorHora: quadra.valorPorHora
        },
        totalReservas: reservas.length,
        totalClientes,
        totalGasto: parseFloat(totalGasto.toFixed(2)),
        reservas: reservas.map(r => ({
          id: r.id,
          locatario: {
            id: r.locatario.id,
            nome: r.locatario.nome,
            email: r.locatario.email
          },
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

  // Listar histórico de todos os clientes do locador autenticado
  getHistoricoLocador: async (req, res) => {
    try {
      if (req.user.tipo !== 'LOCADOR') {
        return res.status(403).json({ erro: 'Apenas locadores podem acessar esse histórico' });
      }

      const reservas = await reservaModel.findHistoricoByLocador(req.user.id);
      const totalGasto = reservas.reduce((sum, reserva) => sum + parseFloat(reserva.valorTotal), 0);
      const totalClientes = new Set(reservas.map(r => r.locatarioId)).size;

      res.json({
        totalReservas: reservas.length,
        totalClientes,
        totalGasto: parseFloat(totalGasto.toFixed(2)),
        historico: reservas.map(r => ({
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

  // Timer da próxima reserva do locatário (melhor prática: usa token)
  proximaReserva: async (req, res) => {
    try {
      // Usar o ID do token (melhor prática de segurança)
      const locatarioId = req.user.id;

      if (req.user.tipo !== 'LOCATARIO') {
        return res.status(403).json({ erro: 'Apenas locatários podem consultar suas próximas reservas' });
      }

      // Buscar todas as reservas do locatário
      const reservas = await reservaModel.findByLocatario(locatarioId);

      const agora = new Date();

      // 1. Procurar por reservas AGUARDANDO_APROVACAO no futuro (alta prioridade)
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

      // 2. Se não houver aguardando, procurar por reservas RESERVADO no futuro
      const proximasReservas = reservas
        .filter(r => r.status === 'RESERVADO' && new Date(r.dataInicio) > agora)
        .sort((a, b) => new Date(a.dataInicio) - new Date(b.dataInicio));

      // Se não houver próximas reservas
      if (proximasReservas.length === 0) {
        return res.json({
          temReserva: false,
          tipo: 'NENHUMA',
          mensagem: 'Você não possui próximas reservas confirmadas ou solicitações pendentes',
          proximaReserva: null
        });
      }

      // Pegar a primeira (próxima) reserva confirmada
      const proxima = proximasReservas[0];
      const dataInicio = new Date(proxima.dataInicio);

      // Calcular tempo restante
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

  // Timer da próxima reserva de outro locatário (para locadores gerenciarem)
  proximaReservaLocador: async (req, res) => {
    try {
      const { locatarioId } = req.params;

      if (!locatarioId) {
        return res.status(400).json({ erro: 'ID do locatário é obrigatório' });
      }

      if (req.user.tipo !== 'LOCADOR') {
        return res.status(403).json({ erro: 'Apenas locadores podem consultar próximas reservas de clientes' });
      }

      // Buscar todas as reservas do locatário
      const reservas = await reservaModel.findByLocatario(Number(locatarioId));

      // Validar que essas reservas pertencem às quadras do locador
      const minhasQuadras = await prisma.quadra.findMany({
        where: { locadorId: req.user.id }
      });
      const idsMinhasQuadras = minhasQuadras.map(q => q.id);

      const minhasReservas = reservas.filter(r => idsMinhasQuadras.includes(r.quadraId));

      if (minhasReservas.length === 0) {
        return res.status(404).json({ erro: 'Este cliente não possui reservas em suas quadras' });
      }

      const agora = new Date();

      // 1. Procurar por reservas AGUARDANDO_APROVACAO no futuro (alta prioridade)
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

      // 2. Se não houver aguardando, procurar por reservas RESERVADO no futuro
      const proximasReservas = minhasReservas
        .filter(r => r.status === 'RESERVADO' && new Date(r.dataInicio) > agora)
        .sort((a, b) => new Date(a.dataInicio) - new Date(b.dataInicio));

      // Se não houver próximas reservas
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

      // Pegar a primeira (próxima) reserva confirmada
      const proxima = proximasReservas[0];
      const dataInicio = new Date(proxima.dataInicio);

      // Calcular tempo restante
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

  // Buscar todas as reservas do locador para um dia específico
  getReservasLocadorDia: async (req, res) => {
    try {
      if (req.user.tipo !== 'LOCADOR') {
        return res.status(403).json({ erro: 'Apenas locadores podem acessar essa rota' });
      }

      const { data } = req.query;

      if (!data) {
        return res.status(400).json({ erro: 'Parâmetro obrigatório: data (formato: YYYY-MM-DD)' });
      }

      // Validar formato da data YYYY-MM-DD
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

      res.json({
        data: data,
        totalReservas: reservas.length,
        reservas: reservas.map(r => ({
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
  }
};

/**
 * Valida se o período de reserva está dentro dos horários de funcionamento
 * Funciona como calendários do Outlook: valida dia da semana e horário
 */
function validarHorariosFuncionamento(quadra, dataInicio, dataFim) {
  if (!quadra.horarios || quadra.horarios.length === 0) {
    return { valido: false, erro: 'A quadra não possui horários de funcionamento configurados' };
  }

  // Percorrer cada dia no intervalo e validar
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

    // Para o primeiro dia, validar hora de início
    if (dataAtual.getTime() === dataInicio.getTime()) {
      const horaInicio = dataInicio.getHours() + ':' + String(dataInicio.getMinutes()).padStart(2, '0');
      if (horaInicio < horario.horaAbertura) {
        return { 
          valido: false, 
          erro: `A quadra abre às ${horario.horaAbertura} no ${obterNomeDia(diaSemana)}` 
        };
      }
    }

    // Para o último dia, validar hora de término
    if (dataAtual.getDate() === dataFim.getDate() && dataAtual.getMonth() === dataFim.getMonth()) {
      const horaFim = dataFim.getHours() + ':' + String(dataFim.getMinutes()).padStart(2, '0');
      if (horaFim > horario.horaFechamento) {
        return { 
          valido: false, 
          erro: `A quadra fecha às ${horario.horaFechamento} no ${obterNomeDia(diaSemana)}` 
        };
      }
    }

    // Avançar um dia
    dataAtual.setDate(dataAtual.getDate() + 1);
  }

  return { valido: true };
}

function obterNomeDia(dia) {
  const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  return dias[dia];
}

module.exports = reservaController;
