const express = require('express');
const bloqueioQuadraController = require('../controllers/bloqueioQuadraController');
const { requireAuth, requireLocador } = require('../middleware/authMiddleware');

const router = express.Router();

// Todas as rotas de bloqueio de quadra requerem autenticação e ser locador
router.use(requireAuth, requireLocador);

/**
 * @swagger
 * /bloqueios-quadra:
 *   get:
 *     summary: Listar todos os bloqueios de quadras do locador autenticado
 *     description: |
 *       Retorna uma lista de todos os bloqueios de quadra criados pelo locador,
 *       agrupados por quadra.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de bloqueios agrupados por quadra
 *       403:
 *         description: Apenas locadores podem acessar
 */
router.get('/', bloqueioQuadraController.listarMeus);

/**
 * @swagger
 * /bloqueios-quadra:
 *   post:
 *     summary: Criar um novo bloqueio de quadra
 *     description: |
 *       O locador cria um bloqueio para indicar períodos em que a quadra não funcionará.
 *       Pode ser um bloqueio de dia inteiro (ex: feriado) ou parcial (ex: 14:00 a 18:00).
 *       Reservas conflitantes serão canceladas automaticamente.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quadraId
 *               - dataInicio
 *               - dataFim
 *               - motivo
 *             properties:
 *               quadraId:
 *                 type: integer
 *                 example: 1
 *               dataInicio:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-05-01T00:00:00Z"
 *               dataFim:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-05-02T00:00:00Z"
 *               motivo:
 *                 type: string
 *                 maxLength: 200
 *                 example: "Feriado Nacional"
 *               descricao:
 *                 type: string
 *                 example: "Quadra fechada por Corpus Christi"
 *               horaInicio:
 *                 type: string
 *                 pattern: "^([0-1]\\d|2[0-3]):[0-5]\\d$"
 *                 example: "14:00"
 *               horaFim:
 *                 type: string
 *                 pattern: "^([0-1]\\d|2[0-3]):[0-5]\\d$"
 *                 example: "18:00"
 *     responses:
 *       201:
 *         description: Bloqueio criado com sucesso
 *       400:
 *         description: Dados inválidos
 *       403:
 *         description: Sem permissão para bloquear esta quadra
 *       404:
 *         description: Quadra não encontrada
 */
router.post('/', bloqueioQuadraController.criar);

/**
 * @swagger
 * /bloqueios-quadra/quadra/{quadraId}:
 *   get:
 *     summary: Listar bloqueios de uma quadra específica
 *     description: |
 *       Retorna todos os bloqueios de uma quadra do locador autenticado.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: quadraId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de bloqueios da quadra
 *       403:
 *         description: Sem permissão para acessar esta quadra
 *       404:
 *         description: Quadra não encontrada
 */
router.get('/quadra/:quadraId', bloqueioQuadraController.listarPorQuadra);

/**
 * @swagger
 * /bloqueios-quadra/verificar/{quadraId}:
 *   get:
 *     summary: Verificar disponibilidade de uma quadra em um período
 *     description: |
 *       Verifica se a quadra está disponível no período especificado.
 *       Pode ser acessada por qualquer usuário autenticado.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: quadraId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *       - name: dataInicio
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *       - name: dataFim
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Status de disponibilidade
 *       400:
 *         description: Parâmetros inválidos
 */
router.get('/verificar/:quadraId', bloqueioQuadraController.verificarDisponibilidade);

/**
 * @swagger
 * /bloqueios-quadra/{bloqueioId}:
 *   get:
 *     summary: Obter detalhes de um bloqueio
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: bloqueioId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Detalhes do bloqueio
 *       403:
 *         description: Sem permissão para acessar este bloqueio
 *       404:
 *         description: Bloqueio não encontrado
 */
router.get('/:bloqueioId', bloqueioQuadraController.obter);

/**
 * @swagger
 * /bloqueios-quadra/{bloqueioId}:
 *   patch:
 *     summary: Atualizar um bloqueio de quadra
 *     description: |
 *       Permite atualizar os detalhes de um bloqueio existente.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: bloqueioId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dataInicio:
 *                 type: string
 *                 format: date-time
 *               dataFim:
 *                 type: string
 *                 format: date-time
 *               motivo:
 *                 type: string
 *               descricao:
 *                 type: string
 *               horaInicio:
 *                 type: string
 *                 pattern: "^([0-1]\\d|2[0-3]):[0-5]\\d$"
 *               horaFim:
 *                 type: string
 *                 pattern: "^([0-1]\\d|2[0-3]):[0-5]\\d$"
 *     responses:
 *       200:
 *         description: Bloqueio atualizado com sucesso
 *       400:
 *         description: Dados inválidos
 *       403:
 *         description: Sem permissão para atualizar este bloqueio
 *       404:
 *         description: Bloqueio não encontrado
 */
router.patch('/:bloqueioId', bloqueioQuadraController.atualizar);

/**
 * @swagger
 * /bloqueios-quadra/{bloqueioId}:
 *   delete:
 *     summary: Deletar um bloqueio de quadra
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: bloqueioId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Bloqueio deletado com sucesso
 *       403:
 *         description: Sem permissão para deletar este bloqueio
 *       404:
 *         description: Bloqueio não encontrado
 */
router.delete('/:bloqueioId', bloqueioQuadraController.deletar);

module.exports = router;
