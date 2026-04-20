const express = require('express');
const reservaController = require('../controllers/reservaController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(requireAuth);

/**
 * @swagger
 * /reservas:
 *   get:
 *     summary: Lista as reservas do usuário autenticado
 *     description: |
 *       Locadores veem reservas recebidas de suas quadras.
 *       Locatários veem reservas que fizeram.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de reservas
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Reserva'
 *       401:
 *         description: Usuário não autenticado
 *       500:
 *         description: Erro interno do servidor
 */
router.get('/', reservaController.list);

/**
 * @swagger
 * /reservas/proxima:
 *   get:
 *     summary: Timer da próxima reserva do locatário (MELHOR PRÁTICA)
 *     description: |
 *       Mostra quanto tempo falta para a próxima reserva confirmada do locatário autenticado.
 *       Usa o token JWT para identificar o usuário - melhor prática de segurança.
 *       Prioridade: Primeiro retorna AGUARDANDO_APROVACAO, depois CONFIRMADA.
 *       Retorna um timer com dias, horas, minutos e segundos.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Informações da próxima reserva com timer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 temReserva:
 *                   type: boolean
 *                 tipo:
 *                   type: string
 *                   enum: [CONFIRMADA, AGUARDANDO_APROVACAO, NENHUMA]
 *                   description: Tipo de status da próxima reserva
 *                 proximaReserva:
 *                   type: object
 *                 dataSolicitacao:
 *                   type: string
 *                   description: Data da solicitação (apenas se AGUARDANDO_APROVACAO)
 *                 timer:
 *                   type: object
 *                 mensagem:
 *                   type: string
 *       403:
 *         description: Apenas locatários podem consultar
 *       500:
 *         description: Erro interno do servidor
 */
router.get('/proxima', reservaController.proximaReserva);

/**
 * @swagger
 * /reservas/clientes/{locatarioId}/proxima:
 *   get:
 *     summary: Timer da próxima reserva de um cliente (para locadores)
 *     description: |
 *       Mostra quanto tempo falta para a próxima reserva confirmada de um cliente específico.
 *       Apenas locadores podem consultar - valida se o cliente tem reservas em suas quadras.
 *       Prioridade: Primeiro retorna AGUARDANDO_APROVACAO, depois CONFIRMADA.
 *       Retorna um timer com dias, horas, minutos e segundos.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: locatarioId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID do cliente (locatário)
 *     responses:
 *       200:
 *         description: Informações da próxima reserva do cliente com timer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 temReserva:
 *                   type: boolean
 *                 tipo:
 *                   type: string
 *                   enum: [CONFIRMADA, AGUARDANDO_APROVACAO, NENHUMA]
 *                   description: Tipo de status da próxima reserva
 *                 locatarioId:
 *                   type: integer
 *                 cliente:
 *                   type: string
 *                 proximaReserva:
 *                   type: object
 *                 dataSolicitacao:
 *                   type: string
 *                   description: Data da solicitação (apenas se AGUARDANDO_APROVACAO)
 *                 timer:
 *                   type: object
 *                 mensagem:
 *                   type: string
 *       403:
 *         description: Apenas locadores podem consultar
 *       404:
 *         description: Cliente não tem reservas em suas quadras
 *       500:
 *         description: Erro interno do servidor
 */
router.get('/clientes/:locatarioId/proxima', reservaController.proximaReservaLocador);

/**
 * @swagger
 * /reservas/disponibilidade:
 *   get:
 *     summary: Verifica disponibilidade de uma quadra em um período
 *     description: |
 *       Valida se a quadra está disponível e se o horário está dentro do funcionamento.
 *       Funciona como calendários do Outlook.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: quadraId
 *         in: query
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da quadra
 *       - name: dataInicio
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Data e hora de início (ISO format ou yyyy-MM-dd HH:mm)
 *         example: "2026-04-20T14:00:00"
 *       - name: dataFim
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Data e hora de término (ISO format ou yyyy-MM-dd HH:mm)
 *         example: "2026-04-20T16:00:00"
 *     responses:
 *       200:
 *         description: Status de disponibilidade
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 disponivel:
 *                   type: boolean
 *                 quadra:
 *                   type: object
 *                 periodo:
 *                   type: object
 *                 conflitos:
 *                   type: array
 *       400:
 *         description: Parâmetros inválidos
 *       404:
 *         description: Quadra não encontrada
 */
router.get('/disponibilidade', reservaController.getAvailability);

/**
 * @swagger
 * /reservas:
 *   post:
 *     summary: Criar uma nova reserva de quadra
 *     description: |
 *       Locatário cria uma reserva. A reserva inicia em status AGUARDANDO_APROVACAO.
 *       Validações:
 *       - Verificar se horário está dentro de funcionamento (como Outlook)
 *       - Verificar se não há conflito com outras reservas
 *       - Valor total é calculado automaticamente
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
 *             properties:
 *               quadraId:
 *                 type: integer
 *                 description: ID da quadra
 *               dataInicio:
 *                 type: string
 *                 format: date-time
 *                 description: Data e hora de início (ISO format ou yyyy-MM-dd HH:mm)
 *                 example: "2026-04-20T14:00:00"
 *               dataFim:
 *                 type: string
 *                 format: date-time
 *                 description: Data e hora de término (ISO format ou yyyy-MM-dd HH:mm)
 *                 example: "2026-04-20T16:00:00"
 *     responses:
 *       201:
 *         description: Reserva criada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mensagem:
 *                   type: string
 *                 reserva:
 *                   $ref: '#/components/schemas/Reserva'
 *       400:
 *         description: Erro de validação
 *       403:
 *         description: Apenas locatários podem fazer reservas
 *       409:
 *         description: Conflito - quadra já reservada neste período
 */
router.post('/', reservaController.create);

/**
 * @swagger
 * /reservas/{id}:
 *   get:
 *     summary: Obter detalhes de uma reserva
 *     description: Locador ou locatário pode visualizar os dados da reserva
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da reserva
 *     responses:
 *       200:
 *         description: Detalhes da reserva
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Reserva'
 *       403:
 *         description: Sem permissão para visualizar
 *       404:
 *         description: Reserva não encontrada
 */
router.get('/:id', reservaController.getById);

/**
 * @swagger
 * /reservas/{id}/status:
 *   patch:
 *     summary: Atualizar status da reserva
 *     description: |
 *       Locador: pode atualizar para qualquer status (AGUARDANDO_APROVACAO, RESERVADO, CANCELADO, etc)
 *       Locatário: pode apenas CANCELAR sua própria reserva
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da reserva
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PENDENTE, AGUARDANDO_APROVACAO, CANCELADO, RESERVADO, EM_FILA, OFERECIDO_LOCATARIO]
 *                 description: Novo status da reserva
 *     responses:
 *       200:
 *         description: Status atualizado com sucesso
 *       400:
 *         description: Status inválido ou reserva já cancelada
 *       403:
 *         description: Sem permissão (locatário só pode cancelar)
 *       404:
 *         description: Reserva não encontrada
 */
router.patch('/:id/status', reservaController.updateStatus);

/**
 * @swagger
 * /reservas/{id}/cancelar:
 *   delete:
 *     summary: Cancelar uma reserva
 *     description: Locador ou locatário pode cancelar a reserva
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da reserva
 *     responses:
 *       200:
 *         description: Reserva cancelada com sucesso
 *       400:
 *         description: Reserva já foi cancelada
 *       403:
 *         description: Sem permissão para cancelar
 *       404:
 *         description: Reserva não encontrada
 */
router.delete('/:id/cancelar', reservaController.cancel);

/**
 * @swagger
 * /reservas/locador/dia:
 *   get:
 *     summary: Listar todas as reservas do locador para um dia específico
 *     description: |
 *       Mostra todas as reservas de todas as quadras do locador autenticado para um dia específico.
 *       Útil para visualizar agenda do dia.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: data
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Data no formato YYYY-MM-DD
 *         example: "2026-04-17"
 *     responses:
 *       200:
 *         description: Lista de reservas do dia
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: string
 *                   format: date
 *                 totalReservas:
 *                   type: integer
 *                 reservas:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       quadra:
 *                         type: object
 *                       locatario:
 *                         type: object
 *                       periodo:
 *                         type: object
 *                       status:
 *                         type: string
 *                       valorTotal:
 *                         type: number
 *       400:
 *         description: Parâmetro de data inválido
 *       403:
 *         description: Apenas locadores podem acessar
 *       500:
 *         description: Erro interno do servidor
 */
router.get('/locador/dia', reservaController.getReservasLocadorDia);

/**
 * @swagger
 * /reservas/quadra/{quadraId}/clientes:
 *   get:
 *     summary: Listar clientes que já reservaram uma quadra
 *     description: |
 *       Lista todas as reservas de uma quadra específica e informa os dados do locatário,
 *       valor gasto e dia da reserva.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: quadraId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da quadra
 *     responses:
 *       200:
 *         description: Histórico de clientes da quadra
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       403:
 *         description: Acesso negado para locadores que não são proprietários desta quadra
 *       404:
 *         description: Quadra não encontrada
 */
router.get('/quadra/:quadraId/clientes', reservaController.getClientesByQuadra);

/**
 * @swagger
 * /reservas/locador/historico:
 *   get:
 *     summary: Histórico de todos os clientes do locador
 *     description: |
 *       Busca todas as reservas de todas as quadras do locador autenticado,
 *       incluindo dados do locatário, valor gasto e dia da reserva.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Histórico de clientes para o locador autenticado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       403:
 *         description: Apenas locadores podem acessar esse histórico
 */
router.get('/locador/historico', reservaController.getHistoricoLocador);

/**
 * @swagger
 * /reservas/quadra/{quadraId}:
 *   get:
 *     summary: Listar todas as reservas de uma quadra
 *     description: |
 *       Mostra todas as reservas (ativas e canceladas) de uma quadra.
 *       Útil para ver o calendário de ocupação.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: quadraId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da quadra
 *     responses:
 *       200:
 *         description: Lista de reservas da quadra
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 quadra:
 *                   type: object
 *                 totalReservas:
 *                   type: integer
 *                 reservas:
 *                   type: array
 *       404:
 *         description: Quadra não encontrada
 */
router.get('/quadra/:quadraId', reservaController.getReservasByQuadra);

module.exports = router;
