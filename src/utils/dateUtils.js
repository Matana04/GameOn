/**
 * Utilitários para conversão de datas com timezone
 * Padrão: UTC-3 (Brasília)
 */

const TIMEZONE_OFFSET_MINUTES = -180; // UTC-3 em minutos

/**
 * Converte uma data ISO string (sem timezone) para UTC
 * Assume que a entrada está em UTC-3
 * @param {string} isoString - Data em formato ISO (ex: "2026-04-17T22:00:00")
 * @returns {Date} Data em UTC
 */
function converterParaUTC(isoString) {
  const data = new Date(isoString);
  const offsetMs = TIMEZONE_OFFSET_MINUTES * 60 * 1000;
  const utcData = new Date(data.getTime() - offsetMs);
  return utcData;
}

/**
 * Converte uma data UTC para hora local (UTC-3)
 * @param {Date} dataUTC - Data em UTC
 * @returns {Date} Data ajustada para UTC-3
 */
function converterDeUTC(dataUTC) {
  const offsetMs = TIMEZONE_OFFSET_MINUTES * 60 * 1000;
  return new Date(dataUTC.getTime() + offsetMs);
}

/**
 * Formata uma data para ISO string local (sem Z no final)
 * @param {Date} data - Data a formatar
 * @returns {string} Data em formato ISO local
 */
function formatarISOLocal(data) {
  const dataLocal = converterDeUTC(data);
  const ano = dataLocal.getUTCFullYear();
  const mes = String(dataLocal.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(dataLocal.getUTCDate()).padStart(2, '0');
  const horas = String(dataLocal.getUTCHours()).padStart(2, '0');
  const minutos = String(dataLocal.getUTCMinutes()).padStart(2, '0');
  const segundos = String(dataLocal.getUTCSeconds()).padStart(2, '0');
  const ms = String(dataLocal.getUTCMilliseconds()).padStart(3, '0');
  
  return `${ano}-${mes}-${dia}T${horas}:${minutos}:${segundos}.${ms}`;
}

module.exports = {
  converterParaUTC,
  converterDeUTC,
  formatarISOLocal,
  TIMEZONE_OFFSET_MINUTES
};
