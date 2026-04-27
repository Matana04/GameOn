const prisma = require('../database/prismaClient');

const bloqueioModel = {
  criar: async (locadorId, locatarioId) =>
    prisma.bloqueioLocatario.create({
      data: { locadorId: Number(locadorId), locatarioId: Number(locatarioId) },
      include: { locatario: true, locador: true },
    }),

  remover: async (locadorId, locatarioId) =>
    prisma.bloqueioLocatario.delete({
      where: {
        locadorId_locatarioId: {
          locadorId: Number(locadorId),
          locatarioId: Number(locatarioId),
        },
      },
    }),

  buscar: async (locadorId, locatarioId) =>
    prisma.bloqueioLocatario.findUnique({
      where: {
        locadorId_locatarioId: {
          locadorId: Number(locadorId),
          locatarioId: Number(locatarioId),
        },
      },
    }),

  listarPorLocador: async (locadorId) =>
    prisma.bloqueioLocatario.findMany({
      where: { locadorId: Number(locadorId) },
      include: { locatario: { select: { id: true, nome: true, email: true } } },
      orderBy: { criadoEm: 'desc' },
    }),
};

module.exports = bloqueioModel;
