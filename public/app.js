console.log("APP.JS CARREGADO: vHTTP-TESTE-02");

import {
  initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  onSnapshot,
  query,
  where,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

import { normalizeRole, humanizeRole } from "./src/utils/roles.js";
import { show, hide, escapeHtml } from "./src/utils/dom.js";
import {
  setView,
  ROUTES,
  getRoutePath,
  isKnownRoute,
  navigateTo,
  initCleanRouter,
  normalizeRoute
} from "./src/ui/router.js?v=1777551400";
import { isEmailValidBasic, isCnpjValidBasic } from "./src/utils/validators.js";
import { fetchPlatformUser, fetchCompanyIdForUser, fetchCompanyUserProfile } from "./src/services/firestore.service.js";
import { auth, secondaryAuth, db, storage, functions, httpsCallable } from "./src/config/firebase.js";
import { normalizePhone, normalizeCnpj, slugify } from "./src/utils/format.js";
import { setAlert, clearAlert, clearInlineAlert, showInlineAlert, showDialogAlert } from "./src/ui/alerts.js";
import { getCompanyDoc, listCompaniesDocs } from "./src/services/companies.service.js";
import { createNotification } from "./src/services/notifications.service.js?v=1776052722";
import * as refs from "./src/ui/refs.js?v=1778794200";
import * as companiesDomain from "./src/domain/companies.domain.js?v=1778794100";
import * as teamsDomain from "./src/domain/teams.domain.js?v=1772614200";
import * as usersDomain from "./src/domain/users.domain.js?v=1778794100";
import * as managerUsersDomain from "./src/domain/manager-users.domain.js?v=1778794100";
import * as clientsDomain from "./src/domain/clients.domain.js?v=1778628200";
import * as projectsDomain from "./src/domain/projects.domain.js?v=1778616200";
import * as myActivitiesDomain from "./src/domain/my-activities.domain.js?v=1778795200";
import * as myFeedbacksDomain from "./src/domain/my-feedbacks.domain.js?v=1778629800";
import * as osApprovalsDomain from "./src/domain/os-approvals.domain.js?v=1776052722";
import * as expensesDomain from "./src/domain/expenses.domain.js?v=1778720300";
import * as projectWorkspaceDomain from "./src/domain/project-workspace.domain.js?v=1778794000";
import * as reportsDomain from "./src/domain/reports.domain.js?v=1778795000";
import * as lgpdDomain from "./src/domain/lgpd.domain.js?v=1777475100";
import * as profileModal from "./src/ui/modals/profile.modal.js?v=1770332251";
import * as topbar from "./src/ui/topbar.js?v=1770332251";
import * as sidebar from "./src/ui/sidebar.js?v=1770332251";
import * as dashboard from "./src/ui/dashboard.js?v=1770332251";
import { initHelpManual } from "./src/ui/help-manual.js?v=1778794500";
import { intersects, getTeamNameById, initialFromName } from "./src/utils/helpers.js?v=1770332251";

// Evita double-binding de eventos (há blocos de listeners repetidos no app.js)
function onOnce(el, type, handler, key = type){
  if (!el) return;
  const prop = `__fp_on_${key}`;
  if (el[prop]) return;
  el.addEventListener(type, handler);
  el[prop] = true;
}
/** =========================
 *  1) CONFIG FIREBASE
 *  ========================= */

const fnCreateUserInTenant = httpsCallable(functions, "createUserInTenant");
const fnCreateCompanyWithAdmin = httpsCallable(functions, "createCompanyWithAdmin") /* (mantido, mas usamos HTTP no createCompany) */;

async function createUserWithAuthAndResetLink(payload){
  // Criação de usuário SEM duplicar Auth e SEM quebrar quando o Firestore negar
  // Fluxo oficial: Cloud Function (Admin SDK) => retorna { uid, resetLink, number }
  const user = auth.currentUser || await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u || null); });
  });

  if (!user) throw new Error("Não autenticado.");

  // força refresh do token antes de chamar callable (reduz erro de unauthenticated)
  try { await user.getIdToken(true); } catch (_) {}

  const safePayload = {
    companyId: (payload?.companyId || state?.companyId || "").trim(),
    name: (payload?.name || "").trim(),
    email: (payload?.email || "").trim().toLowerCase(),
    phone: (payload?.phone || "").trim(),
    role: payload?.role || "tecnico",
    teamIds: Array.isArray(payload?.teamIds) ? payload.teamIds : [],
    tempAvatarPath: (payload?.tempAvatarPath || "").trim(),
    // Campos extras do técnico (persistidos pela Cloud Function)
    softSkills: Array.isArray(payload?.softSkills) ? payload.softSkills : [],
    hardSkills: Array.isArray(payload?.hardSkills) ? payload.hardSkills : [],
    hourlyRate: (payload?.hourlyRate ?? null),
  };

  // ✅ Preferir HTTP direto para perfis da empresa (evita ruído 401 do callable em alguns ambientes)
  // Mantemos callable como opção principalmente para SuperAdmin.
  const preferHttpDirect = (
    !state?.isSuperAdmin &&
    ["admin", "gestor", "coordenador"].includes((state?.profile?.role || "").toString())
  );

  if (preferHttpDirect) {
    try { await user.getIdToken(true); } catch (_) {}
    return await callHttpFunctionWithAuth("createUserInTenantHttp", safePayload);
  }

  // 1) Tenta callable (mais simples)
  try{
    const r = await fnCreateUserInTenant(safePayload);
    return r?.data || r;
  }catch(err){
    const code = (err?.code || "").toString();
    const msg = (err?.message || "").toString();

    // ✅ Fallback robusto:
    // - Alguns browsers/devtools mostram 401 direto no endpoint do callable
    // - O SDK pode retornar functions/internal ou functions/unknown
    // Nesses casos, tentamos a versão HTTP com Bearer token.
    const looksLikeAuthTransportIssue = (
      code === "functions/unauthenticated" ||
      code === "functions/internal" ||
      code === "functions/unknown" ||
      /\b401\b/.test(msg) ||
      msg.toLowerCase().includes("unauth") ||
      msg.toLowerCase().includes("não autentic")
    );

    if (looksLikeAuthTransportIssue) {
      console.warn("[createUserWithAuthAndResetLink] callable falhou, tentando HTTP fallback...", { code, msg });
      const httpRes = await callHttpFunctionWithAuth("createUserInTenantHttp", safePayload);
      return httpRes;
    }

    throw err;
  }
}


/** =========================
 *  2) ESTADO
 *  ========================= */
const state = {
  companyId: null,
  company: null,
  profile: null,
  isSuperAdmin: false,
  teams: [],          // cache de equipes
  selectedTeamIds: [], // usado no modal usuário
  mgrSelectedTeamIds: [],
  managedTeamsTargetUid: null,
  managedTeamsSelected: [],
  _usersCache: [],
  _notificationsCache: []
};

let _notificationsUnsub = null;
let _dashboardRemindersUnsub = null;
let _dashboardAgendaCursor = new Date();
_dashboardAgendaCursor.setDate(1);
let _dashboardReminders = [];
let _dashboardReminderUsers = [];
let _activeReminderDetailId = "";
let _adminOnboardingLoading = false;
let _adminOnboardingLastDoneCount = null;
let _adminOnboardingRefreshTimer = null;
let _guideHighlightTimer = null;
let _authReadyForRoutes = false;
let _routeUnsubscribe = null;

// Guard: evita salvar projeto duas vezes (double click / duplo binding)
let _isCreatingProject = false;


/** =========================
 *  3) ELEMENTOS UI (importados de refs.js)
 *  ========================= */
// Todas as referências DOM foram movidas para ./src/ui/refs.js
// Acesse via refs.nomeDoElemento (ex: refs.viewLogin, refs.btnAvatar)

let currentCompanyDetailId = null;

const DEFAULT_BRAND = {
  name: "FlowProject",
  logoURL: "logof.png"
};

const REPORT_PERMISSION_ROLES = [
  { key: "admin", label: "Admin" },
  { key: "gestor", label: "Gestor" },
  { key: "coordenador", label: "Coordenador" },
  { key: "tecnico", label: "Tecnico" }
];

const REPORT_PERMISSION_ITEMS = [
  { key: "overview", label: "Painel consolidado de projetos" },
  { key: "metrics", label: "Saude operacional do periodo" },
  { key: "statuses", label: "Projetos por status" },
  { key: "execution", label: "Horas previstas x executadas" },
  { key: "clients", label: "Clientes com maior volume executado" },
  { key: "schedule", label: "Cronograma de projeto por periodo" },
  { key: "activityTech", label: "Relatorio de Atividade x Tecnico", note: "Tecnico ve apenas os proprios dados." },
  { key: "expenseReport", label: "Relatorio de Despesas", note: "Tecnico ve apenas as proprias despesas." }
];

function getDefaultReportPermissions(){
  return Object.fromEntries(
    REPORT_PERMISSION_ROLES.map((role) => [
      role.key,
      Object.fromEntries(REPORT_PERMISSION_ITEMS.map((item) => [item.key, true]))
    ])
  );
}

function normalizeReportPermissions(value){
  const defaults = getDefaultReportPermissions();
  const source = value && typeof value === "object" ? value : {};
  for (const role of REPORT_PERMISSION_ROLES) {
    const roleSource = source[role.key] && typeof source[role.key] === "object" ? source[role.key] : {};
    for (const item of REPORT_PERMISSION_ITEMS) {
      defaults[role.key][item.key] = roleSource[item.key] !== false;
    }
  }
  return defaults;
}

const PROJECT_TECH_PERMISSION_ITEMS = [
  { key: "showProjectCardHours", label: "Horas no card do projeto", note: "Exibe horas do projeto no Kanban." },
  { key: "showProjectCardValue", label: "Valor no card do projeto", note: "Exibe valor do projeto no Kanban." },
  { key: "showCoverHoursInfo", label: "Informacoes de horas na capa", note: "Horas planejadas, executadas, consumo e saldos." },
  { key: "showInternalExpenses", label: "Despesas internas", note: "Valores internos aprovados na capa do projeto." },
  { key: "showEstimatedTechCost", label: "Custo tecnico estimado", note: "Estimativa baseada em horas e valor/hora do tecnico." },
  { key: "showProjectBillingHours", label: "Horas do projeto", note: "Horas contratadas/orcadas do projeto." },
  { key: "showProjectBillingValue", label: "Valor do projeto", note: "Valor comercial do projeto." },
  { key: "showProjectCost", label: "Custo do projeto", note: "Custo tecnico somado a despesas internas." },
  { key: "showClientHourlyRate", label: "Valor hora cliente", note: "Valor medio por hora cobrada do cliente." },
  { key: "showEstimatedMargin", label: "Margem estimada", note: "Margem calculada a partir de valor, custos e despesas." },
  { key: "showExpensesSummary", label: "Resumo de despesas", note: "Totais e pendencias de despesas do projeto." },
  { key: "allowStatusReport", label: "Extrair status report", note: "Libera o botao Status Report na capa do projeto." },
  { key: "allowProjectWorkspaceActivityPointing", label: "Apontar atividade pelo projeto", note: "Libera o icone de editar no workspace do projeto para abrir o modal Apontar atividade." }
];

function getDefaultProjectTechPermissions(){
  return Object.fromEntries(PROJECT_TECH_PERMISSION_ITEMS.map((item) => [item.key, false]));
}

function normalizeProjectTechPermissions(value){
  const defaults = getDefaultProjectTechPermissions();
  const source = value && typeof value === "object" ? value : {};
  for (const item of PROJECT_TECH_PERMISSION_ITEMS) {
    defaults[item.key] = source[item.key] === true;
  }
  return defaults;
}

function normalizeActivityNoteMinChars(value){
  const num = Number(value);
  if (!Number.isFinite(num)) return 50;
  return Math.max(0, Math.min(1000, Math.round(num)));
}

function normalizeExpenseObservationMinChars(value){
  const num = Number(value);
  if (!Number.isFinite(num)) return 10;
  return Math.max(0, Math.min(1000, Math.round(num)));
}

function getCompanyBrand(company = state.company){
  const name = (company?.displayName || company?.name || DEFAULT_BRAND.name).toString().trim() || DEFAULT_BRAND.name;
  const logoURL = (company?.logoURL || "").toString().trim();
  return { name, logoURL: logoURL || DEFAULT_BRAND.logoURL, customLogo: Boolean(logoURL) };
}

function renderSidebarBrand(company = state.company){
  const brand = getCompanyBrand(company);
  const canEditBrand = isCompanyAdmin();
  if (refs.sidebarBrandLogo){
    refs.sidebarBrandLogo.src = brand.logoURL;
    refs.sidebarBrandLogo.alt = brand.name;
    refs.sidebarBrandLogo.classList.toggle("is-company-logo", brand.customLogo);
  }
  if (refs.sidebarBrandTitle) refs.sidebarBrandTitle.textContent = brand.name;
  if (refs.sidebarBrand){
    refs.sidebarBrand.classList.toggle("can-edit", canEditBrand);
    refs.sidebarBrand.title = canEditBrand ? "Alterar marca da empresa" : brand.name;
    refs.sidebarBrand.setAttribute("aria-label", canEditBrand ? "Alterar marca da empresa" : brand.name);
  }
}

async function loadCurrentCompanyBrand(){
  if (!state.companyId || state.isSuperAdmin){
    state.company = null;
    renderSidebarBrand(null);
    return null;
  }
  try{
    state.company = await getCompanyDoc(state.companyId);
  }catch(err){
    console.warn("[company-brand] nao foi possivel carregar marca da empresa", err);
    state.company = null;
  }
  renderSidebarBrand(state.company);
  return state.company;
}

/** =========================
 *  4) HELPERS
 *  ========================= */

async function ensureCompanyContext(){
  if (state.companyId) return state.companyId;

  const cached =
    localStorage.getItem("currentCompanyId") ||
    localStorage.getItem("companyId");

  if (cached) {
    state.companyId = cached;
    return cached;
  }

  const uid = auth?.currentUser?.uid;
  if (!uid) throw new Error("Não autenticado.");

  const companyId = await fetchCompanyIdForUser(uid);
  if (!companyId) throw new Error("companyId não encontrado para o usuário.");

  state.companyId = companyId;
  localStorage.setItem("currentCompanyId", companyId);
  return companyId;
}


function setAlertWithResetLink(alertEl, msg, email, resetLink){
  if (!alertEl) return;
  alertEl.hidden = false;
  alertEl.className = "alert success";
  // link é grande: deixamos clicável + botão copiar
  alertEl.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <div>${msg}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <a href="${resetLink}" target="_blank" rel="noopener">Abrir link de definição de senha</a>
        <button class="btn sm" id="btnCopyResetLink">Copiar link</button>
      </div>
      <div class="muted" style="font-size:12px;">Envie este link para <b>${email}</b>. Ele serve para definir a senha no primeiro acesso.</div>
    </div>
  `;
  const btn = alertEl.querySelector("#btnCopyResetLink");
  btn?.addEventListener("click", async () => {
    try{
      await navigator.clipboard.writeText(resetLink);
      btn.textContent = "Copiado!";
      setTimeout(()=> btn.textContent="Copiar link", 1200);
    }catch(e){
      alert("Não consegui copiar automaticamente. Copie manualmente pelo navegador.");
    }
  });
}

async function callAdminHttp(functionName, payload){
  const user = auth.currentUser;
  if (!user) throw new Error("Você precisa estar logado.");
  const idToken = await user.getIdToken(true);
  const projectId = auth?.app?.options?.projectId;
  if (!projectId) throw new Error("Firebase projectId não encontrado. Verifique ./src/config/firebase.js");
  const url = `https://us-central1-${projectId}.cloudfunctions.net/${functionName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify(payload || {})
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok){
    throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
  }
  return json;
}

