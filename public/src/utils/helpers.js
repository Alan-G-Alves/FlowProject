/**
 * helpers.js
 * Funções auxiliares genéricas
 * 
 * Funções utilitárias que são usadas em múltiplos lugares do app
 */

/**
 * Verifica se dois arrays têm algum elemento em comum
 * @param {Array} a - Primeiro array
 * @param {Array} b - Segundo array
 * @returns {boolean} - true se houver interseção
 */
export function intersects(a = [], b = []) {
  const setB = new Set(b || []);
  return (a || []).some(x => setB.has(x));
}

/**
 * Obtém o nome de uma equipe pelo ID
 * @param {Object} state - Estado global da aplicação
 * @param {string} teamId - ID da equipe
 * @returns {string} - Nome da equipe ou o ID se não encontrado
 */
export function getTeamNameById(state, teamId){
  const t = (state.teams || []).find(x => x.id === teamId);
  return t ? (t.name || t.id) : teamId;
}

/**
 * Gera iniciais a partir de um nome
 * @param {string} name - Nome completo
 * @returns {string} - Iniciais (primeira e última letra)
 */
export function initialFromName(name){
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] || "U";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] || "") : "";
  return (a + b).toUpperCase();
}
