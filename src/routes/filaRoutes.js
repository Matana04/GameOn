const express = require('express');
const filaController = require('../controllers/filaController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(requireAuth);

/**
 * @swagger
 * /fila/status/{id}:
 *   get:
 *     summary: Buscar status de uma reserva (fila, oferta, etc)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Status da reserva
 */
router.get('/status/:id', filaController.buscarStatus);

/**
 * @swagger
 * /fila/confirmar/{id}:
 *   post:
 *     summary: Confirmar uma oferta de reserva (locatário)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Oferta confirmada
 */
router.post('/confirmar/:id', filaController.confirmarOferta);

/**
 * @swagger
 * /fila/listar:
 *   get:
 *     summary: Buscar fila de espera ou reservas do usuário
 *     description: |
 *       Locador: ver fila de espera de uma quadra específica (parâmetros obrigatórios)
 *       Locatário: ver todas as suas reservas e filas de espera (sem parâmetros)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: quadraId
 *         in: query
 *         required: false
 *         description: ID da quadra (apenas para locadores)
 *         schema:
 *           type: integer
 *       - name: dataInicio
 *         in: query
 *         required: false
 *         description: Data de início (apenas para locadores)
 *         schema:
 *           type: string
 *       - name: dataFim
 *         in: query
 *         required: false
 *         description: Data de fim (apenas para locadores)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de reservas ou fila de espera
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     tipo:
 *                       type: string
 *                       enum: [locador]
 *                     quadraId:
 *                       type: integer
 *                     periodo:
 *                       type: object
 *                     totalFila:
 *                       type: integer
 *                     fila:
 *                       type: array
 *                 - type: object
 *                   properties:
 *                     tipo:
 *                       type: string
 *                       enum: [locatario]
 *                     totalReservas:
 *                       type: integer
 *                     reservas:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           quadra:
 *                             type: object
 *                           periodo:
 *                             type: object
 *                           status:
 *                             type: string
 *                           posicaoFila:
 *                             type: integer
 *                           valorTotal:
 *                             type: number
 *                           criadoEm:
 *                             type: string
 *                           dataOferta:
 *                             type: string
 */
router.get('/listar', filaController.buscarFila);

module.exports = router;