// Chamada HTTP (onRequest) com token do Firebase Auth (fallback quando a Function não é callable)
async function callHttpFunctionWithAuth(functionName, payload){
  // Espera o auth estabilizar (evita clicar antes de carregar a sessão)
  const user = auth.currentUser || await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u || null); });
  });

  if (!user) throw new Error("Não autenticado.");

  // Força refresh do token (reduz 401 por token velho)
  const idToken = await user.getIdToken(true);

  const projectId = auth?.app?.options?.projectId;
  if (!projectId) throw new Error("Firebase projectId não encontrado. Verifique ./src/config/firebase.js");
  const url = `https://us-central1-${projectId}.cloudfunctions.net/${functionName}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify(payload || {})
  });

  // Tenta ler JSON; se vier vazio, cria objeto vazio
  const json = await res.json().catch(() => ({}));

  if (!res.ok){
    const msg = json?.error?.message || json?.message || json?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return json;
}

function setActiveNav(activeId){
  const items = [refs.navHome, refs.navAddTech, refs.navClients, refs.navReports, refs.navFeedbacks, refs.navExpenses, refs.navConfig].filter(Boolean);
  for (const el of items){
    if (el.hidden) {
      el.classList.remove("active");
      continue;
    }
    const isActive = el.id === activeId;
    el.classList.toggle("active", isActive);
  }
}

function syncSidebarForRole(){
  const isSuperAdmin = !!state.isSuperAdmin;
  const currentRole = String(state.profile?.role || "").toLowerCase();
  const hideTechMenu = isSuperAdmin || currentRole === "tecnico";
  const hideClientsMenu = isSuperAdmin || currentRole === "tecnico";
  const hideFeedbacksMenu = isSuperAdmin;
  const hideExpensesMenu = isSuperAdmin || !["admin", "gestor", "coordenador"].includes(currentRole);
  const sidebarSep = document.querySelector(".sidebar-nav .sidebar-sep");

  document.body.classList.toggle("is-superadmin", isSuperAdmin);
  if (refs.navAddTech) refs.navAddTech.hidden = hideTechMenu;
  if (refs.navClients) refs.navClients.hidden = hideClientsMenu;
  if (refs.navFeedbacks) refs.navFeedbacks.hidden = hideFeedbacksMenu;
  if (refs.navExpenses) refs.navExpenses.hidden = hideExpensesMenu;
  if (refs.navAddTech) refs.navAddTech.style.display = hideTechMenu ? "none" : "";
  if (refs.navClients) refs.navClients.style.display = hideClientsMenu ? "none" : "";
  if (refs.navFeedbacks) refs.navFeedbacks.style.display = hideFeedbacksMenu ? "none" : "";
  if (refs.navExpenses) refs.navExpenses.style.display = hideExpensesMenu ? "none" : "";
  if (sidebarSep) sidebarSep.hidden = false;

  if (isSuperAdmin) {
    setActiveNav("navHome");
  }
}

function canOpenExpensesMenu(){
  const currentRole = String(state.profile?.role || "").toLowerCase();
  return !state.isSuperAdmin && ["admin", "gestor", "coordenador"].includes(currentRole);
}

function setBrowserRouteSilently(route){
  const next = normalizeRoute(route);
  if (getRoutePath() !== next) window.history.replaceState({}, "", next);
}

function normalizeRoleKeyValue(role){
  const normalized = String(role || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (normalized === "recurso" || normalized === "tecnico") return "tecnico";
  return normalized;
}

function currentRoleKey(){
  return normalizeRoleKeyValue(state.profile?.role);
}

function canAccessRoute(route){
  const currentRole = currentRoleKey();
  if (route === ROUTES.login || route === ROUTES.dashboard || route === ROUTES.settings) return true;
  if (route === ROUTES.companies) return !!state.isSuperAdmin;
  if (state.isSuperAdmin) return route === ROUTES.companies || route === ROUTES.dashboard || route === ROUTES.settings;
  if (route === ROUTES.admin) return currentRole === "admin";
  if (route === ROUTES.managerUsers || route === ROUTES.clients) return ["admin", "gestor"].includes(currentRole);
  if (route === ROUTES.expenses || route === ROUTES.osApprovals) return ["admin", "gestor", "coordenador"].includes(currentRole);
  if (route === ROUTES.reports || route === ROUTES.feedbacks || route === ROUTES.projects || route === ROUTES.myProjects || route === ROUTES.myActivities) {
    return !!state.profile;
  }
  return false;
}

async function openRouteView(route){
  switch (route) {
    case ROUTES.login:
      setView("login");
      return;
    case ROUTES.dashboard:
      setActiveNav("navHome");
      setView("dashboard");
      refreshDashboardHomeWidgets();
      return;
    case ROUTES.admin:
      setActiveNav("navConfig");
      openAdminView();
      return;
    case ROUTES.companies:
      setActiveNav("navConfig");
      openCompaniesView();
      return;
    case ROUTES.managerUsers:
      setActiveNav("navAddTech");
      openManagerUsersView();
      return;
    case ROUTES.clients:
      setActiveNav("navClients");
      openClientsView();
      return;
    case ROUTES.reports:
      setActiveNav("navReports");
      await openReportsView();
      return;
    case ROUTES.expenses:
      setActiveNav("navExpenses");
      await openExpenseApprovalsView();
      return;
    case ROUTES.feedbacks:
      setActiveNav("navFeedbacks");
      await openMyFeedbacksView();
      return;
    case ROUTES.projects:
      setActiveNav("");
      openProjectsView();
      return;
    case ROUTES.myProjects:
      setActiveNav("");
      await openMyProjectsView({ onlyMine: true });
      return;
    case ROUTES.myActivities:
      setActiveNav("");
      await openMyActivitiesView();
      return;
    case ROUTES.osApprovals:
      setActiveNav("");
      await openOsApprovalsView();
      return;
    case ROUTES.settings:
      setActiveNav("navConfig");
      openSettingsView();
      return;
    default:
      setActiveNav("navHome");
      setView("dashboard");
      refreshDashboardHomeWidgets();
  }
}

async function resolveCleanRoute(route){
  const requested = normalizeRoute(route);
  if (!_authReadyForRoutes) {
    state._pendingRoute = requested;
    return;
  }

  let target = isKnownRoute(requested) ? requested : ROUTES.dashboard;
  if (target !== requested) setBrowserRouteSilently(target);
  if (normalizeRoute(window.location.pathname) === target && window.location.pathname !== target) {
    setBrowserRouteSilently(target);
  }

  if (!auth.currentUser) {
    if (target !== ROUTES.login) state._intendedRoute = target;
    setBrowserRouteSilently(ROUTES.login);
    setView("login");
    return;
  }

  if (target === ROUTES.login) {
    target = state._intendedRoute || ROUTES.dashboard;
    state._intendedRoute = "";
    setBrowserRouteSilently(target);
  }

  if (!canAccessRoute(target)) {
    target = ROUTES.dashboard;
    setBrowserRouteSilently(target);
  }

  await openRouteView(target);
}

function resolveRouteAfterAuth(){
  const intended = auth.currentUser ? state._intendedRoute : "";
  const route = intended || state._pendingRoute || getRoutePath();
  if (intended) state._intendedRoute = "";
  state._pendingRoute = "";
  resolveCleanRoute(route).catch((err) => {
    console.error("[router] erro ao resolver rota:", err);
    setBrowserRouteSilently(ROUTES.dashboard);
    setView("dashboard");
  });
}

function roleLabel(){
  if (state.isSuperAdmin) return "Superadmin";
  const role = String(state.profile?.role || "").toLowerCase();
  const labels = {
    admin: "Admin",
    gestor: "Gestor",
    coordenador: "Coordenador",
    tecnico: "Tecnico"
  };
  return labels[role] || "Usuario";
}

function settingsCard({ scope, title, desc, action, actionLabel = "Abrir" }){
  return `
    <article class="settings-card">
      <span class="badge">${escapeHtml(scope)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(desc)}</p>
      <button class="btn sm" type="button" data-settings-action="${escapeHtml(action)}">${escapeHtml(actionLabel)}</button>
    </article>
  `;
}

function renderSettingsView(){
  if (!refs.settingsGrid) return;
  const role = String(state.profile?.role || "").toLowerCase();
  const isAdmin = role === "admin";
  const isManager = role === "gestor";
  const isCoordinator = role === "coordenador";
  const isTech = role === "tecnico";
  const isSuperAdmin = !!state.isSuperAdmin;
  const cards = [];

  if (refs.settingsRoleLabel) refs.settingsRoleLabel.textContent = roleLabel();

  cards.push(`
    <div class="settings-section">
      <h2>Minha conta</h2>
      <p>Dados pessoais, foto e telefone usados no FlowProject.</p>
    </div>
  `);
  cards.push(settingsCard({
    scope: "Conta",
    title: "Perfil",
    desc: "Atualize seu nome, telefone e foto de usuario.",
    action: "profile",
    actionLabel: "Editar perfil"
  }));
  if (!isSuperAdmin){
    cards.push(settingsCard({
      scope: "LGPD",
      title: isAdmin ? "Privacidade e LGPD" : "Meus direitos LGPD",
      desc: isAdmin
        ? "Gerencie termos, aceites e solicitacoes LGPD da empresa."
        : "Consulte o aceite vigente e registre solicitacoes sobre seus dados.",
      action: "lgpd",
      actionLabel: isAdmin ? "Abrir central" : "Abrir"
    }));
  }

  if (isAdmin){
    cards.push(`
      <div class="settings-section">
        <h2>Empresa</h2>
        <p>Identidade visual, equipe e preferencias gerais da empresa.</p>
      </div>
    `);
    cards.push(settingsCard({
      scope: "Empresa",
      title: "Marca da empresa",
      desc: "Altere o nome e o logo exibidos no menu lateral e nos relatorios.",
      action: "brand",
      actionLabel: "Editar marca"
    }));
    cards.push(settingsCard({
      scope: "Relatorios",
      title: "Permissoes de relatorios",
      desc: "Defina quais relatorios cada perfil da empresa pode visualizar.",
      action: "reportPermissions",
      actionLabel: "Configurar"
    }));
    cards.push(settingsCard({
      scope: "Apontamentos",
      title: "Regras de apontamento",
      desc: "Defina quantos caracteres a observacao tecnica precisa ter para salvar um apontamento.",
      action: "activityNoteSettings",
      actionLabel: "Configurar"
    }));
    cards.push(settingsCard({
      scope: "Despesas",
      title: "Regras de despesas",
      desc: "Defina quantos caracteres a observacao da despesa precisa ter para ser salva.",
      action: "expenseObservationSettings",
      actionLabel: "Configurar"
    }));
  }

  if (isAdmin || isManager || isCoordinator){
    cards.push(`
      <div class="settings-section">
        <h2>Operacao</h2>
        <p>Acesso rapido aos fluxos de acompanhamento e relatorios.</p>
      </div>
    `);
    cards.push(settingsCard({
      scope: "Relatorios",
      title: "Relatorios e indicadores",
      desc: "Acesse os filtros e paineis de acompanhamento da operacao.",
      action: "reports",
      actionLabel: "Abrir relatorios"
    }));
    cards.push(settingsCard({
      scope: "OS",
      title: "OS para aprovar",
      desc: "Revise apontamentos enviados e acompanhe aprovacoes.",
      action: "osApprovals",
      actionLabel: "Abrir OS"
    }));
    cards.push(settingsCard({
      scope: "Projetos",
      title: "Permissoes do tecnico no projeto",
      desc: "Controle quais dados financeiros, horas e status report o tecnico pode ver no card e na capa do projeto.",
      action: "projectTechPermissions",
      actionLabel: "Configurar"
    }));
    cards.push(settingsCard({
      scope: "Despesas",
      title: "Despesas para aprovar",
      desc: "Centralize comprovantes, aprovacoes e impacto financeiro por projeto.",
      action: "expenses",
      actionLabel: "Abrir despesas"
    }));
  }

  if (isTech){
    cards.push(`
      <div class="settings-section">
        <h2>Trabalho</h2>
        <p>Preferencias basicas e atalhos para sua rotina.</p>
      </div>
    `);
    cards.push(settingsCard({
      scope: "Atividades",
      title: "Minhas atividades",
      desc: "Acesse suas atividades e apontamentos em aberto.",
      action: "myActivities",
      actionLabel: "Abrir atividades"
    }));
  }

  if (isSuperAdmin){
    cards.push(`
      <div class="settings-section">
        <h2>Plataforma</h2>
        <p>Atalhos administrativos do ambiente FlowProject.</p>
      </div>
    `);
    cards.push(settingsCard({
      scope: "Master",
      title: "Empresas",
      desc: "Gerencie empresas cadastradas, usuarios admin e status de acesso.",
      action: "companies",
      actionLabel: "Abrir empresas"
    }));
    cards.push(settingsCard({
      scope: "LGPD",
      title: "LGPD por empresa",
      desc: "Acompanhe aceites pendentes e solicitacoes LGPD das empresas cadastradas.",
      action: "lgpd",
      actionLabel: "Ver LGPD"
    }));
  }

  refs.settingsGrid.innerHTML = cards.join("");
  if (refs.settingsEmpty) refs.settingsEmpty.hidden = cards.length > 1;
}

function openSettingsView(){
  setView("settings");
  renderSettingsView();
}

function initSidebar(){
  if (!refs.sidebar) return;

  // estado persistido (padrão: recolhido)
  const saved = localStorage.getItem("fp.refs.sidebar.expanded");
  if (saved === "1") refs.sidebar.classList.add("expanded");

  const toggle = () => {
    refs.sidebar.classList.toggle("expanded");
    localStorage.setItem("fp.refs.sidebar.expanded", refs.sidebar.classList.contains("expanded") ? "1" : "0");
  };

  // Expande ao passar o mouse (hover)
  refs.sidebar.addEventListener("mouseenter", () => {
    refs.sidebar.classList.add("expanded");
  });

  // Recolhe ao sair o mouse (se não foi fixado)
  refs.sidebar.addEventListener("mouseleave", () => {
    const saved = localStorage.getItem("fp.refs.sidebar.expanded");
    if (saved !== "1") {
      refs.sidebar.classList.remove("expanded");
    }
  });

  // Clique na sidebar fixa/desfixa (toggle permanente)
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
    setActiveNav("navHome");
    setView("dashboard");
    refreshDashboardHomeWidgets();
  });
  refs.navReports?.addEventListener("click", () => {
    setActiveNav("navReports");
    openReportsView();
  });
  refs.navFeedbacks?.addEventListener("click", () => {
    setActiveNav("navFeedbacks");
    openMyFeedbacksView();
  });
  refs.navExpenses?.addEventListener("click", () => {
    if (!canOpenExpensesMenu()) return;
    setActiveNav("navExpenses");
    openExpenseApprovalsView();
  });
  refs.navAddTech?.addEventListener("click", () => {
    setActiveNav("navAddTech");
    // para gestor, já existe tela de técnicos
    if (["gestor", "admin"].includes(state.profile?.role)) openManagerUsersView();
    else alert("Acesso restrito.");
  });

  refs.navClients?.addEventListener("click", () => {
    setActiveNav("navClients");
    // mesmos perfis que podem criar tecnicos podem criar clientes
    if (["gestor", "admin"].includes(state.profile?.role)) openClientsView();
    else alert("Acesso restrito.");
  });

  refs.navConfig?.addEventListener("click", () => {
    setActiveNav("navConfig");
    openSettingsView();
  });

  refs.sidebarBrand?.addEventListener("click", () => {
    openCompanyBrandModal();
  });
  refs.sidebarBrand?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openCompanyBrandModal();
  });
  syncSidebarForRole();
}

/** =========================
 *  6) DASHBOARD
 *  ========================= */
function renderTopbar(profile, user){
  // Topbar minimal: apenas avatar no canto direito
  show(refs.notificationsMenu);
  show(refs.btnNotifications);
  show(refs.userMenu);
  show(refs.btnAvatar);
  [refs.notificationsMenu, refs.btnNotifications, refs.userMenu, refs.btnAvatar].forEach((el) => {
    if (!el) return;
    el.style.pointerEvents = "auto";
    if ("disabled" in el) el.disabled = false;
  });

  // Avatar: tenta foto (perfil -> auth), senão usa iniciais
  const photoUrl = profile?.photoURL || user?.photoURL || "";

  // OBS: no CSS o .avatar-img começa com display:none; aqui controlamos via display
  if (photoUrl && refs.userAvatarImg){
    // Cache-bust leve (evita manter imagem antiga após trocar foto)
    const bust = photoUrl.includes("?") ? "&t=" : "?t=";
    refs.userAvatarImg.src = photoUrl + bust + Date.now();

    refs.userAvatarImg.hidden = false;
    refs.userAvatarImg.style.display = "block";

    if (refs.userAvatarFallback){
      refs.userAvatarFallback.hidden = true;
      refs.userAvatarFallback.style.display = "none";
    }
  }else{
    if (refs.userAvatarImg){
      refs.userAvatarImg.hidden = true;
      refs.userAvatarImg.style.display = "none";
      refs.userAvatarImg.removeAttribute("src");
    }

    const label = (profile?.name || user?.displayName || user?.email || "Usuário").trim();
    const initials = label.split(/\s+/).slice(0,2).map(p => (p[0] || "").toUpperCase()).join("") || "U";
    if (refs.userAvatarFallback){
      refs.userAvatarFallback.textContent = initials;
      refs.userAvatarFallback.hidden = false;
      refs.userAvatarFallback.style.display = "grid";
    }
  }
}

/** =========================
 *  TOPBAR: MENU DO USUÁRIO
 *  ========================= */
function initUserMenu(){
  // Estrutura vem do index.html (refs.userMenu/avatarBtn/refs.avatarDropdown)
  if (!refs.btnAvatar || !refs.avatarDropdown) return;

  const closeDropdown = () => {
    refs.avatarDropdown.classList.remove("open");
    refs.btnAvatar.setAttribute("aria-expanded", "false");
  };

  const toggleDropdown = () => {
    const isOpen = refs.avatarDropdown.classList.contains("open");
    if (isOpen) closeDropdown();
    else {
      refs.avatarDropdown.classList.add("open");
      refs.btnAvatar.setAttribute("aria-expanded", "true");
    }
  };

  // Toggle ao clicar no avatar
  refs.btnAvatar.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDropdown();
  });

  // Fecha ao clicar fora
  document.addEventListener("click", (e) => {
    if (!refs.avatarDropdown.classList.contains("open")) return;
    const target = e.target;
    if (refs.userMenu && refs.userMenu.contains(target)) return;
    closeDropdown();
  });

  // Fecha no ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDropdown();
  });

  // Ações do menu
  refs.btnEditProfile?.addEventListener("click", (e) => {
    e.preventDefault();
    closeDropdown();
    openProfileModal();
  });

  refs.btnBillingPortal?.addEventListener("click", (e) => {
    e.preventDefault();
    closeDropdown();
    openCustomerPortal();
  });

  refs.btnUserLogout?.addEventListener("click", async (e) => {
    e.preventDefault();
    closeDropdown();
    await signOut(auth);
  });
}

/** =========================
 *  TOPBAR: NOTIFICACOES
 *  ========================= */
function stopNotificationsListener(){
  if (typeof _notificationsUnsub === "function") {
    _notificationsUnsub();
    _notificationsUnsub = null;
  }
  state._notificationsCache = [];
  renderNotifications([]);
}

function stopDashboardRemindersListener(){
  if (typeof _dashboardRemindersUnsub === "function") {
    _dashboardRemindersUnsub();
    _dashboardRemindersUnsub = null;
  }
  _dashboardReminders = [];
  if (refs.dashboardRemindersList && refs.dashboardRemindersEmpty) {
    renderDashboardReminders([]);
  }
}

function formatNotificationTime(value){
  const date = value?.toDate ? value.toDate() : (value instanceof Date ? value : null);
  if (!date) return "";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function monthKeyLocal(date = new Date()){
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthNamePtBr(date){
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function parseBirthDateParts(value){
  const raw = String(value || "").slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

function getMonthBirthdays(users, date = new Date(), today = new Date()){
  const month = date.getMonth() + 1;
  const isCurrentMonth = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
  return (Array.isArray(users) ? users : [])
    .map((user) => {
      const birth = parseBirthDateParts(user.birthDate);
      if (!birth || birth.month !== month) return null;
      const name = String(user.name || user.displayName || user.email || "Usuario").trim();
      return {
        uid: user.uid || user.id || "",
        name,
        role: String(user.role || "").trim(),
        day: birth.day,
        isToday: isCurrentMonth && birth.day === today.getDate()
      };
    })
    .filter((item) => item && item.name)
    .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
}

function formatBirthdaySummary(items){
  const names = items.slice(0, 3).map((item) => item.name).join(", ");
  const remaining = Math.max(0, items.length - 3);
  return remaining
    ? `${items.length} aniversariantes neste mes: ${names} e mais ${remaining}.`
    : `${items.length} aniversariante(s) neste mes: ${names}.`;
}

async function showMonthlyBirthdaysDialog(notification = {}){
  if (!state.companyId) return;
  const key = String(notification.entityId || monthKeyLocal()).trim();
  const match = key.match(/^(\d{4})-(\d{2})$/);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, 1)
    : new Date();

  try {
    const usersSnap = await getDocs(collection(db, "companies", state.companyId, "users"));
    const users = usersSnap.docs
      .map((docSnap) => ({ uid: docSnap.id, id: docSnap.id, ...docSnap.data() }))
      .filter((user) => user.active !== false);
    const birthdays = getMonthBirthdays(users, date);
    const message = birthdays.length
      ? birthdays
          .map((item) => {
            const day = String(item.day).padStart(2, "0");
            const role = item.role ? ` (${humanizeRole(item.role)})` : "";
            const today = item.isToday ? " - hoje" : "";
            return `${day}/${String(date.getMonth() + 1).padStart(2, "0")}: ${item.name}${role}${today}`;
          })
          .join("; ")
      : "Nenhum aniversariante encontrado para este mes.";

    await showDialogAlert(message, {
      title: `Aniversariantes de ${monthNamePtBr(date)}`,
      type: "info",
      confirmLabel: "Fechar"
    });
  } catch (err) {
    console.warn("[notifications:birthdays-dialog]", err);
    await showDialogAlert("Nao foi possivel carregar os aniversariantes agora.", {
      title: "Aniversariantes",
      type: "error"
    });
  }
}

function renderNotifications(items = state._notificationsCache || []){
  if (!refs.notificationCount || !refs.notificationsList) return;

  const unreadCount = items.filter((item) => item.read !== true).length;
  refs.notificationCount.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
  refs.notificationCount.hidden = unreadCount <= 0;

  if (!items.length) {
    refs.notificationsList.innerHTML = '<div class="notifications-empty">Nenhuma notificacao por enquanto.</div>';
    return;
  }

  refs.notificationsList.innerHTML = items.slice(0, 20).map((item) => `
    <button class="notification-item ${item.read === true ? "" : "unread"}" type="button" data-notification-id="${escapeHtml(item.id)}">
      <strong>${escapeHtml(item.title || "Notificacao")}</strong>
      <span>${escapeHtml(item.message || "")}</span>
      <small>${escapeHtml(formatNotificationTime(item.createdAt))}</small>
    </button>
  `).join("");
}

async function markNotificationRead(notificationId){
  if (!state.companyId || !notificationId) return;
  await updateDoc(doc(db, "companies", state.companyId, "notifications", notificationId), {
    read: true,
    readAt: serverTimestamp()
  });
}

async function markVisibleNotificationsRead(){
  if (!state.companyId) return;
  const unread = (state._notificationsCache || []).filter((item) => item.read !== true);
  if (!unread.length) return;
  const batch = writeBatch(db);
  unread.forEach((item) => {
    batch.update(doc(db, "companies", state.companyId, "notifications", item.id), {
      read: true,
      readAt: serverTimestamp()
    });
  });
  await batch.commit();
}

function openNotificationTarget(notification){
  const type = String(notification?.type || "");
  refs.notificationsPanel?.classList.remove("open");
  refs.btnNotifications?.setAttribute("aria-expanded", "false");

  if (type === "monthly_birthdays") {
    showMonthlyBirthdaysDialog(notification);
    return;
  }
  if (type === "os_submitted") {
    navigateTo(ROUTES.osApprovals);
    return;
  }
  if (type === "os_approved" || type === "os_reverted" || type === "daily_today" || type === "daily_overdue") {
    navigateTo(ROUTES.myActivities);
    return;
  }
  if (type === "feedback_received") {
    navigateTo(ROUTES.feedbacks);
  }
}

function initNotificationsUi(){
  if (!refs.btnNotifications || refs.btnNotifications.__fp_notifications_bound) return;
  refs.btnNotifications.__fp_notifications_bound = true;

  refs.btnNotifications.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const isOpen = refs.notificationsPanel?.classList.contains("open");
    refs.notificationsPanel?.classList.toggle("open", !isOpen);
    refs.btnNotifications?.setAttribute("aria-expanded", !isOpen ? "true" : "false");
  });

  refs.notificationsList?.addEventListener("click", async (event) => {
    const itemBtn = event.target?.closest?.("[data-notification-id]");
    if (!itemBtn) return;
    const id = itemBtn.getAttribute("data-notification-id") || "";
    const notification = (state._notificationsCache || []).find((item) => item.id === id);
    try {
      if (notification?.read !== true) await markNotificationRead(id);
    } catch (err) {
      console.warn("[notifications:read]", err);
    }
    openNotificationTarget(notification);
  });

  refs.btnMarkAllNotificationsRead?.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      await markVisibleNotificationsRead();
    } catch (err) {
      console.warn("[notifications:mark-all]", err);
    }
  });

  document.addEventListener("click", (event) => {
    if (!refs.notificationsPanel?.classList.contains("open")) return;
    if (refs.notificationsMenu?.contains?.(event.target)) return;
    refs.notificationsPanel.classList.remove("open");
    refs.btnNotifications?.setAttribute("aria-expanded", "false");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    refs.notificationsPanel?.classList.remove("open");
    refs.btnNotifications?.setAttribute("aria-expanded", "false");
  });
}

function startNotificationsListener(){
  stopNotificationsListener();
  const uid = auth.currentUser?.uid || "";
  if (!state.companyId || !uid || state.isSuperAdmin) return;

  const q = query(
    collection(db, "companies", state.companyId, "notifications"),
    where("recipientUid", "==", uid)
  );

  _notificationsUnsub = onSnapshot(q, (snap) => {
    const items = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => {
        const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return bt - at;
      });
    state._notificationsCache = items;
    renderNotifications(items);
  }, (err) => {
    console.warn("[notifications:listen]", err);
    renderNotifications([]);
  });
}

function todayKeyLocal(){
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isActivityStatusCompleted(activity){
  const status = String(activity?.status || "").toLowerCase();
  return status === "os_gerada" || status === "os_aprovada";
}

async function createDailyTechnicalNotifications(){
  const uid = auth.currentUser?.uid || "";
  const role = String(state.profile?.role || "").toLowerCase();
  if (!state.companyId || !uid || role !== "tecnico") return;

  const today = todayKeyLocal();

  try {
    const [activitiesSnap, notificationsSnap] = await Promise.all([
      getDocs(query(
        collection(db, "companies", state.companyId, "activities"),
        where("techUids", "array-contains", uid)
      )),
      getDocs(query(
        collection(db, "companies", state.companyId, "notifications"),
        where("recipientUid", "==", uid)
      ))
    ]);

    const activities = activitiesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    const pending = activities.filter((activity) => !isActivityStatusCompleted(activity));
    const todayItems = pending.filter((activity) => String(activity.workDate || "").slice(0, 10) === today);
    const overdueItems = pending.filter((activity) => {
      const workDate = String(activity.workDate || "").slice(0, 10);
      return workDate && workDate < today;
    });

    const alreadyCreated = new Set(
      notificationsSnap.docs
        .map((docSnap) => docSnap.data() || {})
        .filter((item) => item.entityId === today)
        .map((item) => item.type)
    );

    if (todayItems.length && !alreadyCreated.has("daily_today")) {
      await createNotification(db, state.companyId, uid, {
        type: "daily_today",
        title: "Atividades de hoje",
        message: `Voce tem ${todayItems.length} atividade(s) planejada(s) para hoje.`,
        entityType: "activity-summary",
        entityId: today,
        createdBy: "system"
      });
    }

    if (overdueItems.length && !alreadyCreated.has("daily_overdue")) {
      await createNotification(db, state.companyId, uid, {
        type: "daily_overdue",
        title: "Atividades atrasadas",
        message: `Voce tem ${overdueItems.length} atividade(s) atrasada(s) aguardando apontamento.`,
        entityType: "activity-summary",
        entityId: today,
        createdBy: "system"
      });
    }
  } catch (err) {
    console.warn("[notifications:daily-tech]", err);
  }
}

async function createMonthlyBirthdayNotification(){
  const uid = auth.currentUser?.uid || "";
  if (!state.companyId || !uid || state.isSuperAdmin) return;

  const now = new Date();
  const monthKey = monthKeyLocal(now);

  try {
    const [usersSnap, notificationsSnap] = await Promise.all([
      getDocs(collection(db, "companies", state.companyId, "users")),
      getDocs(query(
        collection(db, "companies", state.companyId, "notifications"),
        where("recipientUid", "==", uid)
      ))
    ]);

    const users = usersSnap.docs
      .map((docSnap) => ({ uid: docSnap.id, id: docSnap.id, ...docSnap.data() }))
      .filter((user) => user.active !== false);
    const birthdays = getMonthBirthdays(users, now);
    if (!birthdays.length) return;

    const alreadyCreated = notificationsSnap.docs
      .map((docSnap) => docSnap.data() || {})
      .some((item) => item.type === "monthly_birthdays" && item.entityId === monthKey);
    if (alreadyCreated) return;

    await createNotification(db, state.companyId, uid, {
      type: "monthly_birthdays",
      title: "Aniversariantes do mes",
      message: formatBirthdaySummary(birthdays),
      entityType: "birthday-summary",
      entityId: monthKey,
      createdBy: "system"
    });
  } catch (err) {
    console.warn("[notifications:birthdays]", err);
  }
}

/** =========================
 *  PERFIL: MODAL (EDITAR PERFIL)
 *  ========================= */
function openProfileModal(){
  if (!refs.profileModal) return;
  clearAlert(refs.profileAlert);

  const user = auth.currentUser;
  const p = state.profile || {};

  // Preenche campos
  if (refs.profileName) refs.profileName.value = (p.name || user?.displayName || "").trim();
  if (refs.profilePhone) refs.profilePhone.value = (p.phone || "").trim();
  if (refs.profileEmail) refs.profileEmail.value = (user?.email || "").trim();

  const url = (p.photoURL || user?.photoURL || "").trim();
  if (refs.profilePhotoUrl) refs.profilePhotoUrl.value = url;
  renderProfilePhotoPreview(url);

  refs.profileModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeProfileModal(){
  if (!refs.profileModal) return;
  refs.profileModal.hidden = true;
  document.body.classList.remove("modal-open");
  if (refs.profilePhotoFile) refs.profilePhotoFile.value = "";
}

function renderProfilePhotoPreview(url){
  const user = auth.currentUser;
  const label = ((refs.profileName?.value || state.profile?.name || user?.displayName || user?.email || "Usuário").trim());
  const initials = label.split(/\s+/).slice(0,2).map(p => (p[0] || "").toUpperCase()).join("") || "U";

  const finalUrl = (url || "").trim();
  if (finalUrl){
    if (refs.profilePhotoImg){
      refs.profilePhotoImg.src = finalUrl;
      refs.profilePhotoImg.style.display = "block";
    }
    if (refs.profilePhotoFallback){
      refs.profilePhotoFallback.textContent = initials;
      refs.profilePhotoFallback.style.display = "none";
    }
  } else {
    if (refs.profilePhotoImg) refs.profilePhotoImg.style.display = "none";
    if (refs.profilePhotoFallback){
      refs.profilePhotoFallback.textContent = initials;
      refs.profilePhotoFallback.style.display = "block";
    }
  }
}

async function saveProfile(){
  clearAlert(refs.profileAlert);
  const user = auth.currentUser;
  if (!user) return;

  const name = (refs.profileName?.value || "").trim();
  const phone = (refs.profilePhone?.value || "").trim();
  const photoURL = (refs.profilePhotoUrl?.value || "").trim();

  if (!name){
    setAlert(refs.profileAlert, "Informe seu nome.");
    return;
  }

  setAlert(refs.profileAlert, "Salvando...", "info");

  try {
    if (state.isSuperAdmin){
      await updateDoc(doc(db, "platformUsers", user.uid), {
        name,
        phone,
        photoURL
      });
    } else {
      await updateDoc(doc(db, "companies", state.companyId, "users", user.uid), {
        name,
        phone,
        photoURL
      });
    }

    // Atualiza estado local e UI
    state.profile = { ...(state.profile || {}), name, phone, photoURL };
    renderTopbar(state.profile, user);
    scheduleAdminOnboardingRefresh(500);

    setAlert(refs.profileAlert, "Perfil atualizado!", "success");
    setTimeout(closeProfileModal, 400);
  } catch (err){
    console.error("saveProfile error", err);
    setAlert(refs.profileAlert, "Não foi possível salvar. Verifique permissões no Firestore rules.");
  }
}

// Listeners do modal (se existir na página)
refs.btnCloseProfile?.addEventListener("click", closeProfileModal);
refs.btnCancelProfile?.addEventListener("click", closeProfileModal);

refs.profileModal?.addEventListener("click", (e) => {
  const target = e.target;
  if (target && target.getAttribute && target.getAttribute("data-close") === "profile"){
    closeProfileModal();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && refs.profileModal && !refs.profileModal.hidden) closeProfileModal();
});

refs.btnSaveProfile?.addEventListener("click", saveProfile);

refs.profilePhotoUrl?.addEventListener("input", () => {
  renderProfilePhotoPreview(refs.profilePhotoUrl.value);
});

refs.btnProfileRemovePhoto?.addEventListener("click", () => {
  if (refs.profilePhotoUrl) refs.profilePhotoUrl.value = "";
  renderProfilePhotoPreview("");
});

refs.profilePhotoFile?.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  // Regras básicas (evita upload gigante)
  const maxMb = 2; // recomendado: 1–2MB
  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (!allowed.includes((file.type || "").toLowerCase())){
    setAlert(refs.profileAlert, "Formato inválido. Use PNG ou JPG.");
    e.target.value = "";
    return;
  }
  if (file.size > maxMb * 1024 * 1024){
    setAlert(refs.profileAlert, `A imagem é muito grande (máx. ${maxMb}MB).`);
    e.target.value = "";
    return;
  }

  // Upload para Firebase Storage e grava a URL no input
  try{
    setAlert(refs.profileAlert, "Enviando foto...", "info");
    const user = auth.currentUser;
    if (!user) throw new Error("not-auth");

    const path = `avatars/${user.uid}`;
    const ref = storageRef(storage, path);

    await uploadBytes(ref, file, { contentType: file.type || "image/jpeg" });
    const url = await getDownloadURL(ref);

    if (refs.profilePhotoUrl) refs.profilePhotoUrl.value = url;
    renderProfilePhotoPreview(url);
    clearAlert(refs.profileAlert);
  }catch(err){
    console.error("upload avatar error", err);
    setAlert(refs.profileAlert, "Não foi possível enviar a foto. Verifique as regras do Storage.");
  }finally{
    // permite reenviar o mesmo arquivo se quiser
    e.target.value = "";
  }
});

function refreshDashboardHomeWidgets(){
  loadDashboardAgenda().catch((err) => console.warn("[dashboard-agenda]", err));
  loadDashboardReminders().catch((err) => console.warn("[dashboard-reminders]", err));
  renderAdminOnboarding().catch((err) => console.warn("[admin-onboarding]", err));
}

function canShowAdminOnboarding(){
  if (!state.companyId || state.isSuperAdmin) return false;
  const role = currentRoleKey();
  return role === "admin" || role === "tecnico" || isIndividualManagerOnboarding();
}

function isIndividualManagerOnboarding(){
  const role = currentRoleKey();
  const accountType = String(state.company?.accountType || "").toLowerCase();
  return role === "gestor" && accountType === "individual";
}

function isTechOnboarding(){
  const role = currentRoleKey();
  return role === "tecnico";
}

function hasAdminCheckedCompanySettings(){
  const onboarding = state.profile?.onboarding && typeof state.profile.onboarding === "object"
    ? state.profile.onboarding
    : {};
  return Boolean(onboarding.companySettingsChecked);
}

async function getAdminOnboardingStats(){
  if (!state.companyId) return null;
  const base = ["companies", state.companyId];
  const currentUid = auth.currentUser?.uid || "";

  if (isTechOnboarding()) {
    let ownActivities = [];
    let receivedFeedbacks = 0;
    if (currentUid) {
      try {
        const activitiesQuery = query(collection(db, ...base, "activities"), where("techUids", "array-contains", currentUid));
        const activitiesSnap = await getDocs(activitiesQuery);
        ownActivities = activitiesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
      } catch (err) {
        console.warn("[onboarding:tech-activities]", err);
      }
      try {
        const feedbacksSnap = await getDocs(collection(db, ...base, "users", currentUid, "feedbacks"));
        receivedFeedbacks = feedbacksSnap.size;
      } catch (err) {
        console.warn("[onboarding:feedback-stats]", err);
      }
    }
    const ownSubmittedActivities = ownActivities.filter((activity) => {
      const status = String(activity.status || "").toLowerCase();
      return status === "os_gerada" || status === "os_aprovada";
    });
    return {
      teams: 0,
      resources: 0,
      clients: 0,
      projects: 0,
      tasks: 0,
      activities: ownActivities.length,
      ownActivities: ownActivities.length,
      ownSubmittedActivities: ownSubmittedActivities.length,
      receivedFeedbacks,
      settingsChecked: hasAdminCheckedCompanySettings()
    };
  }

  const [
    teamsSnap,
    usersSnap,
    clientsSnap,
    projectsSnap,
    tasksSnap,
    activitiesSnap
  ] = await Promise.all([
    getDocs(collection(db, ...base, "teams")),
    getDocs(collection(db, ...base, "users")),
    getDocs(collection(db, ...base, "clients")),
    getDocs(collection(db, ...base, "projects")),
    getDocs(collection(db, ...base, "tasks")),
    getDocs(collection(db, ...base, "activities"))
  ]);

  const users = usersSnap.docs.map((docSnap) => docSnap.data() || {});
  const activities = activitiesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
  const ownActivities = activities.filter((activity) => {
    const techUids = Array.isArray(activity.techUids) ? activity.techUids.filter(Boolean) : [];
    return currentUid && techUids.includes(currentUid);
  });
  const ownSubmittedActivities = ownActivities.filter((activity) => {
    const status = String(activity.status || "").toLowerCase();
    return status === "os_gerada" || status === "os_aprovada";
  });
  let receivedFeedbacks = 0;
  if (currentUid) {
    try {
      const feedbacksSnap = await getDocs(collection(db, ...base, "users", currentUid, "feedbacks"));
      receivedFeedbacks = feedbacksSnap.size;
    } catch (err) {
      console.warn("[onboarding:feedback-stats]", err);
    }
  }

  return {
    teams: teamsSnap.docs.filter((docSnap) => (docSnap.data() || {}).active !== false).length,
    resources: users.filter((user) => String(user.role || "").toLowerCase() === "tecnico" && user.active !== false).length,
    clients: clientsSnap.docs.filter((docSnap) => (docSnap.data() || {}).active !== false).length,
    projects: projectsSnap.docs.filter((docSnap) => (docSnap.data() || {}).active !== false).length,
    tasks: tasksSnap.size,
    activities: activitiesSnap.size,
    ownActivities: ownActivities.length,
    ownSubmittedActivities: ownSubmittedActivities.length,
    receivedFeedbacks,
    settingsChecked: hasAdminCheckedCompanySettings()
  };
}

function getAdminOnboardingSteps(stats){
  const isIndividualAccount = String(state.company?.accountType || "").toLowerCase() === "individual";
  if (isTechOnboarding()) {
    const onboarding = getProfileOnboarding();
    const profileComplete = Boolean(String(state.profile?.name || "").trim() && String(state.profile?.phone || "").trim());
    return [
      {
        key: "tech-profile",
        title: "Completar perfil",
        desc: "Confira nome, telefone e foto para deixar seu acesso identificado.",
        done: profileComplete,
        actionLabel: "Editar perfil",
        action: () => guideCompleteProfileAction()
      },
      {
        key: "tech-activities",
        title: "Abrir minhas atividades",
        desc: "Veja as atividades vinculadas ao seu usuario.",
        done: Boolean(onboarding.techActivitiesViewed),
        actionLabel: "Abrir atividades",
        action: () => guideOpenTechActivitiesAction()
      },
      {
        key: "tech-submit-os",
        title: "Enviar primeira OS",
        desc: "Aponte uma atividade e envie para aprovacao do gestor.",
        done: stats.ownSubmittedActivities > 0,
        actionLabel: "Apontar OS",
        action: () => guideSubmitTechActivityAction()
      },
      {
        key: "tech-feedbacks",
        title: "Consultar feedbacks",
        desc: "Acompanhe avaliacoes, reconhecimentos e pontos de evolucao.",
        done: Boolean(onboarding.techFeedbacksViewed),
        actionLabel: "Abrir feedbacks",
        action: () => guideOpenTechFeedbacksAction()
      }
    ];
  }

  if (isIndividualManagerOnboarding()) {
    return [
      {
        key: "resource",
        title: "Criar primeiro recurso",
        desc: "Cadastre quem vai receber atividades e apontar horas nos seus projetos.",
        done: stats.resources > 0,
        actionLabel: "Criar recurso",
        action: () => {
          navigateTo(ROUTES.managerUsers);
          setTimeout(() => {
            highlightGuideTarget(refs.btnOpenCreateTech);
            refs.btnOpenCreateTech?.click();
            setTimeout(() => {
              showOnboardingActionHint("resource");
              highlightGuideTarget(refs.modalCreateTech || refs.btnCreateTech);
            }, 250);
          }, 350);
        }
      },
      {
        key: "client",
        title: "Criar primeiro cliente",
        desc: "Inclua o cliente e os key users que participam das entregas.",
        done: stats.clients > 0,
        actionLabel: "Criar cliente",
        action: () => {
          navigateTo(ROUTES.clients);
          setTimeout(() => {
            highlightGuideTarget(refs.btnOpenCreateClient);
            refs.btnOpenCreateClient?.click();
            setTimeout(() => {
              showOnboardingActionHint("client");
              highlightGuideTarget(refs.modalCreateClient || refs.btnCreateClient);
            }, 250);
          }, 350);
        }
      },
      {
        key: "project",
        title: "Criar primeiro projeto",
        desc: "Abra o projeto que vai concentrar tarefas, recursos e acompanhamento.",
        done: stats.projects > 0,
        actionLabel: "Criar projeto",
        action: () => {
          navigateTo(ROUTES.myProjects);
          setTimeout(() => {
            highlightGuideTarget(refs.btnOpenCreateProjectFromKanban);
            refs.btnOpenCreateProjectFromKanban?.click();
            setTimeout(() => {
              showOnboardingActionHint("project");
              highlightGuideTarget(refs.modalCreateProject || refs.btnCreateProject);
            }, 250);
          }, 350);
        }
      },
      {
        key: "task",
        title: "Adicionar primeira tarefa",
        desc: "Entre no workspace do projeto e adicione a primeira tarefa.",
        done: stats.tasks > 0,
        actionLabel: "Abrir projetos",
        action: () => guideCreateTaskAction()
      },
      {
        key: "activity",
        title: "Programar primeira atividade",
        desc: "Dentro da tarefa, programe a atividade que sera executada pelo recurso.",
        done: stats.activities > 0,
        actionLabel: "Abrir projetos",
        action: () => guideCreateActivityAction()
      }
    ];
  }

  return [
    {
      key: "team",
      title: "Criar primeira equipe",
      desc: isIndividualAccount ? "Mantenha uma equipe base para organizar seus recursos." : "Use equipes para separar areas, contratos ou frentes de trabalho.",
      done: stats.teams > 0,
      actionLabel: "Criar equipe",
      action: () => {
        navigateTo(ROUTES.admin);
        setTimeout(() => refs.btnOpenCreateTeam?.click(), 250);
      }
    },
    {
      key: "resource",
      title: "Criar primeiro recurso",
      desc: "Cadastre quem vai receber atividades e apontar horas.",
      done: stats.resources > 0,
      actionLabel: "Criar recurso",
      action: () => {
        navigateTo(ROUTES.admin);
        setTimeout(() => refs.btnOpenCreateUser?.click(), 250);
      }
    },
    {
      key: "client",
      title: "Criar primeiro cliente",
      desc: "Inclua o cliente e os key users que serao usados nas atividades.",
      done: stats.clients > 0,
      actionLabel: "Criar cliente",
      action: () => {
        navigateTo(ROUTES.clients);
        setTimeout(() => refs.btnOpenCreateClient?.click(), 250);
      }
    },
    {
      key: "project",
      title: "Criar primeiro projeto",
      desc: "Abra o projeto que vai concentrar tarefas, recursos e acompanhamento.",
      done: stats.projects > 0,
      actionLabel: "Criar projeto",
      action: () => {
        navigateTo(isIndividualAccount ? ROUTES.myProjects : ROUTES.projects);
        setTimeout(() => (refs.btnOpenCreateProjectFromKanban || refs.btnOpenCreateProject)?.click(), 250);
      }
    },
    {
      key: "task",
      title: "Adicionar primeira tarefa",
      desc: "Entre no workspace de um projeto e adicione a primeira tarefa.",
      done: stats.tasks > 0,
      actionLabel: "Abrir projetos",
      action: () => guideCreateTaskAction()
    },
    {
      key: "activity",
      title: "Programar primeira atividade",
      desc: "Dentro da tarefa, programe a atividade que sera executada pelo recurso.",
      done: stats.activities > 0,
      actionLabel: "Abrir projetos",
      action: () => guideCreateActivityAction()
    },
    {
      key: "settings",
      title: "Conferir configuracoes da empresa",
      desc: "Revise marca, permissoes de relatorio e regras de apontamento.",
      done: stats.settingsChecked,
      actionLabel: "Conferir",
      action: () => markAdminSettingsChecked()
    }
  ];
}

function getDashboardOnboardingCopy(stepCount = 7){
  if (isTechOnboarding()) {
    return {
      title: "Guia de primeiro acesso",
      desc: "Complete os passos iniciais para acompanhar e apontar suas atividades.",
      progress: `0/${stepCount}`
    };
  }
  if (isIndividualManagerOnboarding()) {
    return {
      title: "Guia de configuracao",
      desc: "Complete o essencial para acompanhar suas entregas.",
      progress: `0/${stepCount}`
    };
  }
  return {
    title: "Guia de configuracao",
    desc: "Complete o essencial para controlar projetos, recursos e atividades.",
    progress: `0/${stepCount}`
  };
}

function updateDashboardOnboardingCopy(stepCount = 7){
  if (!refs.dashboardAdminOnboarding) return;
  const copy = getDashboardOnboardingCopy(stepCount);
  const titleEl = refs.dashboardAdminOnboarding.querySelector("h2");
  const descEl = refs.dashboardAdminOnboarding.querySelector(".admin-onboarding-head p");
  if (titleEl) titleEl.textContent = copy.title;
  if (descEl) descEl.textContent = copy.desc;
  if (refs.adminOnboardingProgressText) refs.adminOnboardingProgressText.textContent = copy.progress;
}

function getProfileOnboarding(){
  return state.profile?.onboarding && typeof state.profile.onboarding === "object"
    ? state.profile.onboarding
    : {};
}

async function saveProfileOnboardingPatch(patch = {}){
  if (!state.companyId || !auth.currentUser?.uid) return;
  const uid = auth.currentUser.uid;
  const onboarding = {
    ...getProfileOnboarding(),
    ...patch
  };
  state.profile = { ...(state.profile || {}), onboarding };
  await updateDoc(doc(db, "companies", state.companyId, "users", uid), { onboarding });
}

function ensureOnboardingActionsEl(){
  if (!refs.dashboardAdminOnboarding) return null;
  const head = refs.dashboardAdminOnboarding.querySelector(".admin-onboarding-head");
  if (!head) return null;
  let actions = refs.dashboardAdminOnboarding.querySelector(".admin-onboarding-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "admin-onboarding-actions";
    head.appendChild(actions);
  }
  return actions;
}

function ensureOnboardingMessageEl(){
  if (!refs.dashboardAdminOnboarding) return null;
  let message = refs.dashboardAdminOnboarding.querySelector(".admin-onboarding-message");
  if (!message) {
    message = document.createElement("div");
    message.className = "admin-onboarding-message";
    message.hidden = true;
    refs.dashboardAdminOnboarding.insertBefore(message, refs.adminOnboardingList || null);
  }
  return message;
}

function updateDashboardOnboardingMessage(steps, doneCount){
  const message = ensureOnboardingMessageEl();
  if (!message) return;
  const nextStep = steps.find((step) => !step.done);
  const shouldCelebrate = _adminOnboardingLastDoneCount !== null && doneCount > _adminOnboardingLastDoneCount;

  if (shouldCelebrate) {
    message.hidden = false;
    message.classList.add("is-visible");
    message.textContent = nextStep
      ? `Passo concluido. Proximo: ${nextStep.title}.`
      : "Configuracao concluida.";
  } else if (!nextStep) {
    message.hidden = false;
    message.classList.add("is-visible");
    message.textContent = "Configuracao concluida.";
  } else {
    message.hidden = true;
    message.classList.remove("is-visible");
    message.textContent = "";
  }

  _adminOnboardingLastDoneCount = doneCount;
}

function scheduleAdminOnboardingRefresh(delay = 900){
  if (_adminOnboardingRefreshTimer) clearTimeout(_adminOnboardingRefreshTimer);
  _adminOnboardingRefreshTimer = setTimeout(() => {
    _adminOnboardingRefreshTimer = null;
    renderAdminOnboarding().catch((err) => console.warn("[admin-onboarding:auto-refresh]", err));
  }, delay);
}

function highlightGuideTarget(el, options = {}){
  if (!el) return;
  if (_guideHighlightTimer) clearTimeout(_guideHighlightTimer);
  document.querySelectorAll(".fp-guide-highlight").forEach((node) => node.classList.remove("fp-guide-highlight"));
  el.classList.add("fp-guide-highlight");
  try { el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }); } catch (_) {}
  _guideHighlightTimer = setTimeout(() => {
    el.classList.remove("fp-guide-highlight");
    _guideHighlightTimer = null;
  }, options.duration || 4500);
}

function showOnboardingActionHint(kind){
  const hints = {
    resource: "Preencha nome, e-mail e equipe do recurso para continuar o guia.",
    client: "Cadastre o cliente principal e, se possivel, inclua um key user.",
    project: "Crie o primeiro projeto para liberar as proximas etapas do guia.",
    task: "Abra um projeto e cadastre a primeira tarefa.",
    activity: "Abra uma tarefa e programe a primeira atividade."
  };
  const alertMap = {
    resource: refs.createTechAlert,
    client: refs.createClientAlert,
    project: refs.createProjectAlert,
    task: refs.projectTaskAlert,
    activity: refs.projectTaskAlert
  };
  const alertEl = alertMap[kind];
  const text = hints[kind];
  if (alertEl && text) setAlert(alertEl, text, "info");
}

function waitForGuideCondition(check, { timeout = 5000, interval = 150 } = {}){
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      let result = null;
      try { result = check?.(); } catch (_) {}
      if (result) {
        resolve(result);
        return;
      }
      if (Date.now() - startedAt >= timeout) {
        resolve(null);
        return;
      }
      setTimeout(tick, interval);
    };
    tick();
  });
}

function isElementGuideVisible(el){
  if (!el || el.hidden) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function withFirstProjectWorkspaceForGuide(callback){
  navigateTo(ROUTES.myProjects);
  setTimeout(async () => {
    const panel = refs.projectWorkspacePanel || document.getElementById("projectWorkspacePanel");
    const isWorkspaceOpen = panel && panel.classList.contains("is-open") && !panel.hidden;
    if (isWorkspaceOpen) {
      callback?.();
      return;
    }

    const firstCard = document.querySelector(".kanban-card[data-project-id]");
    if (!firstCard) {
      highlightGuideTarget(refs.btnOpenCreateProjectFromKanban);
      const message = ensureOnboardingMessageEl();
      if (message) {
        message.hidden = false;
        message.classList.add("is-visible");
        message.textContent = "Crie um projeto antes de adicionar tarefas e atividades.";
      }
      return;
    }

    highlightGuideTarget(firstCard);
    firstCard.click();
    await waitForGuideCondition(() => {
      const workspacePanel = refs.projectWorkspacePanel || document.getElementById("projectWorkspacePanel");
      const taskButton = refs.btnOpenTaskForm || document.getElementById("btnOpenTaskForm");
      return workspacePanel?.classList.contains("is-open") && isElementGuideVisible(taskButton);
    });
    callback?.();
  }, 500);
}

function guideCreateTaskAction(){
  withFirstProjectWorkspaceForGuide(async () => {
    const taskButton = await waitForGuideCondition(() => {
      const btn = refs.btnOpenTaskForm || document.getElementById("btnOpenTaskForm");
      return isElementGuideVisible(btn) ? btn : null;
    });
    showOnboardingActionHint("task");
    highlightGuideTarget(taskButton || refs.btnOpenTaskForm);
    taskButton?.click();
    const taskForm = await waitForGuideCondition(() => {
      const form = refs.projectTaskFormWrap || document.getElementById("projectTaskFormWrap");
      return isElementGuideVisible(form) ? form : null;
    }, { timeout: 3000 });
    highlightGuideTarget(taskForm || refs.btnSaveTask);
  });
}

function guideCreateActivityAction(){
  withFirstProjectWorkspaceForGuide(async () => {
    const addActivityBtn = await waitForGuideCondition(() => {
      const btn = document.querySelector("[data-open-activity-form]");
      return isElementGuideVisible(btn) ? btn : null;
    }, { timeout: 2500 });
    if (!addActivityBtn) {
      showOnboardingActionHint("task");
      const taskButton = refs.btnOpenTaskForm || document.getElementById("btnOpenTaskForm");
      highlightGuideTarget(taskButton);
      taskButton?.click();
      const taskForm = await waitForGuideCondition(() => {
        const form = refs.projectTaskFormWrap || document.getElementById("projectTaskFormWrap");
        return isElementGuideVisible(form) ? form : null;
      }, { timeout: 3000 });
      highlightGuideTarget(taskForm || refs.btnSaveTask);
      return;
    }

    showOnboardingActionHint("activity");
    highlightGuideTarget(addActivityBtn);
    addActivityBtn.click();
    const activityForm = await waitForGuideCondition(() => {
      const taskCard = addActivityBtn.closest(".task-card");
      const form = taskCard?.querySelector?.("[id^='activityFormWrap-']");
      return isElementGuideVisible(form) ? form : null;
    }, { timeout: 3000 });
    highlightGuideTarget(activityForm || addActivityBtn);
  });
}

function guideCompleteProfileAction(){
  openProfileModal();
  setAlert(refs.profileAlert, "Complete seu nome e telefone para concluir este passo.", "info");
  setTimeout(() => highlightGuideTarget(refs.profileModal || refs.profilePhone), 150);
}

async function markTechOnboardingViewed(field){
  if (!isTechOnboarding() || !field) return;
  try {
    await saveProfileOnboardingPatch({ [field]: true });
    scheduleAdminOnboardingRefresh(500);
  } catch (err) {
    console.warn("[tech-onboarding:viewed]", err);
  }
}

function guideOpenTechActivitiesAction(){
  navigateTo(ROUTES.myActivities);
  markTechOnboardingViewed("techActivitiesViewed");
  setTimeout(async () => {
    const editButton = await waitForGuideCondition(() => {
      const btn = document.querySelector("[data-edit-my-activity]");
      return isElementGuideVisible(btn) ? btn : null;
    }, { timeout: 3000 });
    highlightGuideTarget(editButton || refs.btnOpenManualActivity || refs.myActivitiesList);
  }, 500);
}

function guideSubmitTechActivityAction(){
  navigateTo(ROUTES.myActivities);
  markTechOnboardingViewed("techActivitiesViewed");
  setTimeout(async () => {
    const editButton = await waitForGuideCondition(() => {
      const btn = document.querySelector("[data-edit-my-activity]");
      return isElementGuideVisible(btn) ? btn : null;
    }, { timeout: 3500 });
    if (editButton) {
      highlightGuideTarget(editButton);
      editButton.click();
      const modal = await waitForGuideCondition(() => isElementGuideVisible(refs.modalMyActivity) ? refs.modalMyActivity : null, { timeout: 3000 });
      if (modal) {
        setAlert(refs.myActivityModalAlert, "Preencha horario e observacao para enviar a OS.", "info");
        highlightGuideTarget(modal);
      }
      return;
    }

    highlightGuideTarget(refs.btnOpenManualActivity || refs.myActivitiesList);
    const message = ensureOnboardingMessageEl();
    if (message) {
      message.hidden = false;
      message.classList.add("is-visible");
      message.textContent = "Quando houver atividade vinculada, use o icone de editar para enviar sua primeira OS.";
    }
  }, 600);
}

function guideOpenTechFeedbacksAction(){
  navigateTo(ROUTES.feedbacks);
  markTechOnboardingViewed("techFeedbacksViewed");
  setTimeout(async () => {
    const target = await waitForGuideCondition(() => {
      const list = refs.myFeedbacksList || document.getElementById("myFeedbacksList");
      return isElementGuideVisible(list) ? list : null;
    }, { timeout: 3000 });
    highlightGuideTarget(target || refs.navFeedbacks);
  }, 500);
}

function renderDashboardOnboardingControls(doneCount, totalSteps){
  if (!refs.dashboardAdminOnboarding) return;
  const onboarding = getProfileOnboarding();
  const isMinimized = Boolean(onboarding.guideMinimized);
  const isComplete = totalSteps > 0 && doneCount === totalSteps;
  refs.dashboardAdminOnboarding.classList.toggle("is-minimized", isMinimized);
  refs.dashboardAdminOnboarding.classList.toggle("is-complete", isComplete);

  const actions = ensureOnboardingActionsEl();
  if (!actions) return;
  actions.innerHTML = `
    <button class="admin-onboarding-icon-btn" type="button" data-onboarding-toggle title="${isMinimized ? "Expandir guia" : "Minimizar guia"}" aria-label="${isMinimized ? "Expandir guia" : "Minimizar guia"}">${isMinimized ? "+" : "-"}</button>
    ${isComplete ? '<button class="admin-onboarding-icon-btn" type="button" data-onboarding-hide title="Ocultar guia" aria-label="Ocultar guia">x</button>' : ""}
  `;

  actions.querySelector("[data-onboarding-toggle]")?.addEventListener("click", async () => {
    const next = !Boolean(getProfileOnboarding().guideMinimized);
    refs.dashboardAdminOnboarding?.classList.toggle("is-minimized", next);
    try{
      await saveProfileOnboardingPatch({ guideMinimized: next });
      renderAdminOnboarding().catch((err) => console.warn("[admin-onboarding:toggle-refresh]", err));
    }catch(err){
      console.warn("[admin-onboarding:toggle]", err);
    }
  });

  actions.querySelector("[data-onboarding-hide]")?.addEventListener("click", async () => {
    refs.dashboardAdminOnboarding.hidden = true;
    try{
      await saveProfileOnboardingPatch({
        guideHidden: true,
        guideHiddenAt: new Date().toISOString()
      });
    }catch(err){
      console.warn("[admin-onboarding:hide]", err);
    }
  });
}

function renderAdminOnboardingSkeleton(){
  if (!refs.dashboardAdminOnboarding || !refs.adminOnboardingList) return;
  refs.dashboardAdminOnboarding.hidden = false;
  refs.dashboardAdminOnboarding.classList.remove("is-complete");
  const skeletonSteps = isTechOnboarding() ? 4 : (isIndividualManagerOnboarding() ? 5 : 7);
  updateDashboardOnboardingCopy(skeletonSteps);
  renderDashboardOnboardingControls(0, skeletonSteps);
  if (refs.adminOnboardingProgressLabel) refs.adminOnboardingProgressLabel.textContent = "carregando";
  if (refs.adminOnboardingProgressBar) refs.adminOnboardingProgressBar.style.width = "0%";
  refs.adminOnboardingList.innerHTML = '<div class="admin-onboarding-empty">Carregando primeiros passos...</div>';
}

async function renderAdminOnboarding(){
  if (!refs.dashboardAdminOnboarding || !refs.adminOnboardingList) return;
  if (!canShowAdminOnboarding()){
    refs.dashboardAdminOnboarding.hidden = true;
    return;
  }
  if (_adminOnboardingLoading) return;
  _adminOnboardingLoading = true;
  renderAdminOnboardingSkeleton();
  try{
    const stats = await getAdminOnboardingStats();
    const steps = getAdminOnboardingSteps(stats);
    updateDashboardOnboardingCopy(steps.length);
    const doneCount = steps.filter((step) => step.done).length;
    const pct = Math.round((doneCount / steps.length) * 100);
    const onboarding = getProfileOnboarding();
    const isComplete = doneCount === steps.length;

    if (isComplete && onboarding.guideHidden) {
      refs.dashboardAdminOnboarding.hidden = true;
      return;
    }

    refs.dashboardAdminOnboarding.hidden = false;
    renderDashboardOnboardingControls(doneCount, steps.length);
    updateDashboardOnboardingMessage(steps, doneCount);

    if (refs.adminOnboardingProgressText) refs.adminOnboardingProgressText.textContent = `${doneCount}/${steps.length}`;
    if (refs.adminOnboardingProgressLabel) refs.adminOnboardingProgressLabel.textContent = doneCount === steps.length ? "completo" : `${pct}% concluido`;
    if (refs.adminOnboardingProgressBar) refs.adminOnboardingProgressBar.style.width = `${pct}%`;

    const firstPendingKey = steps.find((step) => !step.done)?.key || "";
    refs.adminOnboardingList.innerHTML = steps.map((step) => `
      <article class="admin-onboarding-step ${step.done ? "is-done" : ""} ${step.key === firstPendingKey ? "is-active" : ""}">
        <span class="admin-onboarding-check" aria-hidden="true">${step.done ? "✓" : ""}</span>
        <div>
          <strong>${escapeHtml(step.title)}</strong>
          <p>${escapeHtml(step.desc)}</p>
        </div>
        ${step.done ? '<span class="admin-onboarding-status">Feito</span>' : `<button class="btn sm" type="button" data-admin-onboarding-action="${escapeHtml(step.key)}">${escapeHtml(step.actionLabel)}</button>`}
      </article>
    `).join("");

    refs.adminOnboardingList.querySelectorAll("[data-admin-onboarding-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-admin-onboarding-action");
        const step = steps.find((item) => item.key === key);
        step?.action?.();
      });
    });
  }catch(err){
    console.warn("[admin-onboarding:render]", err);
    refs.adminOnboardingList.innerHTML = '<div class="admin-onboarding-empty">Nao foi possivel carregar o checklist agora.</div>';
  }finally{
    _adminOnboardingLoading = false;
  }
}

async function markAdminSettingsChecked(){
  if (!state.companyId || !auth.currentUser?.uid) return;
  const uid = auth.currentUser.uid;
  const onboarding = {
    ...(state.profile?.onboarding && typeof state.profile.onboarding === "object" ? state.profile.onboarding : {}),
    companySettingsChecked: true,
    companySettingsCheckedAt: new Date().toISOString()
  };
  state.profile = { ...(state.profile || {}), onboarding };
  navigateTo(ROUTES.settings);
  try{
    await updateDoc(doc(db, "companies", state.companyId, "users", uid), { onboarding });
    renderAdminOnboarding().catch((err) => console.warn("[admin-onboarding:refresh]", err));
  }catch(err){
    console.warn("[admin-onboarding:settings-check]", err);
  }
}

function sortDashboardReminders(items){
  return [...items].sort((a, b) => {
    if (isReminderViewed(a) !== isReminderViewed(b)) return isReminderViewed(a) ? 1 : -1;
    if (String(a.dueDate || "") !== String(b.dueDate || "")) return String(a.dueDate || "").localeCompare(String(b.dueDate || ""));
    const aTime = typeof a.createdAt?.toMillis === "function" ? a.createdAt.toMillis() : 0;
    const bTime = typeof b.createdAt?.toMillis === "function" ? b.createdAt.toMillis() : 0;
    return bTime - aTime;
  });
}

function renderDashboardCards(profile){
  if (!refs.dashCards) return;
  refs.dashCards.innerHTML = "";
  updateBillingMenuVisibility(profile);

  const cards = [];
  const role = (profile?.role || "").toString().toLowerCase();
  const isIndividualAccount = String(state.company?.accountType || "").toLowerCase() === "individual";
  const canSeeOwnProjectsSplit = ["gestor", "admin", "coordenador"].includes(role);
  const canApproveOs = ["gestor", "admin", "coordenador"].includes(role);

  if (state.isSuperAdmin){
    cards.push({
      title: "Empresas",
      desc: "Gerencie as empresas cadastradas no FlowProject.",
      badge: "Master",
      action: () => navigateTo(ROUTES.companies)
    });
    cards.push({
      title: "LGPD por Empresa",
      desc: "Acompanhe aceites, pendencias e solicitacoes LGPD das empresas.",
      badge: "Compliance",
      action: () => openLgpdCenter()
    });

    
} else if (isIndividualAccount) {
    cards.push({
      title: "Meus Projetos",
      desc: "Visualize seus projetos em formato Kanban.",
      badge: "Kanban",
      action: () => navigateTo(ROUTES.myProjects)
    });

    if (canApproveOs) {
      cards.push({
        title: "OS para Aprovar",
        desc: "Revise apontamentos enviados, aprove individualmente ou em massa e faca estornos quando necessario.",
        badge: "Operacao",
        action: () => navigateTo(ROUTES.osApprovals)
      });
    }

    if (role === "admin"){
      cards.push({
        title: "Administracao",
        desc: "Gerencie equipes e recursos da conta.",
        badge: "Admin",
        action: () => navigateTo(ROUTES.admin)
      });
    }

} else {
    if (canSeeOwnProjectsSplit) {
      cards.push({
        title: "Projetos",
        desc: "Visualize todos os projetos da empresa.",
        badge: "Carteira",
        action: () => navigateTo(ROUTES.projects)
      });
      cards.push({
        title: "Meus Projetos",
        desc: "Visualize apenas os projetos criados por voce.",
        badge: "Kanban",
        action: () => navigateTo(ROUTES.myProjects)
      });
    } else {
      cards.push({
        title: "Meus Projetos",
        desc: "Visualize seus projetos em formato Kanban.",
        badge: "Kanban",
        action: () => navigateTo(ROUTES.myProjects)
      });
    }

    if (role === "tecnico") {
      cards.push({
        title: "Minhas Atividades",
        desc: "Veja suas atividades por tarefa, faca apontamentos e envie para aprovacao.",
        badge: "Tecnico",
        action: () => navigateTo(ROUTES.myActivities)
      });
    }

    if (canApproveOs) {
      cards.push({
        title: "OS para Aprovar",
        desc: "Revise apontamentos enviados, aprove individualmente ou em massa e faca estornos quando necessario.",
        badge: "Operacao",
        action: () => navigateTo(ROUTES.osApprovals)
      });
    }

    if (false && role === "gestor") {
      cards.push({
        title: "Usuários (Técnicos)",
        desc: "Cadastre técnicos e vincule às equipes que você administra.",
        badge: "Gestor",
        action: () => navigateTo(ROUTES.managerUsers)
      });
    }

    if (role === "admin"){
      cards.push({
        title: "Administração",
        desc: "Gerencie equipes e usuários da empresa.",
        badge: "Admin",
        action: () => navigateTo(ROUTES.admin)
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

  refreshDashboardHomeWidgets();
}

function canManageBillingFromMenu(profile = state.profile){
  const role = String(profile?.role || "").toLowerCase();
  const isIndividualAccount = String(state.company?.accountType || "").toLowerCase() === "individual";
  return isIndividualAccount && (role === "admin" || role === "gestor");
}

function updateBillingMenuVisibility(profile = state.profile){
  if (!refs.btnBillingPortal) return;
  refs.btnBillingPortal.hidden = !canManageBillingFromMenu(profile);
}

async function openCustomerPortal(){
  try {
    const data = await callHttpFunctionWithAuth("createCustomerPortalSession", {});
    if (!data?.url) throw new Error("Portal de assinatura indisponivel no momento.");
    window.location.href = data.url;
  } catch (err) {
    console.error("[billing-portal]", err);
    alert(err?.message || "Nao foi possivel abrir o portal de assinatura.");
  }
}

function getMonthKey(date){
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getDateKeyLocal(date){
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDashboardMonthLabel(date){
  const label = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shiftDashboardAgendaMonth(offset){
  const next = new Date(_dashboardAgendaCursor.getFullYear(), _dashboardAgendaCursor.getMonth() + offset, 1);
  _dashboardAgendaCursor = next;
  loadDashboardAgenda().catch((err) => console.warn("[dashboard-agenda]", err));
}

function getCurrentDashboardRole(){
  return String(state.profile?.role || "").trim().toLowerCase();
}

function attachCalendarTooltips(){
  if (!refs.dashboardCalendar) return;
  
  const daysWithTooltip = refs.dashboardCalendar.querySelectorAll('[data-has-tooltip="true"]');
  
  daysWithTooltip.forEach((dayEl) => {
    const tooltip = dayEl.querySelector(".calendar-tooltip");
    if (!tooltip) return;
    
    // Show on mouseenter
    dayEl.addEventListener("mouseenter", (e) => {
      tooltip.style.display = "block";
      tooltip.style.opacity = "1";
      tooltip.style.visibility = "visible";
    });
    
    // Hide on mouseleave
    dayEl.addEventListener("mouseleave", (e) => {
      tooltip.style.display = "none";
      tooltip.style.opacity = "0";
      tooltip.style.visibility = "hidden";
    });
  });
}

function renderDashboardCalendar(dateCountMap, currentDate = new Date(), activitiesByDate = new Map()){
  if (!refs.dashboardCalendar) return;
  const currentRole = getCurrentDashboardRole();
  const isTechView = currentRole === "tecnico";
  const showManagerInTooltip = currentRole === "tecnico";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthLabel = formatDashboardMonthLabel(currentDate);
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay.getDay();
  const todayKey = getDateKeyLocal(new Date());
  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

  if (refs.dashboardAgendaMonth) {
    refs.dashboardAgendaMonth.textContent = monthLabel;
  }

  const cells = [];
  weekdays.forEach((day) => {
    cells.push(`<div class="dashboard-calendar-weekday">${escapeHtml(day)}</div>`);
  });

  for (let i = 0; i < startOffset; i += 1) {
    cells.push('<div class="dashboard-calendar-day is-muted" aria-hidden="true"></div>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const key = getDateKeyLocal(date);
    const count = dateCountMap.get(key) || 0;
    const dayActivities = activitiesByDate.get(key) || [];
    const classes = [
      "dashboard-calendar-day",
      key === todayKey ? "is-today" : "",
      count > 0 ? "has-activity" : ""
    ].filter(Boolean).join(" ");

    // Build tooltip content if there are activities
    let tooltipHtml = "";
    if (count > 0 && dayActivities.length > 0) {
      const tooltipItems = dayActivities.slice(0, 5).map((act) => {
        if (!isTechView) {
          return `<div class="calendar-tooltip-item">
            <div class="calendar-tooltip-project">${escapeHtml(act.projectName)}</div>
            <div class="calendar-tooltip-activity">${escapeHtml(act.clientName || "Cliente nao identificado")}</div>
          </div>`;
        }
        const hoursStr = act.hours > 0 ? `${act.hours}h` : "0h";
        return `<div class="calendar-tooltip-item">
          <div class="calendar-tooltip-project">${escapeHtml(act.projectName)}</div>
          <div class="calendar-tooltip-activity">${escapeHtml(act.name)}</div>
          <div class="calendar-tooltip-details">${hoursStr} • ${escapeHtml(act.managerName)}</div>
        </div>`;
      }).join("");
      
      const moreText = dayActivities.length > 5 ? `<div class="calendar-tooltip-more">+${dayActivities.length - 5} mais...</div>` : "";
      
      tooltipHtml = `<div class="calendar-tooltip${showManagerInTooltip ? "" : " is-compact"}">
        <div class="calendar-tooltip-title">${isTechView ? "Atividades do dia" : "Projetos do dia"}</div>
        <div class="calendar-tooltip-list">${tooltipItems}${moreText}</div>
      </div>`;
    }

    cells.push(`
      <div class="${classes}" ${tooltipHtml ? 'data-has-tooltip="true"' : ''}>
        <span class="dashboard-calendar-number">${escapeHtml(String(day))}</span>
        ${count > 0 ? `<span class="dashboard-calendar-count">${escapeHtml(String(count))} ${isTechView ? `atividade${count > 1 ? "s" : ""}` : `projeto${count > 1 ? "s" : ""}`}</span>` : ""}
        ${tooltipHtml}
      </div>
    `);
  }

  const remainder = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < remainder; i += 1) {
    cells.push('<div class="dashboard-calendar-day is-muted" aria-hidden="true"></div>');
  }

  refs.dashboardCalendar.innerHTML = cells.join("");
  
  // Attach tooltip event listeners
  attachCalendarTooltips();
}

async function loadDashboardAgenda(){
  if (!refs.dashboardAgenda || !refs.dashboardCalendar) return;

  if (state.isSuperAdmin) {
    refs.dashboardAgenda.hidden = true;
    return;
  }

  refs.dashboardAgenda.hidden = false;
  refs.dashboardCalendar.innerHTML = '<div class="dashboard-calendar-empty">Carregando agenda...</div>';

  const uid = auth.currentUser?.uid || "";
  if (!state.companyId || !uid) {
    renderDashboardCalendar(new Map(), _dashboardAgendaCursor, new Map());
    if (refs.dashboardAgendaSubtitle) refs.dashboardAgendaSubtitle.textContent = "Entre para visualizar suas atividades do mes atual.";
    return;
  }

  const selectedMonth = new Date(_dashboardAgendaCursor.getFullYear(), _dashboardAgendaCursor.getMonth(), 1);
  const monthKey = getMonthKey(selectedMonth);
  const currentRole = getCurrentDashboardRole();
  const activitiesRef = collection(db, "companies", state.companyId, "activities");
  const projectsRef = collection(db, "companies", state.companyId, "projects");
  const activitiesQuery = currentRole === "tecnico"
    ? query(activitiesRef, where("techUids", "array-contains", uid))
    : activitiesRef;
  const [activitiesSnap, projectsSnap] = await Promise.all([
    getDocs(activitiesQuery),
    getDocs(projectsRef)
  ]);
  const projects = projectsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const usersByUid = new Map((Array.isArray(state._usersCache) ? state._usersCache : []).map((user) => [user.uid, user]));
  const isTechView = currentRole === "tecnico";
  const managedProjectIds = currentRole === "gestor"
    ? new Set(projects.filter((project) => String(project?.managerUid || "") === uid).map((project) => project.id))
    : new Set();
  const coordinatedProjectIds = currentRole === "coordenador"
    ? new Set(projects.filter((project) => String(project?.coordinatorUid || "") === uid).map((project) => project.id))
    : new Set();

  const counts = new Map();
  const activitiesByDate = new Map();
  const projectsByDate = new Map();
  const distinctProjectsInMonth = new Set();
  activitiesSnap.docs.forEach((docSnap) => {
    const activity = docSnap.data() || {};
    const project = projectsById.get(activity.projectId) || null;
    if (currentRole === "gestor") {
      const belongsToManager = String(activity.managerUid || "") === uid
        || Boolean(project && managedProjectIds.has(project.id));
      if (!belongsToManager) return;
    } else if (currentRole === "coordenador") {
      const belongsToCoordinator = String(project?.coordinatorUid || "") === uid
        || Boolean(project && coordinatedProjectIds.has(project.id));
      if (!belongsToCoordinator) return;
    } else if (currentRole !== "tecnico" && currentRole !== "admin") {
      const assignedTechs = Array.isArray(activity.techUids) ? activity.techUids : [];
      if (!assignedTechs.includes(uid)) return;
    }
    const manager = usersByUid.get(project?.managerUid || "") || null;
    activity.projectName = project?.name || activity.projectName || "Projeto nao identificado";
    activity.managerName = project?.managerName || manager?.name || activity.managerName || activity.createdByName || "Gestor nao identificado";
    const workDate = String(activity.workDate || "").slice(0, 10);
    if (!workDate || !workDate.startsWith(monthKey)) return;
    
    // Count for display
    if (isTechView) {
      counts.set(workDate, (counts.get(workDate) || 0) + 1);
    }
    
    // Store full activity data for tooltip
    if (isTechView && !activitiesByDate.has(workDate)) {
      activitiesByDate.set(workDate, []);
    }
    if (!isTechView) {
      if (!projectsByDate.has(workDate)) {
        projectsByDate.set(workDate, new Map());
      }
      const projectMap = projectsByDate.get(workDate);
      const projectKey = String(activity.projectId || project?.id || activity.projectName || docSnap.id);
      if (!projectMap.has(projectKey)) {
        projectMap.set(projectKey, {
          id: projectKey,
          projectName: activity.projectName || "Projeto nao identificado",
          clientName: project?.clientName || activity.clientName || "Cliente nao identificado"
        });
      }
      distinctProjectsInMonth.add(projectKey);
      return;
    }
    activitiesByDate.get(workDate).push({
      id: docSnap.id,
      name: activity.name || "Atividade sem nome",
      projectName: activity.projectName || "Projeto não identificado",
      hours: activity.hoursWorked || activity.hours || 0,
      managerName: activity.managerName || activity.createdByName || "Gestor não identificado"
    });
  });

  if (!isTechView) {
    projectsByDate.forEach((projectMap, workDate) => {
      const dayProjects = Array.from(projectMap.values());
      counts.set(workDate, dayProjects.length);
      activitiesByDate.set(workDate, dayProjects);
    });
  }

  const total = isTechView
    ? Array.from(counts.values()).reduce((acc, count) => acc + count, 0)
    : distinctProjectsInMonth.size;
  if (refs.dashboardAgendaSubtitle) {
    const label = formatDashboardMonthLabel(selectedMonth);
    refs.dashboardAgendaSubtitle.textContent = total
      ? `${total} ${isTechView ? "atividade(s) planejada(s)" : "projeto(s) planejado(s)"} para voce em ${label}.`
      : `Nenhum${isTechView ? "a atividade" : " projeto"} planejado${isTechView ? "a" : ""} para voce em ${label}.`;
  }
  renderDashboardCalendar(counts, selectedMonth, activitiesByDate);
}

function canBroadcastDashboardReminder(){
  const role = getCurrentDashboardRole();
  return role === "admin" || role === "gestor";
}

const DASHBOARD_REMINDER_COLORS = new Set(["sun", "mint", "rose", "sky", "lavender"]);

function normalizeReminderColor(value){
  const color = String(value || "").trim().toLowerCase();
  return DASHBOARD_REMINDER_COLORS.has(color) ? color : "sun";
}

function isReminderViewed(reminder){
  return Boolean(reminder?.viewed || reminder?.viewedAt);
}

function isReminderDueToday(reminder){
  return String(reminder?.dueDate || "") === getDateKeyLocal(new Date());
}

function isReminderOverdue(reminder){
  const todayKey = getDateKeyLocal(new Date());
  return String(reminder?.dueDate || "") < todayKey && !isReminderViewed(reminder);
}

function formatReminderDateShort(value){
  if (!value) return "-";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return String(value);
  return new Date(year, month - 1, day).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short"
  });
}

function formatReminderDateLong(value){
  if (!value) return "-";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return String(value);
  const label = new Date(year, month - 1, day).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getReminderStatusLabel(reminder){
  if (isReminderDueToday(reminder) && !isReminderViewed(reminder)) return "Alerta de hoje";
  if (isReminderOverdue(reminder)) return "Atrasado";
  if (isReminderViewed(reminder)) return "Visualizado";
  return "Pendente";
}

async function loadDashboardReminderUsers(){
  if (!canBroadcastDashboardReminder()) return [];
  if (_dashboardReminderUsers.length) return _dashboardReminderUsers;
  let users = Array.isArray(state._usersCache) ? [...state._usersCache] : [];
  if (!users.length) {
    const usersSnap = await getDocs(collection(db, "companies", state.companyId, "users"));
    users = usersSnap.docs.map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }));
    state._usersCache = users;
  }
  const currentUid = auth.currentUser?.uid || "";
  _dashboardReminderUsers = users
    .filter((user) => user?.uid && user.active !== false)
    .sort((a, b) => {
      if (a.uid === currentUid) return -1;
      if (b.uid === currentUid) return 1;
      return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR");
    });
  return _dashboardReminderUsers;
}

function updateReminderToggleAllLabel(){
  if (!refs.btnReminderToggleAllUsers || !refs.reminderTargetsList) return;
  const options = Array.from(refs.reminderTargetsList.querySelectorAll("input[type='checkbox']"));
  const checkedCount = options.filter((input) => input.checked).length;
  refs.btnReminderToggleAllUsers.textContent = checkedCount === options.length && options.length ? "Limpar selecao" : "Selecionar todos";
}

function updateReminderRecipientHint(){
  if (!refs.reminderSelfHint) return;
  if (!canBroadcastDashboardReminder()) {
    refs.reminderSelfHint.textContent = "Este lembrete sera salvo apenas no seu mural.";
    return;
  }

  const currentUid = auth.currentUser?.uid || "";
  const selected = Array.from(refs.reminderTargetsList?.querySelectorAll("input[type='checkbox']:checked") || []);
  const hasSelf = selected.some((input) => input.value === currentUid);
  const selectedOthers = selected.filter((input) => input.value !== currentUid).length;

  if (selectedOthers > 0 && hasSelf) {
    refs.reminderSelfHint.textContent = "Este lembrete sera salvo no seu mural e dos destinatarios selecionados.";
  } else if (selectedOthers > 0) {
    refs.reminderSelfHint.textContent = "Este lembrete sera salvo no mural dos destinatarios selecionados.";
  } else {
    refs.reminderSelfHint.textContent = "Este lembrete sera salvo apenas no seu mural.";
  }
}

function renderDashboardReminderTargetOptions(users){
  if (!refs.reminderTargetsList) return;
  const currentUid = auth.currentUser?.uid || "";
  refs.reminderTargetsList.innerHTML = users.length
    ? users.map((user) => {
        const inputId = `reminder-target-${String(user.uid || "").replace(/[^a-zA-Z0-9_-]/g, "")}`;
        const label = `${user.name || user.email || "Usuario"}${user.uid === currentUid ? " (voce)" : ""}`;
        return `
          <div class="reminder-target-row">
            <input id="${escapeHtml(inputId)}" type="checkbox" value="${escapeHtml(user.uid)}" ${user.uid === currentUid ? "checked" : ""} />
            <label for="${escapeHtml(inputId)}">${escapeHtml(label)}</label>
          </div>
        `;
      }).join("")
    : '<div class="reminder-self-hint">Nenhum usuario elegivel encontrado para receber lembretes.</div>';
  updateReminderToggleAllLabel();
  updateReminderRecipientHint();
}

function getSelectedReminderRecipients(){
  const currentUid = auth.currentUser?.uid || "";
  const currentName = state.profile?.name || auth.currentUser?.email || "Voce";
  if (!canBroadcastDashboardReminder()) {
    return [{ uid: currentUid, name: currentName }];
  }
  const selected = Array.from(refs.reminderTargetsList?.querySelectorAll("input[type='checkbox']:checked") || [])
    .map((input) => {
      const user = _dashboardReminderUsers.find((item) => item.uid === input.value);
      return user ? { uid: user.uid, name: user.name || user.email || "Usuario" } : null;
    })
    .filter(Boolean);
  return Array.from(new Map(selected.map((item) => [item.uid, item])).values());
}

function getReminderFirstName(value){
  const text = String(value || "").trim();
  if (!text) return "";
  const [first = ""] = text.split(/\s+/);
  return first || text;
}

function buildReminderRecipientSummary(recipients){
  const names = recipients
    .map((recipient) => getReminderFirstName(recipient?.name || ""))
    .filter(Boolean);
  return Array.from(new Set(names)).join(", ");
}

function closeReminderComposer(){
  if (refs.modalReminderComposer) refs.modalReminderComposer.hidden = true;
  clearAlert(refs.reminderComposerAlert);
}

async function openReminderComposer(){
  if (!refs.modalReminderComposer) return;
  clearAlert(refs.reminderComposerAlert);
  if (refs.reminderDateInput) refs.reminderDateInput.value = getDateKeyLocal(new Date());
  if (refs.reminderColorOptions) {
    const defaultColor = refs.reminderColorOptions.querySelector("input[value='sun']");
    if (defaultColor) defaultColor.checked = true;
  }
  if (refs.reminderMessageInput) refs.reminderMessageInput.value = "";
  if (canBroadcastDashboardReminder()) {
    if (refs.reminderTargetsWrap) refs.reminderTargetsWrap.hidden = false;
    if (refs.reminderSelfHintWrap) refs.reminderSelfHintWrap.hidden = false;
    const users = await loadDashboardReminderUsers();
    renderDashboardReminderTargetOptions(users);
    if (refs.btnReminderToggleAllUsers) refs.btnReminderToggleAllUsers.hidden = users.length <= 1;
  } else {
    if (refs.reminderTargetsWrap) refs.reminderTargetsWrap.hidden = true;
    if (refs.reminderSelfHintWrap) refs.reminderSelfHintWrap.hidden = false;
    if (refs.reminderSelfHint) refs.reminderSelfHint.textContent = "Este lembrete sera salvo apenas no seu mural.";
  }
  refs.modalReminderComposer.hidden = false;
}

function getSelectedReminderColor(){
  const selected = refs.reminderColorOptions?.querySelector("input[name='reminderColor']:checked");
  return normalizeReminderColor(selected?.value || "sun");
}

function closeReminderDetail(){
  _activeReminderDetailId = "";
  if (refs.modalReminderDetail) refs.modalReminderDetail.hidden = true;
}

async function saveDashboardReminder(){
  const companyId = state.companyId;
  const currentUid = auth.currentUser?.uid || "";
  if (!companyId || !currentUid) return;
  const dueDate = String(refs.reminderDateInput?.value || "").slice(0, 10);
  const noteColor = getSelectedReminderColor();
  const message = String(refs.reminderMessageInput?.value || "").trim();
  const recipients = getSelectedReminderRecipients();
  if (!dueDate) {
    setAlert(refs.reminderComposerAlert, "Selecione a data do lembrete.");
    return;
  }
  if (message.length < 4) {
    setAlert(refs.reminderComposerAlert, "Digite uma mensagem com pelo menos 4 caracteres.");
    return;
  }
  if (!recipients.length) {
    setAlert(refs.reminderComposerAlert, "Selecione pelo menos um destinatario.");
    return;
  }
  setAlert(refs.reminderComposerAlert, "Salvando...", "info");
  const batch = writeBatch(db);
  const createdByName = state.profile?.name || auth.currentUser?.email || "Usuario";
  const createdByRole = normalizeRole(state.profile?.role || "tecnico");
  const recipientSummary = recipients.length > 1 ? buildReminderRecipientSummary(recipients) : "";
  recipients.forEach((recipient, index) => {
    const reminderId = `rem-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
    const reminderRef = doc(db, "companies", companyId, "reminders", reminderId);
    batch.set(reminderRef, {
      recipientUid: recipient.uid,
      recipientName: recipient.name || "",
      recipientSummary,
      dueDate,
      noteColor,
      message,
      viewed: false,
      viewedBy: "",
      createdBy: currentUid,
      createdByName,
      createdByRole,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: currentUid
    });
  });
  await batch.commit();
  closeReminderComposer();
  await loadDashboardReminders();
}

