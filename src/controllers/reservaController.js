const reservaModel = require('../models/reservaModel');
const quadraModel = require('../models/quadraModel');
const prisma = require('../database/prismaClient');
const { converterParaUTC, formatarISOLocal } = require('../utils/dateUtils');

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
      // Converter datas de hora local para UTC
      const dataInicioObj = converterParaUTC(dataInicio);
      const dataFimObj = converterParaUTC(dataFim);

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
        return res.status(409).json({ 
          erro: 'A quadra já possui reserva neste período',
          conflitosExistentes: conflitos.map(c => ({
            id: c.id,
            dataInicio: formatarISOLocal(c.dataInicio),
            dataFim: formatarISOLocal(c.dataFim),
            status: c.status
          }))
        });
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
            status: 'AGUARDANDO_APROVACAO',
            timezoneOffset: -180 // UTC-3
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
