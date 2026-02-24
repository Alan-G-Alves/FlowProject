// FlowProject - Router (Hash Routes) para SPA sem framework
// Mantém o app em 1 página (index.html), alternando views por id via setView().
// Rotas no formato: #/login, #/dashboard, #/admin, #/companies, #/manager-users

import { show, hide } from "../utils/dom.js";
import { unsubscribeMyProjects } from "../domain/projects.domain.js";

const ids = {
  sidebar: "sidebar",
  viewLogin: "viewLogin",
  viewDashboard: "viewDashboard",
  viewAdmin: "viewAdmin",
  viewCompanies: "viewCompanies",
  viewManagerUsers: "viewManagerUsers",
  viewClients: "viewClients",
  viewMyProjects: "viewMyProjects",
  viewProjects: "viewProjects",
};

function el(id){ return document.getElementById(id); }

export function setView(name){
  const sidebar = el(ids.sidebar);
  const viewLogin = el(ids.viewLogin);
  const viewDashboard = el(ids.viewDashboard);
  const viewAdmin = el(ids.viewAdmin);
  const viewCompanies = el(ids.viewCompanies);
  const viewManagerUsers = el(ids.viewManagerUsers);
  const viewClients = el(ids.viewClients);
  const viewMyProjects = el(ids.viewMyProjects);
  const viewProjects = el(ids.viewProjects);

  // 🔥 Cleanup: ao sair do Kanban realtime, cancela o onSnapshot
  const wasInMyProjects = !!viewMyProjects && !viewMyProjects.hidden;
  if (wasInMyProjects && name !== "myProjects") {
    try {
      unsubscribeMyProjects();
    } catch (e) {
      console.warn("unsubscribeMyProjects failed:", e);
    }
  }

  hide(viewLogin);
  hide(viewDashboard);
  hide(viewAdmin);
  hide(viewCompanies);
  hide(viewManagerUsers);
  hide(viewClients);
  hide(viewMyProjects);
  hide(viewProjects);

  if (name === "login"){
    document.body.classList.add("is-login");
    hide(sidebar);
  } else {
    document.body.classList.remove("is-login");
    show(sidebar);
  }

  if (name === "login") show(viewLogin);
  if (name === "dashboard") show(viewDashboard);
  if (name === "admin") show(viewAdmin);
  if (name === "companies") show(viewCompanies);
  if (name === "managerUsers") show(viewManagerUsers);
  if (name === "clients") show(viewClients);
  if (name === "myProjects") show(viewMyProjects);
  if (name === "projects") show(viewProjects);
}

// =========================
// Hash Router helpers
// =========================
export const ROUTES = Object.freeze({
  login: "#/login",
  dashboard: "#/dashboard",
  admin: "#/admin",
  companies: "#/companies",
  managerUsers: "#/manager-users",
});

export function getHashPath(){
  const h = (window.location.hash || "").trim();
  if (!h) return ROUTES.login;
  // normaliza: '#', '#/' => '#/login'
  if (h === "#" || h === "#/") return ROUTES.login;
  return h;
}

export function navigateTo(hash){
  if (!hash) return;
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}

// Inicializa o listener de hashchange.
// Você injeta a regra de acesso e o render via callbacks para manter o router sem dependências do app.js.
export function initHashRouter({ resolve, fallback } = {}){
  const handle = () => {
    const hash = getHashPath();
    if (typeof resolve === "function") resolve(hash);
    else if (typeof fallback === "function") fallback(hash);
  };

  window.addEventListener("hashchange", handle);
  // roda 1x no load
  handle();

  // retorna função de cleanup se precisar
  return () => window.removeEventListener("hashchange", handle);
}