function renderDashboardReminders(reminders){
  if (!refs.dashboardRemindersList || !refs.dashboardRemindersEmpty) return;
  const openCount = reminders.filter((item) => !isReminderViewed(item)).length;
  const todayCount = reminders.filter((item) => isReminderDueToday(item) && !isReminderViewed(item)).length;
  if (refs.dashboardRemindersOpenCount) refs.dashboardRemindersOpenCount.textContent = String(openCount);
  if (refs.dashboardRemindersTodayCount) refs.dashboardRemindersTodayCount.textContent = String(todayCount);
  if (refs.dashboardRemindersTotalCount) refs.dashboardRemindersTotalCount.textContent = String(reminders.length);
  if (refs.dashboardRemindersSubtitle) {
    refs.dashboardRemindersSubtitle.textContent = reminders.length
      ? `${openCount} lembrete(s) aguardando sua atencao.`
      : "Anotacoes importantes e lembretes compartilhados aparecerao aqui.";
  }
  refs.dashboardRemindersEmpty.hidden = reminders.length > 0;
  refs.dashboardRemindersList.innerHTML = reminders.map((reminder) => {
    const noteColor = normalizeReminderColor(reminder.noteColor);
    const classes = [
      "reminder-note",
      `note-color-${noteColor}`,
      isReminderViewed(reminder) ? "is-viewed" : "",
      isReminderDueToday(reminder) && !isReminderViewed(reminder) ? "is-alert" : "",
      isReminderOverdue(reminder) ? "is-overdue" : ""
    ].filter(Boolean).join(" ");
    return `
      <article class="${classes}" role="button" tabindex="0" data-reminder-id="${escapeHtml(reminder.id)}">
        <button class="reminder-note-delete" type="button" data-delete-reminder="${escapeHtml(reminder.id)}" aria-label="Excluir lembrete" title="Excluir lembrete">x</button>
        <span class="reminder-note-date">${escapeHtml(formatReminderDateShort(reminder.dueDate))}</span>
        <div class="reminder-note-message">${escapeHtml(reminder.message || "")}</div>
        <div class="reminder-note-footer">
          <span class="reminder-note-author-wrap">
            <span class="reminder-note-author">Por ${escapeHtml(reminder.createdByName || "Usuario")}</span>
            ${reminder.recipientSummary ? `<span class="reminder-note-recipient">Para ${escapeHtml(reminder.recipientSummary)}</span>` : ""}
          </span>
          <span class="reminder-note-status">${escapeHtml(getReminderStatusLabel(reminder))}</span>
        </div>
        <span class="reminder-note-fold" aria-hidden="true"></span>
      </article>
    `;
  }).join("");
}

