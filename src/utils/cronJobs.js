const cron = require('node-cron');
const filaService = require('../services/filaService');

/**
 * Iniciar cron jobs para processar fila de espera
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
