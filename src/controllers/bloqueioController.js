const prisma = require('../database/prismaClient');
const bloqueioModel = require('../models/bloqueioModel');
const usuarioModel = require('../models/usuarioModel');
const emailService = require('../services/emailService');
const { formatarISOLocal } = require('../utils/dateUtils');

const STATUS_CANCELAVEIS = ['PENDENTE', 'AGUARDANDO_APROVACAO', 'RESERVADO', 'EM_FILA', 'OFERECIDO_LOCATARIO'];

const bloqueioController = {
  bloquear: async (req, res) => {
    const locadorId = req.user.id;
    const { locatarioId } = req.params;

    try {
      const locatario = await usuarioModel.findById(locatarioId);
      if (!locatario) {
        return res.status(404).json({ erro: 'Usuário não encontrado' });
      }
      if (locatario.tipo !== 'LOCATARIO') {
        return res.status(400).json({ erro: 'Só é possível bloquear locatários' });
      }

      const jaExiste = await bloqueioModel.buscar(locadorId, locatarioId);
      if (jaExiste) {
        return res.status(409).json({ erro: 'Locatário já está bloqueado' });
      }

      // Criar bloqueio
      await bloqueioModel.criar(locadorId, locatarioId);

      // Buscar quadras do locador
      const quadrasLocador = await prisma.quadra.findMany({
        where: { locadorId },
        select: { id: true },
      });
      const idsQuadras = quadrasLocador.map(q => q.id);

      // Cancelar todas as reservas ativas do locatário nessas quadras
      const reservasCanceladas = await prisma.reserva.updateMany({
        where: {
          locatarioId: Number(locatarioId),
          quadraId: { in: idsQuadras },
          status: { in: STATUS_CANCELAVEIS },
        },
        data: { status: 'CANCELADO' },
      });

      // Notificar locatário por email
      emailService.enviar(
        locatario.email,
        'Acesso bloqueado pelo locador',
        `
          <h2>Você foi bloqueado por um locador</h2>
          <p>Olá ${locatario.nome},</p>
          <p>Um locador bloqueou seu acesso às quadras dele. Todas as suas reservas nessas quadras foram canceladas.</p>
          <p>Em caso de dúvida, entre em contato diretamente com o locador.</p>
        `
      );

      return res.status(201).json({
        mensagem: 'Locatário bloqueado com sucesso',
        locatario: { id: locatario.id, nome: locatario.nome, email: locatario.email },
        reservasCanceladas: reservasCanceladas.count,
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao bloquear locatário', detalhes: error.message });
    }
  },

  desbloquear: async (req, res) => {
    const locadorId = req.user.id;
    const { locatarioId } = req.params;

    try {
      const bloqueio = await bloqueioModel.buscar(locadorId, locatarioId);
      if (!bloqueio) {
        return res.status(404).json({ erro: 'Bloqueio não encontrado' });
      }

      await bloqueioModel.remover(locadorId, locatarioId);

      return res.json({ mensagem: 'Locatário desbloqueado com sucesso' });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao desbloquear locatário', detalhes: error.message });
    }
  },

  listar: async (req, res) => {
    const locadorId = req.user.id;

    try {
      const bloqueios = await bloqueioModel.listarPorLocador(locadorId);

      return res.json({
        total: bloqueios.length,
        bloqueios: bloqueios.map(b => ({
          locatario: b.locatario,
          bloqueadoEm: b.criadoEm,
        })),
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao listar bloqueios', detalhes: error.message });
    }
  },
};

module.exports = bloqueioController;
