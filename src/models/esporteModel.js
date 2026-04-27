const prisma = require('../database/prismaClient');

const esporteModel = {
  listar: async () => prisma.esporte.findMany({
    orderBy: { nome: 'asc' },
  }),
};

module.exports = esporteModel;