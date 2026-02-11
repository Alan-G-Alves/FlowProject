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
import { setView } from "./src/ui/router.js";
import { isEmailValidBasic, isCnpjValidBasic } from "./src/utils/validators.js";
import { fetchPlatformUser, fetchCompanyIdForUser, fetchCompanyUserProfile } from "./src/services/firestore.service.js";
import { auth, secondaryAuth, db, storage, functions, httpsCallable } from "./src/config/firebase.js";
import { normalizePhone, normalizeCnpj, slugify } from "./src/utils/format.js";
import { setAlert, clearAlert, clearInlineAlert, showInlineAlert } from "./src/ui/alerts.js";
import { listCompaniesDocs } from "./src/services/companies.service.js";
import * as refs from "./src/ui/refs.js?v=1770332251";
import * as companiesDomain from "./src/domain/companies.domain.js?v=1770332251";
import * as teamsDomain from "./src/domain/teams.domain.js?v=1770332251";
import * as usersDomain from "./src/domain/users.domain.js?v=1770332251";
import * as managerUsersDomain from "./src/domain/manager-users.domain.js?v=1770332251";
import * as projectsDomain from "./src/domain/projects.domain.js?v=1770332251";
import * as profileModal from "./src/ui/modals/profile.modal.js?v=1770332251";
import * as topbar from "./src/ui/topbar.js?v=1770332251";
import * as sidebar from "./src/ui/sidebar.js?v=1770332251";
import * as dashboard from "./src/ui/dashboard.js?v=1770332251";
import { intersects, getTeamNameById, initialFromName } from "./src/utils/helpers.js?v=1770332251";
/** =========================
 *  1) CONFIG FIREBASE
 *  ========================= */

const fnCreateUserInTenant = httpsCallable(functions, "createUserInTenant");
const fnCreateCompanyWithAdmin = httpsCallable(functions, "createCompanyWithAdmin") /* (mantido, mas usamos HTTP no createCompany) */;

async function createUserWithAuthAndResetLink(payload){
  // Cria usuário no Firebase Authentication sem deslogar o Admin/Gestor
  const email = (payload?.email || "").trim().toLowerCase();
  if (!email) throw new Error("E-mail inválido.");

  // senha temporária (usuário redefine via e-mail)
  const tempPass =
    "Fp@" +
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 6).toUpperCase() +
    "9";

  const cred = await createUserWithEmailAndPassword(secondaryAuth, email, tempPass);

  // dispara e-mail de redefinição de senha (primeiro acesso)
  try{
    await sendPasswordResetEmail(secondaryAuth, email);
  }catch(err){
    console.warn("Não consegui disparar reset de senha automaticamente:", err);
  }

  return { uid: cred.user.uid };
}
/** =========================
 *  2) ESTADO
 *  ========================= */
const state = {
  companyId: null,
  profile: null,
  isSuperAdmin: false,
  teams: [],          // cache de equipes
  selectedTeamIds: [], // usado no modal usuário
  mgrSelectedTeamIds: [],
  managedTeamsTargetUid: null,
  managedTeamsSelected: [],
  _usersCache: []
};

/** =========================
 *  3) ELEMENTOS UI (importados de refs.js)
 *  ========================= */
// Todas as referências DOM foram movidas para ./src/ui/refs.js
// Acesse via refs.nomeDoElemento (ex: refs.viewLogin, refs.btnAvatar)

let currentCompanyDetailId = null;

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
  const items = [refs.navHome, refs.navAddProject, refs.navAddTech, refs.navReports, refs.navConfig].filter(Boolean);
  for (const el of items){
    const isActive = el.id === activeId;
    el.classList.toggle("active", isActive);
  }
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
  });
  refs.navReports?.addEventListener("click", () => {
    setActiveNav("navReports");
    alert("Em breve: Relatórios e indicadores");
  });
  refs.navAddProject?.addEventListener("click", async () => {
    try {
      setActiveNav("navAddProject");
      // Carregar equipes e usuários antes de abrir o modal
      await loadTeams();
      await loadUsers();
      openCreateProjectModal();
    } catch (err) {
      console.error("Erro ao abrir modal de projeto:", err);
      alert("Erro ao abrir modal de projeto: " + (err?.message || err));
    }
  });
  refs.navMyProjects?.addEventListener("click", async () => {
  setActiveNav("navMyProjects");
  await openMyProjectsView();
});
  refs.navAddTech?.addEventListener("click", () => {
    setActiveNav("navAddTech");
    // para gestor, já existe tela de técnicos
    if (state.profile?.role === "gestor") setView("managerUsers");
    else alert("Acesso restrito: somente Gestor");
  });
  refs.navConfig?.addEventListener("click", () => {
    setActiveNav("navConfig");
    alert("Em breve: Configurações");
  });
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

    const ext = (file.type || "").includes("png") ? "png" : "jpg";
    const path = `avatars/${user.uid}.${ext}`;
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
  loadUsers, loadManagerUsers, renderTeamChips, getNextTeamId
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

