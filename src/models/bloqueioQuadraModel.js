const prisma = require('../database/prismaClient');

const bloqueioQuadraModel = {
  criar: async (bloqueio) =>
    prisma.bloqueioQuadra.create({
      data: {
        quadraId: Number(bloqueio.quadraId),
        dataInicio: new Date(bloqueio.dataInicio),
        dataFim: new Date(bloqueio.dataFim),
        motivo: bloqueio.motivo,
        descricao: bloqueio.descricao || null,
        horaInicio: bloqueio.horaInicio || null,
        horaFim: bloqueio.horaFim || null,
      },
      include: { quadra: true },
    }),

  buscarPorId: async (id) =>
    prisma.bloqueioQuadra.findUnique({
      where: { id: Number(id) },
      include: { quadra: true },
    }),

  listarPorQuadra: async (quadraId, filtros = {}) => {
    const where = { quadraId: Number(quadraId) };

    if (filtros.dataInicio && filtros.dataFim) {
      where.AND = [
        { dataInicio: { lte: new Date(filtros.dataFim) } },
        { dataFim: { gte: new Date(filtros.dataInicio) } },
      ];
    }

    return prisma.bloqueioQuadra.findMany({
      where,
      orderBy: { dataInicio: 'asc' },
      include: { quadra: true },
    });
  },

  listarPorLocador: async (locadorId) =>
    prisma.bloqueioQuadra.findMany({
      where: {
        quadra: { locadorId: Number(locadorId) },
      },
      orderBy: { dataInicio: 'asc' },
      include: { quadra: true },
    }),

  atualizar: async (id, dados) =>
    prisma.bloqueioQuadra.update({
      where: { id: Number(id) },
      data: {
        motivo: dados.motivo,
        descricao: dados.descricao,
        dataInicio: dados.dataInicio ? new Date(dados.dataInicio) : undefined,
        dataFim: dados.dataFim ? new Date(dados.dataFim) : undefined,
        horaInicio: dados.horaInicio || null,
        horaFim: dados.horaFim || null,
      },
      include: { quadra: true },
    }),

  deletar: async (id) =>
    prisma.bloqueioQuadra.delete({
      where: { id: Number(id) },
    }),

  verificarConflito: async (quadraId, dataInicio, dataFim, horaInicio = null, horaFim = null) => {
    const where = {
      quadraId: Number(quadraId),
      AND: [
        { dataInicio: { lte: new Date(dataFim) } },
        { dataFim: { gte: new Date(dataInicio) } },
      ],
    };

    if (horaInicio && horaFim) {
      where.AND.push({
        OR: [
          { horaInicio: null, horaFim: null },
          {
            AND: [
              { horaInicio: { lte: horaFim } },
              { horaFim: { gte: horaInicio } },
            ],
          },
        ],
      });
    }

    return prisma.bloqueioQuadra.findFirst({ where });
  },

  buscarBloqueiosNoPeríodo: async (quadraId, dataInicio, dataFim) =>
    prisma.bloqueioQuadra.findMany({
      where: {
        quadraId: Number(quadraId),
        AND: [
          { dataInicio: { lte: new Date(dataFim) } },
          { dataFim: { gte: new Date(dataInicio) } },
        ],
      },
      orderBy: { dataInicio: 'asc' },
    }),
};

module.exports = bloqueioQuadraModel;
