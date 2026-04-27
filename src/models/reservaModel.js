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
    dataInicio: formatarISOLocal(reserva.dataInicio),
    dataFim: formatarISOLocal(reserva.dataFim)
  };
}

const reservaModel = {
  // Buscar todas as reservas
  findAll: async () => prisma.reserva.findMany({
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then((reservas) => reservas.map(formatarReserva)),

  // Buscar reserva por ID
  findById: async (id) => prisma.reserva.findUnique({
    where: { id: Number(id) },
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then(formatarReserva),

  // Buscar reservas por quadra
  findByQuadra: async (quadraId) => prisma.reserva.findMany({
    where: { quadraId: Number(quadraId) },
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then((reservas) => reservas.map(formatarReserva)),

  // Buscar clientes que já fizeram reservas em uma quadra
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

  // Buscar clientes únicos de todas as quadras de um locador
  findClientesByLocador: async (locadorId) => prisma.reserva.findMany({
    where: {
      quadra: { locadorId: Number(locadorId) },
      status: { not: 'EM_FILA' }
    },
    include: { locatario: true },
    distinct: ['locatarioId'],
    orderBy: { dataInicio: 'desc' }
  }),

  // Buscar histórico de reservas dos quadras de um locador
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

  // Buscar reservas do locatário
  findByLocatario: async (locatarioId) => prisma.reserva.findMany({
    where: { locatarioId: Number(locatarioId) },
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then((reservas) => reservas.map(formatarReserva)),

  // Buscar reservas do locador (quadras que ele aluga)
  findByLocador: async (locadorId) => prisma.reserva.findMany({
    where: { quadra: { locadorId: Number(locadorId) } },
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then((reservas) => reservas.map(formatarReserva)),

  // Criar nova reserva
  create: async (reservaData) => prisma.reserva.create({
    data: reservaData,
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then(formatarReserva),

  // Atualizar reserva
  update: async (id, data) => prisma.reserva.update({
    where: { id: Number(id) },
    data,
    include: { 
      quadra: { include: { locador: true, horarios: true, quadraEsportes: { include: { esporte: true } } } },
      locatario: true 
    }
  }).then(formatarReserva),

  // Deletar reserva
  delete: async (id) => prisma.reserva.delete({
    where: { id: Number(id) }
  }),

  // Buscar conflitos de horário (reservas que conflitam com o período desejado)
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

  // Buscar disponibilidades por período (exemplar Outlook)
  findAvailability: async (quadraId, dataInicio, dataFim) => {
    const conflitos = await reservaModel.findConflicts(quadraId, dataInicio, dataFim);
    return {
      disponivel: conflitos.length === 0,
      conflitos
    };
  },

  // Buscar reservas do locador para um dia específico
  findByLocadorAndDate: async (locadorId, data) => {
    // Convertendo a data string (YYYY-MM-DD) para objeto Date
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