/** =========================
 *  9) ADMIN (EMPRESA): USERS - Delegado para users.domain.js
 *  ========================= */
const getUsersDeps = () => ({
  refs, state, db, auth, functions, httpsCallable,
  createUserWithAuthAndResetLink, loadUsers, loadTeams,
  openManagedTeamsModal, ensureTeamsForChips, renderTeamChips
});

async function loadUsers(){
  await usersDomain.loadUsers(getUsersDeps());
}

function openCreateUserModal(){
  usersDomain.openCreateUserModal(getUsersDeps());
}

function closeCreateUserModal(){
  usersDomain.closeCreateUserModal(refs);
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
    setView,
    loadTeams,
    loadManagerUsers,
    ensureTeamsForChips,
    createUserWithAuthAndResetLink,
    setAlertWithResetLink,
    loadUsers
  };
}

function openManagerUsersView() {
  managerUsersDomain.openManagerUsersView(getManagerUsersDeps());
}

async function loadManagerUsers() {
  await managerUsersDomain.loadManagerUsers(getManagerUsersDeps());
}

function openCreateTechModal() {
  managerUsersDomain.openCreateTechModal(getManagerUsersDeps());
}

function closeCreateTechModal() {
  managerUsersDomain.closeCreateTechModal(refs);
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
  refs, state, db, auth,
  loadProjects, openProjectDetailModal, closeProjectDetailModal,
  openEditProjectModal, closeEditProjectModal, updateProject,
  openCreateProjectModal, closeCreateProjectModal, createProject
});

async function openMyProjectsView() {
  try{
    await ensureCompanyContext();
  }catch(err){
    console.error("openMyProjectsView: ensureCompanyContext falhou:", err);
    alert("Não foi possível identificar a empresa do usuário. Faça logout e login novamente.");
    return;
  }

  // ✅ IMPORTANTE: passe deps completos (não só um objeto parcial)
  projectsDomain.openMyProjectsView(getProjectsDeps());
}

async function loadMyProjects() {
  await projectsDomain.loadMyProjects(getProjectsDeps());
}

function openProjectsView() {
  projectsDomain.openProjectsView({ loadProjects });
}

async function loadProjects() {
  await projectsDomain.loadProjects(getProjectsDeps());
}

function openCreateProjectModal() {
  projectsDomain.openCreateProjectModal(getProjectsDeps());
}

function closeCreateProjectModal() {
  projectsDomain.closeCreateProjectModal(refs);
}

async function createProject() {
  await projectsDomain.createProject(getProjectsDeps());
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

onAuthStateChanged(auth, async (user) => {
  clearAlert(refs.loginAlert);

  state.companyId = null;
  state.profile = null;
  state.isSuperAdmin = false;

  if (!user){
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

    renderTopbar(profile, user);
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
refs.btnBackToDashboard?.addEventListener("click", () => setView("dashboard"));
refs.btnBackFromAdmin?.addEventListener("click", () => setView("dashboard"));

// Gestor Users view
refs.btnBackFromManagerUsers?.addEventListener("click", () => setView("dashboard"));
refs.btnReloadMgrUsers?.addEventListener("click", () => loadManagerUsers());
refs.mgrUserSearch?.addEventListener("input", () => loadManagerUsers());
refs.mgrTeamFilter?.addEventListener("change", () => loadManagerUsers());
refs.btnOpenCreateTech?.addEventListener("click", async () => {
  await loadTeams();
  openCreateTechModal();
});

// Modal técnico
refs.btnCloseCreateTech?.addEventListener("click", () => closeCreateTechModal());
refs.btnCancelCreateTech?.addEventListener("click", () => closeCreateTechModal());
refs.btnCreateTech?.addEventListener("click", () => {
  createTech().catch(err => {
    console.error(err);
    setAlert(refs.createTechAlert, "Erro ao salvar: " + (err?.message || err));
  });
});
refs.modalCreateTech?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateTechModal();
});

// Modal equipes administradas
refs.btnCloseManagedTeams?.addEventListener("click", () => closeManagedTeamsModal());
refs.btnCancelManagedTeams?.addEventListener("click", () => closeManagedTeamsModal());
refs.btnSaveManagedTeams?.addEventListener("click", () => {
  saveManagedTeams().catch(err => {
    console.error(err);
    setAlert(refs.managedTeamsAlert, "Erro ao salvar: " + (err?.message || err));
  });
});
refs.modalManagedTeams?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeManagedTeamsModal();
});

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

// Teams events
refs.btnReloadTeams?.addEventListener("click", () => loadTeams());
refs.teamSearch?.addEventListener("input", () => loadTeams());
refs.btnOpenCreateTeam?.addEventListener("click", () => openCreateTeamModal());

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

