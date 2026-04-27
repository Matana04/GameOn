const express = require('express');
const quadraController = require('../controllers/quadraController');
const { requireAuth, requireLocador } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(requireAuth);

/**
 * @swagger
 * /quadras:
 *   get:
 *     summary: Lista todas as quadras com filtros opcionais
 *     description: Retorna uma lista de quadras, com possibilidade de filtrar por cidade, estado, esporte e faixa de preço
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cidade
 *         schema:
 *           type: string
 *         description: Filtrar por cidade (busca parcial, case-insensitive)
 *       - in: query
 *         name: estado
 *         schema:
 *           type: string
 *         description: Filtrar por estado
 *       - in: query
 *         name: esporte
 *         schema:
 *           type: string
 *         description: Filtrar por esporte (busca parcial, case-insensitive)
 *       - in: query
 *         name: valorMin
 *         schema:
 *           type: number
 *         description: Valor mínimo por hora
 *       - in: query
 *         name: valorMax
 *         schema:
 *           type: number
 *         description: Valor máximo por hora
 *     responses:
 *       200:
 *         description: Lista de quadras filtradas
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
 * /quadras/horarios-disponiveis:
 *   get:
 *     summary: Lista os horários disponíveis das quadras para uma data específica
 *     description: |
 *       Retorna todos os slots de 1 hora disponíveis para cada quadra na data informada,
 *       excluindo os horários já reservados (status RESERVADO ou AGUARDANDO_APROVACAO).
 *       O parâmetro `data` é obrigatório no formato YYYY-MM-DD.
 *       Opcionalmente, filtre por `quadraId` para consultar uma quadra específica.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: data
 *         required: true
 *         schema:
 *           type: string
 *           example: '2025-04-22'
 *         description: Data para consulta (formato YYYY-MM-DD)
 *       - in: query
 *         name: quadraId
 *         schema:
 *           type: integer
 *         description: ID da quadra (opcional, retorna todas se omitido)
 *     responses:
 *       200:
 *         description: Lista de quadras com horários disponíveis na data informada
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   nome:
 *                     type: string
 *                   esporte:
 *                     type: string
 *                   valorPorHora:
 *                     type: number
 *                   locador:
 *                     type: string
 *                   data:
 *                     type: string
 *                     example: '2025-04-22'
 *                   diaSemana:
 *                     type: string
 *                     example: 'terça-feira'
 *                   aberto:
 *                     type: boolean
 *                     description: false se a quadra não funciona neste dia da semana
 *                   horaAbertura:
 *                     type: string
 *                     example: '08:00'
 *                   horaFechamento:
 *                     type: string
 *                     example: '22:00'
 *                   horariosDisponiveis:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         inicio:
 *                           type: string
 *                           example: '08:00'
 *                         fim:
 *                           type: string
 *                           example: '09:00'
 *       400:
 *         description: Parâmetro data ausente ou com formato inválido
 *       500:
 *         description: Erro interno do servidor
 */
router.get('/horarios-disponiveis', quadraController.listWithHorarios);

/**
 * @swagger
 * /quadras/filtrar:
 *   get:
 *     summary: Filtrar quadras por critérios
 *     description: |
 *       Permite aos locatários filtrar quadras por localização, locador, esporte e disponibilidade de horário.
 *       Parâmetros de query opcionais:
 *       - localizacao: cidade, estado ou endereço (busca parcial)
 *       - locadorId: ID do locador/estabelecimento
 *       - esporte: tipo de esporte (busca parcial)
 *       - dataInicio: data/hora inicial para verificar disponibilidade (ISO format)
 *       - dataFim: data/hora final para verificar disponibilidade (ISO format)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: localizacao
 *         schema:
 *           type: string
 *         description: Cidade, estado ou endereço para busca
 *       - in: query
 *         name: locadorId
 *         schema:
 *           type: integer
 *         description: ID do locador
 *       - in: query
 *         name: esporte
 *         schema:
 *           type: string
 *         description: Tipo de esporte
 *       - in: query
 *         name: dataInicio
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Data/hora inicial para verificar disponibilidade
 *       - in: query
 *         name: dataFim
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Data/hora final para verificar disponibilidade
 *     responses:
 *       200:
 *         description: Lista de quadras filtradas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Número total de quadras encontradas
 *                 filtros:
 *                   type: object
 *                   description: Filtros aplicados
 *                 quadras:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       nome:
 *                         type: string
 *                       esporte:
 *                         type: string
 *                       valorPorHora:
 *                         type: number
 *                       descricao:
 *                         type: string
 *                       endereco:
 *                         type: string
 *                       cidade:
 *                         type: string
 *                       estado:
 *                         type: string
 *                       cep:
 *                         type: string
 *                       locador:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           nome:
 *                             type: string
 *                           email:
 *                             type: string
 *                       horarios:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             diaSemana:
 *                               type: integer
 *                             horaAbertura:
 *                               type: string
 *                             horaFechamento:
 *                               type: string
 *                             nomeDia:
 *                               type: string
 *                       disponivel:
 *                         type: boolean
 *                         nullable: true
 *                         description: true=disponível, false=indisponível, null=não verificado
 *                       periodo:
 *                         type: object
 *                         description: Período verificado (se dataInicio/dataFim fornecidos)
 *                       conflitos:
 *                         type: integer
 *                         description: Número de conflitos encontrados
 *       400:
 *         description: Parâmetros inválidos
 *       500:
 *         description: Erro interno do servidor
 */
router.get('/filtrar', quadraController.filtrar);

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