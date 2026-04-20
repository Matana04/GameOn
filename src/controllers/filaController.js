const filaService = require('../services/filaService');
const emailService = require('../services/emailService');
const reservaModel = require('../models/reservaModel');
const { formatarISOLocal } = require('../utils/dateUtils');

const filaController = {
  /**
   * Confirmar uma oferta de reserva (locatário confirma que quer)
   */
  confirmarOferta: async (req, res) => {
    const { id } = req.params;
    const locatarioId = req.user.id;

    try {
      const reservaConfirmada = await filaService.confirmarOferta(id, locatarioId);

      // Enviar email confirmando ao locatário
      await emailService.enviar(
        reservaConfirmada.locatario.email,
        `${reservaConfirmada.quadra.nome} - Sua confirmação foi recebida! ⏳`,
        `
          <h2>Sua confirmação foi recebida</h2>
          <p>Olá ${reservaConfirmada.locatario.nome},</p>
          <p>Recebemos sua confirmação de interesse na quadra <strong>${reservaConfirmada.quadra.nome}</strong>.</p>
          <ul>
            <li><strong>Data/Hora:</strong> ${new Date(reservaConfirmada.dataInicio).toLocaleString('pt-BR')} até ${new Date(reservaConfirmada.dataFim).toLocaleString('pt-BR')}</li>
            <li><strong>Valor:</strong> R$ ${parseFloat(reservaConfirmada.valorTotal).toFixed(2)}</li>
          </ul>
          <p>Seu pedido foi enviado para aprovação do locador. Você receberá uma notificação em breve!</p>
        `
      );

      res.json({
        mensagem: 'Oferta confirmada! Aguardando aprovação do locador.',
        reserva: {
          id: reservaConfirmada.id,
          status: reservaConfirmada.status,
          quadra: reservaConfirmada.quadra.nome,
          periodo: {
            dataInicio: new Date(reservaConfirmada.dataInicio).toLocaleString('pt-BR'),
            dataFim: new Date(reservaConfirmada.dataFim).toLocaleString('pt-BR')
          }
        }
      });
    } catch (error) {
      res.status(400).json({
        erro: error.message || 'Erro ao confirmar oferta',
        detalhes: error.message
      });
    }
  },

  /**
   * Buscar fila de espera ou reservas do usuário
   * - Locador: ver fila de espera de uma quadra específica
   * - Locatário: ver todas as suas reservas e filas de espera
   */
  buscarFila: async (req, res) => {
    try {
      if (req.user.tipo === 'LOCADOR') {
        // Locador: ver fila de espera de uma quadra específica
        const { quadraId, dataInicio, dataFim } = req.query;

        if (!quadraId || !dataInicio || !dataFim) {
          return res.status(400).json({
            erro: 'Parâmetros obrigatórios: quadraId, dataInicio, dataFim'
          });
        }

        // Validar se o usuário é locador da quadra
        const quadra = await reservaModel.findByQuadra(quadraId);
        if (quadra.length === 0) {
          return res.status(404).json({ erro: 'Quadra não encontrada' });
        }

        // Validar se é dele
        if (quadra[0].quadra.locadorId !== req.user.id) {
          return res.status(403).json({
            erro: 'Você não tem permissão para visualizar a fila desta quadra'
          });
        }

        const fila = await filaService.buscarFila(quadraId, dataInicio, dataFim);

        return res.json({
          tipo: 'locador',
          quadraId: Number(quadraId),
          periodo: {
            dataInicio,
            dataFim
          },
          totalFila: fila.length,
          fila: fila.map((r, index) => ({
            posicao: index + 1,
            locatarioId: r.locatarioId,
            locatarioNome: r.locatario.nome,
            locatarioEmail: r.locatario.email,
            reservaId: r.id,
            criadoEm: formatarISOLocal(r.createdAt)
          }))
        });

      } else if (req.user.tipo === 'LOCATARIO') {
        // Locatário: ver todas as suas reservas e filas de espera
        const reservas = await reservaModel.findByLocatario(req.user.id);

        const reservasFormatadas = reservas.map(r => ({
          id: r.id,
          quadra: {
            id: r.quadra.id,
            nome: r.quadra.nome,
            esporte: r.quadra.esporte,
            locador: r.quadra.locador.nome
          },
          periodo: {
            dataInicio: formatarISOLocal(r.dataInicio),
            dataFim: formatarISOLocal(r.dataFim)
          },
          status: r.status,
          posicaoFila: r.posicaoFila,
          valorTotal: r.valorTotal,
          criadoEm: formatarISOLocal(r.createdAt),
          dataOferta: r.dataOferta ? formatarISOLocal(r.dataOferta) : null
        }));

        return res.json({
          tipo: 'locatario',
          totalReservas: reservasFormatadas.length,
          reservas: reservasFormatadas
        });
      }

    } catch (error) {
      res.status(500).json({
        erro: 'Erro ao buscar informações',
        detalhes: error.message
      });
    }
  },

  /**
   * Buscar status de uma reserva (fila, ofertada, etc)
   */
  buscarStatus: async (req, res) => {
    const { id } = req.params;

    try {
      const reserva = await reservaModel.findById(id);
      if (!reserva) {
        return res.status(404).json({ erro: 'Reserva não encontrada' });
      }

      // Validar permissão
      if (req.user.tipo === 'LOCADOR' && reserva.quadra.locadorId !== req.user.id) {
        return res.status(403).json({
          erro: 'Você não tem permissão para visualizar esta reserva'
        });
      }
      if (req.user.tipo === 'LOCATARIO' && reserva.locatarioId !== req.user.id) {
        return res.status(403).json({
          erro: 'Você não tem permissão para visualizar esta reserva'
        });
      }

      const status = await filaService.buscarStatusReserva(id);

      res.json({
        ...status,
        locatario: reserva.locatario.nome
      });
    } catch (error) {
      res.status(500).json({
        erro: 'Erro ao buscar status',
        detalhes: error.message
      });
    }
  }
};

module.exports = filaController;