refs.btnCloseCreateTeam?.addEventListener("click", () => closeCreateTeamModal());
refs.btnCancelCreateTeam?.addEventListener("click", () => closeCreateTeamModal());
refs.btnCreateTeam?.addEventListener("click", () => {
  createTeam().catch(err => {
    console.error(err);
    setAlert(refs.createTeamAlert, "Erro ao salvar: " + (err?.message || err));
  });
});

refs.modalCreateTeam?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateTeamModal();
});

// Users events
refs.btnReloadUsers?.addEventListener("click", () => loadUsers());
refs.userSearch?.addEventListener("input", () => loadUsers());
refs.userRoleFilter?.addEventListener("change", () => { loadUsers(); });
refs.btnOpenCreateUser?.addEventListener("click", async () => {
  // garante que as equipes estão carregadas antes de abrir
  await loadTeams();
  openCreateUserModal();
});

refs.btnCloseCreateUser?.addEventListener("click", () => closeCreateUserModal());
refs.btnCancelCreateUser?.addEventListener("click", () => closeCreateUserModal());
refs.btnCreateUser?.addEventListener("click", () => {
  createUser().catch(err => {
    console.error(err);
    setAlert(refs.createUserAlert, "Erro ao salvar: " + (err?.message || err));
  });
});

refs.modalCreateUser?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateUserModal();
});

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

// Sidebar + tooltips
try{ initSidebar(); }catch(e){ console.warn("initSidebar falhou", e); }

// Dashboard navigation
refs.btnBackToDashboard?.addEventListener("click", () => setView("dashboard"));
refs.btnBackFromAdmin?.addEventListener("click", () => setView("dashboard"));

// Gestor Users view
refs.btnBackFromManagerUsers?.addEventListener("click", () => setView("dashboard"));
refs.btnReloadMgrUsers?.addEventListener("click", () => loadManagerUsers());
refs.mgrUserSearch?.addEventListener("input", () => loadManagerUsers());
refs.mgrTeamFilter?.addEventListener("change", () => loadManagerUsers());
refs.btnOpenCreateTech?.addEventListener("click", async () => {
  await loadTeams();
  openCreateTechModal();
});

// Modal técnico
refs.btnCloseCreateTech?.addEventListener("click", () => closeCreateTechModal());
refs.btnCancelCreateTech?.addEventListener("click", () => closeCreateTechModal());
refs.btnCreateTech?.addEventListener("click", () => {
  createTech().catch(err => {
    console.error(err);
    setAlert(refs.createTechAlert, "Erro ao salvar: " + (err?.message || err));
  });
});
refs.modalCreateTech?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateTechModal();
});

// Modal equipes administradas
refs.btnCloseManagedTeams?.addEventListener("click", () => closeManagedTeamsModal());
refs.btnCancelManagedTeams?.addEventListener("click", () => closeManagedTeamsModal());
refs.btnSaveManagedTeams?.addEventListener("click", () => {
  saveManagedTeams().catch(err => {
    console.error(err);
    setAlert(refs.managedTeamsAlert, "Erro ao salvar: " + (err?.message || err));
  });
});
refs.modalManagedTeams?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeManagedTeamsModal();
});

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

// My Projects (Kanban) events
refs.btnBackFromMyProjects?.addEventListener("click", () => setView("dashboard"));
refs.btnOpenCreateProjectFromKanban?.addEventListener("click", async () => {
  await loadTeams();
  await loadUsers();
  openCreateProjectModal();
});

// Projects events
refs.btnBackFromProjects?.addEventListener("click", () => setView("dashboard"));
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
refs.btnReloadTeams?.addEventListener("click", () => loadTeams());
refs.teamSearch?.addEventListener("input", () => loadTeams());
refs.btnOpenCreateTeam?.addEventListener("click", () => openCreateTeamModal());

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

refs.btnCloseCreateTeam?.addEventListener("click", () => closeCreateTeamModal());
refs.btnCancelCreateTeam?.addEventListener("click", () => closeCreateTeamModal());
refs.btnCreateTeam?.addEventListener("click", () => {
  createTeam().catch(err => {
    console.error(err);
    setAlert(refs.createTeamAlert, "Erro ao salvar: " + (err?.message || err));
  });
});

refs.modalCreateTeam?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateTeamModal();
});

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
refs.btnReloadUsers?.addEventListener("click", () => loadUsers());
refs.userSearch?.addEventListener("input", () => loadUsers());
refs.userRoleFilter?.addEventListener("change", () => { loadUsers(); });
refs.btnOpenCreateUser?.addEventListener("click", async () => {
  await loadTeams();
  openCreateUserModal();
});

refs.btnCloseCreateUser?.addEventListener("click", () => closeCreateUserModal());
refs.btnCancelCreateUser?.addEventListener("click", () => closeCreateUserModal());
refs.btnCreateUser?.addEventListener("click", () => {
  createUser().catch(err => {
    console.error(err);
    setAlert(refs.createUserAlert, "Erro ao salvar: " + (err?.message || err));
  });
});

refs.modalCreateUser?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateUserModal();
});

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
