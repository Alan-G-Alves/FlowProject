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
import { setView } from "./src/ui/router.js?v=1776052722";
import { isEmailValidBasic, isCnpjValidBasic } from "./src/utils/validators.js";
import { fetchPlatformUser, fetchCompanyIdForUser, fetchCompanyUserProfile } from "./src/services/firestore.service.js";
import { auth, secondaryAuth, db, storage, functions, httpsCallable } from "./src/config/firebase.js";
import { normalizePhone, normalizeCnpj, slugify } from "./src/utils/format.js";
import { setAlert, clearAlert, clearInlineAlert, showInlineAlert } from "./src/ui/alerts.js";
import { getCompanyDoc, listCompaniesDocs } from "./src/services/companies.service.js";
import { createNotification } from "./src/services/notifications.service.js?v=1776052722";
import * as refs from "./src/ui/refs.js?v=1776052724";
import * as companiesDomain from "./src/domain/companies.domain.js?v=1770332251";
import * as teamsDomain from "./src/domain/teams.domain.js?v=1772614200";
import * as usersDomain from "./src/domain/users.domain.js?v=1777055918";
import * as managerUsersDomain from "./src/domain/manager-users.domain.js?v=1777055918";
import * as clientsDomain from "./src/domain/clients.domain.js?v=1776052720";
import * as projectsDomain from "./src/domain/projects.domain.js?v=1772626200";
import * as myActivitiesDomain from "./src/domain/my-activities.domain.js?v=1776052722";
import * as myFeedbacksDomain from "./src/domain/my-feedbacks.domain.js?v=1776040900";
import * as osApprovalsDomain from "./src/domain/os-approvals.domain.js?v=1776052722";
import * as projectWorkspaceDomain from "./src/domain/project-workspace.domain.js?v=1776052722";
import * as reportsDomain from "./src/domain/reports.domain.js?v=1776052700";
import * as profileModal from "./src/ui/modals/profile.modal.js?v=1770332251";
import * as topbar from "./src/ui/topbar.js?v=1770332251";
import * as sidebar from "./src/ui/sidebar.js?v=1770332251";
import * as dashboard from "./src/ui/dashboard.js?v=1770332251";
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
  const items = [refs.navHome, refs.navAddTech, refs.navClients, refs.navReports, refs.navFeedbacks, refs.navConfig].filter(Boolean);
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
  const sidebarSep = document.querySelector(".sidebar-nav .sidebar-sep");

  document.body.classList.toggle("is-superadmin", isSuperAdmin);
  if (refs.navAddTech) refs.navAddTech.hidden = hideTechMenu;
  if (refs.navClients) refs.navClients.hidden = hideClientsMenu;
  if (refs.navFeedbacks) refs.navFeedbacks.hidden = hideFeedbacksMenu;
  if (refs.navAddTech) refs.navAddTech.style.display = hideTechMenu ? "none" : "";
  if (refs.navClients) refs.navClients.style.display = hideClientsMenu ? "none" : "";
  if (refs.navFeedbacks) refs.navFeedbacks.style.display = hideFeedbacksMenu ? "none" : "";
  if (sidebarSep) sidebarSep.hidden = false;

  if (isSuperAdmin) {
    setActiveNav("navHome");
  }
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
      scope: "Usuarios",
      title: "Tecnicos e equipes",
      desc: "Gerencie tecnicos, gestores, coordenadores, skills e vinculos de equipe.",
      action: "users",
      actionLabel: "Abrir tecnicos"
    }));
    cards.push(settingsCard({
      scope: "Clientes",
      title: "Cadastro de clientes",
      desc: "Mantenha clientes, key users e contatos atualizados.",
      action: "clients",
      actionLabel: "Abrir clientes"
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
    loadDashboardAgenda().catch((err) => console.warn("[dashboard-agenda]", err));
  });
  refs.navReports?.addEventListener("click", () => {
    setActiveNav("navReports");
    openReportsView();
  });
  refs.navFeedbacks?.addEventListener("click", () => {
    setActiveNav("navFeedbacks");
    openMyFeedbacksView();
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
  show(refs.btnAvatar);

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

  if (type === "os_submitted") {
    openOsApprovalsView();
    return;
  }
  if (type === "os_approved" || type === "os_reverted" || type === "daily_today" || type === "daily_overdue") {
    openMyActivitiesView();
    return;
  }
  if (type === "feedback_received") {
    openMyFeedbacksView();
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

function renderDashboardCards(profile){
  if (!refs.dashCards) return;
  refs.dashCards.innerHTML = "";

  const cards = [];
  const role = (profile?.role || "").toString().toLowerCase();
  const canSeeOwnProjectsSplit = ["gestor", "admin", "coordenador"].includes(role);
  const canApproveOs = ["gestor", "admin", "coordenador"].includes(role);

  if (state.isSuperAdmin){
    cards.push({
      title: "Empresas",
      desc: "Gerencie as empresas cadastradas no FlowProject.",
      badge: "Master",
      action: () => openCompaniesView()
    });

    
} else {
    if (canSeeOwnProjectsSplit) {
      cards.push({
        title: "Projetos",
        desc: "Visualize todos os projetos da empresa.",
        badge: "Carteira",
        action: () => openProjectsView()
      });
      cards.push({
        title: "Meus Projetos",
        desc: "Visualize apenas os projetos criados por voce.",
        badge: "Kanban",
        action: () => openMyProjectsView({ onlyMine: true })
      });
    } else {
      cards.push({
        title: "Meus Projetos",
        desc: "Visualize seus projetos em formato Kanban.",
        badge: "Kanban",
        action: () => openMyProjectsView()
      });
    }

    if (role === "tecnico") {
      cards.push({
        title: "Minhas Atividades",
        desc: "Veja suas atividades por tarefa, faca apontamentos e envie para aprovacao.",
        badge: "Tecnico",
        action: () => openMyActivitiesView()
      });
    }

    if (canApproveOs) {
      cards.push({
        title: "OS para Aprovar",
        desc: "Revise apontamentos enviados, aprove individualmente ou em massa e faca estornos quando necessario.",
        badge: "Operacao",
        action: () => openOsApprovalsView()
      });
    }

    if (false && role === "gestor") {
      cards.push({
        title: "Usuários (Técnicos)",
        desc: "Cadastre técnicos e vincule às equipes que você administra.",
        badge: "Gestor",
        action: () => openManagerUsersView()
      });
    }

    if (role === "admin"){
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

  loadDashboardAgenda().catch((err) => {
    console.warn("[dashboard-agenda]", err);
  });
}

function getMonthKey(date){
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getDateKeyLocal(date){
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function renderDashboardCalendar(dateCountMap, currentDate = new Date()){
  if (!refs.dashboardCalendar) return;

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthLabel = currentDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay.getDay();
  const todayKey = getDateKeyLocal(new Date());
  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

  if (refs.dashboardAgendaMonth) {
    refs.dashboardAgendaMonth.textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
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
    const classes = [
      "dashboard-calendar-day",
      key === todayKey ? "is-today" : "",
      count > 0 ? "has-activity" : ""
    ].filter(Boolean).join(" ");

    cells.push(`
      <div class="${classes}">
        <span class="dashboard-calendar-number">${escapeHtml(String(day))}</span>
        ${count > 0 ? `<span class="dashboard-calendar-count">${escapeHtml(String(count))} atividade${count > 1 ? "s" : ""}</span>` : ""}
      </div>
    `);
  }

  const remainder = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < remainder; i += 1) {
    cells.push('<div class="dashboard-calendar-day is-muted" aria-hidden="true"></div>');
  }

  refs.dashboardCalendar.innerHTML = cells.join("");
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
    renderDashboardCalendar(new Map());
    if (refs.dashboardAgendaSubtitle) refs.dashboardAgendaSubtitle.textContent = "Entre para visualizar suas atividades do mes atual.";
    return;
  }

  const now = new Date();
  const monthKey = getMonthKey(now);
  const activitiesSnap = await getDocs(query(
    collection(db, "companies", state.companyId, "activities"),
    where("techUids", "array-contains", uid)
  ));

  const counts = new Map();
  activitiesSnap.docs.forEach((docSnap) => {
    const activity = docSnap.data() || {};
    const workDate = String(activity.workDate || "").slice(0, 10);
    if (!workDate || !workDate.startsWith(monthKey)) return;
    counts.set(workDate, (counts.get(workDate) || 0) + 1);
  });

  const total = Array.from(counts.values()).reduce((acc, count) => acc + count, 0);
  if (refs.dashboardAgendaSubtitle) {
    refs.dashboardAgendaSubtitle.textContent = total
      ? `${total} atividade(s) planejada(s) para voce neste mes.`
      : "Nenhuma atividade planejada para voce neste mes.";
  }
  renderDashboardCalendar(counts, now);
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
  await companiesDomain.loadCompanies({ refs, openCompanyDetailModal });
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
  };
}

function openClientsView(){
  clientsDomain.openClientsView(getClientsDeps());
}

async function loadClients(){
  await clientsDomain.loadClients(getClientsDeps());
}

async function openReportsView(){
  await reportsDomain.openReportsView({ refs, state, db, setView, openMyActivitiesView, openProjectsView });
}

async function loadReports(opts = {}){
  await reportsDomain.loadReports({ refs, state, db, setView, openMyActivitiesView, openProjectsView }, opts);
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
  openProjectWorkspace, openProjectTab
});

const getMyActivitiesDeps = () => ({
  refs, state, db, auth, setView
});

const getMyFeedbacksDeps = () => ({
  refs, state, db, auth, setView
});

const getOsApprovalsDeps = () => ({
  refs, state, db, auth, setView
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

onAuthStateChanged(auth, async (user) => {
  clearAlert(refs.loginAlert);
  stopNotificationsListener();

  state.companyId = null;
  state.company = null;
  state.profile = null;
  state.isSuperAdmin = false;

  if (!user){
    renderSidebarBrand(null);
    setView("login");
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
      setView("dashboard");
      return;
    }

    // 2) Usuário comum (multi-tenant)
    const companyId = await fetchCompanyIdForUser(user.uid);
    console.log("🏢 Company ID:", companyId);
    
    if (!companyId){
      setView("login");
      setAlert(refs.loginAlert, "Seu usuário não está vinculado a nenhuma empresa. Peça ao admin para configurar.");
      await signOut(auth);
      return;
    }

    const profile = await fetchCompanyUserProfile(companyId, user.uid);
    console.log("👔 Profile:", profile);
    
    if (!profile){
      setView("login");
      setAlert(refs.loginAlert, "Seu perfil não foi encontrado dentro da empresa. Peça ao admin para criar.");
      await signOut(auth);
      return;
    }

    if (profile.active === false){
      setView("login");
      setAlert(refs.loginAlert, "Usuário bloqueado. Fale com o administrador.");
      await signOut(auth);
      return;
    }

    state.companyId = companyId;
    localStorage.setItem("currentCompanyId", companyId);

    state.profile = profile;
    await loadCurrentCompanyBrand();

    syncSidebarForRole();
    renderTopbar(profile, user);
    startNotificationsListener();
    createDailyTechnicalNotifications();
    renderDashboardCards(profile);
    setView("dashboard");
  } catch (err) {
    console.error("❌ Erro no fluxo de autenticação:", err);
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
refs.modalCompanyBrand?.addEventListener("click", (event) => {
  if (event.target?.matches?.("[data-close-company-brand='true']")) closeCompanyBrandModal();
});
refs.companyBrandName?.addEventListener("input", previewCompanyBrand);
refs.companyBrandLogoFile?.addEventListener("change", previewCompanyBrand);
refs.btnSaveCompanyBrand?.addEventListener("click", saveCompanyBrand);
refs.btnResetCompanyBrand?.addEventListener("click", resetCompanyBrand);

refs.settingsGrid?.addEventListener("click", async (event) => {
  const btn = event.target?.closest?.("[data-settings-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-settings-action");
  if (action === "profile") return openProfileModal();
  if (action === "brand") return openCompanyBrandModal();
  if (action === "users") {
    setActiveNav("navAddTech");
    return openManagerUsersView();
  }
  if (action === "clients") {
    setActiveNav("navClients");
    return openClientsView();
  }
  if (action === "reports") {
    setActiveNav("navReports");
    return openReportsView();
  }
  if (action === "osApprovals") return openOsApprovalsView();
  if (action === "myActivities") return openMyActivitiesView();
  if (action === "companies") return openCompaniesView();
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
    await sendPasswordResetEmail(auth, email);
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
  setView("dashboard");
  loadDashboardAgenda().catch((err) => console.warn("[dashboard-agenda]", err));
});
refs.btnBackFromAdmin?.addEventListener("click", () => {
  setView("dashboard");
  loadDashboardAgenda().catch((err) => console.warn("[dashboard-agenda]", err));
});

// Gestor Users view
refs.btnBackFromManagerUsers?.addEventListener("click", () => {
  setView("dashboard");
  loadDashboardAgenda().catch((err) => console.warn("[dashboard-agenda]", err));
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
  setView("dashboard");
  loadDashboardAgenda().catch((err) => console.warn("[dashboard-agenda]", err));
});
refs.btnOpenCreateProjectFromKanban?.addEventListener("click", async () => {
  await loadTeams();
  await loadUsers();
  openCreateProjectModal();
});

// My Activities events
refs.btnBackFromMyActivities?.addEventListener("click", () => {
  setView("dashboard");
  loadDashboardAgenda().catch((err) => console.warn("[dashboard-agenda]", err));
});
refs.btnReloadMyActivities?.addEventListener("click", () => loadMyActivities());
refs.myActivitiesSearchInput?.addEventListener("input", () => loadMyActivities());

// Projects events
refs.btnBackFromProjects?.addEventListener("click", () => {
  setView("dashboard");
  loadDashboardAgenda().catch((err) => console.warn("[dashboard-agenda]", err));
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

// Sidebar + tooltips
try{ initSidebar(); }catch(e){ console.warn("initSidebar falhou", e); }












