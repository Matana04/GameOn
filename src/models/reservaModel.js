const prisma = require('../database/prismaClient');
const { formatarISOLocal } = require('../utils/dateUtils');
const { normalizarQuadra } = require('../utils/quadraEsporteUtils');

/**
 * Formata uma reserva convertendo datas para hora local
 */
function formatarReserva(reserva) {
  if (!reserva) return reserva;

  return {
    ...reserva,
    quadra: normalizarQuadra(reserva.quadra),
    dataInicio: reserva.dataInicio,
    dataFim: reserva.dataFim
  };
}

const reservaModel = {
  findAll: async () => prisma.reserva.findMany({
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then((reservas) => reservas.map(formatarReserva)),

  findById: async (id) => prisma.reserva.findUnique({
    where: { id: Number(id) },
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then(formatarReserva),

  findByQuadra: async (quadraId) => prisma.reserva.findMany({
    where: { quadraId: Number(quadraId) },
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then((reservas) => reservas.map(formatarReserva)),

  findClientesByQuadra: async (quadraId) => prisma.reserva.findMany({
    where: {
      quadraId: Number(quadraId),
      status: { not: 'EM_FILA' }
    },
    include: {
      quadra: { include: { quadraEsportes: { include: { esporte: true } } } },
      locatario: true
    },
    orderBy: { dataInicio: 'desc' }
  }).then((reservas) => reservas.map(formatarReserva)),

  findClientesByLocador: async (locadorId) => prisma.reserva.findMany({
    where: {
      quadra: { locadorId: Number(locadorId) },
      status: { not: 'EM_FILA' }
    },
    include: { locatario: true },
    distinct: ['locatarioId'],
    orderBy: { dataInicio: 'desc' }
  }),

  findHistoricoByLocador: async (locadorId) => prisma.reserva.findMany({
    where: {
      quadra: { locadorId: Number(locadorId) },
      status: { not: 'EM_FILA' }
    },
    include: {
      quadra: { include: { quadraEsportes: { include: { esporte: true } } } },
      locatario: true
    },
    orderBy: { dataInicio: 'desc' }
  }).then((reservas) => reservas.map(formatarReserva)),

  findHistoricoByLocatario: async (locatarioId) => prisma.reserva.findMany({
    where: {
      locatarioId: Number(locatarioId),
      status: { not: 'EM_FILA' }
    },
    include: {
      quadra: { include: { quadraEsportes: { include: { esporte: true } } } },
      locatario: true
    },
    orderBy: { dataInicio: 'desc' }
  }).then((reservas) => reservas.map(formatarReserva)),

  findByLocatario: async (locatarioId) => prisma.reserva.findMany({
    where: { locatarioId: Number(locatarioId) },
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then((reservas) => reservas.map(formatarReserva)),

  findByLocador: async (locadorId) => prisma.reserva.findMany({
    where: { quadra: { locadorId: Number(locadorId) } },
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then((reservas) => reservas.map(formatarReserva)),

  create: async (reservaData) => prisma.reserva.create({
    data: reservaData,
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then(formatarReserva),

  update: async (id, data) => prisma.reserva.update({
    where: { id: Number(id) },
    data,
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then(formatarReserva),

  delete: async (id) => prisma.reserva.delete({
    where: { id: Number(id) }
  }),

  findConflicts: async (quadraId, dataInicio, dataFim, excludeId = null) => {
    const where = {
      quadraId: Number(quadraId),
      status: { in: ['RESERVADO', 'AGUARDANDO_APROVACAO'] },
      OR: [
        {
          AND: [
            { dataInicio: { lt: dataFim } },
            { dataFim: { gt: dataInicio } }
          ]
        }
      ]
    };

    if (excludeId) {
      where.id = { not: Number(excludeId) };
    }

    return prisma.reserva.findMany({
      where,
      include: {
        quadra: true,
        locatario: true
      }
    });
  },

  findAvailability: async (quadraId, dataInicio, dataFim) => {
    const conflitos = await reservaModel.findConflicts(quadraId, dataInicio, dataFim);
    return {
      disponivel: conflitos.length === 0,
      conflitos
    };
  },

  findByLocadorAndDate: async (locadorId, data) => {
    const [year, month, day] = data.split('-');
    const dataObj = new Date(year, month - 1, day, 0, 0, 0, 0);
    
    const proximoDia = new Date(dataObj);
    proximoDia.setDate(proximoDia.getDate() + 1);

    return prisma.reserva.findMany({
      where: {
        quadra: { locadorId: Number(locadorId) },
        dataInicio: { gte: dataObj },
        dataFim: { lt: proximoDia }
      },
      include: {
        quadra: true,
        locatario: true
      },
      orderBy: {
        dataInicio: 'asc'
      }
    });
  }
};

module.exports = reservaModel;
