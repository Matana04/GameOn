const prisma = require('../database/prismaClient');
const bloqueioQuadraModel = require('../models/bloqueioQuadraModel');
const quadraModel = require('../models/quadraModel');
const reservaModel = require('../models/reservaModel');

const bloqueioQuadraController = {
  // Criar bloqueio de quadra
  criar: async (req, res) => {
    const locadorId = req.user.id;
    const { quadraId, dataInicio, dataFim, motivo, descricao, horaInicio, horaFim } = req.body;

    try {
      // Validar campos obrigatórios
      if (!quadraId || !dataInicio || !dataFim || !motivo) {
        return res.status(400).json({
          erro: 'Campos obrigatórios: quadraId, dataInicio, dataFim, motivo',
        });
      }

      // Validar formato de datas
      const inicio = new Date(dataInicio);
      const fim = new Date(dataFim);

      if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) {
        return res.status(400).json({ erro: 'Formato de data inválido' });
      }

      if (inicio >= fim) {
        return res.status(400).json({
          erro: 'Data de início deve ser anterior à data de fim',
        });
      }

      // Validar horários se fornecidos
      if (horaInicio && horaFim) {
        const regexHora = /^([0-1]\d|2[0-3]):[0-5]\d$/;
        if (!regexHora.test(horaInicio) || !regexHora.test(horaFim)) {
          return res.status(400).json({
            erro: 'Formato de hora inválido. Use HH:mm (ex: 14:30)',
          });
        }

        if (horaInicio >= horaFim) {
          return res.status(400).json({
            erro: 'Hora de início deve ser anterior à hora de fim',
          });
        }
      }

      // Verificar se a quadra pertence ao locador
      const quadra = await quadraModel.buscarPorId(quadraId);
      if (!quadra) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      if (quadra.locadorId !== locadorId) {
        return res.status(403).json({
          erro: 'Você não tem permissão para bloquear esta quadra',
        });
      }

      // Criar o bloqueio
      const bloqueio = await bloqueioQuadraModel.criar({
        quadraId,
        dataInicio,
        dataFim,
        motivo,
        descricao,
        horaInicio,
        horaFim,
      });

      // Cancelar reservas que conflitam com o bloqueio
      const reservasParaCancelar = await prisma.reserva.findMany({
        where: {
          quadraId: Number(quadraId),
          status: { in: ['PENDENTE', 'AGUARDANDO_APROVACAO', 'RESERVADO', 'EM_FILA', 'OFERECIDO_LOCATARIO'] },
          dataInicio: { lte: fim },
          dataFim: { gte: inicio },
        },
      });

      if (reservasParaCancelar.length > 0) {
        await prisma.reserva.updateMany({
          where: {
            id: { in: reservasParaCancelar.map(r => r.id) },
          },
          data: { status: 'CANCELADO' },
        });
      }

      return res.status(201).json({
        mensagem: 'Bloqueio de quadra criado com sucesso',
        bloqueio,
        reservasCanceladas: reservasParaCancelar.length,
      });
    } catch (error) {
      res.status(500).json({
        erro: 'Erro ao criar bloqueio',
        detalhes: error.message,
      });
    }
  },

  // Listar bloqueios de uma quadra
  listarPorQuadra: async (req, res) => {
    const { quadraId } = req.params;
    const locadorId = req.user.id;

    try {
      // Verificar se a quadra pertence ao locador
      const quadra = await quadraModel.buscarPorId(quadraId);
      if (!quadra) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      if (quadra.locadorId !== locadorId) {
        return res.status(403).json({
          erro: 'Você não tem permissão para visualizar bloqueios desta quadra',
        });
      }

      const bloqueios = await bloqueioQuadraModel.listarPorQuadra(quadraId);

      return res.json({
        total: bloqueios.length,
        bloqueios: bloqueios.map(b => ({
          id: b.id,
          quadra: { id: b.quadra.id, nome: b.quadra.nome },
          dataInicio: b.dataInicio,
          dataFim: b.dataFim,
          motivo: b.motivo,
          descricao: b.descricao,
          horaInicio: b.horaInicio,
          horaFim: b.horaFim,
          criadoEm: b.criadoEm,
          atualizadoEm: b.atualizadoEm,
        })),
      });
    } catch (error) {
      res.status(500).json({
        erro: 'Erro ao listar bloqueios',
        detalhes: error.message,
      });
    }
  },

  // Listar bloqueios de todas as quadras do locador
  listarMeus: async (req, res) => {
    const locadorId = req.user.id;

    try {
      const bloqueios = await bloqueioQuadraModel.listarPorLocador(locadorId);

      const agrupadosPorQuadra = {};
      bloqueios.forEach(b => {
        if (!agrupadosPorQuadra[b.quadra.id]) {
          agrupadosPorQuadra[b.quadra.id] = {
            quadra: { id: b.quadra.id, nome: b.quadra.nome },
            bloqueios: [],
          };
        }
        agrupadosPorQuadra[b.quadra.id].bloqueios.push({
          id: b.id,
          dataInicio: b.dataInicio,
          dataFim: b.dataFim,
          motivo: b.motivo,
          descricao: b.descricao,
          horaInicio: b.horaInicio,
          horaFim: b.horaFim,
          criadoEm: b.criadoEm,
          atualizadoEm: b.atualizadoEm,
        });
      });

      return res.json({
        total: bloqueios.length,
        quadrasComBloqueios: Object.values(agrupadosPorQuadra),
      });
    } catch (error) {
      res.status(500).json({
        erro: 'Erro ao listar bloqueios',
        detalhes: error.message,
      });
    }
  },

  // Obter detalhes de um bloqueio
  obter: async (req, res) => {
    const { bloqueioId } = req.params;
    const locadorId = req.user.id;

    try {
      const bloqueio = await bloqueioQuadraModel.buscarPorId(bloqueioId);

      if (!bloqueio) {
        return res.status(404).json({ erro: 'Bloqueio não encontrado' });
      }

      if (bloqueio.quadra.locadorId !== locadorId) {
        return res.status(403).json({
          erro: 'Você não tem permissão para visualizar este bloqueio',
        });
      }

      return res.json(bloqueio);
    } catch (error) {
      res.status(500).json({
        erro: 'Erro ao obter bloqueio',
        detalhes: error.message,
      });
    }
  },

  // Atualizar bloqueio
  atualizar: async (req, res) => {
    const { bloqueioId } = req.params;
    const locadorId = req.user.id;
    const { dataInicio, dataFim, motivo, descricao, horaInicio, horaFim } = req.body;

    try {
      const bloqueio = await bloqueioQuadraModel.buscarPorId(bloqueioId);

      if (!bloqueio) {
        return res.status(404).json({ erro: 'Bloqueio não encontrado' });
      }

      if (bloqueio.quadra.locadorId !== locadorId) {
        return res.status(403).json({
          erro: 'Você não tem permissão para atualizar este bloqueio',
        });
      }

      // Validar datas se fornecidas
      if (dataInicio && dataFim) {
        const inicio = new Date(dataInicio);
        const fim = new Date(dataFim);

        if (inicio >= fim) {
          return res.status(400).json({
            erro: 'Data de início deve ser anterior à data de fim',
          });
        }
      }

      // Validar horários se fornecidos
      if (horaInicio && horaFim) {
        const regexHora = /^([0-1]\d|2[0-3]):[0-5]\d$/;
        if (!regexHora.test(horaInicio) || !regexHora.test(horaFim)) {
          return res.status(400).json({
            erro: 'Formato de hora inválido. Use HH:mm',
          });
        }

        if (horaInicio >= horaFim) {
          return res.status(400).json({
            erro: 'Hora de início deve ser anterior à hora de fim',
          });
        }
      }

      const bloqueioAtualizado = await bloqueioQuadraModel.atualizar(bloqueioId, {
        dataInicio,
        dataFim,
        motivo,
        descricao,
        horaInicio,
        horaFim,
      });

      return res.json({
        mensagem: 'Bloqueio atualizado com sucesso',
        bloqueio: bloqueioAtualizado,
      });
    } catch (error) {
      res.status(500).json({
        erro: 'Erro ao atualizar bloqueio',
        detalhes: error.message,
      });
    }
  },

  // Deletar bloqueio
  deletar: async (req, res) => {
    const { bloqueioId } = req.params;
    const locadorId = req.user.id;

    try {
      const bloqueio = await bloqueioQuadraModel.buscarPorId(bloqueioId);

      if (!bloqueio) {
        return res.status(404).json({ erro: 'Bloqueio não encontrado' });
      }

      if (bloqueio.quadra.locadorId !== locadorId) {
        return res.status(403).json({
          erro: 'Você não tem permissão para deletar este bloqueio',
        });
      }

      await bloqueioQuadraModel.deletar(bloqueioId);

      return res.json({
        mensagem: 'Bloqueio deletado com sucesso',
      });
    } catch (error) {
      res.status(500).json({
        erro: 'Erro ao deletar bloqueio',
        detalhes: error.message,
      });
    }
  },

  // Verificar disponibilidade de uma quadra em um período
  verificarDisponibilidade: async (req, res) => {
    const { quadraId } = req.params;
    const { dataInicio, dataFim } = req.query;

    try {
      if (!dataInicio || !dataFim) {
        return res.status(400).json({
          erro: 'Parâmetros obrigatórios: dataInicio, dataFim',
        });
      }

      const bloqueios = await bloqueioQuadraModel.buscarBloqueiosNoPeríodo(
        quadraId,
        dataInicio,
        dataFim
      );

      const disponivel = bloqueios.length === 0;

      return res.json({
        quadraId: Number(quadraId),
        dataInicio,
        dataFim,
        disponivel,
        bloqueios: bloqueios.map(b => ({
          id: b.id,
          dataInicio: b.dataInicio,
          dataFim: b.dataFim,
          motivo: b.motivo,
          horaInicio: b.horaInicio,
          horaFim: b.horaFim,
        })),
      });
    } catch (error) {
      res.status(500).json({
        erro: 'Erro ao verificar disponibilidade',
        detalhes: error.message,
      });
    }
  },
};

module.exports = bloqueioQuadraController;
