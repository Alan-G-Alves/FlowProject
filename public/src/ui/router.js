// FlowProject - Router para SPA sem framework.
// Mantem o app em 1 pagina (index.html), alternando views por id via setView().

import { show, hide } from "../utils/dom.js";
import { unsubscribeMyProjects } from "../domain/projects.domain.js";

const ids = {
  sidebar: "sidebar",
  viewLogin: "viewLogin",
  viewDashboard: "viewDashboard",
  viewReports: "viewReports",
  viewAdmin: "viewAdmin",
  viewCompanies: "viewCompanies",
  viewManagerUsers: "viewManagerUsers",
  viewClients: "viewClients",
  viewSettings: "viewSettings",
  viewMyProjects: "viewMyProjects",
  viewMyActivities: "viewMyActivities",
  viewMyFeedbacks: "viewMyFeedbacks",
  viewOsApprovals: "viewOsApprovals",
  viewExpenseApprovals: "viewExpenseApprovals",
  viewProjects: "viewProjects",
};

function el(id){ return document.getElementById(id); }

export function setView(name){
  const sidebar = el(ids.sidebar);
  const viewLogin = el(ids.viewLogin);
  const viewDashboard = el(ids.viewDashboard);
  const viewReports = el(ids.viewReports);
  const viewAdmin = el(ids.viewAdmin);
  const viewCompanies = el(ids.viewCompanies);
  const viewManagerUsers = el(ids.viewManagerUsers);
  const viewClients = el(ids.viewClients);
  const viewSettings = el(ids.viewSettings);
  const viewMyProjects = el(ids.viewMyProjects);
  const viewMyActivities = el(ids.viewMyActivities);
  const viewMyFeedbacks = el(ids.viewMyFeedbacks);
  const viewOsApprovals = el(ids.viewOsApprovals);
  const viewExpenseApprovals = el(ids.viewExpenseApprovals);
  const viewProjects = el(ids.viewProjects);

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
  hide(viewReports);
  hide(viewAdmin);
  hide(viewCompanies);
  hide(viewManagerUsers);
  hide(viewClients);
  hide(viewSettings);
  hide(viewMyProjects);
  hide(viewMyActivities);
  hide(viewMyFeedbacks);
  hide(viewOsApprovals);
  hide(viewExpenseApprovals);
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
  if (name === "reports") show(viewReports);
  if (name === "admin") show(viewAdmin);
  if (name === "companies") show(viewCompanies);
  if (name === "managerUsers") show(viewManagerUsers);
  if (name === "clients") show(viewClients);
  if (name === "settings") show(viewSettings);
  if (name === "myProjects") show(viewMyProjects);
  if (name === "myActivities") show(viewMyActivities);
  if (name === "myFeedbacks") show(viewMyFeedbacks);
  if (name === "osApprovals") show(viewOsApprovals);
  if (name === "expenseApprovals") show(viewExpenseApprovals);
  if (name === "projects") show(viewProjects);
}

export const ROUTES = Object.freeze({
  login: "/login",
  dashboard: "/dashboard",
  admin: "/administracao",
  companies: "/empresas",
  managerUsers: "/tecnicos",
  clients: "/clientes",
  reports: "/relatorios",
  expenses: "/despesas",
  feedbacks: "/feedbacks",
  projects: "/projetos",
  myProjects: "/meus-projetos",
  myActivities: "/minhas-atividades",
  osApprovals: "/aprovacoes-os",
  settings: "/configuracoes",
});

export const ROUTE_TO_VIEW = Object.freeze({
  [ROUTES.login]: "login",
  [ROUTES.dashboard]: "dashboard",
  [ROUTES.admin]: "admin",
  [ROUTES.companies]: "companies",
  [ROUTES.managerUsers]: "managerUsers",
  [ROUTES.clients]: "clients",
  [ROUTES.reports]: "reports",
  [ROUTES.expenses]: "expenseApprovals",
  [ROUTES.feedbacks]: "myFeedbacks",
  [ROUTES.projects]: "projects",
  [ROUTES.myProjects]: "myProjects",
  [ROUTES.myActivities]: "myActivities",
  [ROUTES.osApprovals]: "osApprovals",
  [ROUTES.settings]: "settings",
});

export const VIEW_TO_ROUTE = Object.freeze(Object.fromEntries(
  Object.entries(ROUTE_TO_VIEW).map(([route, view]) => [view, route])
));

export function normalizeRoute(path = window.location.pathname){
  const raw = String(path || "/").split("?")[0].split("#")[0].trim() || "/";
  let clean = raw.startsWith("/") ? raw : `/${raw}`;
  clean = clean.replace(/\/{2,}/g, "/");
  if (clean.length > 1) clean = clean.replace(/\/+$/g, "");
  if (clean === "/") return ROUTES.dashboard;
  return clean;
}

export function getRoutePath(){
  return normalizeRoute(window.location.pathname);
}

export function isKnownRoute(path){
  return !!ROUTE_TO_VIEW[normalizeRoute(path)];
}

export function navigateTo(route, options = {}){
  const next = normalizeRoute(route);
  const current = getRoutePath();
  const method = options.replace ? "replaceState" : "pushState";
  if (current !== next || options.force) {
    window.history[method]({}, "", next);
  }
  window.dispatchEvent(new CustomEvent("flowproject:routechange", { detail: { route: next } }));
}

export function initCleanRouter({ resolve } = {}){
  const handle = () => {
    const route = getRoutePath();
    if (typeof resolve === "function") {
      const result = resolve(route);
      if (result && typeof result.catch === "function") {
        result.catch((err) => console.error("[router] route handler failed:", err));
      }
    }
  };

  window.addEventListener("popstate", handle);
  window.addEventListener("flowproject:routechange", handle);
  handle();

  return () => {
    window.removeEventListener("popstate", handle);
    window.removeEventListener("flowproject:routechange", handle);
  };
}