async function loadDashboardReminders(){
  if (!refs.dashboardReminders || !refs.dashboardRemindersList) return;
  stopDashboardRemindersListener();
  if (state.isSuperAdmin) {
    refs.dashboardReminders.hidden = true;
    return;
  }
  refs.dashboardReminders.hidden = false;
  const companyId = state.companyId;
  const currentUid = auth.currentUser?.uid || "";
  if (!companyId || !currentUid) {
    _dashboardReminders = [];
    renderDashboardReminders([]);
    return;
  }
  const remindersQuery = query(
    collection(db, "companies", companyId, "reminders"),
    where("recipientUid", "==", currentUid)
  );
  _dashboardRemindersUnsub = onSnapshot(remindersQuery, (snap) => {
    _dashboardReminders = sortDashboardReminders(
      snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    );
    renderDashboardReminders(_dashboardReminders);
  }, (err) => {
    console.warn("[dashboard-reminders:listen]", err);
    _dashboardReminders = [];
    renderDashboardReminders([]);
  });
}

async function markReminderAsViewed(reminderId){
  const reminder = _dashboardReminders.find((item) => item.id === reminderId);
  const currentUid = auth.currentUser?.uid || "";
  if (!reminder || reminder.recipientUid !== currentUid || isReminderViewed(reminder)) return reminder;
  await updateDoc(doc(db, "companies", state.companyId, "reminders", reminderId), {
    viewed: true,
    viewedAt: serverTimestamp(),
    viewedBy: currentUid,
    updatedAt: serverTimestamp(),
    updatedBy: currentUid
  });
  reminder.viewed = true;
  reminder.viewedAt = new Date();
  reminder.viewedBy = currentUid;
  renderDashboardReminders(_dashboardReminders);
  return reminder;
}

