const prisma = require('../database/prismaClient');

const reservaModel = {
  // Buscar todas as reservas
  findAll: async () => prisma.reserva.findMany({
    include: { 
      quadra: { include: { locador: true, horarios: true } },
      locatario: true 
    }
  }),

  // Buscar reserva por ID
  findById: async (id) => prisma.reserva.findUnique({
    where: { id: Number(id) },
    include: { 
      quadra: { include: { locador: true, horarios: true } },
      locatario: true 
    }
  }),

  // Buscar reservas por quadra
  findByQuadra: async (quadraId) => prisma.reserva.findMany({
    where: { quadraId: Number(quadraId) },
    include: { 
      quadra: { include: { locador: true, horarios: true } },
      locatario: true 
    }
  }),

  // Buscar reservas do locatário
  findByLocatario: async (locatarioId) => prisma.reserva.findMany({
    where: { locatarioId: Number(locatarioId) },
    include: { 
      quadra: { include: { locador: true, horarios: true } },
      locatario: true 
    }
  }),

  // Buscar reservas do locador (quadras que ele aluga)
  findByLocador: async (locadorId) => prisma.reserva.findMany({
    where: { quadra: { locadorId: Number(locadorId) } },
    include: { 
      quadra: { include: { locador: true, horarios: true } },
      locatario: true 
    }
  }),

  // Criar nova reserva
  create: async (reservaData) => prisma.reserva.create({
    data: reservaData,
    include: { 
      quadra: { include: { locador: true, horarios: true } },
      locatario: true 
    }
  }),

  // Atualizar reserva
  update: async (id, data) => prisma.reserva.update({
    where: { id: Number(id) },
    data,
    include: { 
      quadra: { include: { locador: true, horarios: true } },
      locatario: true 
    }
  }),

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
  }
};

module.exports = reservaModel;
