/**
 * Serviço de segurança para gerenciar códigos de verificação de reservas
 */

/**
 * Gera um código alfanumérico aleatório com 4 caracteres
 * Usa caracteres de 0-9 e A-Z (excluindo I, O, U, Z para evitar confusão com números)
 * @returns {string} Código de segurança (ex: A3B7)
 */
function gerarCodigoSeguranca() {
  // Caracteres permitidos: números 0-9 e letras maiúsculas (sem I, O, U, Z para evitar confusão)
  const caracteres = '0123456789ABCDEFGHJKLMNPQRSTVWXY';
  let codigo = '';
  
  for (let i = 0; i < 4; i++) {
    const indiceAleatorio = Math.floor(Math.random() * caracteres.length);
    codigo += caracteres[indiceAleatorio];
  }
  
  return codigo;
}

/**
 * Valida se um código tem o formato correto
 * @param {string} codigo - Código a ser validado
 * @returns {boolean} true se válido, false caso contrário
 */
function validarFormatoCodigo(codigo) {
  if (!codigo || typeof codigo !== 'string') return false;
  const regexCodigo = /^[0-9A-Z]{4}$/;
  return regexCodigo.test(codigo.toUpperCase());
}

/**
 * Verifica se o usuário tem permissão para visualizar o código da reserva
 * O código pode ser visualizado por:
 * - O locatário que fez a reserva
 * - O locador da quadra
 * 
 * @param {Object} reserva - Objeto da reserva
 * @param {number} usuarioId - ID do usuário autenticado
 * @param {string} tipoUsuario - Tipo do usuário (LOCADOR ou LOCATARIO)
 * @returns {boolean} true se tem permissão, false caso contrário
 */
function temPermissaoVerCodigoSeguranca(reserva, usuarioId, tipoUsuario) {
  if (tipoUsuario === 'LOCATARIO') {
    // Locatário só vê o código de suas próprias reservas
    return reserva.locatarioId === usuarioId;
  } else if (tipoUsuario === 'LOCADOR') {
    // Locador vê o código de todas as reservas de suas quadras
    return reserva.quadra.locadorId === usuarioId;
  }
  return false;
}

/**
 * Filtra as reservas retornando apenas o código de segurança para quem tem permissão
 * Remove o código da resposta para usuários sem permissão
 * 
 * @param {Array|Object} reservas - Uma reserva ou array de reservas
 * @param {number} usuarioId - ID do usuário autenticado
 * @param {string} tipoUsuario - Tipo do usuário (LOCADOR ou LOCATARIO)
 * @returns {Array|Object} Reserva(s) com código filtrado apropriadamente
 */
function filtrarCodigosSeguranca(reservas, usuarioId, tipoUsuario) {
  const ehArray = Array.isArray(reservas);
  const listaReservas = ehArray ? reservas : [reservas];
  
  const resultado = listaReservas.map(reserva => {
    const temPermissao = temPermissaoVerCodigoSeguranca(reserva, usuarioId, tipoUsuario);
    
    if (!temPermissao) {
      const { codigoSeguranca, ...reservaSemCodigo } = reserva;
      return reservaSemCodigo;
    }
    
    return reserva;
  });
  
  return ehArray ? resultado : resultado[0];
}

module.exports = {
  gerarCodigoSeguranca,
  validarFormatoCodigo,
  temPermissaoVerCodigoSeguranca,
  filtrarCodigosSeguranca
};
