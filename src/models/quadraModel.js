const prisma = require('../database/prismaClient');

const quadraModel = {
  findAll: async () => prisma.quadra.findMany({
    include: { horarios: true, locador: true, reservas: true }
  }),

  create: async (quadraData) => prisma.quadra.create({
    data: quadraData,
    include: { horarios: true }
  }),

  findById: async (id) => prisma.quadra.findUnique({
    where: { id: Number(id) },
    include: { horarios: true, locador: true, reservas: true }
  }),

  update: async (id, data) => prisma.quadra.update({
    where: { id: Number(id) },
    data,
    include: { horarios: true }
  }),

  delete: async (id) => prisma.$transaction(async (tx) => {
    await tx.horario.deleteMany({ where: { quadraId: Number(id) } });
    await tx.reserva.deleteMany({ where: { quadraId: Number(id) } });
    return tx.quadra.delete({ where: { id: Number(id) } });
  }),
};

module.exports = quadraModel;