async function openReminderDetail(reminderId){
  let reminder = _dashboardReminders.find((item) => item.id === reminderId);
  if (!reminder || !refs.modalReminderDetail) return;
  reminder = await markReminderAsViewed(reminderId);
  _activeReminderDetailId = reminderId;
  if (refs.reminderDetailMeta) refs.reminderDetailMeta.textContent = `Criado por ${reminder.createdByName || "Usuario"} para ${reminder.recipientName || "voce"}.`;
  if (refs.reminderDetailDate) refs.reminderDetailDate.textContent = formatReminderDateLong(reminder.dueDate);
  if (refs.reminderDetailMessage) refs.reminderDetailMessage.textContent = reminder.message || "-";
  if (refs.reminderDetailAuthor) refs.reminderDetailAuthor.textContent = `Criado por: ${reminder.createdByName || "Usuario"}`;
  if (refs.reminderDetailRecipient) refs.reminderDetailRecipient.textContent = `Destinatario: ${reminder.recipientName || "Voce"}`;
  refs.modalReminderDetail.hidden = false;
}

async function deleteDashboardReminder(reminderId){
  const reminder = _dashboardReminders.find((item) => item.id === reminderId);
  if (!reminder || !state.companyId) return;
  if (!confirm("Deseja excluir este lembrete?")) return;
  await deleteDoc(doc(db, "companies", state.companyId, "reminders", reminderId));
  _dashboardReminders = _dashboardReminders.filter((item) => item.id !== reminderId);
  renderDashboardReminders(_dashboardReminders);
  if (_activeReminderDetailId === reminderId) closeReminderDetail();
}

