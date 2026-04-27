const express = require('express');
const esporteController = require('../controllers/esporteController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(requireAuth);

router.get('/', esporteController.listar);

module.exports = router;