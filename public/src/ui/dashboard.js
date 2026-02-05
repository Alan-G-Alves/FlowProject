/**
 * dashboard.js
 * Módulo de UI para o dashboard (cards principais)
 * 
 * Funcionalidades:
 * - Renderização de cards do dashboard
 * - Cards diferentes por perfil (SuperAdmin, Admin, Gestor, Técnico)
 * - Navegação para as diferentes seções do sistema
 */

export function renderDashboardCards(deps, profile){
  const { refs, state, openCompaniesView, openManagerUsersView, openAdminView } = deps;
  
  if (!refs.dashCards) return;
  refs.dashCards.innerHTML = "";

  const cards = [];

  if (state.isSuperAdmin){
    cards.push({
      title: "Empresas",
      desc: "Gerencie as empresas cadastradas no FlowProject.",
      badge: "Master",
      action: () => openCompaniesView()
    });
  } else {
    cards.push({
      title: "Meus Projetos",
      desc: "Em breve: Kanban de projetos e visão por equipe.",
      badge: "Fase 2",
      action: () => alert("Fase 2: Kanban de Projetos")
    });

    if (profile.role === "gestor") {
      cards.push({
        title: "Usuários (Técnicos)",
        desc: "Cadastre técnicos e vincule às equipes que você administra.",
        badge: "Gestor",
        action: () => openManagerUsersView()
      });
    }

    if (profile.role === "admin"){
      cards.push({
        title: "Administração",
        desc: "Gerencie equipes e usuários da empresa.",
        badge: "Admin",
        action: () => openAdminView()
      });
    }
  }

  for (const c of cards){
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <h3 class="title">${c.title}</h3>
      <p class="desc">${c.desc}</p>
      <div class="meta"><span class="badge">${c.badge}</span></div>
    `;
    el.addEventListener("click", c.action);
    refs.dashCards.appendChild(el);
  }
}
