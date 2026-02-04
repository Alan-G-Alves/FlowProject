// FlowProject - utilitário de papéis (roles)
// Objetivo: centralizar rotulagem de papéis e evitar duplicação no app.js (monolito).
// Em futuras refatorações, mais utils virão para /public/src/utils.

export function normalizeRole(role){
  const map = {
    superadmin: "Master Admin",
    admin: "Admin",
    gestor: "Gestor",
    coordenador: "Coordenador",
    tecnico: "Técnico"
  };
  return map[role] || "Usuário";
}

// Compatibilidade com código legado
export const humanizeRole = normalizeRole;
