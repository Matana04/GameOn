const express = require('express');
const quadraController = require('../controllers/quadraController');
const { requireAuth, requireLocador } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(requireAuth);

/**
 * @swagger
 * /quadras:
 *   get:
 *     summary: Lista todas as quadras
 *     description: Retorna uma lista de todas as quadras cadastradas
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de quadras
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Quadra'
 *       500:
 *         description: Erro interno do servidor
 */
router.get('/', quadraController.list);

/**
 * @swagger
 * /quadras:
 *   post:
 *     summary: Cria uma nova quadra
 *     description: Cria uma nova quadra com seus horários de funcionamento
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nome
 *               - esporte
 *               - valorPorHora
 *               - horarios
 *             properties:
 *               nome:
 *                 type: string
 *                 description: Nome da quadra
 *               esporte:
 *                 type: string
 *                 description: Esporte praticado na quadra
 *               valorPorHora:
 *                 type: number
 *                 format: float
 *                 description: Valor por hora da quadra
 *               descricao:
 *                 type: string
 *                 description: Descrição da quadra
 *               horarios:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - diaSemana
 *                     - horaAbertura
 *                     - horaFechamento
 *                   properties:
 *                     diaSemana:
 *                       type: integer
 *                       minimum: 0
 *                       maximum: 6
 *                       description: Dia da semana (0=domingo, 6=sábado)
 *                     horaAbertura:
 *                       type: string
 *                       description: Hora de abertura (HH:MM)
 *                     horaFechamento:
 *                       type: string
 *                       description: Hora de fechamento (HH:MM)
 *     responses:
 *       201:
 *         description: Quadra criada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Quadra'
 *       400:
 *         description: Dados inválidos
 *       500:
 *         description: Erro interno do servidor
 */
router.post('/', requireLocador, quadraController.create);

/**
 * @swagger
 * /quadras/{id}:
 *   get:
 *     summary: Busca uma quadra por ID
 *     description: Retorna os detalhes de uma quadra específica
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da quadra
 *     responses:
 *       200:
 *         description: Detalhes da quadra
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Quadra'
 *       404:
 *         description: Quadra não encontrada
 *       500:
 *         description: Erro interno do servidor
 */
router.get('/:id', quadraController.getById);

/**
 * @swagger
 * /quadras/{id}:
 *   put:
 *     summary: Atualiza uma quadra
 *     description: Atualiza os dados de uma quadra existente, incluindo horários
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da quadra
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nome:
 *                 type: string
 *               esporte:
 *                 type: string
 *               valorPorHora:
 *                 type: number
 *                 format: float
 *               descricao:
 *                 type: string
 *               horarios:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     diaSemana:
 *                       type: integer
 *                       minimum: 0
 *                       maximum: 6
 *                     horaAbertura:
 *                       type: string
 *                     horaFechamento:
 *                       type: string
 *     responses:
 *       200:
 *         description: Quadra atualizada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Quadra'
 *       404:
 *         description: Quadra não encontrada
 *       400:
 *         description: Dados inválidos
 *       500:
 *         description: Erro interno do servidor
 */
router.put('/:id', requireLocador, quadraController.update);

/**
 * @swagger
 * /quadras/{id}:
 *   delete:
 *     summary: Deleta uma quadra
 *     description: Remove uma quadra do sistema
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da quadra
 *     responses:
 *       200:
 *         description: Quadra deletada com sucesso
 *       404:
 *         description: Quadra não encontrada
 *       500:
 *         description: Erro interno do servidor
 */
router.delete('/:id', requireLocador, quadraController.delete);

module.exports = router;