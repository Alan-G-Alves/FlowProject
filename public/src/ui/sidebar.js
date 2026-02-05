/**
 * sidebar.js
 * Módulo de UI para a sidebar (navegação lateral)
 * 
 * Funcionalidades:
 * - Inicialização da sidebar com estado persistido
 * - Toggle de expansão/recolhimento
 * - Navegação entre views
 * - Gestão de estado ativo dos itens de navegação
 */

export function initSidebar(deps){
  const { refs, setView, state } = deps;
  
  if (!refs.sidebar) return;

  // estado persistido (padrão: recolhido)
  const saved = localStorage.getItem("fp.refs.sidebar.expanded");
  if (saved === "1") refs.sidebar.classList.add("expanded");

  const toggle = () => {
    refs.sidebar.classList.toggle("expanded");
    localStorage.setItem("fp.refs.sidebar.expanded", refs.sidebar.classList.contains("expanded") ? "1" : "0");
  };

  // Remove o hambúrguer: expansão por clique em qualquer área "vazia" da barra
  refs.sidebar.addEventListener("click", (e) => {
    // se clicou em um item do menu, NÃO alterna (deixa só navegar)
    if (e.target?.closest?.(".nav-item")) return;
    toggle();
  });

  // (se existir por algum motivo no HTML antigo, ainda funciona)
  refs.btnToggleSidebar?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });

  // Ações (por enquanto: navegação de views existentes)
  refs.navHome?.addEventListener("click", () => {
    setActiveNav(refs, "navHome");
    setView("dashboard");
  });
  
  refs.navReports?.addEventListener("click", () => {
    setActiveNav(refs, "navReports");
    alert("Em breve: Relatórios e indicadores");
  });
  
  refs.navAddProject?.addEventListener("click", () => {
    setActiveNav(refs, "navAddProject");
    alert("Em breve: Adicionar projeto");
  });
  
  refs.navAddTech?.addEventListener("click", () => {
    setActiveNav(refs, "navAddTech");
    // para gestor, já existe tela de técnicos
    if (state.profile?.role === "gestor") setView("managerUsers");
    else alert("Acesso restrito: somente Gestor");
  });
  
  refs.navConfig?.addEventListener("click", () => {
    setActiveNav(refs, "navConfig");
    alert("Em breve: Configurações");
  });
}

function setActiveNav(refs, activeId){
  const items = [refs.navHome, refs.navAddProject, refs.navAddTech, refs.navReports, refs.navConfig];
  for (const el of items){
    if (el) el.classList.remove("active");
  }
  const elem = refs[activeId];
  if (elem) elem.classList.add("active");
}
