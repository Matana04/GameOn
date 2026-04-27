const express = require('express');
const bloqueioController = require('../controllers/bloqueioController');
const { requireAuth, requireLocador } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(requireAuth, requireLocador);

/**
 * @swagger
 * /bloqueios:
 *   get:
 *     summary: Listar locatários bloqueados pelo locador autenticado
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de locatários bloqueados
 *       403:
 *         description: Apenas locadores podem acessar
 */
router.get('/', bloqueioController.listar);

/**
 * @swagger
 * /bloqueios/{locatarioId}:
 *   post:
 *     summary: Bloquear um locatário
 *     description: |
 *       O locador bloqueia um locatário. Todas as reservas ativas do locatário
 *       nas quadras deste locador são canceladas automaticamente.
 *       Apenas locatários podem ser bloqueados (não é possível bloquear outro locador).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: locatarioId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Locatário bloqueado com sucesso
 *       400:
 *         description: Tentativa de bloquear um locador
 *       404:
 *         description: Usuário não encontrado
 *       409:
 *         description: Locatário já está bloqueado
 */
router.post('/:locatarioId', bloqueioController.bloquear);

/**
 * @swagger
 * /bloqueios/{locatarioId}:
 *   delete:
 *     summary: Desbloquear um locatário
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: locatarioId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Locatário desbloqueado com sucesso
 *       404:
 *         description: Bloqueio não encontrado
 */
router.delete('/:locatarioId', bloqueioController.desbloquear);

module.exports = router;
