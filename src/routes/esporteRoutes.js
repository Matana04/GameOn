const express = require('express');
const esporteController = require('../controllers/esporteController');

const router = express.Router();

router.get('/', esporteController.listar);

module.exports = router;