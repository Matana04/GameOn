const cron = require('node-cron');
const filaService = require('../services/filaService');
const emailService = require('../services/emailService');
const prisma = require('../database/prismaClient');

/**
 * Verificar e enviar lembretes de reservas
 */
async function processarLembretesReservas() {
  try {
    const agora = new Date();

    // Buscar todas as reservas confirmadas (RESERVADO) que não foram canceladas
    const reservas = await prisma.reserva.findMany({
      where: {
        status: 'RESERVADO'
      },
      include: {
        quadra: {
          include: { locador: true }
        },
        locatario: true
      }
    });

    for (const reserva of reservas) {
      const dataInicio = new Date(reserva.dataInicio);
      const diferenca = dataInicio.getTime() - agora.getTime();
      const horasAte = diferenca / (1000 * 60 * 60);

      // 1 dia antes (24 horas)
      if (horasAte <= 24 && horasAte > 23.5 && !reserva.lembreteUmDiaEnviado) {
        console.log(`📅 Enviando lembrete 1 dia antes para ${reserva.locatario.nome} - ${reserva.quadra.nome}`);
        await emailService.lembrar1DiaAntes(reserva.locatario, reserva.quadra, reserva);
        await prisma.reserva.update({
          where: { id: reserva.id },
          data: { lembreteUmDiaEnviado: true }
        });
      }

      // 6 horas antes
      if (horasAte <= 6 && horasAte > 5.5 && !reserva.lembrete6HorasEnviado) {
        console.log(`⚠️ Enviando lembrete 6 horas antes para ${reserva.locatario.nome} - ${reserva.quadra.nome}`);
        await emailService.lembrar6HorasAntes(reserva.locatario, reserva.quadra, reserva);
        await prisma.reserva.update({
          where: { id: reserva.id },
          data: { lembrete6HorasEnviado: true }
        });
      }

      // 3 horas antes
      if (horasAte <= 3 && horasAte > 2.5 && !reserva.lembrete3HorasEnviado) {
        console.log(`⏳ Enviando lembrete 3 horas antes para ${reserva.locatario.nome} - ${reserva.quadra.nome}`);
        await emailService.lembrar3HorasAntes(reserva.locatario, reserva.quadra, reserva);
        await prisma.reserva.update({
          where: { id: reserva.id },
          data: { lembrete3HorasEnviado: true }
        });
      }

      // 1 hora antes
      if (horasAte <= 1 && horasAte > 0.5 && !reserva.lembrete1HoraEnviado) {
        console.log(`🚨 Enviando lembrete 1 hora antes para ${reserva.locatario.nome} - ${reserva.quadra.nome}`);
        await emailService.lembrar1HoraAntes(reserva.locatario, reserva.quadra, reserva);
        await prisma.reserva.update({
          where: { id: reserva.id },
          data: { lembrete1HoraEnviado: true }
        });
      }
    }
  } catch (error) {
    console.error('❌ Erro ao processar lembretes de reservas:', error.message);
  }
}

/**
 * Iniciar cron jobs para processar fila de espera e lembretes
 */
function iniciarCronJobs() {
  console.log('🚀 Iniciando cron jobs...');

  /**
   * Executar a cada 1 hora: processar ofertas expiradas (> 12 horas)
   * Expressão: "0 * * * *" = toda hora cheia (00:00, 01:00, etc)
   */
  cron.schedule('0 * * * *', async () => {
    console.log('\n⏰ Executando verificação de ofertas expiradas...');
    await filaService.processarOfertasExpiradas();
  });


  cron.schedule('*/15 * * * *', async () => {
    console.log('\n📧 Executando verificação de lembretes...');
    await processarLembretesReservas();
  });

  /**
   * Alternativa: executar a cada 30 minutos
   * Descomentar se quiser verificação mais frequente
   */
  // cron.schedule('*/30 * * * *', async () => {
  //   console.log('\n⏰ Executando verificação de ofertas expiradas (30 min)...');
  //   await filaService.processarOfertasExpiradas();
  // });

  console.log('✅ Cron jobs iniciados com sucesso!');
}

/**
 * Parar todos os cron jobs
 */
function pararCronJobs() {
  cron.getTasks().forEach(task => task.stop());
  console.log('🛑 Todos os cron jobs foram parados');
}

module.exports = {
  iniciarCronJobs,
  pararCronJobs
};
