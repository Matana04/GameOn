const esporteModel = require('../models/esporteModel');

const esporteController = {
  listar: async (_req, res) => {
    try {
      const esportes = await esporteModel.listar();
      res.json({ esportes });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar esportes', detalhes: error.message });
    }
  },
};

module.exports = esporteController;