/** =========================
 *  7) COMPANIES (MASTER) - Delegado para companies.domain.js
 *  ========================= */
const getDeps = () => ({
  state, refs, db, auth,
  callHttpFunctionWithAuth,
  currentCompanyDetailId,
  loadCompanies, openCompanyDetailModal, loadCompanyDetail,
  renderCompanyUsersTable, toggleCompanyBlock,
  setCompanyUserActive, setCompanyUserRole
});

function openCompaniesView() {
  companiesDomain.openCompaniesView({ loadCompanies });
}

async function loadCompanies() {
  await companiesDomain.loadCompanies(getDeps());
}

function clearCompanyCreateSuccess() {
  companiesDomain.clearCompanyCreateSuccess();
}

function showCompanyCreateSuccess(data) {
  companiesDomain.showCompanyCreateSuccess(data);
}

function closeCreateCompanyModal() {
  companiesDomain.closeCreateCompanyModal(refs);
}

function closeCompanyDetailModal() {
  companiesDomain.closeCompanyDetailModal(getDeps());
}

function openCreateCompanyModal() {
  companiesDomain.openCreateCompanyModal(getDeps());
}

async function openCompanyDetailModal(companyId) {
  await companiesDomain.openCompanyDetailModal(companyId, getDeps());
}

async function loadCompanyDetail(companyId) {
  await companiesDomain.loadCompanyDetail(companyId, getDeps());
}

function renderCompanyUsersTable(companyId, users) {
  companiesDomain.renderCompanyUsersTable(companyId, users, getDeps());
}

async function setCompanyUserActive(companyId, uid, active) {
  await companiesDomain.setCompanyUserActive(companyId, uid, active, getDeps());
}

async function setCompanyUserRole(companyId, uid, role) {
  await companiesDomain.setCompanyUserRole(companyId, uid, role, getDeps());
}

async function toggleCompanyBlock(companyId, currentlyActive) {
  await companiesDomain.toggleCompanyBlock(companyId, currentlyActive, getDeps());
}

async function createCompany() {
  await companiesDomain.createCompany(getDeps());
}

/** =========================
 *  8) ADMIN (EMPRESA): TEAMS - Delegado para teams.domain.js
 *  ========================= */
const getTeamsDeps = () => ({
  refs, state, db, auth,
  loadTeams, openTeamDetailsModal, loadTeamMembers, removeUserFromTeam,
  loadUsers, loadManagerUsers, renderTeamChips, getNextTeamId, updateAdminSummary
});

function openAdminView(){
  setView("admin");
  Promise.all([loadTeams(), loadUsers()]).catch(err => {
    console.error(err);
    alert("Erro ao carregar administração: " + (err?.message || err));
  });
}

async function loadTeams(){
  await teamsDomain.loadTeams(getTeamsDeps());
}

function closeTeamDetailsModal(){
  teamsDomain.closeTeamDetailsModal(getTeamsDeps());
}

async function loadTeamMembers(teamId){
  return await teamsDomain.loadTeamMembers(teamId, getTeamsDeps());
}

async function removeUserFromTeam(uid, teamId){
  await teamsDomain.removeUserFromTeam(uid, teamId, getTeamsDeps());
}

async function openTeamDetailsModal(teamId){
  await teamsDomain.openTeamDetailsModal(teamId, getTeamsDeps());
}

async function ensureTeamsForChips(){
  await teamsDomain.ensureTeamsForChips(getTeamsDeps());
}

async function getNextTeamId(){
  return await teamsDomain.getNextTeamId(getTeamsDeps());
}

function openCreateTeamModal(){
  teamsDomain.openCreateTeamModal(getTeamsDeps());
}

function closeCreateTeamModal(){
  teamsDomain.closeCreateTeamModal(refs);
}

async function createTeam(){
  await teamsDomain.createTeam(getTeamsDeps());
}

function isCompanyAdmin(){
  return !state.isSuperAdmin && String(state.profile?.role || "").toLowerCase() === "admin";
}

function canConfigureProjectTechPermissions(){
  const role = String(state.profile?.role || "").toLowerCase();
  return !state.isSuperAdmin && ["admin", "gestor", "coordenador"].includes(role);
}

function closeReportPermissionsModal(){
  hide(refs.modalReportPermissions);
  clearAlert(refs.reportPermissionsAlert);
}

function renderReportPermissionsTable(){
  if (!refs.reportPermissionsTableBody) return;
  const permissions = normalizeReportPermissions(state.company?.reportPermissions);
  refs.reportPermissionsTableBody.innerHTML = REPORT_PERMISSION_ITEMS.map((report) => `
    <tr>
      <th>
        <strong>${escapeHtml(report.label)}</strong>
        ${report.note ? `<span>${escapeHtml(report.note)}</span>` : ""}
      </th>
      ${REPORT_PERMISSION_ROLES.map((role) => `
        <td>
          <label class="report-permission-check">
            <input
              type="checkbox"
              data-report-permission-role="${escapeHtml(role.key)}"
              data-report-permission-key="${escapeHtml(report.key)}"
              ${permissions[role.key]?.[report.key] !== false ? "checked" : ""}
            />
            <span>${escapeHtml(role.label)}</span>
          </label>
        </td>
      `).join("")}
    </tr>
  `).join("");
}

async function openReportPermissionsModal(){
  clearAlert(refs.reportPermissionsAlert);
  if (!isCompanyAdmin()){
    alert("Acesso restrito: somente admin da empresa pode configurar relatorios.");
    return;
  }
  if (!state.company && state.companyId) await loadCurrentCompanyBrand();
  renderReportPermissionsTable();
  show(refs.modalReportPermissions);
}

function readReportPermissionsForm(){
  const permissions = getDefaultReportPermissions();
  const inputs = Array.from(refs.reportPermissionsTableBody?.querySelectorAll?.("[data-report-permission-role][data-report-permission-key]") || []);
  for (const input of inputs) {
    const role = input.getAttribute("data-report-permission-role");
    const key = input.getAttribute("data-report-permission-key");
    if (!role || !key || !permissions[role]) continue;
    permissions[role][key] = input.checked === true;
  }
  return permissions;
}

async function saveReportPermissions(){
  clearAlert(refs.reportPermissionsAlert);
  if (!isCompanyAdmin()) return setAlert(refs.reportPermissionsAlert, "Acesso restrito.");
  if (!state.companyId) return setAlert(refs.reportPermissionsAlert, "Empresa nao identificada.");
  const permissions = readReportPermissionsForm();
  try{
    await updateDoc(doc(db, "companies", state.companyId), {
      reportPermissions: permissions,
      updatedAt: serverTimestamp()
    });
    state.company = { ...(state.company || {}), reportPermissions: permissions };
    state._reportsCacheLoaded = false;
    setAlert(refs.reportPermissionsAlert, "Permissoes de relatorios salvas com sucesso.", "success");
  }catch(err){
    console.error("[report-permissions:save]", err);
    setAlert(refs.reportPermissionsAlert, err?.message || "Nao foi possivel salvar as permissoes.");
  }
}

function resetReportPermissionsForm(){
  const permissions = getDefaultReportPermissions();
  if (!refs.reportPermissionsTableBody) return;
  refs.reportPermissionsTableBody.querySelectorAll("[data-report-permission-role][data-report-permission-key]").forEach((input) => {
    const role = input.getAttribute("data-report-permission-role");
    const key = input.getAttribute("data-report-permission-key");
    input.checked = permissions[role]?.[key] !== false;
  });
}

function closeProjectTechPermissionsModal(){
  hide(refs.modalProjectTechPermissions);
  clearAlert(refs.projectTechPermissionsAlert);
}

function renderProjectTechPermissionsTable(){
  if (!refs.projectTechPermissionsTableBody) return;
  const permissions = normalizeProjectTechPermissions(state.company?.projectTechPermissions);
  refs.projectTechPermissionsTableBody.innerHTML = PROJECT_TECH_PERMISSION_ITEMS.map((item) => `
    <tr>
      <th>
        <strong>${escapeHtml(item.label)}</strong>
        ${item.note ? `<span>${escapeHtml(item.note)}</span>` : ""}
      </th>
      <td>
        <label class="report-permission-check">
          <input
            type="checkbox"
            data-project-tech-permission-key="${escapeHtml(item.key)}"
            ${permissions[item.key] === true ? "checked" : ""}
          />
          <span>Permitir</span>
        </label>
      </td>
    </tr>
  `).join("");
}

async function openProjectTechPermissionsModal(){
  clearAlert(refs.projectTechPermissionsAlert);
  if (!canConfigureProjectTechPermissions()){
    alert("Acesso restrito: somente admin, gestor ou coordenador pode configurar permissoes do tecnico.");
    return;
  }
  if (!state.company && state.companyId) await loadCurrentCompanyBrand();
  renderProjectTechPermissionsTable();
  show(refs.modalProjectTechPermissions);
}

function readProjectTechPermissionsForm(){
  const permissions = getDefaultProjectTechPermissions();
  const inputs = Array.from(refs.projectTechPermissionsTableBody?.querySelectorAll?.("[data-project-tech-permission-key]") || []);
  for (const input of inputs) {
    const key = input.getAttribute("data-project-tech-permission-key");
    if (!key || !(key in permissions)) continue;
    permissions[key] = input.checked === true;
  }
  return permissions;
}

async function saveProjectTechPermissions(){
  clearAlert(refs.projectTechPermissionsAlert);
  if (!canConfigureProjectTechPermissions()) return setAlert(refs.projectTechPermissionsAlert, "Acesso restrito.");
  if (!state.companyId) return setAlert(refs.projectTechPermissionsAlert, "Empresa nao identificada.");
  const permissions = readProjectTechPermissionsForm();
  try{
    await updateDoc(doc(db, "companies", state.companyId), {
      projectTechPermissions: permissions,
      updatedAt: serverTimestamp()
    });
    state.company = { ...(state.company || {}), projectTechPermissions: permissions };
    setAlert(refs.projectTechPermissionsAlert, "Permissoes do tecnico salvas com sucesso.", "success");
  }catch(err){
    console.error("[project-tech-permissions:save]", err);
    setAlert(refs.projectTechPermissionsAlert, err?.message || "Nao foi possivel salvar as permissoes.");
  }
}

function resetProjectTechPermissionsForm(){
  if (!refs.projectTechPermissionsTableBody) return;
  refs.projectTechPermissionsTableBody.querySelectorAll("[data-project-tech-permission-key]").forEach((input) => {
    input.checked = false;
  });
}

function closeActivityNoteSettingsModal(){
  hide(refs.modalActivityNoteSettings);
  clearAlert(refs.activityNoteSettingsAlert);
}

async function openActivityNoteSettingsModal(){
  clearAlert(refs.activityNoteSettingsAlert);
  if (!isCompanyAdmin()){
    alert("Acesso restrito: somente admin da empresa pode configurar regras de apontamento.");
    return;
  }
  if (!state.company && state.companyId) await loadCurrentCompanyBrand();
  if (refs.activityNoteMinCharsInput) {
    refs.activityNoteMinCharsInput.value = String(normalizeActivityNoteMinChars(state.company?.activityNoteMinChars));
  }
  show(refs.modalActivityNoteSettings);
}

async function saveActivityNoteSettings(){
  clearAlert(refs.activityNoteSettingsAlert);
  if (!isCompanyAdmin()) return setAlert(refs.activityNoteSettingsAlert, "Acesso restrito.");
  if (!state.companyId) return setAlert(refs.activityNoteSettingsAlert, "Empresa nao identificada.");
  const raw = refs.activityNoteMinCharsInput?.value ?? "";
  const value = normalizeActivityNoteMinChars(raw);
  if (String(raw).trim() === "" || Number(raw) !== value){
    return setAlert(refs.activityNoteSettingsAlert, "Informe um numero inteiro entre 0 e 1000.");
  }
  try{
    await updateDoc(doc(db, "companies", state.companyId), {
      activityNoteMinChars: value,
      updatedAt: serverTimestamp()
    });
    state.company = { ...(state.company || {}), activityNoteMinChars: value };
    setAlert(refs.activityNoteSettingsAlert, "Regra de apontamento salva com sucesso.", "success");
  }catch(err){
    console.error("[activity-note-settings:save]", err);
    setAlert(refs.activityNoteSettingsAlert, err?.message || "Nao foi possivel salvar a regra de apontamento.");
  }
}

function resetActivityNoteSettingsForm(){
  if (refs.activityNoteMinCharsInput) refs.activityNoteMinCharsInput.value = "50";
}

function closeExpenseObservationSettingsModal(){
  hide(refs.modalExpenseObservationSettings);
  clearAlert(refs.expenseObservationSettingsAlert);
}

async function openExpenseObservationSettingsModal(){
  clearAlert(refs.expenseObservationSettingsAlert);
  if (!isCompanyAdmin()){
    alert("Acesso restrito: somente admin da empresa pode configurar regras de despesas.");
    return;
  }
  if (!state.company && state.companyId) await loadCurrentCompanyBrand();
  if (refs.expenseObservationMinCharsInput) {
    refs.expenseObservationMinCharsInput.value = String(normalizeExpenseObservationMinChars(state.company?.expenseObservationMinChars));
  }
  show(refs.modalExpenseObservationSettings);
}

async function saveExpenseObservationSettings(){
  clearAlert(refs.expenseObservationSettingsAlert);
  if (!isCompanyAdmin()) return setAlert(refs.expenseObservationSettingsAlert, "Acesso restrito.");
  if (!state.companyId) return setAlert(refs.expenseObservationSettingsAlert, "Empresa nao identificada.");
  const raw = refs.expenseObservationMinCharsInput?.value ?? "";
  const value = normalizeExpenseObservationMinChars(raw);
  if (String(raw).trim() === "" || Number(raw) !== value){
    return setAlert(refs.expenseObservationSettingsAlert, "Informe um numero inteiro entre 0 e 1000.");
  }
  try{
    await updateDoc(doc(db, "companies", state.companyId), {
      expenseObservationMinChars: value,
      updatedAt: serverTimestamp()
    });
    state.company = { ...(state.company || {}), expenseObservationMinChars: value };
    setAlert(refs.expenseObservationSettingsAlert, "Regra de despesa salva com sucesso.", "success");
  }catch(err){
    console.error("[expense-observation-settings:save]", err);
    setAlert(refs.expenseObservationSettingsAlert, err?.message || "Nao foi possivel salvar a regra de despesa.");
  }
}

function resetExpenseObservationSettingsForm(){
  if (refs.expenseObservationMinCharsInput) refs.expenseObservationMinCharsInput.value = "10";
}

function closeCompanyBrandModal(){
  hide(refs.modalCompanyBrand);
  clearAlert(refs.companyBrandAlert);
  if (refs.companyBrandLogoFile) refs.companyBrandLogoFile.value = "";
}

async function openCompanyBrandModal(){
  clearAlert(refs.companyBrandAlert);
  if (!isCompanyAdmin()){
    alert("Acesso restrito: somente admin da empresa pode alterar a marca.");
    return;
  }
  if (!state.company && state.companyId) await loadCurrentCompanyBrand();
  const brand = getCompanyBrand(state.company);
  if (refs.companyBrandName) refs.companyBrandName.value = brand.name === DEFAULT_BRAND.name ? (state.company?.name || "") : brand.name;
  if (refs.companyBrandPreviewName) refs.companyBrandPreviewName.textContent = brand.name;
  if (refs.companyBrandPreviewImg) refs.companyBrandPreviewImg.src = brand.logoURL;
  if (refs.companyBrandLogoFile) refs.companyBrandLogoFile.value = "";
  show(refs.modalCompanyBrand);
}

function previewCompanyBrand(){
  const name = (refs.companyBrandName?.value || "").trim() || state.company?.name || DEFAULT_BRAND.name;
  if (refs.companyBrandPreviewName) refs.companyBrandPreviewName.textContent = name;
  const file = refs.companyBrandLogoFile?.files?.[0];
  if (file && refs.companyBrandPreviewImg){
    refs.companyBrandPreviewImg.src = URL.createObjectURL(file);
  } else if (refs.companyBrandPreviewImg){
    refs.companyBrandPreviewImg.src = getCompanyBrand(state.company).logoURL;
  }
}

