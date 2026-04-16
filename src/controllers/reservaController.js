const reservaModel = require('../models/reservaModel');
const quadraModel = require('../models/quadraModel');
const prisma = require('../database/prismaClient');

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
      
      res.json(reservas);
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
      const dataInicioObj = new Date(dataInicio);
      const dataFimObj = new Date(dataFim);

      // Validar formato de data
      if (isNaN(dataInicioObj.getTime()) || isNaN(dataFimObj.getTime())) {
        return res.status(400).json({ erro: 'Formato de data inválido' });
      }

      // Validar ordenação de datas
      if (dataInicioObj >= dataFimObj) {
        return res.status(400).json({ erro: 'Data de início deve ser anterior à data de fim' });
      }

      // Validar se a reserva é no futuro
      if (dataInicioObj < new Date()) {
        return res.status(400).json({ erro: 'Não é possível fazer reservas no passado' });
      }

      // Buscar quadra
      const quadra = await quadraModel.findById(quadraId);
      if (!quadra) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      // Validar horários de funcionamento
      const horariosOK = validarHorariosFuncionamento(quadra, dataInicioObj, dataFimObj);
      if (!horariosOK.valido) {
        return res.status(400).json({ erro: horariosOK.erro });
      }

      // Validar conflitos de reserva
      const conflitos = await reservaModel.findConflicts(Number(quadraId), dataInicioObj, dataFimObj);
      if (conflitos.length > 0) {
        return res.status(409).json({ 
          erro: 'A quadra já possui reserva neste período',
          conflitosExistentes: conflitos.map(c => ({
            id: c.id,
            dataInicio: c.dataInicio,
            dataFim: c.dataFim,
            status: c.status
          }))
        });
      }

      // Calcular valor total
      const duracao = (dataFimObj - dataInicioObj) / 3600000; // Em horas
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
            status: 'AGUARDANDO_APROVACAO'
          },
          include: {
            quadra: { include: { locador: true, horarios: true } },
            locatario: true
          }
        });
      });

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
            dataInicio: novaReserva.dataInicio,
            dataFim: novaReserva.dataFim,
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

      res.json(reserva);
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar reserva', detalhes: error.message });
    }
  },

  // Atualizar status de reserva (apenas para locador aprovar/cancelar)
  updateStatus: async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const statusValidos = ['PENDENTE', 'AGUARDANDO_APROVACAO', 'CANCELADO', 'RESERVADO'];
    if (!status || !statusValidos.includes(status)) {
      return res.status(400).json({ 
        erro: 'Status inválido. Válidos: PENDENTE, AGUARDANDO_APROVACAO, CANCELADO, RESERVADO' 
      });
    }

    try {
      const reserva = await reservaModel.findById(id);
      if (!reserva) {
        return res.status(404).json({ erro: 'Reserva não encontrada' });
      }

      // Apenas locador da quadra pode atualizar status
      if (req.user.tipo !== 'LOCADOR' || reserva.quadra.locadorId !== req.user.id) {
        return res.status(403).json({ erro: 'Apenas o locador pode atualizar o status da reserva' });
      }

      const reservaAtualizada = await reservaModel.update(id, { status });

      res.json({
        mensagem: 'Status da reserva atualizado com sucesso',
        reserva: {
          id: reservaAtualizada.id,
          status: reservaAtualizada.status,
          quadra: reservaAtualizada.quadra.nome,
          locatario: reservaAtualizada.locatario.nome,
          periodo: {
            dataInicio: reservaAtualizada.dataInicio,
            dataFim: reservaAtualizada.dataFim
          }
        }
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
            dataInicio: r.dataInicio,
            dataFim: r.dataFim
          },
          status: r.status,
          valorTotal: r.valorTotal
        }))
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar reservas', detalhes: error.message });
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
