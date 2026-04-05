const prisma = require('../database/prismaClient');

const usuarioModel = {
  findAll: async () => prisma.usuario.findMany(),

  create: async (usuarioData) => prisma.usuario.create({ data: usuarioData }),

  findByEmail: async (email) =>
    prisma.usuario.findUnique({ where: { email } }),

  findById: async (id) =>
    prisma.usuario.findUnique({
      where: { id: Number(id) },
      include: { quadras: true, reservas: true },
    }),

  update: async (id, data) =>
    prisma.usuario.update({ where: { id: Number(id) }, data }),

  delete: async (id) => prisma.usuario.delete({ where: { id: Number(id) } }),
};

module.exports = usuarioModel;
