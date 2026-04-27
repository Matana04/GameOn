const prisma = require('../database/prismaClient');
const emailService = require('./emailService');
const { formatarISOLocal } = require('../utils/dateUtils');

const filaService = {
  /**
   * Buscar conflitos de horário que ainda estejam em 6 horas antes da reserva
   * Retorna reservas válidas para entrar em fila
   */
  verificarEligibilidadeFila: async (quadraId, dataInicio, dataFim) => {
    const quadra = await prisma.quadra.findUnique({
      where: { id: Number(quadraId) },
      select: { horasAntecedenciaCancelamento: true }
    });
    const horasMinimas = quadra?.horasAntecedenciaCancelamento ?? 6;

    const agora = new Date();
    const horasAteReserva = (dataInicio - agora) / (1000 * 60 * 60);

    if (horasAteReserva < horasMinimas) {
      throw new Error(`Não é possível entrar em fila. A reserva deve ser com pelo menos ${horasMinimas}h de antecedência.`);
    }

    // Buscar conflitos
    const conflitos = await prisma.reserva.findMany({
      where: {
        quadraId: Number(quadraId),
        status: { in: ['RESERVADO', 'AGUARDANDO_APROVACAO', 'OFERECIDO_LOCATARIO'] },
        OR: [
          {
            AND: [
              { dataInicio: { lt: dataFim } },
              { dataFim: { gt: dataInicio } }
            ]
          }
        ]
      },
      include: {
        quadra: { include: { locador: true } },
        locatario: true
      }
    });

    return {
      temConflito: conflitos.length > 0,
      conflitos
    };
  },

  /**
   * Adicionar reserva à fila de espera
   */
  adicionarFila: async (reserva) => {
    try {
      const dataInicioDate = new Date(reserva.dataInicio);
      const dataFimDate = new Date(reserva.dataFim);

      // Contar quantas reservas estão em fila para a mesma quadra/horário
      const contagemFila = await prisma.reserva.count({
        where: {
          quadraId: reserva.quadraId,
          status: 'EM_FILA',
          dataInicio: { equals: dataInicioDate },
          dataFim: { equals: dataFimDate }
        }
      });

      const proximoPosicao = contagemFila + 1;
      console.log(`\n📊 Fila: Contagem=${contagemFila}, Próxima posição=${proximoPosicao}`);

      // Atualizar reserva com status EM_FILA
      const reservaAtualizada = await prisma.reserva.update({
        where: { id: reserva.id },
        data: {
          status: 'EM_FILA',
          posicaoFila: proximoPosicao
        },
        include: {
          quadra: { include: { locador: true } },
          locatario: true
        }
      });

      // Enviar notificações
      await emailService.notificarLocatarioEntFila(
        reservaAtualizada.locatario,
        reservaAtualizada.quadra,
        proximoPosicao
      );

      await emailService.notificarLocadorFilaPendente(
        reservaAtualizada.quadra.locador,
        reservaAtualizada.quadra,
        proximoPosicao
      );

      console.log(`✅ ${reservaAtualizada.locatario.nome} adicionado à fila na posição ${proximoPosicao}`);
      return reservaAtualizada;
    } catch (error) {
      console.error('Erro ao adicionar reserva à fila:', error);
      throw error;
    }
  },

  /**
   * Oferecer primeiro da fila quando há cancelamento
   */
  processarProximaFila: async (quadraId, dataInicio, dataFim) => {
    try {
      const dataInicioDate = new Date(dataInicio);
      const dataFimDate = new Date(dataFim);

      console.log(`\n📋 Buscando fila para: quadra=${quadraId}, inicio=${dataInicioDate.toISOString()}, fim=${dataFimDate.toISOString()}`);

      // Buscar TODAS as reservas em fila para esta quadra e horário
      const todasEmFila = await prisma.reserva.findMany({
        where: {
          quadraId: Number(quadraId),
          status: 'EM_FILA'
        },
        include: {
          quadra: { include: { locador: true } },
          locatario: true
        },
        orderBy: { posicaoFila: 'asc' }
      });

      console.log(`✓ Total em fila: ${todasEmFila.length}`);

      // Filtrar pelo horário (comparação manual para evitar problemas de timezone)
      const filaDoHorario = todasEmFila.filter(r => {
        const inicioIgual = r.dataInicio.getTime() === dataInicioDate.getTime();
        const fimIgual = r.dataFim.getTime() === dataFimDate.getTime();
        console.log(`  - ${r.locatario.nome}: inicio=${r.dataInicio.toISOString()}, fim=${r.dataFim.toISOString()} [Match: ${inicioIgual && fimIgual}]`);
        return inicioIgual && fimIgual;
      });

      console.log(`✓ Na fila deste horário: ${filaDoHorario.length}`);

      if (filaDoHorario.length === 0) {
        console.log('ℹ️ Nenhuma reserva em fila para este horário');
        return null;
      }

      // Pegar o primeiro (posição 1)
      const primeiroFila = filaDoHorario[0];
      console.log(`🎯 Primeiro da fila: ${primeiroFila.locatario.nome} (posição ${primeiroFila.posicaoFila})`);

      // Oferecer ao primeiro da fila
      const reservaOfertada = await prisma.reserva.update({
        where: { id: primeiroFila.id },
        data: {
          status: 'OFERECIDO_LOCATARIO',
          dataOferta: new Date(),
          posicaoFila: null // Remove da fila
        },
        include: {
          quadra: { include: { locador: true } },
          locatario: true
        }
      });

      // Atualizar posições da fila
      await filaService.reorganizarFila(quadraId, dataInicio, dataFim);

      // Enviar notificação ao locatário
      await emailService.oferecerHorarioLocatario(
        reservaOfertada.locatario,
        reservaOfertada.quadra,
        reservaOfertada
      );

      console.log(`✅ Oferta enviada para: ${reservaOfertada.locatario.nome}`);
      return reservaOfertada;
    } catch (error) {
      console.error('❌ Erro ao processar próxima fila:', error);
      throw error;
    }
  },

  /**
   * Reorganizar posições da fila após remover alguém
   */
  reorganizarFila: async (quadraId, dataInicio, dataFim) => {
    try {
      const dataInicioDate = new Date(dataInicio);
      const dataFimDate = new Date(dataFim);

      // Buscar todas as reservas em fila para esta quadra
      const todasEmFila = await prisma.reserva.findMany({
        where: {
          quadraId: Number(quadraId),
          status: 'EM_FILA'
        },
        orderBy: { createdAt: 'asc' }
      });

      // Filtrar pelo horário
      const filaDoHorario = todasEmFila.filter(r => {
        return r.dataInicio.getTime() === dataInicioDate.getTime() &&
               r.dataFim.getTime() === dataFimDate.getTime();
      });

      console.log(`🔄 Reorganizando fila: ${filaDoHorario.length} reservas`);

      // Atualizar posições
      for (let i = 0; i < filaDoHorario.length; i++) {
        await prisma.reserva.update({
          where: { id: filaDoHorario[i].id },
          data: { posicaoFila: i + 1 }
        });
        console.log(`  └─ ${i + 1}. Posição atualizada`);
      }

      console.log(`✅ Fila reorganizada: ${filaDoHorario.length} reservas restantes\n`);
      return filaDoHorario.length;
    } catch (error) {
      console.error('Erro ao reorganizar fila:', error);
      throw error;
    }
  },

  /**
   * Confirmar que locatário quer a reserva oferecida
   * Mudar de OFERECIDO_LOCATARIO para AGUARDANDO_APROVACAO
   */
  confirmarOferta: async (reservaId, locatarioId) => {
    try {
      const reserva = await prisma.reserva.findUnique({
        where: { id: Number(reservaId) },
        include: {
          quadra: { include: { locador: true } },
          locatario: true
        }
      });

      if (!reserva) {
        throw new Error('Reserva não encontrada');
      }

      if (reserva.locatarioId !== Number(locatarioId)) {
        throw new Error('Você não tem permissão para confirmar esta reserva');
      }

      if (reserva.status !== 'OFERECIDO_LOCATARIO') {
        throw new Error(`Status inválido para confirmação: ${reserva.status}`);
      }

      // Verificar se já passou das 12 horas
      const horasPassadas = (new Date() - reserva.dataOferta) / (1000 * 60 * 60);
      if (horasPassadas > 12) {
        // Remover e oferecer ao próximo
        await filaService.removerOfertaExpirada(reserva);
        throw new Error('Prazo de 12 horas expirou. A oferta foi passada para o próximo da fila.');
      }

      // Mudar status para AGUARDANDO_APROVACAO
      const reservaConfirmada = await prisma.reserva.update({
        where: { id: Number(reservaId) },
        data: {
          status: 'AGUARDANDO_APROVACAO',
          dataOferta: null // Limpar data de oferta
        },
        include: {
          quadra: { include: { locador: true } },
          locatario: true
        }
      });

      // Notificar locador
      await emailService.notificarLocadorOfertaPendente(
        reservaConfirmada.quadra.locador,
        reservaConfirmada.quadra,
        reservaConfirmada.locatario,
        reservaConfirmada
      );

      return reservaConfirmada;
    } catch (error) {
      console.error('Erro ao confirmar oferta:', error);
      throw error;
    }
  },

  /**
   * Processar oferta expirada (timeout de 12 horas)
   */
  removerOfertaExpirada: async (reserva) => {
    try {
      // Deletar reserva expirada
      await prisma.reserva.delete({
        where: { id: reserva.id }
      });

      // Notificar locatário que foi removido
      await emailService.notificarRemocaoFilaPorTimeout(
        reserva.locatario,
        reserva.quadra
      );

      // Oferecer próximo da fila
      const proximoOfertado = await filaService.processarProximaFila(
        reserva.quadraId,
        reserva.dataInicio,
        reserva.dataFim
      );

      console.log(`✅ Oferta expirada removida. Próximo da fila: ${proximoOfertado ? proximoOfertado.id : 'nenhum'}`);

      return proximoOfertado;
    } catch (error) {
      console.error('Erro ao remover oferta expirada:', error);
      throw error;
    }
  },

  /**
   * Buscar todas as ofertas expiradas (> 12 horas)
   */
  buscarOfertasExpiradas: async () => {
    try {
      const agora = new Date();
      const limite12h = new Date(agora.getTime() - 12 * 60 * 60 * 1000);

      const expiradas = await prisma.reserva.findMany({
        where: {
          status: 'OFERECIDO_LOCATARIO',
          dataOferta: { lt: limite12h }
        },
        include: {
          quadra: { include: { locador: true } },
          locatario: true
        }
      });

      return expiradas;
    } catch (error) {
      console.error('Erro ao buscar ofertas expiradas:', error);
      throw error;
    }
  },

  /**
   * Processar todas as ofertas expiradas
   * (Chamado pelo cron job a cada hora)
   */
  processarOfertasExpiradas: async () => {
    try {
      const expiradas = await filaService.buscarOfertasExpiradas();
      
      if (expiradas.length === 0) {
        console.log('✅ Nenhuma oferta expirada para processar');
        return;
      }

      console.log(`⏳ Processando ${expiradas.length} oferta(s) expirada(s)...`);

      for (const reserva of expiradas) {
        await filaService.removerOfertaExpirada(reserva);
      }

      console.log(`✅ ${expiradas.length} oferta(s) processada(s)`);
    } catch (error) {
      console.error('Erro ao processar ofertas expiradas:', error);
    }
  },

  /**
   * Buscar fila de espera para um horário específico
   */
  buscarFila: async (quadraId, dataInicio, dataFim) => {
    try {
      const fila = await prisma.reserva.findMany({
        where: {
          quadraId: Number(quadraId),
          status: 'EM_FILA',
          dataInicio: new Date(dataInicio),
          dataFim: new Date(dataFim)
        },
        include: {
          locatario: true
        },
        orderBy: { posicaoFila: 'asc' }
      });

      return fila;
    } catch (error) {
      console.error('Erro ao buscar fila:', error);
      throw error;
    }
  },

  /**
   * Buscar status atual de uma reserva (se está em fila, ofertada, etc)
   */
  buscarStatusReserva: async (reservaId) => {
    try {
      const reserva = await prisma.reserva.findUnique({
        where: { id: Number(reservaId) },
        include: {
          quadra: { include: { locador: true } },
          locatario: true
        }
      });

      if (!reserva) {
        throw new Error('Reserva não encontrada');
      }

      let info = {
        id: reserva.id,
        status: reserva.status,
        quadra: reserva.quadra.nome,
        periodo: {
          dataInicio: formatarISOLocal(reserva.dataInicio),
          dataFim: formatarISOLocal(reserva.dataFim)
        }
      };

      if (reserva.status === 'EM_FILA') {
        info.filaInfo = {
          posicao: reserva.posicaoFila,
          mensagem: `Você está na posição #${reserva.posicaoFila} da fila`
        };
      }

      if (reserva.status === 'OFERECIDO_LOCATARIO') {
        const horasRestantes = 12 - ((new Date() - reserva.dataOferta) / (1000 * 60 * 60));
        info.ofertaInfo = {
          dataOferta: formatarISOLocal(reserva.dataOferta),
          horasRestantes: Math.max(0, horasRestantes),
          prazoDe: new Date(reserva.dataOferta.getTime() + 12 * 60 * 60 * 1000).toLocaleString('pt-BR'),
          mensagem: horasRestantes > 0 
            ? `Confirme sua reserva em ${Math.ceil(horasRestantes)} hora(s)`
            : 'Prazo expirado'
        };
      }

      return info;
    } catch (error) {
      console.error('Erro ao buscar status:', error);
      throw error;
    }
  }
};

module.exports = filaService;