function buildCompanyLogoReportDataUrl(file){
  return new Promise((resolve) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.onerror = () => resolve("");
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => resolve("");
      image.onload = () => {
        const maxSize = 360;
        const ratio = Math.min(maxSize / image.width, maxSize / image.height, 1);
        const width = Math.max(1, Math.round(image.width * ratio));
        const height = Math.max(1, Math.round(image.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function storeCompanyLogoReportDataUrl(companyId, dataUrl){
  if (!companyId || typeof localStorage === "undefined") return;
  try{
    const key = `fp_company_logo_report_${companyId}`;
    if (dataUrl) localStorage.setItem(key, dataUrl);
    else localStorage.removeItem(key);
  }catch(_){}
}

async function saveCompanyBrand(){
  clearAlert(refs.companyBrandAlert);
  if (!isCompanyAdmin()) return setAlert(refs.companyBrandAlert, "Acesso restrito.");
  if (!state.companyId) return setAlert(refs.companyBrandAlert, "Empresa nao identificada.");

  const displayName = (refs.companyBrandName?.value || "").trim();
  const file = refs.companyBrandLogoFile?.files?.[0] || null;
  if (!displayName) return setAlert(refs.companyBrandAlert, "Informe o nome exibido.");
  if (file && !String(file.type || "").startsWith("image/")) return setAlert(refs.companyBrandAlert, "Selecione uma imagem valida.");
  if (file && file.size > 2 * 1024 * 1024) return setAlert(refs.companyBrandAlert, "A imagem deve ter ate 2MB.");

  try{
    let logoURL = (state.company?.logoURL || "").toString();
    let logoPath = (state.company?.logoPath || "").toString();
    let logoReportDataUrl = (state.company?.logoReportDataUrl || "").toString();
    if (file){
      logoPath = `companyLogos/${state.companyId}/brandLogo`;
      const ref = storageRef(storage, logoPath);
      await uploadBytes(ref, file, { contentType: file.type || "image/png" });
      logoURL = await getDownloadURL(ref);
      logoReportDataUrl = await buildCompanyLogoReportDataUrl(file);
      storeCompanyLogoReportDataUrl(state.companyId, logoReportDataUrl);
    }
    await updateDoc(doc(db, "companies", state.companyId), {
      displayName,
      logoURL,
      logoPath,
      logoReportDataUrl,
      updatedAt: serverTimestamp()
    });
    state.company = { ...(state.company || {}), displayName, logoURL, logoPath, logoReportDataUrl };
    storeCompanyLogoReportDataUrl(state.companyId, logoReportDataUrl);
    renderSidebarBrand(state.company);
    closeCompanyBrandModal();
  }catch(err){
    console.error("[company-brand:save]", err);
    setAlert(refs.companyBrandAlert, err?.message || "Nao foi possivel salvar a marca da empresa.");
  }
}

async function resetCompanyBrand(){
  clearAlert(refs.companyBrandAlert);
  if (!isCompanyAdmin()) return setAlert(refs.companyBrandAlert, "Acesso restrito.");
  if (!state.companyId) return setAlert(refs.companyBrandAlert, "Empresa nao identificada.");
  const displayName = (state.company?.name || DEFAULT_BRAND.name).toString().trim() || DEFAULT_BRAND.name;
  try{
    await updateDoc(doc(db, "companies", state.companyId), {
      displayName,
      logoURL: "",
      logoPath: "",
      logoReportDataUrl: "",
      updatedAt: serverTimestamp()
    });
    storeCompanyLogoReportDataUrl(state.companyId, "");
    state.company = { ...(state.company || {}), displayName, logoURL: "", logoPath: "", logoReportDataUrl: "" };
    renderSidebarBrand(state.company);
    closeCompanyBrandModal();
  }catch(err){
    console.error("[company-brand:reset]", err);
    setAlert(refs.companyBrandAlert, err?.message || "Nao foi possivel restaurar a marca padrao.");
  }
}

function updateAdminSummary(){
  usersDomain.updateAdminSummary(getUsersDeps());
}

/** =========================
 *  9) ADMIN (EMPRESA): USERS - Delegado para users.domain.js
 *  ========================= */
const getUsersDeps = () => ({
  refs, state, db, auth, storage, functions, httpsCallable,
  createUserWithAuthAndResetLink, loadUsers, loadTeams,
  openManagedTeamsModal, ensureTeamsForChips, renderTeamChips, openUserFeedbackModal
});

async function loadUsers(){
  await usersDomain.loadUsers(getUsersDeps());
}

function openCreateUserModal(){
  usersDomain.openCreateUserModal(getUsersDeps());
}

function closeCreateUserModal(){
  usersDomain.closeCreateUserModal(getUsersDeps());
}

async function openUserFeedbackModal(user){
  await managerUsersDomain.openTechFeedbackModal(getManagerUsersDeps(), user);
}

function renderTeamChips(){
  usersDomain.renderTeamChips(getUsersDeps());
}

async function createUser(){
  await usersDomain.createUser(getUsersDeps());
}

/** =========================
 *  9.5) GESTOR: USUÁRIOS (TÉCNICOS) - Delegado para manager-users.domain.js
 *  ========================= */
function getManagerUsersDeps() {
  return {
    refs,
    state,
    db,
    storage,
    auth,
    setView,
    loadTeams,
    loadManagerUsers,
    loadUsers,
    ensureTeamsForChips,
    createUserWithAuthAndResetLink,
    callHttpFunctionWithAuth,
    setAlertWithResetLink,
    closeTechFeedbackModal,
    saveTechFeedback,
    loadUsers
  };
}

function openManagerUsersView() {
  managerUsersDomain.openManagerUsersView(getManagerUsersDeps());
}

async function loadManagerUsers() {
  await managerUsersDomain.loadManagerUsers(getManagerUsersDeps());
}


function getClientsDeps(){
  return {
    db,
    storage,
    auth,
    refs,
    state,
    setView,
    openProjectTab,
    onOnboardingProgressChanged: () => scheduleAdminOnboardingRefresh(900),
  };
}

function openClientsView(){
  clientsDomain.openClientsView(getClientsDeps());
}

async function loadClients(){
  await clientsDomain.loadClients(getClientsDeps());
}

function getReportsDeps(){
  return {
    refs,
    state,
    db,
    auth,
    setView,
    openMyActivitiesView: () => navigateTo(ROUTES.myActivities),
    openProjectsView: () => navigateTo(ROUTES.projects)
  };
}

async function openReportsView(){
  await reportsDomain.openReportsView(getReportsDeps());
}

async function loadReports(opts = {}){
  await reportsDomain.loadReports(getReportsDeps(), opts);
}

function getLgpdDeps(){
  return { refs, state, db, auth };
}

async function openLgpdCenter(){
  await lgpdDomain.openLgpdCenter(getLgpdDeps());
}

function openCreateTechModal() {
  managerUsersDomain.openCreateTechModal(getManagerUsersDeps());
}

function closeCreateTechModal() {
  // limpa upload temporário (se houver) e fecha
  managerUsersDomain.cleanupTechDraftAvatar(getManagerUsersDeps())
    .catch(() => {})
    .finally(() => managerUsersDomain.closeCreateTechModal(refs, state));
}

function closeTechFeedbackModal() {
  managerUsersDomain.closeTechFeedbackModal(refs);
}

async function saveTechFeedback() {
  await managerUsersDomain.saveTechFeedback(getManagerUsersDeps());
}


async function createTech() {
  await managerUsersDomain.createTech(getManagerUsersDeps());
  scheduleAdminOnboardingRefresh(1200);
}

/** =========================
 *  9.6) ADMIN: DEFINIR EQUIPES ADMINISTRADAS (GESTOR) - Delegado para manager-users.domain.js
 *  ========================= */
function openManagedTeamsModal(targetUid, targetName) {
  managerUsersDomain.openManagedTeamsModal(getManagerUsersDeps(), targetUid, targetName);
}

function closeManagedTeamsModal() {
  managerUsersDomain.closeManagedTeamsModal(refs);
}

async function saveManagedTeams() {
  await managerUsersDomain.saveManagedTeams(getManagerUsersDeps());
}

/** =========================
 *  9.7) PROJECTS - Delegado para projects.domain.js
 *  ========================= */
const getProjectsDeps = () => ({
  refs, state, db, auth, storage,
  setView,
  loadProjects, openProjectDetailModal, closeProjectDetailModal,
  openEditProjectModal, closeEditProjectModal, updateProject,
  openCreateProjectModal, closeCreateProjectModal, createProject,
  openProjectWorkspace, openProjectTab,
  onOnboardingProgressChanged: () => scheduleAdminOnboardingRefresh(900)
});

const getMyActivitiesDeps = () => ({
  refs, state, db, auth, storage, setView,
  onOnboardingProgressChanged: () => scheduleAdminOnboardingRefresh(700)
});

const getMyFeedbacksDeps = () => ({
  refs, state, db, auth, setView,
  onOnboardingProgressChanged: () => scheduleAdminOnboardingRefresh(700)
});

const getOsApprovalsDeps = () => ({
  refs, state, db, auth, setView
});

const getExpensesDeps = () => ({
  refs, state, db, storage, auth, setView
});

async function openProjectWorkspace(projectId) {
  await projectWorkspaceDomain.openProjectWorkspace(projectId, getProjectsDeps());
}

async function openProjectTab(projectId) {
  await projectWorkspaceDomain.openProjectTab(projectId, getProjectsDeps());
}

async function openMyProjectsView(options = {}) {
  try{
    await ensureCompanyContext();
  }catch(err){
    console.error("openMyProjectsView: ensureCompanyContext falhou:", err);
    alert("Não foi possível identificar a empresa do usuário. Faça logout e login novamente.");
    return;
  }

  // ✅ IMPORTANTE: passe deps completos (não só um objeto parcial)
  projectWorkspaceDomain.closeProjectWorkspace(getProjectsDeps());
  projectsDomain.openMyProjectsView(getProjectsDeps(), options);
}

async function loadMyProjects() {
  await projectsDomain.loadMyProjects(getProjectsDeps());
}

async function openMyActivitiesView() {
  try{
    await ensureCompanyContext();
  }catch(err){
    console.error("openMyActivitiesView: ensureCompanyContext falhou:", err);
    alert("Nao foi possivel identificar a empresa do usuario. Faca logout e login novamente.");
    return;
  }

  myActivitiesDomain.openMyActivitiesView(getMyActivitiesDeps());
  if (isTechOnboarding()) {
    markTechOnboardingViewed("techActivitiesViewed");
  }
}

async function loadMyActivities() {
  await myActivitiesDomain.loadMyActivities(getMyActivitiesDeps());
}

async function openMyFeedbacksView() {
  try{
    await ensureCompanyContext();
  }catch(err){
    console.error("openMyFeedbacksView: ensureCompanyContext falhou:", err);
    alert("Nao foi possivel identificar a empresa do usuario. Faca logout e login novamente.");
    return;
  }

  myFeedbacksDomain.openMyFeedbacksView(getMyFeedbacksDeps());
  if (isTechOnboarding()) {
    markTechOnboardingViewed("techFeedbacksViewed");
  }
}

async function loadMyFeedbacks() {
  await myFeedbacksDomain.loadMyFeedbacks(getMyFeedbacksDeps());
}

async function openOsApprovalsView() {
  try{
    await ensureCompanyContext();
  }catch(err){
    console.error("openOsApprovalsView: ensureCompanyContext falhou:", err);
    alert("Nao foi possivel identificar a empresa do usuario. Faca logout e login novamente.");
    return;
  }

  osApprovalsDomain.openOsApprovalsView(getOsApprovalsDeps());
}

async function loadOsApprovals() {
  await osApprovalsDomain.loadOsApprovals(getOsApprovalsDeps());
}

async function openExpenseApprovalsView() {
  try{
    await ensureCompanyContext();
  }catch(err){
    console.error("openExpenseApprovalsView: ensureCompanyContext falhou:", err);
    alert("Nao foi possivel identificar a empresa do usuario. Faca logout e login novamente.");
    return;
  }

  expensesDomain.openExpenseApprovalsView(getExpensesDeps());
}

async function loadExpenseApprovals() {
  await expensesDomain.loadExpenseApprovals(getExpensesDeps());
}

function openProjectsView() {
  projectWorkspaceDomain.closeProjectWorkspace(getProjectsDeps());
  projectsDomain.openMyProjectsView(getProjectsDeps(), { onlyMine: false, mode: "all" });
}

async function loadProjects() {
  await projectsDomain.loadProjects(getProjectsDeps());
}

async function openCreateProjectModal() {
  await projectsDomain.openCreateProjectModal(getProjectsDeps());
}

function closeCreateProjectModal() {
  projectsDomain.closeCreateProjectModal(refs);
}

async function createProject() {
  if (_isCreatingProject) return;
  _isCreatingProject = true;

  // feedback imediato + bloqueia double click
  try {
    if (refs.btnCreateProject) {
      refs.btnCreateProject.disabled = true;
      refs.btnCreateProject.dataset.originalText = refs.btnCreateProject.textContent || "";
      refs.btnCreateProject.textContent = "Salvando...";
    }

    await projectsDomain.createProject(getProjectsDeps());
    scheduleAdminOnboardingRefresh(1300);

  } finally {
    _isCreatingProject = false;
    if (refs.btnCreateProject) {
      refs.btnCreateProject.disabled = false;
      const t = refs.btnCreateProject.dataset.originalText;
      if (t) refs.btnCreateProject.textContent = t;
    }
  }
}

async function openProjectDetailModal(projectId) {
  await projectsDomain.openProjectDetailModal(projectId, getProjectsDeps());
}

function closeProjectDetailModal() {
  projectsDomain.closeProjectDetailModal(refs);
}

async function openEditProjectModal(projectId) {
  await projectsDomain.openEditProjectModal(projectId, getProjectsDeps());
}

function closeEditProjectModal() {
  projectsDomain.closeEditProjectModal(refs);
}

async function updateProject() {
  await projectsDomain.updateProject(getProjectsDeps());
}

/** =========================
 *  10) AUTH FLOW
 *  ========================= */
// Inicializa o dropdown do avatar (não depende do login)
initUserMenu();
initNotificationsUi();
if (!_routeUnsubscribe) {
  _routeUnsubscribe = initCleanRouter({ resolve: resolveCleanRoute });
}

onAuthStateChanged(auth, async (user) => {
  clearAlert(refs.loginAlert);
  stopNotificationsListener();
  stopDashboardRemindersListener();

  state.companyId = null;
  state.company = null;
  state.profile = null;
  state.isSuperAdmin = false;

  if (!user){
    _authReadyForRoutes = true;
    const route = getRoutePath();
    if (route !== ROUTES.login) state._intendedRoute = route;
    renderSidebarBrand(null);
    resolveRouteAfterAuth();
    return;
  }

  console.log("🔐 Auth changed - UID:", user.uid, "Email:", user.email);

  try {
    // 1) Super Admin
    const platformUser = await fetchPlatformUser(user.uid);
    console.log("👤 Platform User:", platformUser);
    
    if (platformUser && platformUser.role === "superadmin" && platformUser.active !== false){
      state.isSuperAdmin = true;
      state.profile = platformUser;
      renderSidebarBrand(null);

      syncSidebarForRole();
      renderTopbar(platformUser, user);
      renderDashboardCards(platformUser);
      _authReadyForRoutes = true;
      resolveRouteAfterAuth();
      return;
    }

    // 2) Usuário comum (multi-tenant)
    const companyId = await fetchCompanyIdForUser(user.uid);
    console.log("🏢 Company ID:", companyId);
    
    if (!companyId){
      _authReadyForRoutes = true;
      setBrowserRouteSilently(ROUTES.login);
      setView("login");
      setAlert(refs.loginAlert, "Seu usuário não está vinculado a nenhuma empresa. Peça ao admin para configurar.");
      await signOut(auth);
      return;
    }

    const company = await getCompanyDoc(companyId);
    if (!company || company.active === false){
      _authReadyForRoutes = true;
      setBrowserRouteSilently(ROUTES.login);
      setView("login");
      setAlert(refs.loginAlert, "Empresa bloqueada. Fale com o administrador do FlowProject.");
      await signOut(auth);
      return;
    }

    const profile = await fetchCompanyUserProfile(companyId, user.uid);
    console.log("👔 Profile:", profile);
    
    if (!profile){
      _authReadyForRoutes = true;
      setBrowserRouteSilently(ROUTES.login);
      setView("login");
      setAlert(refs.loginAlert, "Seu perfil não foi encontrado dentro da empresa. Peça ao admin para criar.");
      await signOut(auth);
      return;
    }

    if (profile.active === false){
      _authReadyForRoutes = true;
      setBrowserRouteSilently(ROUTES.login);
      setView("login");
      setAlert(refs.loginAlert, "Usuário bloqueado. Fale com o administrador.");
      await signOut(auth);
      return;
    }

    state.companyId = companyId;
    state.company = company;
    localStorage.setItem("currentCompanyId", companyId);
    state._usersCache = [];
    _dashboardReminderUsers = [];
    _dashboardReminders = [];
    _activeReminderDetailId = "";
    _dashboardAgendaCursor = new Date();
    _dashboardAgendaCursor.setDate(1);

    state.profile = profile;
    renderSidebarBrand(state.company);

    syncSidebarForRole();
    renderTopbar(profile, user);
    startNotificationsListener();
    createMonthlyBirthdayNotification();
    createDailyTechnicalNotifications();
    renderDashboardCards(profile);
    _authReadyForRoutes = true;
    resolveRouteAfterAuth();
    lgpdDomain.ensureLgpdConsent(getLgpdDeps()).catch((err) => console.warn("[lgpd:consent]", err));
  } catch (err) {
    console.error("❌ Erro no fluxo de autenticação:", err);
    _authReadyForRoutes = true;
    setBrowserRouteSilently(ROUTES.login);
    setView("login");
    setAlert(refs.loginAlert, "Erro ao carregar perfil: " + (err?.message || err));
    await signOut(auth);
  }
});

/** =========================
 *  11) EVENTOS
 *  ========================= */
refs.btnCloseCompanyBrand?.addEventListener("click", closeCompanyBrandModal);
refs.btnCancelCompanyBrand?.addEventListener("click", closeCompanyBrandModal);
refs.btnDashboardAgendaPrevMonth?.addEventListener("click", () => shiftDashboardAgendaMonth(-1));
refs.btnDashboardAgendaNextMonth?.addEventListener("click", () => shiftDashboardAgendaMonth(1));
refs.btnOpenReminderComposer?.addEventListener("click", () => {
  openReminderComposer().catch((err) => console.warn("[dashboard-reminders:open]", err));
});
refs.btnCloseReminderComposer?.addEventListener("click", closeReminderComposer);
refs.btnCancelReminderComposer?.addEventListener("click", closeReminderComposer);
refs.btnSaveReminder?.addEventListener("click", () => {
  saveDashboardReminder().catch((err) => {
    console.warn("[dashboard-reminders:save]", err);
    setAlert(refs.reminderComposerAlert, "Nao foi possivel salvar o lembrete.");
  });
});
refs.btnReminderToggleAllUsers?.addEventListener("click", () => {
  const options = Array.from(refs.reminderTargetsList?.querySelectorAll("input[type='checkbox']") || []);
  const shouldSelectAll = options.some((input) => !input.checked);
  options.forEach((input) => { input.checked = shouldSelectAll; });
  updateReminderToggleAllLabel();
  updateReminderRecipientHint();
});
refs.reminderTargetsList?.addEventListener("change", () => {
  updateReminderToggleAllLabel();
  updateReminderRecipientHint();
});
refs.modalReminderComposer?.addEventListener("click", (event) => {
  if (event.target?.matches?.("[data-close-reminder-composer='true']")) closeReminderComposer();
});
refs.dashboardRemindersList?.addEventListener("click", (event) => {
  const deleteButton = event.target?.closest?.("[data-delete-reminder]");
  if (deleteButton) {
    deleteDashboardReminder(deleteButton.getAttribute("data-delete-reminder")).catch((err) => console.warn("[dashboard-reminders:delete]", err));
    return;
  }
  const note = event.target?.closest?.("[data-reminder-id]");
  if (!note) return;
  openReminderDetail(note.getAttribute("data-reminder-id")).catch((err) => console.warn("[dashboard-reminders:detail]", err));
});
refs.dashboardRemindersList?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const note = event.target?.closest?.("[data-reminder-id]");
  if (!note) return;
  event.preventDefault();
  openReminderDetail(note.getAttribute("data-reminder-id")).catch((err) => console.warn("[dashboard-reminders:detail]", err));
});
refs.modalReminderDetail?.addEventListener("click", (event) => {
  if (event.target?.matches?.("[data-close-reminder-detail='true']")) closeReminderDetail();
});
refs.btnCloseReminderDetail?.addEventListener("click", closeReminderDetail);
refs.btnAcknowledgeReminderDetail?.addEventListener("click", closeReminderDetail);
refs.btnDeleteReminderDetail?.addEventListener("click", () => {
  if (!_activeReminderDetailId) return;
  deleteDashboardReminder(_activeReminderDetailId).catch((err) => console.warn("[dashboard-reminders:delete]", err));
});
refs.modalCompanyBrand?.addEventListener("click", (event) => {
  if (event.target?.matches?.("[data-close-company-brand='true']")) closeCompanyBrandModal();
});
refs.btnCloseReportPermissions?.addEventListener("click", closeReportPermissionsModal);
refs.btnCancelReportPermissions?.addEventListener("click", closeReportPermissionsModal);
refs.modalReportPermissions?.addEventListener("click", (event) => {
  if (event.target?.matches?.("[data-close-report-permissions='true']")) closeReportPermissionsModal();
});
refs.btnCloseProjectTechPermissions?.addEventListener("click", closeProjectTechPermissionsModal);
refs.btnCancelProjectTechPermissions?.addEventListener("click", closeProjectTechPermissionsModal);
refs.modalProjectTechPermissions?.addEventListener("click", (event) => {
  if (event.target?.matches?.("[data-close-project-tech-permissions='true']")) closeProjectTechPermissionsModal();
});
refs.btnCloseActivityNoteSettings?.addEventListener("click", closeActivityNoteSettingsModal);
refs.btnCancelActivityNoteSettings?.addEventListener("click", closeActivityNoteSettingsModal);
refs.modalActivityNoteSettings?.addEventListener("click", (event) => {
  if (event.target?.matches?.("[data-close-activity-note-settings='true']")) closeActivityNoteSettingsModal();
});
refs.btnCloseExpenseObservationSettings?.addEventListener("click", closeExpenseObservationSettingsModal);
refs.btnCancelExpenseObservationSettings?.addEventListener("click", closeExpenseObservationSettingsModal);
refs.modalExpenseObservationSettings?.addEventListener("click", (event) => {
  if (event.target?.matches?.("[data-close-expense-observation-settings='true']")) closeExpenseObservationSettingsModal();
});
refs.companyBrandName?.addEventListener("input", previewCompanyBrand);
refs.companyBrandLogoFile?.addEventListener("change", previewCompanyBrand);
refs.btnSaveCompanyBrand?.addEventListener("click", saveCompanyBrand);
refs.btnResetCompanyBrand?.addEventListener("click", resetCompanyBrand);
refs.btnSaveReportPermissions?.addEventListener("click", saveReportPermissions);
refs.btnResetReportPermissions?.addEventListener("click", resetReportPermissionsForm);
refs.btnSaveProjectTechPermissions?.addEventListener("click", saveProjectTechPermissions);
refs.btnResetProjectTechPermissions?.addEventListener("click", resetProjectTechPermissionsForm);
refs.btnSaveActivityNoteSettings?.addEventListener("click", saveActivityNoteSettings);
refs.btnResetActivityNoteSettings?.addEventListener("click", resetActivityNoteSettingsForm);
refs.btnSaveExpenseObservationSettings?.addEventListener("click", saveExpenseObservationSettings);
refs.btnResetExpenseObservationSettings?.addEventListener("click", resetExpenseObservationSettingsForm);

refs.settingsGrid?.addEventListener("click", async (event) => {
  const btn = event.target?.closest?.("[data-settings-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-settings-action");
  if (action === "profile") return openProfileModal();
  if (action === "brand") return openCompanyBrandModal();
  if (action === "reportPermissions") return openReportPermissionsModal();
  if (action === "projectTechPermissions") return openProjectTechPermissionsModal();
  if (action === "activityNoteSettings") return openActivityNoteSettingsModal();
  if (action === "expenseObservationSettings") return openExpenseObservationSettingsModal();
  if (action === "lgpd") return openLgpdCenter();
  if (action === "users") {
    return navigateTo(ROUTES.managerUsers);
  }
  if (action === "clients") {
    return navigateTo(ROUTES.clients);
  }
  if (action === "reports") {
    return navigateTo(ROUTES.reports);
  }
  if (action === "osApprovals") return navigateTo(ROUTES.osApprovals);
  if (action === "expenses") {
    return navigateTo(ROUTES.expenses);
  }
  if (action === "myActivities") return navigateTo(ROUTES.myActivities);
  if (action === "companies") return navigateTo(ROUTES.companies);
});

refs.loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert(refs.loginAlert);

  const email = (refs.emailEl?.value || "").trim();
  const password = refs.passwordEl?.value || "";

  if (!email || !password){
    setAlert(refs.loginAlert, "Preencha e-mail e senha.");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    setAlert(refs.loginAlert, mapAuthError(err));
  }
});

refs.btnForgot?.addEventListener("click", async () => {
  clearAlert(refs.loginAlert);
  const email = (refs.emailEl?.value || "").trim();
  if (!email) return setAlert(refs.loginAlert, "Digite seu e-mail para redefinir a senha.");

  try {
    await sendPasswordResetEmail(auth, email, {
      url: "https://portalprojectflow.com/login",
      handleCodeInApp: false
    });
    setAlert(refs.loginAlert, "Link de redefinição enviado para seu e-mail.", "info");
  } catch (err) {
    setAlert(refs.loginAlert, mapAuthError(err));
  }
});

refs.navLogout?.addEventListener("click", async (e) => {
  e?.preventDefault?.();
  await signOut(auth);
});
// Dashboard navigation
refs.btnBackToDashboard?.addEventListener("click", () => {
  navigateTo(ROUTES.dashboard);
});
refs.btnBackFromAdmin?.addEventListener("click", () => {
  navigateTo(ROUTES.dashboard);
});

// Gestor Users view
refs.btnBackFromManagerUsers?.addEventListener("click", () => {
  navigateTo(ROUTES.dashboard);
});
refs.btnReloadMgrUsers?.addEventListener("click", () => loadManagerUsers());
refs.mgrUserSearch?.addEventListener("input", () => loadManagerUsers());
onOnce(refs.btnClearMgrUserSearch, "click", (e) => {
  try { e?.preventDefault?.(); } catch (_) {}
  if (!refs.mgrUserSearch) return;
  refs.mgrUserSearch.value = "";
  // dispara o mesmo fluxo do input
  loadManagerUsers();
}, "btnClearMgrUserSearch");
refs.mgrTeamFilter?.addEventListener("change", () => loadManagerUsers());

// Feedback do Técnico (modal)
onOnce(refs.btnCloseTechFeedback, "click", (e) => {
  try { e?.preventDefault?.(); e?.stopPropagation?.(); } catch (_) {}
  closeTechFeedbackModal();
}, "btnCloseTechFeedback");

onOnce(refs.btnCancelTechFeedback, "click", (e) => {
  try { e?.preventDefault?.(); e?.stopPropagation?.(); } catch (_) {}
  closeTechFeedbackModal();
}, "btnCancelTechFeedback");

onOnce(refs.btnSaveTechFeedback, "click", async (e) => {
  try { e?.preventDefault?.(); e?.stopPropagation?.(); } catch (_) {}
  await saveTechFeedback();
}, "btnSaveTechFeedback");

// Fecha modal de feedback no ESC
onOnce(document, "keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!refs.modalTechFeedback || refs.modalTechFeedback.hidden) return;
  closeTechFeedbackModal();
}, "escTechFeedback");
onOnce(refs.btnOpenCreateTech, "click", async (e) => {
  // Abre o modal mesmo que loadTeams falhe (não bloqueia o clique)
  try { e?.preventDefault?.(); e?.stopPropagation?.(); } catch (_) {}

  // tenta carregar equipes, mas não impede abrir
  try { Promise.resolve(loadTeams()).catch(() => {}); } catch (_) {}

  // abre modal (padrão do app)
  try { openCreateTechModal(); } catch (err) { console.error("[ui] openCreateTechModal error:", err); }

  // garante visibilidade (remove hidden e garante fora de contêiner hidden)
  const modal = document.getElementById("modalCreateTech");
  if (modal) {
    try {
      // se o modal estiver dentro de algum container hidden, move para o body
      const hiddenParent = modal.parentElement && modal.parentElement.closest && modal.parentElement.closest("[hidden]");
      if (hiddenParent) document.body.appendChild(modal);

      modal.hidden = false;
      modal.removeAttribute("hidden");
      modal.classList.add("open");
      modal.style.display = "flex";
      document.body.classList.add("modal-open");
    } catch (err) {
      console.error("[ui] ensure modal visible error:", err);
    }
  }
}, "btnOpenCreateTech");

