const nodemailer = require('nodemailer');

/**
 * Configurar transporter de email
 * Para desenvolvimento, usar credenciais de um serviço como Gmail
 * Em produção, usar suas credenciais SMTP reais
 */
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

const emailService = {
  /**
   * Enviar email notificando locatário que entrou na fila
   */
  notificarLocatarioEntFila: async (locatario, quadra, posicao) => {
    const assunto = `${quadra.nome} - Você está na fila de espera (posição #${posicao})`;
    
    const html = `
      <h2>Sua solicitação de reserva foi adicionada à fila de espera</h2>
      <p>Olá ${locatario.nome},</p>
      <p>A quadra <strong>${quadra.nome}</strong> já possui uma reserva para o horário solicitado.</p>
      <p>Você foi adicionado à <strong>fila de espera na posição #${posicao}</strong>.</p>
      <p>Se alguém cancelar antes de você, você receberá uma oferta para aproveitar aquele horário!</p>
      <p>Você tem até <strong>6 horas antes</strong> do horário da reserva para entrar na fila.</p>
    `;

    return emailService.enviar(locatario.email, assunto, html);
  },

  /**
   * Enviar email ofertando horário ao locatário
   */
  oferecerHorarioLocatario: async (locatario, quadra, reserva) => {
    const assunto = `${quadra.nome} - Seu horário está disponível! Confirme em 12 horas`;
    
    const dataInicio = new Date(reserva.dataInicio).toLocaleString('pt-BR');
    const dataFim = new Date(reserva.dataFim).toLocaleString('pt-BR');
    const dataLimite = new Date(Date.now() + 12 * 60 * 60 * 1000).toLocaleString('pt-BR');

    const html = `
      <h2>Seu horário está disponível!</h2>
      <p>Olá ${locatario.nome},</p>
      <p>Ótima notícia! A quadra <strong>${quadra.nome}</strong> está disponível para o horário que você solicitou:</p>
      <ul>
        <li><strong>Data/Hora:</strong> ${dataInicio} até ${dataFim}</li>
        <li><strong>Valor:</strong> R$ ${parseFloat(reserva.valorTotal).toFixed(2)}</li>
      </ul>
      <p>⏰ <strong>Você tem até ${dataLimite} para confirmar sua intenção de reservar.</strong></p>
      <p>Se não confirmar neste prazo, a oferta será passada para o próximo da fila.</p>
      <p><a href="${process.env.APP_URL || 'https://app.gameon.com'}/reservas/${reserva.id}/confirmar" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Confirmar Reserva</a></p>
    `;

    return emailService.enviar(locatario.email, assunto, html);
  },

  /**
   * Enviar email notificando locador de nova oferta pendente
   */
  notificarLocadorOfertaPendente: async (locador, quadra, locatario, reserva) => {
    const assunto = `${quadra.nome} - Nova solicitação de reserva aguardando aprovação`;
    
    const dataInicio = new Date(reserva.dataInicio).toLocaleString('pt-BR');
    const dataFim = new Date(reserva.dataFim).toLocaleString('pt-BR');

    const html = `
      <h2>Nova solicitação de reserva</h2>
      <p>Olá ${locador.nome},</p>
      <p>O locatário <strong>${locatario.nome}</strong> confirmou sua intenção de alugar a quadra <strong>${quadra.nome}</strong>:</p>
      <ul>
        <li><strong>Data/Hora:</strong> ${dataInicio} até ${dataFim}</li>
        <li><strong>Valor:</strong> R$ ${parseFloat(reserva.valorTotal).toFixed(2)}</li>
      </ul>
      <p>Por favor, aprove ou rejeite esta solicitação no seu painel.</p>
      <p><a href="${process.env.APP_URL || 'https://app.gameon.com'}/reservas/${reserva.id}" style="background-color: #2196F3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Ver Solicitação</a></p>
    `;

    return emailService.enviar(locador.email, assunto, html);
  },

  /**
   * Enviar email notificando locador que há fila de espera
   */
  notificarLocadorFilaPendente: async (locador, quadra, quantidadeFila) => {
    const assunto = `${quadra.nome} - Há ${quantidadeFila} pessoa(s) na fila de espera`;
    
    const html = `
      <h2>Fila de espera ativa</h2>
      <p>Olá ${locador.nome},</p>
      <p>Sua quadra <strong>${quadra.nome}</strong> tem <strong>${quantidadeFila} pessoa(s)</strong> aguardando em fila de espera.</p>
      <p>Se você cancelar alguma reserva, o próximo da fila receberá uma oferta automaticamente.</p>
    `;

    return emailService.enviar(locador.email, assunto, html);
  },

  /**
   * Enviar email para locatário que foi removido da fila por timeout
   */
  notificarRemocaoFilaPorTimeout: async (locatario, quadra) => {
    const assunto = `${quadra.nome} - Sua solicitação foi removida da fila`;
    
    const html = `
      <h2>Sua solicitação foi removida da fila</h2>
      <p>Olá ${locatario.nome},</p>
      <p>Infelizmente, sua solicitação para a quadra <strong>${quadra.nome}</strong> foi removida da fila de espera.</p>
      <p>Isso ocorreu porque você não confirmou sua intenção de reservar no prazo de 12 horas oferecido.</p>
      <p>Você pode tentar novamente quando a quadra estiver disponível.</p>
    `;

    return emailService.enviar(locatario.email, assunto, html);
  },

  /**
   * Enviar email notificando locatário que sua reserva foi cancelada pelo locador
   */
  notificarCancelamentoPorLocador: async (locatario, quadra, reserva, motivo = '') => {
    const assunto = `${quadra.nome} - Sua reserva foi cancelada`;
    const dataInicio = new Date(reserva.dataInicio).toLocaleString('pt-BR');
    const dataFim = new Date(reserva.dataFim).toLocaleString('pt-BR');
    
    const html = `
      <h2>Sua reserva foi cancelada</h2>
      <p>Olá ${locatario.nome},</p>
      <p>Infelizmente, o locador <strong>${quadra.locador.nome}</strong> cancelou sua reserva:</p>
      <ul>
        <li><strong>Quadra:</strong> ${quadra.nome} (${quadra.esporte})</li>
        <li><strong>Data/Hora:</strong> ${dataInicio} até ${dataFim}</li>
        <li><strong>Valor:</strong> R$ ${parseFloat(reserva.valorTotal).toFixed(2)}</li>
      </ul>
      ${motivo ? `<p><strong>Motivo do cancelamento:</strong> ${motivo}</p>` : ''}
      <p>Você pode tentar agendar para outro horário ou entrar em contato com o locador para mais informações.</p>
    `;

    return emailService.enviar(locatario.email, assunto, html);
  },

  /**
   * Enviar email notificando locador que sua reserva foi cancelada pelo locatário
   */
  notificarCancelamentoPorLocatario: async (locador, quadra, reserva, locatario, motivo = '') => {
    const assunto = `${quadra.nome} - Reserva cancelada pelo locatário`;
    const dataInicio = new Date(reserva.dataInicio).toLocaleString('pt-BR');
    const dataFim = new Date(reserva.dataFim).toLocaleString('pt-BR');
    
    const html = `
      <h2>Uma reserva foi cancelada</h2>
      <p>Olá ${locador.nome},</p>
      <p>O locatário <strong>${locatario.nome}</strong> cancelou a seguinte reserva:</p>
      <ul>
        <li><strong>Quadra:</strong> ${quadra.nome}</li>
        <li><strong>Data/Hora:</strong> ${dataInicio} até ${dataFim}</li>
        <li><strong>Valor:</strong> R$ ${parseFloat(reserva.valorTotal).toFixed(2)}</li>
        <li><strong>Locatário:</strong> ${locatario.nome} (${locatario.email})</li>
      </ul>
      ${motivo ? `<p><strong>Motivo do cancelamento:</strong> ${motivo}</p>` : ''}
      <p>Essa data está agora disponível para novas reservas.</p>
      ${reserva.posicaoFila ? `<p>⚠️ <strong>Aviso:</strong> Há locatários aguardando em fila de espera para este horário!</p>` : ''}
    `;

    return emailService.enviar(locador.email, assunto, html);
  },

  /**
   * Enviar lembrete de reserva - 1 dia antes
   */
  lembrar1DiaAntes: async (locatario, quadra, reserva) => {
    const assunto = `📅 Lembrete: ${quadra.nome} em 1 dia`;
    const dataInicio = new Date(reserva.dataInicio).toLocaleString('pt-BR');
    const dataFim = new Date(reserva.dataFim).toLocaleString('pt-BR');
    
    const html = `
      <h2>📅 Lembrete da sua Reserva!</h2>
      <p>Olá ${locatario.nome},</p>
      <p>Sua reserva acontece <strong>em 1 dia!</strong></p>
      <ul>
        <li><strong>Quadra:</strong> ${quadra.nome} (${quadra.esporte})</li>
        <li><strong>Data/Hora:</strong> ${dataInicio} até ${dataFim}</li>
        <li><strong>Valor:</strong> R$ ${parseFloat(reserva.valorTotal).toFixed(2)}</li>
        <li><strong>Código de Segurança:</strong> ${reserva.codigoSeguranca}</li>
      </ul>
      <p>Certifique-se de chegar com antecedência!</p>
    `;

    return emailService.enviar(locatario.email, assunto, html);
  },

  /**
   * Enviar lembrete de reserva - 6 horas antes
   */
  lembrar6HorasAntes: async (locatario, quadra, reserva) => {
    const assunto = `⚠️ Lembrete: ${quadra.nome} em 6 horas`;
    const dataInicio = new Date(reserva.dataInicio).toLocaleString('pt-BR');
    const dataFim = new Date(reserva.dataFim).toLocaleString('pt-BR');
    
    const html = `
      <h2>⚠️ Lembrete: Sua Reserva em 6 Horas!</h2>
      <p>Olá ${locatario.nome},</p>
      <p>Sua reserva acontece <strong>em 6 horas!</strong> Não esqueça de se preparar.</p>
      <ul>
        <li><strong>Quadra:</strong> ${quadra.nome} (${quadra.esporte})</li>
        <li><strong>Data/Hora:</strong> ${dataInicio} até ${dataFim}</li>
        <li><strong>Valor:</strong> R$ ${parseFloat(reserva.valorTotal).toFixed(2)}</li>
        <li><strong>Código de Segurança:</strong> ${reserva.codigoSeguranca}</li>
      </ul>
      <p>Você pode cancelar até 2 horas antes se necessário.</p>
    `;

    return emailService.enviar(locatario.email, assunto, html);
  },

  /**
   * Enviar lembrete de reserva - 3 horas antes
   */
  lembrar3HorasAntes: async (locatario, quadra, reserva) => {
    const assunto = `⏳ Último Lembrete: ${quadra.nome} em 3 horas`;
    const dataInicio = new Date(reserva.dataInicio).toLocaleString('pt-BR');
    const dataFim = new Date(reserva.dataFim).toLocaleString('pt-BR');
    
    const html = `
      <h2>⏳ Último Lembrete: Faltam 3 Horas!</h2>
      <p>Olá ${locatario.nome},</p>
      <p>Sua reserva acontece <strong>em apenas 3 horas!</strong> Prepare-se para sair em breve.</p>
      <ul>
        <li><strong>Quadra:</strong> ${quadra.nome} (${quadra.esporte})</li>
        <li><strong>Data/Hora:</strong> ${dataInicio} até ${dataFim}</li>
        <li><strong>Valor:</strong> R$ ${parseFloat(reserva.valorTotal).toFixed(2)}</li>
        <li><strong>Código de Segurança:</strong> ${reserva.codigoSeguranca}</li>
        <li><strong>Endereço:</strong> ${quadra.endereco || 'Não informado'}</li>
      </ul>
      <p>Você ainda pode cancelar até 2 horas antes se necessário.</p>
    `;

    return emailService.enviar(locatario.email, assunto, html);
  },

  /**
   * Enviar lembrete de reserva - 1 hora antes
   */
  lembrar1HoraAntes: async (locatario, quadra, reserva) => {
    const assunto = `🚨 URGENTE: ${quadra.nome} em 1 hora!`;
    const dataInicio = new Date(reserva.dataInicio).toLocaleString('pt-BR');
    const dataFim = new Date(reserva.dataFim).toLocaleString('pt-BR');
    
    const html = `
      <h2>🚨 URGENTE: Sua Reserva Começa em 1 Hora!</h2>
      <p>Olá ${locatario.nome},</p>
      <p>Sua reserva começa <strong>em APENAS 1 HORA!</strong> Saia agora para não se atrasar!</p>
      <ul>
        <li><strong>Quadra:</strong> ${quadra.nome} (${quadra.esporte})</li>
        <li><strong>Data/Hora:</strong> ${dataInicio} até ${dataFim}</li>
        <li><strong>Valor:</strong> R$ ${parseFloat(reserva.valorTotal).toFixed(2)}</li>
        <li><strong>Código de Segurança:</strong> ${reserva.codigoSeguranca}</li>
        <li><strong>Endereço:</strong> ${quadra.endereco || 'Não informado'}</li>
      </ul>
      <p>🚫 <strong>Aviso:</strong> Cancelamentos são permitidos até 2 horas antes do horário.</p>
    `;

    return emailService.enviar(locatario.email, assunto, html);
  },

  /**
   * Enviar email genérico
   */
  enviar: async (para, assunto, html) => {
    try {
      const info = await transporter.sendMail({
        from: process.env.EMAIL_USER || 'noreply@gameon.com',
        to: para,
        subject: assunto,
        html: html
      });

      console.log(`✅ Email enviado: ${para} - ${assunto}`);
      return { sucesso: true, messageId: info.messageId };
    } catch (error) {
      console.error(`❌ Erro ao enviar email para ${para}:`, error.message);
      return { sucesso: false, erro: error.message };
    }
  }
};

module.exports = emailService;