// Modal técnico (bind once para evitar duplo submit)
onOnce(refs.btnCloseCreateTech, "click", () => closeCreateTechModal(), "btnCloseCreateTech");
onOnce(refs.btnCancelCreateTech, "click", () => closeCreateTechModal(), "btnCancelCreateTech");
onOnce(refs.btnCreateTech, "click", () => {
  createTech().catch(err => {
    console.error(err);
    setAlert(refs.createTechAlert, "Erro ao salvar: " + (err?.message || err));
  });
}, "btnCreateTech");
onOnce(refs.modalCreateTech, "click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateTechModal();
}, "modalCreateTech_click");

// Modal equipes administradas (bind once)
onOnce(refs.btnCloseManagedTeams, "click", () => closeManagedTeamsModal(), "btnCloseManagedTeams");
onOnce(refs.btnCancelManagedTeams, "click", () => closeManagedTeamsModal(), "btnCancelManagedTeams");
onOnce(refs.btnSaveManagedTeams, "click", () => {
  saveManagedTeams().catch(err => {
    console.error(err);
    setAlert(refs.managedTeamsAlert, "Erro ao salvar: " + (err?.message || err));
  });
}, "btnSaveManagedTeams");
onOnce(refs.modalManagedTeams, "click", (e) => {
  if (e.target?.dataset?.close === "true") closeManagedTeamsModal();
}, "modalManagedTeams_click");

// Companies events
refs.btnReloadCompanies?.addEventListener("click", () => loadCompanies());
refs.companySearch?.addEventListener("input", () => loadCompanies());
refs.btnOpenCreateCompany?.addEventListener("click", () => openCreateCompanyModal());

refs.companyNameEl?.addEventListener("input", () => {
  const slug = slugify(refs.companyNameEl.value);
  if (!refs.companyIdEl.value.trim() || refs.companyIdEl.dataset.auto !== "false"){
    refs.companyIdEl.value = slug;
    refs.companyIdEl.dataset.auto = "true";
  }
});
refs.companyIdEl?.addEventListener("input", () => {
  refs.companyIdEl.dataset.auto = "false";
});

refs.btnCloseCreateCompany?.addEventListener("click", () => closeCreateCompanyModal());
refs.btnCancelCreateCompany?.addEventListener("click", () => closeCreateCompanyModal());
refs.btnCreateCompany?.addEventListener("click", () => {
  createCompany().catch(err => {
    console.error(err);
    setAlert(refs.createCompanyAlert, "Erro ao salvar: " + (err?.message || err));
  });
});

refs.modalCreateCompany?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateCompanyModal();
});

refs.modalCompanyDetail?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCompanyDetailModal();
});
refs.companyUsersSearch?.addEventListener("input", () => companiesDomain.handleCompanyUsersSearch(getDeps()));

// Teams events
refs.btnReloadTeams?.addEventListener("click", () => loadTeams());
refs.teamSearch?.addEventListener("input", () => loadTeams());
onOnce(refs.btnOpenCreateTeam, "click", () => openCreateTeamModal(), "btnOpenCreateTeam");

refs.teamNameEl?.addEventListener("input", () => {
  const slug = slugify(refs.teamNameEl.value);
  if (!refs.teamIdEl.value.trim() || refs.teamIdEl.dataset.auto !== "false"){
    refs.teamIdEl.value = slug;
    refs.teamIdEl.dataset.auto = "true";
  }
});
refs.teamIdEl?.addEventListener("input", () => {
  refs.teamIdEl.dataset.auto = "false";
});

onOnce(refs.btnCloseCreateTeam, "click", () => closeCreateTeamModal(), "btnCloseCreateTeam");
onOnce(refs.btnCancelCreateTeam, "click", () => closeCreateTeamModal(), "btnCancelCreateTeam");
onOnce(refs.btnCreateTeam, "click", () => {
  createTeam().catch(err => {
    console.error(err);
    setAlert(refs.createTeamAlert, "Erro ao salvar: " + (err?.message || err));
  });
}, "btnCreateTeam");

onOnce(refs.modalCreateTeam, "click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateTeamModal();
}, "modalCreateTeam");

// Users events
refs.btnReloadUsers?.addEventListener("click", () => loadUsers());
refs.userSearch?.addEventListener("input", () => loadUsers());
refs.userRoleFilter?.addEventListener("change", () => { loadUsers(); });
onOnce(refs.btnOpenCreateUser, "click", async () => {
  // garante que as equipes estão carregadas antes de abrir
  await loadTeams();
  // Preload clients cache (para seleção no modal de projeto)
  try { await loadClients(); } catch(e) { console.warn("[clients] preload falhou", e); }
  openCreateUserModal();
}, "btnOpenCreateUser");

onOnce(refs.btnCloseCreateUser, "click", () => closeCreateUserModal(), "btnCloseCreateUser");
onOnce(refs.btnCancelCreateUser, "click", () => closeCreateUserModal(), "btnCancelCreateUser");
onOnce(refs.btnCreateUser, "click", () => {
  createUser().catch(err => {
    console.error(err);
    setAlert(refs.createUserAlert, "Erro ao salvar: " + (err?.message || err));
  });
}, "btnCreateUser");

onOnce(refs.modalCreateUser, "click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateUserModal();
}, "modalCreateUser");

refs.btnCloseCompanyDetail?.addEventListener("click", () => closeCompanyDetailModal());

/** =========================
 *  12) ERROS FRIENDLY
 *  ========================= */
function mapAuthError(err){
  const code = err?.code || "";
  if (code.includes("auth/invalid-email")) return "E-mail inválido.";
  if (code.includes("auth/missing-password")) return "Informe a senha.";
  if (code.includes("auth/invalid-credential")) return "E-mail ou senha incorretos.";
  if (code.includes("auth/user-disabled")) return "Usuário desativado.";
  if (code.includes("auth/user-not-found")) return "Usuário não encontrado.";
  if (code.includes("auth/wrong-password")) return "Senha incorreta.";
  if (code.includes("auth/too-many-requests")) return "Muitas tentativas. Tente novamente mais tarde.";
  return "Não foi possível entrar. Tente novamente.";
}
window.__fp = { auth, db, functions };

// Gestor Users view
refs.btnReloadMgrUsers?.addEventListener("click", () => loadManagerUsers());
refs.mgrUserSearch?.addEventListener("input", () => loadManagerUsers());
refs.mgrTeamFilter?.addEventListener("change", () => loadManagerUsers());
onOnce(refs.btnOpenCreateTech, "click", async () => {
  await loadTeams();
  openCreateTechModal();
}, "btnOpenCreateTech");

// Modal técnico (bind once para evitar duplo submit)
onOnce(refs.btnCloseCreateTech, "click", () => closeCreateTechModal(), "btnCloseCreateTech");
onOnce(refs.btnCancelCreateTech, "click", () => closeCreateTechModal(), "btnCancelCreateTech");
onOnce(refs.btnCreateTech, "click", () => {
  createTech().catch(err => {
    console.error(err);
    setAlert(refs.createTechAlert, "Erro ao salvar: " + (err?.message || err));
  });
}, "btnCreateTech");

// Modal equipes administradas (bind once)
onOnce(refs.btnCloseManagedTeams, "click", () => closeManagedTeamsModal(), "btnCloseManagedTeams");
onOnce(refs.btnCancelManagedTeams, "click", () => closeManagedTeamsModal(), "btnCancelManagedTeams");
onOnce(refs.btnSaveManagedTeams, "click", () => {
  saveManagedTeams().catch(err => {
    console.error(err);
    setAlert(refs.managedTeamsAlert, "Erro ao salvar: " + (err?.message || err));
  });
}, "btnSaveManagedTeams");

// Companies events
refs.companySearch?.addEventListener("input", () => loadCompanies());

refs.companyNameEl?.addEventListener("input", () => {
  const slug = slugify(refs.companyNameEl.value);
  if (!refs.companyIdEl.value.trim() || refs.companyIdEl.dataset.auto !== "false"){
    refs.companyIdEl.value = slug;
    refs.companyIdEl.dataset.auto = "true";
  }
});
refs.companyIdEl?.addEventListener("input", () => {
  refs.companyIdEl.dataset.auto = "false";
});

refs.btnCloseCreateCompany?.addEventListener("click", () => closeCreateCompanyModal());
refs.btnCancelCreateCompany?.addEventListener("click", () => closeCreateCompanyModal());
refs.btnCreateCompany?.addEventListener("click", () => {
  createCompany().catch(err => {
    console.error(err);
    setAlert(refs.createCompanyAlert, "Erro ao salvar: " + (err?.message || err));
  });
});


refs.modalCompanyDetail?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCompanyDetailModal();
});

// My Projects (Kanban) events
refs.btnBackFromMyProjects?.addEventListener("click", () => {
  navigateTo(ROUTES.dashboard);
});
refs.btnOpenCreateProjectFromKanban?.addEventListener("click", async () => {
  await loadTeams();
  await loadUsers();
  openCreateProjectModal();
});

// My Activities events
refs.btnBackFromMyActivities?.addEventListener("click", () => {
  navigateTo(ROUTES.dashboard);
});
refs.btnReloadMyActivities?.addEventListener("click", () => loadMyActivities());
refs.myActivitiesSearchInput?.addEventListener("input", () => loadMyActivities());
refs.myActivitiesStartDateInput?.addEventListener("change", () => loadMyActivities());
refs.myActivitiesEndDateInput?.addEventListener("change", () => loadMyActivities());
refs.btnClearMyActivitiesPeriod?.addEventListener("click", () => {
  if (refs.myActivitiesStartDateInput) refs.myActivitiesStartDateInput.value = "";
  if (refs.myActivitiesEndDateInput) refs.myActivitiesEndDateInput.value = "";
  loadMyActivities();
});

// Projects events
refs.btnBackFromProjects?.addEventListener("click", () => {
  navigateTo(ROUTES.dashboard);
});
refs.btnReloadProjects?.addEventListener("click", () => loadProjects());
refs.projectSearch?.addEventListener("input", () => loadProjects());
refs.projectTeamFilter?.addEventListener("change", () => loadProjects());
refs.projectStatusFilter?.addEventListener("change", () => loadProjects());
refs.projectCoordinatorFilter?.addEventListener("change", () => loadProjects());
refs.btnOpenCreateProject?.addEventListener("click", async () => {
  await loadTeams();
  openCreateProjectModal();
});

// Modal criar projeto
refs.btnCloseCreateProject?.addEventListener("click", () => closeCreateProjectModal());
refs.btnCancelCreateProject?.addEventListener("click", () => closeCreateProjectModal());
refs.btnCreateProject?.addEventListener("click", () => {
  createProject().catch(err => {
    console.error(err);
    setAlert(refs.createProjectAlert, "Erro ao salvar: " + (err?.message || err));
  });
});
refs.modalCreateProject?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateProjectModal();
});

// Modal detalhes do projeto
refs.btnCloseProjectDetail?.addEventListener("click", () => closeProjectDetailModal());
refs.btnCancelProjectDetail?.addEventListener("click", () => closeProjectDetailModal());
refs.modalProjectDetail?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeProjectDetailModal();
});

// Modal editar projeto
refs.btnCloseEditProject?.addEventListener("click", () => closeEditProjectModal());
refs.btnCancelEditProject?.addEventListener("click", () => closeEditProjectModal());
refs.btnUpdateProject?.addEventListener("click", () => {
  updateProject().catch(err => {
    console.error(err);
    setAlert(refs.editProjectAlert, "Erro ao salvar: " + (err?.message || err));
  });
});
refs.modalEditProject?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeEditProjectModal();
});

// Teams events
refs.teamSearch?.addEventListener("input", () => loadTeams());

refs.teamNameEl?.addEventListener("input", () => {
  const slug = slugify(refs.teamNameEl.value);
  if (!refs.teamIdEl.value.trim() || refs.teamIdEl.dataset.auto !== "false"){
    refs.teamIdEl.value = slug;
    refs.teamIdEl.dataset.auto = "true";
  }
});
refs.teamIdEl?.addEventListener("input", () => {
  refs.teamIdEl.dataset.auto = "false";
});

onOnce(refs.btnCloseCreateTeam, "click", () => closeCreateTeamModal(), "btnCloseCreateTeam");
onOnce(refs.btnCancelCreateTeam, "click", () => closeCreateTeamModal(), "btnCancelCreateTeam");
onOnce(refs.btnCreateTeam, "click", () => {
  createTeam().catch(err => {
    console.error(err);
    setAlert(refs.createTeamAlert, "Erro ao salvar: " + (err?.message || err));
  });
}, "btnCreateTeam");

// Team Details modal events
refs.btnCloseTeamDetails?.addEventListener("click", () => {
  if (refs.modalTeamDetails) refs.modalTeamDetails.hidden = true;
});
refs.btnCancelTeamDetails?.addEventListener("click", () => {
  if (refs.modalTeamDetails) refs.modalTeamDetails.hidden = true;
});
refs.modalTeamDetails?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") {
    refs.modalTeamDetails.hidden = true;
  }
});

// Add Users to Team modal events
refs.btnAddUsersToTeam?.addEventListener("click", () => {
  const teamId = state.currentTeamId;
  const teamName = refs.teamDetailsName?.value || "equipe";
  teamsDomain.openAddUsersToTeamModal(teamId, teamName, getTeamsDeps());
});

refs.btnCloseAddUsersToTeam?.addEventListener("click", () => {
  teamsDomain.closeAddUsersToTeamModal(refs);
});
refs.btnCancelAddUsersToTeam?.addEventListener("click", () => {
  teamsDomain.closeAddUsersToTeamModal(refs);
});
refs.btnSaveAddUsersToTeam?.addEventListener("click", () => {
  teamsDomain.saveAddUsersToTeam(getTeamsDeps()).catch(err => {
    console.error(err);
  });
});
refs.modalAddUsersToTeam?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") {
    teamsDomain.closeAddUsersToTeamModal(refs);
  }
});

// Users events
refs.userSearch?.addEventListener("input", () => loadUsers());
refs.userRoleFilter?.addEventListener("change", () => { loadUsers(); });

onOnce(refs.btnCloseCreateUser, "click", () => closeCreateUserModal(), "btnCloseCreateUser");
onOnce(refs.btnCancelCreateUser, "click", () => closeCreateUserModal(), "btnCancelCreateUser");
onOnce(refs.btnCreateUser, "click", () => {
  createUser().catch(err => {
    console.error(err);
    setAlert(refs.createUserAlert, "Erro ao salvar: " + (err?.message || err));
  });
}, "btnCreateUser");


// Edit User Teams modal events
refs.btnCloseEditUserTeams?.addEventListener("click", () => {
  refs.modalEditUserTeams.hidden = true;
});
refs.btnCancelEditUserTeams?.addEventListener("click", () => {
  refs.modalEditUserTeams.hidden = true;
});
refs.btnSaveEditUserTeams?.addEventListener("click", () => {
  usersDomain.saveEditUserTeams(getUsersDeps()).catch(err => {
    console.error(err);
  });
});
refs.modalEditUserTeams?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") {
    refs.modalEditUserTeams.hidden = true;
  }
});

refs.btnCloseCompanyDetail?.addEventListener("click", () => closeCompanyDetailModal());

function bindCleanRouteNavGuards(){
  const bind = (el, route) => {
    if (!el || el.__fp_clean_route_guard) return;
    el.__fp_clean_route_guard = true;
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      navigateTo(route);
    }, true);
  };

  bind(refs.navHome, ROUTES.dashboard);
  bind(refs.navReports, ROUTES.reports);
  bind(refs.navFeedbacks, ROUTES.feedbacks);
  bind(refs.navExpenses, ROUTES.expenses);
  bind(refs.navAddTech, ROUTES.managerUsers);
  bind(refs.navClients, ROUTES.clients);
  bind(refs.navConfig, ROUTES.settings);
}

// Sidebar + tooltips
try{ initSidebar(); }catch(e){ console.warn("initSidebar falhou", e); }
try{ bindCleanRouteNavGuards(); }catch(e){ console.warn("bindCleanRouteNavGuards falhou", e); }
try{ initHelpManual({ refs, state }); }catch(e){ console.warn("initHelpManual falhou", e); }
try{ lgpdDomain.initLgpd(getLgpdDeps()); }catch(e){ console.warn("initLgpd falhou", e); }












