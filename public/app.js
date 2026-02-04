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
import { setView, initHashRouter, ROUTES, navigateTo } from "./src/ui/router.js";
import { isEmailValidBasic, isCnpjValidBasic } from "./src/utils/validators.js";
import { fetchPlatformUser, fetchCompanyIdForUser, fetchCompanyUserProfile } from "./src/services/firestore.service.js";
import { auth, secondaryAuth, db, storage, functions, httpsCallable } from "./src/config/firebase.js";
import { normalizePhone, normalizeCnpj, slugify } from "./src/utils/format.js";
import { setAlert, clearAlert, clearInlineAlert, showInlineAlert } from "./src/ui/alerts.js";
import { listCompaniesDocs } from "./src/services/companies.service.js";
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
 *  3) ELEMENTOS UI
 *  ========================= */
const viewLogin = document.getElementById("viewLogin");
const viewDashboard = document.getElementById("viewDashboard");
const viewAdmin = document.getElementById("viewAdmin");
const viewCompanies = document.getElementById("viewCompanies");
const viewManagerUsers = document.getElementById("viewManagerUsers");

// Layout (sidebar)
const sidebar = document.getElementById("sidebar");
const btnToggleSidebar = document.getElementById("btnToggleSidebar");
const navHome = document.getElementById("navHome");
const navAddProject = document.getElementById("navAddProject");
const navAddTech = document.getElementById("navAddTech");
const navReports = document.getElementById("navReports");
const navConfig = document.getElementById("navConfig");

// Login
const loginForm = document.getElementById("loginForm");
const emailEl = document.getElementById("email");
const passwordEl = document.getElementById("password");
const btnForgot = document.getElementById("btnForgot");
const loginAlert = document.getElementById("loginAlert");

// Topbar
// Compat: alguns arquivos antigos usavam id "btnAvatar".
const btnAvatar = document.getElementById("btnAvatar") || document.getElementById("avatarBtn");
const userAvatar = document.getElementById("userAvatar");
const userAvatarImg = document.getElementById("userAvatarImg");
const userAvatarFallback = document.getElementById("userAvatarFallback");
const userMenu = document.getElementById("userMenu");
const avatarDropdown = document.getElementById("avatarDropdown");
const btnEditProfile = document.getElementById("btnEditProfile");
const btnUserLogout = document.getElementById("btnUserLogout");
const navLogout = document.getElementById("navLogout");

// Perfil (modal)
const profileModal = document.getElementById("profileModal");
const btnCloseProfile = document.getElementById("btnCloseProfile");
const btnCancelProfile = document.getElementById("btnCancelProfile");
const btnSaveProfile = document.getElementById("btnSaveProfile");
const profileAlert = document.getElementById("profileAlert");

const profilePhotoPreview = document.getElementById("profilePhotoPreview");
const profilePhotoImg = document.getElementById("profilePhotoImg");
const profilePhotoFallback = document.getElementById("profilePhotoFallback");
const profilePhotoFile = document.getElementById("profilePhotoFile");
const profilePhotoUrl = document.getElementById("profilePhotoUrl");
const btnProfileRemovePhoto = document.getElementById("btnProfileRemovePhoto");

const profileName = document.getElementById("profileName");
const profilePhone = document.getElementById("profilePhone");
const profileEmail = document.getElementById("profileEmail");

// Dashboard
const dashTitle = document.getElementById("dashTitle");
const dashSubtitle = document.getElementById("dashSubtitle");
const chipTeam = document.getElementById("chipTeam");
const chipEmail = document.getElementById("chipEmail");
const dashCards = document.getElementById("dashCards");

// Companies (Master)
const companiesGrid = document.getElementById("companiesGrid");
const companiesEmpty = document.getElementById("companiesEmpty");
const companySearch = document.getElementById("companySearch");
const btnReloadCompanies = document.getElementById("btnReloadCompanies");
const btnBackToDashboard = document.getElementById("btnBackToDashboard");
const btnOpenCreateCompany = document.getElementById("btnOpenCreateCompany");

// Company Detail (Master)
const modalCompanyDetail = document.getElementById("modalCompanyDetail");
const btnCloseCompanyDetail = document.getElementById("btnCloseCompanyDetail");
const companyDetailTitle = document.getElementById("companyDetailTitle");
const companyDetailMeta = document.getElementById("companyDetailMeta");
const companyDetailStatus = document.getElementById("companyDetailStatus");
const btnToggleCompanyBlock = document.getElementById("btnToggleCompanyBlock");
const companyUsersTbody = document.getElementById("companyUsersTbody");
const companyUsersEmpty = document.getElementById("companyUsersEmpty");
const companyUsersAlert = document.getElementById("companyUsersAlert");

let currentCompanyDetailId = null;

const modalCreateCompany = document.getElementById("modalCreateCompany");
const btnCloseCreateCompany = document.getElementById("btnCloseCreateCompany");
const btnCancelCreateCompany = document.getElementById("btnCancelCreateCompany");
const btnCreateCompany = document.getElementById("btnCreateCompany");


const companyNameEl = document.getElementById("companyName");
const companyCnpjEl = document.getElementById("companyCnpj");
const companyIdEl = document.getElementById("companyId");
const adminNameEl = document.getElementById("adminName");
const adminEmailEl = document.getElementById("adminEmail");
const adminPhoneEl = document.getElementById("adminPhone");
const adminActiveEl = document.getElementById("adminActive");
const createCompanyAlert = document.getElementById("createCompanyAlert");
const createCompanySuccess = document.getElementById("createCompanySuccess");

// Admin (Empresa)
const btnBackFromAdmin = document.getElementById("btnBackFromAdmin");

// Teams
const teamsGrid = document.getElementById("teamsGrid");
const teamsEmpty = document.getElementById("teamsEmpty");
const teamSearch = document.getElementById("teamSearch");
const btnReloadTeams = document.getElementById("btnReloadTeams");
const btnOpenCreateTeam = document.getElementById("btnOpenCreateTeam");

const modalCreateTeam = document.getElementById("modalCreateTeam");
const btnCloseCreateTeam = document.getElementById("btnCloseCreateTeam");
const btnCancelCreateTeam = document.getElementById("btnCancelCreateTeam");
const btnCreateTeam = document.getElementById("btnCreateTeam");
const teamNameEl = document.getElementById("teamName");
const teamIdEl = document.getElementById("teamId");
const createTeamAlert = document.getElementById("createTeamAlert");
// Team Details
const modalTeamDetails = document.getElementById("modalTeamDetails");
const btnCloseTeamDetails = document.getElementById("btnCloseTeamDetails");
const btnCancelTeamDetails = document.getElementById("btnCancelTeamDetails");
const teamDetailsNameEl = document.getElementById("teamDetailsName");
const teamDetailsIdEl = document.getElementById("teamDetailsId");
const teamDetailsStatusEl = document.getElementById("teamDetailsStatus");
const teamDetailsUsersEl = document.getElementById("teamDetailsUsers");
const teamDetailsEmptyEl = document.getElementById("teamDetailsEmpty");
const teamDetailsAlert = document.getElementById("teamDetailsAlert");
const btnTeamToggleActive = document.getElementById("btnTeamToggleActive");
const btnTeamDelete = document.getElementById("btnTeamDelete");

// Users
const usersTbody = document.getElementById("usersTbody");
const usersEmpty = document.getElementById("usersEmpty");
const userSearch = document.getElementById("userSearch");
const userRoleFilter = document.getElementById("userRoleFilter");
const btnReloadUsers = document.getElementById("btnReloadUsers");
const btnOpenCreateUser = document.getElementById("btnOpenCreateUser");

const modalCreateUser = document.getElementById("modalCreateUser");
const btnCloseCreateUser = document.getElementById("btnCloseCreateUser");
const btnCancelCreateUser = document.getElementById("btnCancelCreateUser");
const btnCreateUser = document.getElementById("btnCreateUser");
const newUserUidEl = document.getElementById("newUserUid");
const newUserNameEl = document.getElementById("newUserName");
const newUserRoleEl = document.getElementById("newUserRole");
const newUserEmailEl = document.getElementById("newUserEmail");
const newUserPhoneEl = document.getElementById("newUserPhone");
const newUserActiveEl = document.getElementById("newUserActive");
const teamChipsEl = document.getElementById("teamChips");
const createUserAlert = document.getElementById("createUserAlert");

// Gestor - Usuários (Técnicos)
const btnBackFromManagerUsers = document.getElementById("btnBackFromManagerUsers");
const btnOpenCreateTech = document.getElementById("btnOpenCreateTech");
const mgrUserSearch = document.getElementById("mgrUserSearch");
const mgrTeamFilter = document.getElementById("mgrTeamFilter");
const btnReloadMgrUsers = document.getElementById("btnReloadMgrUsers");
const mgrUsersTbody = document.getElementById("mgrUsersTbody");
const mgrUsersEmpty = document.getElementById("mgrUsersEmpty");

// Modal criar técnico (Gestor)
const modalCreateTech = document.getElementById("modalCreateTech");
const btnCloseCreateTech = document.getElementById("btnCloseCreateTech");
const btnCancelCreateTech = document.getElementById("btnCancelCreateTech");
const btnCreateTech = document.getElementById("btnCreateTech");
const techUidEl = document.getElementById("techUid");
const techNameEl = document.getElementById("techName");
const techEmailEl = document.getElementById("techEmail");
const techPhoneEl = document.getElementById("techPhone");
const techActiveEl = document.getElementById("techActive");
const mgrTeamChipsEl = document.getElementById("mgrTeamChips");
const createTechAlert = document.getElementById("createTechAlert");

// Modal equipes administradas (Admin da empresa)
const modalManagedTeams = document.getElementById("modalManagedTeams");
const managedTeamsSubtitle = document.getElementById("managedTeamsSubtitle");
const managedTeamsChips = document.getElementById("managedTeamsChips");
const managedTeamsAlert = document.getElementById("managedTeamsAlert");
const btnCloseManagedTeams = document.getElementById("btnCloseManagedTeams");
const btnCancelManagedTeams = document.getElementById("btnCancelManagedTeams");
const btnSaveManagedTeams = document.getElementById("btnSaveManagedTeams");

/** =========================
 *  4) HELPERS
 *  ========================= */



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

function intersects(a = [], b = []) {
  const setB = new Set(b || []);
  return (a || []).some(x => setB.has(x));
}

function setActiveNav(activeId){
  const items = [navHome, navAddProject, navAddTech, navReports, navConfig].filter(Boolean);
  for (const el of items){
    const isActive = el.id === activeId;
    el.classList.toggle("active", isActive);
  }
}

function initSidebar(){
  if (!sidebar) return;

  // estado persistido (padrão: recolhido)
  const saved = localStorage.getItem("fp.sidebar.expanded");
  if (saved === "1") sidebar.classList.add("expanded");

  const toggle = () => {
    sidebar.classList.toggle("expanded");
    localStorage.setItem("fp.sidebar.expanded", sidebar.classList.contains("expanded") ? "1" : "0");
  };

  // Remove o hambúrguer: expansão por clique em qualquer área "vazia" da barra
  sidebar.addEventListener("click", (e) => {
    // se clicou em um item do menu, NÃO alterna (deixa só navegar)
    if (e.target?.closest?.(".nav-item")) return;
    toggle();
  });

  // (se existir por algum motivo no HTML antigo, ainda funciona)
  btnToggleSidebar?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });

  // Ações (por enquanto: navegação de views existentes)
  navHome?.addEventListener("click", () => navigateTo(ROUTES.dashboard));
navReports?.addEventListener("click", () => {
    setActiveNav("navReports");
    alert("Em breve: Relatórios e indicadores");
  });
  navAddProject?.addEventListener("click", () => {
    setActiveNav("navAddProject");
    alert("Em breve: Adicionar projeto");
  });
  navAddTech?.addEventListener("click", () => {
    const role = state.profile?.role || "";
    if (["gestor","coordenador"].includes(role)) navigateTo(ROUTES.managerUsers);
    else navigateTo(ROUTES.dashboard);
  });
navConfig?.addEventListener("click", () => {
    if (state.isSuperAdmin) return navigateTo(ROUTES.companies);
    const role = state.profile?.role || "";
    if (role === "admin") return navigateTo(ROUTES.admin);
    navigateTo(ROUTES.dashboard);
  });
}

function getTeamNameById(teamId){
  const t = (state.teams || []).find(x => x.id === teamId);
  return t ? (t.name || t.id) : teamId;
}

function initialFromName(name){
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] || "U";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] || "") : "";
  return (a + b).toUpperCase();
}

/** =========================
 *  6) DASHBOARD
 *  ========================= */
function renderTopbar(profile, user){
  // Topbar minimal: apenas avatar no canto direito
  show(btnAvatar);

  // Avatar: tenta foto (perfil -> auth), senão usa iniciais
  const photoUrl = profile?.photoURL || user?.photoURL || "";

  // OBS: no CSS o .avatar-img começa com display:none; aqui controlamos via display
  if (photoUrl && userAvatarImg){
    // Cache-bust leve (evita manter imagem antiga após trocar foto)
    const bust = photoUrl.includes("?") ? "&t=" : "?t=";
    userAvatarImg.src = photoUrl + bust + Date.now();

    userAvatarImg.hidden = false;
    userAvatarImg.style.display = "block";

    if (userAvatarFallback){
      userAvatarFallback.hidden = true;
      userAvatarFallback.style.display = "none";
    }
  }else{
    if (userAvatarImg){
      userAvatarImg.hidden = true;
      userAvatarImg.style.display = "none";
      userAvatarImg.removeAttribute("src");
    }

    const label = (profile?.name || user?.displayName || user?.email || "Usuário").trim();
    const initials = label.split(/\s+/).slice(0,2).map(p => (p[0] || "").toUpperCase()).join("") || "U";
    if (userAvatarFallback){
      userAvatarFallback.textContent = initials;
      userAvatarFallback.hidden = false;
      userAvatarFallback.style.display = "grid";
    }
  }
}

/** =========================
 *  TOPBAR: MENU DO USUÁRIO
 *  ========================= */
function initUserMenu(){
  // Estrutura vem do index.html (userMenu/avatarBtn/avatarDropdown)
  if (!btnAvatar || !avatarDropdown) return;

  const closeDropdown = () => {
    avatarDropdown.classList.remove("open");
    btnAvatar.setAttribute("aria-expanded", "false");
  };

  const toggleDropdown = () => {
    const isOpen = avatarDropdown.classList.contains("open");
    if (isOpen) closeDropdown();
    else {
      avatarDropdown.classList.add("open");
      btnAvatar.setAttribute("aria-expanded", "true");
    }
  };

  // Toggle ao clicar no avatar
  btnAvatar.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDropdown();
  });

  // Fecha ao clicar fora
  document.addEventListener("click", (e) => {
    if (!avatarDropdown.classList.contains("open")) return;
    const target = e.target;
    if (userMenu && userMenu.contains(target)) return;
    closeDropdown();
  });

  // Fecha no ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDropdown();
  });

  // Ações do menu
  btnEditProfile?.addEventListener("click", (e) => {
    e.preventDefault();
    closeDropdown();
    openProfileModal();
  });

  btnUserLogout?.addEventListener("click", async (e) => {
    e.preventDefault();
    closeDropdown();
    await signOut(auth);
  });
}

/** =========================
 *  PERFIL: MODAL (EDITAR PERFIL)
 *  ========================= */
function openProfileModal(){
  if (!profileModal) return;
  clearAlert(profileAlert);

  const user = auth.currentUser;
  const p = state.profile || {};

  // Preenche campos
  if (profileName) profileName.value = (p.name || user?.displayName || "").trim();
  if (profilePhone) profilePhone.value = (p.phone || "").trim();
  if (profileEmail) profileEmail.value = (user?.email || "").trim();

  const url = (p.photoURL || user?.photoURL || "").trim();
  if (profilePhotoUrl) profilePhotoUrl.value = url;
  renderProfilePhotoPreview(url);

  profileModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeProfileModal(){
  if (!profileModal) return;
  profileModal.hidden = true;
  document.body.classList.remove("modal-open");
  if (profilePhotoFile) profilePhotoFile.value = "";
}

function renderProfilePhotoPreview(url){
  const user = auth.currentUser;
  const label = ((profileName?.value || state.profile?.name || user?.displayName || user?.email || "Usuário").trim());
  const initials = label.split(/\s+/).slice(0,2).map(p => (p[0] || "").toUpperCase()).join("") || "U";

  const finalUrl = (url || "").trim();
  if (finalUrl){
    if (profilePhotoImg){
      profilePhotoImg.src = finalUrl;
      profilePhotoImg.style.display = "block";
    }
    if (profilePhotoFallback){
      profilePhotoFallback.textContent = initials;
      profilePhotoFallback.style.display = "none";
    }
  } else {
    if (profilePhotoImg) profilePhotoImg.style.display = "none";
    if (profilePhotoFallback){
      profilePhotoFallback.textContent = initials;
      profilePhotoFallback.style.display = "block";
    }
  }
}

async function saveProfile(){
  clearAlert(profileAlert);
  const user = auth.currentUser;
  if (!user) return;

  const name = (profileName?.value || "").trim();
  const phone = (profilePhone?.value || "").trim();
  const photoURL = (profilePhotoUrl?.value || "").trim();

  if (!name){
    setAlert(profileAlert, "Informe seu nome.");
    return;
  }

  setAlert(profileAlert, "Salvando...", "info");

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

    setAlert(profileAlert, "Perfil atualizado!", "success");
    setTimeout(closeProfileModal, 400);
  } catch (err){
    console.error("saveProfile error", err);
    setAlert(profileAlert, "Não foi possível salvar. Verifique permissões no Firestore rules.");
  }
}

// Listeners do modal (se existir na página)
btnCloseProfile?.addEventListener("click", closeProfileModal);
btnCancelProfile?.addEventListener("click", closeProfileModal);

profileModal?.addEventListener("click", (e) => {
  const target = e.target;
  if (target && target.getAttribute && target.getAttribute("data-close") === "profile"){
    closeProfileModal();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && profileModal && !profileModal.hidden) closeProfileModal();
});

btnSaveProfile?.addEventListener("click", saveProfile);

profilePhotoUrl?.addEventListener("input", () => {
  renderProfilePhotoPreview(profilePhotoUrl.value);
});

btnProfileRemovePhoto?.addEventListener("click", () => {
  if (profilePhotoUrl) profilePhotoUrl.value = "";
  renderProfilePhotoPreview("");
});

profilePhotoFile?.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  // Regras básicas (evita upload gigante)
  const maxMb = 2; // recomendado: 1–2MB
  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (!allowed.includes((file.type || "").toLowerCase())){
    setAlert(profileAlert, "Formato inválido. Use PNG ou JPG.");
    e.target.value = "";
    return;
  }
  if (file.size > maxMb * 1024 * 1024){
    setAlert(profileAlert, `A imagem é muito grande (máx. ${maxMb}MB).`);
    e.target.value = "";
    return;
  }

  // Upload para Firebase Storage e grava a URL no input
  try{
    setAlert(profileAlert, "Enviando foto...", "info");
    const user = auth.currentUser;
    if (!user) throw new Error("not-auth");

    const ext = (file.type || "").includes("png") ? "png" : "jpg";
    const path = `avatars/${user.uid}.${ext}`;
    const ref = storageRef(storage, path);

    await uploadBytes(ref, file, { contentType: file.type || "image/jpeg" });
    const url = await getDownloadURL(ref);

    if (profilePhotoUrl) profilePhotoUrl.value = url;
    renderProfilePhotoPreview(url);
    clearAlert(profileAlert);
  }catch(err){
    console.error("upload avatar error", err);
    setAlert(profileAlert, "Não foi possível enviar a foto. Verifique as regras do Storage.");
  }finally{
    // permite reenviar o mesmo arquivo se quiser
    e.target.value = "";
  }
});

function renderDashboardCards(profile){
  if (!dashCards) return;
  dashCards.innerHTML = "";

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
    dashCards.appendChild(el);
  }
}

/** =========================
 *  7) COMPANIES (MASTER)
 *  ========================= */
function openCompaniesView(){
  if (window.location.hash !== ROUTES.companies){ navigateTo(ROUTES.companies); return; }
  setView("companies");
  loadCompanies().catch(err => {
    console.error(err);
    alert("Erro ao carregar empresas: " + (err?.message || err));
  });
}

async function loadCompanies(){
  if (!companiesGrid) return;
  companiesGrid.innerHTML = "";
  hide(companiesEmpty);

  // Agora usa o service modular
  const all = await listCompaniesDocs();

  const qtxt = (companySearch?.value || "").toLowerCase().trim();
  const filtered = !qtxt ? all : all.filter(c =>
    (c.name || "").toLowerCase().includes(qtxt) ||
    (c.cnpj || "").toLowerCase().includes(qtxt) ||
    (c.id || "").toLowerCase().includes(qtxt)
  );

  if (filtered.length === 0){
    show(companiesEmpty);
    return;
  }

  for (const c of filtered.sort((a,b) => (a.name||"").localeCompare(b.name||""))){
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <h3 class="title">${c.name || c.id}</h3>
      <p class="desc">CNPJ: <b>${c.cnpj || "-"}</b></p>
      <div class="meta">
        <span class="badge">ID: ${c.id}</span>
        <span class="badge">${c.active === false ? "Inativa" : "Ativa"}</span>
      </div>
    `;
    el.style.cursor = "pointer";
    el.addEventListener("click", () => openCompanyDetailModal(c.id));
    companiesGrid.appendChild(el);
  }
}



function clearCompanyCreateSuccess(){
  const el = document.getElementById("createCompanySuccess");
  if (!el) return;
  el.hidden = true;
  el.innerHTML = "";
}


function showCompanyCreateSuccess({ adminEmail, uid, resetLink } = {}){
  const el = document.getElementById("createCompanySuccess");
  if (!el) return;

  const email = (adminEmail || "").trim();
  const safeEmail = (typeof escapeHtml === "function") ? escapeHtml(email) : email;

  let html = `<div><strong>Empresa criada com sucesso ✅</strong></div>`;
  if (safeEmail) html += `<div style="margin-top:6px">Admin: <strong>${safeEmail}</strong></div>`;

  // Se sua Cloud Function retornar um link de reset/senha, mostramos aqui
  if (resetLink){
    const safeLink = (typeof escapeHtml === "function") ? escapeHtml(resetLink) : resetLink;
    html += `<div style="margin-top:6px"><a href="${safeLink}" target="_blank" rel="noopener">Definir senha do Admin</a></div>`;
  } else if (uid){
    const safeUid = (typeof escapeHtml === "function") ? escapeHtml(uid) : uid;
    html += `<div style="margin-top:6px; opacity:.8">UID do Admin: ${safeUid}</div>`;
  }

  el.hidden = false;
  el.innerHTML = html;
}



function closeCreateCompanyModal(){ if (modalCreateCompany) modalCreateCompany.hidden = true; }


function closeCompanyDetailModal(){
  if (!modalCompanyDetail) return;
  modalCompanyDetail.hidden = true;
  currentCompanyDetailId = null;
  if (companyUsersTbody) companyUsersTbody.innerHTML = "";
}



function openCreateCompanyModal(){
  if (!state.isSuperAdmin) return;
  if (!modalCreateCompany) return;

  clearAlert(createCompanyAlert);
  clearCompanyCreateSuccess();

  if (companyNameEl) companyNameEl.value = "";
  if (companyCnpjEl) companyCnpjEl.value = "";
  if (companyIdEl) companyIdEl.value = "";
  if (adminNameEl) adminNameEl.value = "";
  if (adminEmailEl) adminEmailEl.value = "";
  if (adminPhoneEl) adminPhoneEl.value = "";
  if (adminActiveEl) adminActiveEl.value = "true";

  modalCreateCompany.hidden = false;
}

async function openCompanyDetailModal(companyId){
  if (!state.isSuperAdmin) return;
  if (!modalCompanyDetail) return;

  clearInlineAlert(companyUsersAlert);
  if (companyUsersTbody) companyUsersTbody.innerHTML = "";
  if (companyUsersEmpty) companyUsersEmpty.hidden = true;

  modalCompanyDetail.hidden = false;
  currentCompanyDetailId = companyId;
  await loadCompanyDetail(companyId);
}




async function loadCompanyDetail(companyId){
  if (!state.isSuperAdmin) return;

  try{
    const cRef = doc(db, "companies", companyId);
    const cSnap = await getDoc(cRef);
    if (!cSnap.exists()){
      showInlineAlert(companyUsersAlert, "Empresa não encontrada.", "error");
      return;
    }
    const cData = cSnap.data();
    const active = cData.active === true;

    if (companyDetailTitle) companyDetailTitle.textContent = cData.name || companyId;
    if (companyDetailMeta) companyDetailMeta.textContent = `CNPJ: ${cData.cnpj || "-"} • ID: ${companyId}`;
    if (companyDetailStatus){
      companyDetailStatus.textContent = active ? "ATIVA" : "BLOQUEADA";
      companyDetailStatus.className = `badge ${active ? "badge-success" : "badge-danger"}`;
    }
    if (btnToggleCompanyBlock){
      btnToggleCompanyBlock.textContent = active ? "Bloquear empresa" : "Desbloquear empresa";
      btnToggleCompanyBlock.className = active ? "btn btn-danger" : "btn btn-secondary";
      btnToggleCompanyBlock.onclick = () => toggleCompanyBlock(companyId, active);
    }

    const uCol = collection(db, "companies", companyId, "users");
    const uSnap = await getDocs(uCol);
    const users = [];
    uSnap.forEach(d => users.push({ id: d.id, ...d.data() }));
    users.sort((a,b) => (a.name||"").localeCompare(b.name||""));

    renderCompanyUsersTable(companyId, users);
  }catch(err){
    console.error("Erro ao carregar detalhes da empresa:", err);
    showInlineAlert(companyUsersAlert, "Erro ao carregar detalhes da empresa.", "error");
  }
}

function renderCompanyUsersTable(companyId, users){
  if (!companyUsersTbody) return;
  companyUsersTbody.innerHTML = "";

  if (!users || users.length === 0){
    if (companyUsersEmpty) companyUsersEmpty.hidden = false;
    return;
  }
  if (companyUsersEmpty) companyUsersEmpty.hidden = true;

  for (const u of users){
    const active = u.active === true;
    const role = u.role || "tecnico";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="cell-main">${escapeHtml(u.name || "(sem nome)")}</div>
        <div class="cell-sub">${escapeHtml(u.id)}</div>
      </td>
      <td>${escapeHtml(u.email || "-")}</td>
      <td>${escapeHtml(u.phone || "-")}</td>
      <td>
        <select class="input small js-role">
          ${["admin","gestor","coordenador","tecnico"].map(r => `<option value="${r}" ${r===role?"selected":""}>${r}</option>`).join("")}
        </select>
      </td>
      <td>
        <span class="badge ${active ? "badge-success" : "badge-danger"}">${active ? "ATIVO" : "BLOQUEADO"}</span>
      </td>
      <td class="actions">
        <button class="btn btn-ghost js-toggle">${active ? "Bloquear" : "Desbloquear"}</button>
        <button class="btn btn-ghost js-save">Salvar perfil</button>
      </td>
    `;

    const btnToggle = tr.querySelector(".js-toggle");
    const selRole = tr.querySelector(".js-role");
    const btnSave = tr.querySelector(".js-save");

    btnToggle.addEventListener("click", async (e) => {
      e.preventDefault();
      await setCompanyUserActive(companyId, u.id, !active);
      await loadCompanyDetail(companyId);
    });

    btnSave.addEventListener("click", async (e) => {
      e.preventDefault();
      const newRole = selRole.value;
      await setCompanyUserRole(companyId, u.id, newRole);
      await loadCompanyDetail(companyId);
    });

    companyUsersTbody.appendChild(tr);
  }

  // Empty state
  if (companyUsersEmpty){
    companyUsersEmpty.style.display = users.length ? "none" : "block";
  }
}

async function setCompanyUserActive(companyId, uid, active){
  if (!state.isSuperAdmin) return;
  try{
    const uRef = doc(db, "companies", companyId, "users", uid);
    await updateDoc(uRef, { active: !!active });
  }catch(err){
    console.error("Erro ao atualizar usuário:", err);
    showInlineAlert(companyUsersAlert, "Não foi possível atualizar o usuário.", "error");
  }
}

async function setCompanyUserRole(companyId, uid, role){
  if (!state.isSuperAdmin) return;
  try{
    if (!["admin","gestor","coordenador","tecnico"].includes(role)) return;
    const uRef = doc(db, "companies", companyId, "users", uid);
    await updateDoc(uRef, { role });
  }catch(err){
    console.error("Erro ao trocar perfil:", err);
    showInlineAlert(companyUsersAlert, "Não foi possível trocar o perfil.", "error");
  }
}

async function toggleCompanyBlock(companyId, currentlyActive){
  if (!state.isSuperAdmin) return;
  try{
    const cRef = doc(db, "companies", companyId);

    if (currentlyActive){
      const uCol = collection(db, "companies", companyId, "users");
      const uSnap = await getDocs(query(uCol));
      const batch = writeBatch(db);
      batch.update(cRef, { active: false });

      uSnap.forEach(d => {
        batch.update(d.ref, { active: false });
      });

      await batch.commit();
      showInlineAlert(companyUsersAlert, "Empresa bloqueada e usuários bloqueados.", "success");
    }else{
      await updateDoc(cRef, { active: true });
      showInlineAlert(companyUsersAlert, "Empresa desbloqueada. (Usuários permanecem com o status atual.)", "success");
    }

    await loadCompanyDetail(companyId);
    if (typeof loadCompanies === "function") loadCompanies();
  }catch(err){
    console.error("Erro ao bloquear/desbloquear empresa:", err);
    showInlineAlert(companyUsersAlert, "Não foi possível alterar o status da empresa.", "error");
  }
}

async function createCompany(){
  clearAlert(createCompanyAlert);

  try{
    if (!auth.currentUser){
      return setAlert(createCompanyAlert, "Você precisa estar logado como Admin Master.");
    }

    // força refresh do token para reduzir chance de 401 por token velho
    await auth.currentUser.getIdToken(true);

    const companyId = (companyIdEl?.value || "").trim();
    const companyName = (companyNameEl?.value || "").trim();
    const cnpj = (companyCnpjEl?.value || "").trim();

    const adminName = (adminNameEl?.value || "").trim();
    const adminEmail = (adminEmailEl?.value || "").trim();
    const adminPhone = (adminPhoneEl?.value || "").trim();
    const adminActive = (adminActiveEl?.value || "true") === "true";

    if (!companyId) return setAlert(createCompanyAlert, "Informe o ID da empresa (slug).");
    if (!companyName) return setAlert(createCompanyAlert, "Informe o nome da empresa.");
    if (!cnpj || !isCnpjValidBasic(cnpj)) return setAlert(createCompanyAlert, "Informe um CNPJ válido (14 dígitos).");
    if (!adminName) return setAlert(createCompanyAlert, "Informe o nome do Admin da empresa.");
    if (!adminEmail || !isEmailValidBasic(adminEmail)) return setAlert(createCompanyAlert, "Informe um e-mail válido para o Admin.");

    setAlert(createCompanyAlert, "Criando empresa e Admin...", "info");

// Payload no formato esperado pela Function (admin aninhado)
const payload = {
  companyId,
  companyName,
  cnpj: normalizeCnpj(cnpj),
  admin: {
    name: adminName,
    email: adminEmail,
    phone: normalizePhone(adminPhone),
    active: adminActive
  }
};

// Chama endpoint HTTP (robusto no localhost) - precisa estar deployado em functions/index.js
const data = await callHttpFunctionWithAuth("createCompanyWithAdminHttp", payload);

    const uid = data?.uid;
    const resetLink = data?.resetLink;
    await loadCompanies();

    // Mostra retorno formatado logo abaixo do formulário (sem alert)
    clearAlert(createCompanyAlert);
    showCompanyCreateSuccess({ adminEmail, uid, resetLink });

  }catch(err){
    console.error("Erro ao criar empresa:", err);
    clearCompanyCreateSuccess();
    setAlert(createCompanyAlert, err?.message || "Erro ao criar empresa");
  }
}

/** =========================
 *  8) ADMIN (EMPRESA): TEAMS
 *  ========================= */
function openAdminView(){
  if (window.location.hash !== ROUTES.admin){ navigateTo(ROUTES.admin); return; }
  setView("admin");
  Promise.all([loadTeams(), loadUsers()]).catch(err => {
    console.error(err);
    alert("Erro ao carregar administração: " + (err?.message || err));
  });
}

async function loadTeams(){
  if (!teamsGrid) return;

  teamsGrid.innerHTML = "";
  hide(teamsEmpty);

  const snap = await getDocs(collection(db, "companies", state.companyId, "teams"));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const q = (teamSearch?.value || "").toLowerCase().trim();
  const filtered = !q ? all : all.filter(t =>
    (t.name || "").toLowerCase().includes(q) ||
    (t.id || "").toLowerCase().includes(q)
  );

  state.teams = filtered.sort((a,b) => (a.name||"").localeCompare(b.name||""));

  if (state.teams.length === 0){
    show(teamsEmpty);
    return;
  }

  for (const t of state.teams){
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <h3 class="title">${t.name || t.id}</h3>
      <p class="desc">ID: <b>${t.id}</b></p>
      <div class="meta">
        <span class="badge">${t.active === false ? "Inativa" : "Ativa"}</span>
      </div>
    `;
    el.addEventListener("click", async () => {
      await openTeamDetailsModal(t.id);
    });
    teamsGrid.appendChild(el);
  }
}

function closeTeamDetailsModal(){
  if (!modalTeamDetails) return;
  modalTeamDetails.hidden = true;
  clearAlert(teamDetailsAlert);
  state.selectedTeamId = null;
}

async function loadTeamMembers(teamId){
  if (!teamDetailsUsersEl) return [];
  teamDetailsUsersEl.innerHTML = "";
  hide(teamDetailsEmptyEl);

  const q = query(
    collection(db, "companies", state.companyId, "users"),
    where("teamIds", "array-contains", teamId)
  );

  const snap = await getDocs(q);
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
    .sort((a,b) => (a.name||"").localeCompare(b.name||""));

  if (users.length === 0){
    show(teamDetailsEmptyEl);
    return [];
  }

  for (const u of users){
    const row = document.createElement("div");
    row.className = "list-item";
    const roleLabel = humanizeRole(u.role);
    row.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center; justify-content:space-between;">
        <div style="min-width:0;">
          <div style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(u.name || "Sem nome")}</div>
          <div class="muted" style="font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${roleLabel} • ${escapeHtml(u.email || "—")}
          </div>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn sm danger" data-act="remove">Remover</button>
        </div>
      </div>
    `;

    row.querySelector('[data-act="remove"]').addEventListener("click", async () => {
      if (!confirm(`Remover "${u.name}" desta equipe?`)) return;
      try{
        await removeUserFromTeam(u.uid, teamId);
        await openTeamDetailsModal(teamId, { keepOpen: true });
        if (typeof loadUsers === "function") loadUsers().catch(()=>{});
        if (typeof loadManagerUsers === "function") loadManagerUsers().catch(()=>{});
      }catch(err){
        console.error(err);
        setAlert(teamDetailsAlert, "Erro ao remover usuário: " + (err?.message || err));
      }
    });

    teamDetailsUsersEl.appendChild(row);
  }

  return users;
}

async function removeUserFromTeam(uid, teamId){
  const ref = doc(db, "companies", state.companyId, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Usuário não encontrado.");
  const u = snap.data();

  const teamIds = Array.isArray(u.teamIds) ? u.teamIds.slice() : [];
  const nextTeamIds = teamIds.filter(t => t !== teamId);

  const updates = { teamIds: nextTeamIds };

  if ((u.teamId || "") === teamId){
    updates.teamId = nextTeamIds[0] || "";
  }

  await updateDoc(ref, updates);
}

async function openTeamDetailsModal(teamId){
  if (!modalTeamDetails) return;
  clearAlert(teamDetailsAlert);
  modalTeamDetails.hidden = false;
  state.selectedTeamId = teamId;

  const teamRef = doc(db, "companies", state.companyId, "teams", teamId);
  const teamSnap = await getDoc(teamRef);
  if (!teamSnap.exists()){
    setAlert(teamDetailsAlert, "Equipe não encontrada.");
    return;
  }
  const team = { id: teamSnap.id, ...teamSnap.data() };

  teamDetailsNameEl.value = team.name || team.id;
  teamDetailsIdEl.value = team.id;
  teamDetailsStatusEl.value = (team.active === false) ? "Inativa" : "Ativa";

  btnTeamToggleActive.textContent = (team.active === false) ? "Ativar" : "Desativar";
  btnTeamToggleActive.onclick = async () => {
    try{
      const nextActive = !(team.active === false);
      if (!confirm(`Deseja ${nextActive ? "ativar" : "inativar"} a equipe "${team.name}"?`)) return;
      await updateDoc(teamRef, { active: !nextActive });
      await loadTeams();
      await openTeamDetailsModal(teamId);
      if (!modalCreateUser.hidden) renderTeamChips();
    }catch(err){
      console.error(err);
      setAlert(teamDetailsAlert, "Erro ao atualizar equipe: " + (err?.message || err));
    }
  };

  const members = await loadTeamMembers(teamId);

  btnTeamDelete.disabled = members.length > 0;
  btnTeamDelete.onclick = async () => {
    if (members.length > 0) return;
    if (!confirm(`Excluir definitivamente a equipe "${team.name}"?`)) return;
    try{
      await deleteDoc(teamRef);
      closeTeamDetailsModal();
      await loadTeams();
      if (!modalCreateUser.hidden) renderTeamChips();
    }catch(err){
      console.error(err);
      setAlert(teamDetailsAlert, "Erro ao excluir equipe: " + (err?.message || err));
    }
  };
}

// Carrega TODAS as equipes (sem filtro de busca) para uso nos chips
async function ensureTeamsForChips(){
  if (!state.companyId) return;
  const snap = await getDocs(collection(db, "companies", state.companyId, "teams"));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.teams = all.sort((a,b) => (a.name||"").localeCompare(b.name||""));
}

// Gera próximo ID de equipe: #1, #2, #3...
async function getNextTeamId(){
  if (!state.companyId) throw new Error("companyId ausente.");
  const snap = await getDocs(collection(db, "companies", state.companyId, "teams"));
  let maxN = 0;
  snap.forEach(d => {
    const id = d.id || "";
    const m = /^#(\d+)$/.exec(id);
    if (m){
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n)) maxN = Math.max(maxN, n);
    }
  });
  return `#${maxN + 1}`;
}

function openCreateTeamModal(){
  if (!modalCreateTeam) return;
  clearAlert(createTeamAlert);
  modalCreateTeam.hidden = false;

  // Não pedir ID manual (gerar #1, #2, ...)
  try{
    const idLabel = teamIdEl?.closest("label");
    if (idLabel) idLabel.style.display = "none";
  }catch(_){}

  teamNameEl.value = "";
  teamIdEl.value = "";

  getNextTeamId()
    .then(id => { teamIdEl.value = id; })
    .catch(() => { teamIdEl.value = ""; });
}

function closeCreateTeamModal(){ if (modalCreateTeam) modalCreateTeam.hidden = true; }

 async function createTeam(){
  clearAlert(createTeamAlert);

  const name = (teamNameEl.value || "").trim();
  if (!name) return setAlert(createTeamAlert, "Informe o nome da equipe.");

  setAlert(createTeamAlert, "Salvando...", "info");

  const teamId = await getNextTeamId();

  await setDoc(doc(db, "companies", state.companyId, "teams", teamId), {
    name,
    active: true,
    number: parseInt(teamId.replace("#",""), 10) || null,
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser.uid
  });

  closeCreateTeamModal();
  await loadTeams();
}

/** =========================
 *  9) ADMIN (EMPRESA): USERS
 *  ========================= */
async function loadUsers(){
  if (!usersTbody) return;

  usersTbody.innerHTML = "";
  hide(usersEmpty);

  const snap = await getDocs(collection(db, "companies", state.companyId, "users"));
  const all = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

  const q = (userSearch?.value || "").toLowerCase().trim();

  state._usersCache = all;

  const filtered = all.filter(u => {
    const text = `${u.uid} ${u.name||""} ${u.email||""} ${u.phone||""}`.toLowerCase();
    const okQ = !q || text.includes(q);
    const roleFilter = (userRoleFilter?.value || "").trim();
    const okRole = !roleFilter || (u.role === roleFilter);
    return okQ && okRole;
  }).sort((a,b) => (a.name||"").localeCompare(b.name||""));

  if (filtered.length === 0){
    show(usersEmpty);
    return;
  }

  for (const u of filtered){
    const tr = document.createElement("tr");

    const teamIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
    const teamsLabel = teamIds.length ? teamIds.join(", ") : "—";
    const statusLabel = (u.active === false) ? "Inativo" : "Ativo";

    tr.innerHTML = `
      <td>
        <div style="display:flex; flex-direction:column; gap:2px;">
          <div><b>${u.name || "—"}</b></div>
          <div class="muted" style="font-size:12px;">UID: ${u.uid}</div>
        </div>
      </td>
      <td>${normalizeRole(u.role)}</td>
      <td>${u.email || "—"}</td>
      <td>${u.phone || "—"}</td>
      <td>${teamsLabel}</td>
      <td><span class="badge small">${statusLabel}</span></td>
      <td>
        <div class="action-row">
          <button class="btn sm" data-act="toggle">${u.active === false ? "Ativar" : "Inativar"}</button>${u.role === "gestor" ? `<button class="btn sm link" data-act="managed">Equipes</button>` : ""}
        </div>
      </td>
    `;

    tr.querySelector('[data-act="toggle"]').addEventListener("click", async () => {
      const nextActive = (u.active === false);
      if (!confirm(`Deseja ${nextActive ? "ativar" : "inativar"} "${u.name}"?`)) return;
      await updateDoc(doc(db, "companies", state.companyId, "users", u.uid), { active: nextActive });
      await loadUsers();
    });

    const btnManaged = tr.querySelector('[data-act="managed"]');
    if (btnManaged){
      btnManaged.addEventListener("click", async () => {
        // garante equipes carregadas
        await loadTeams();
        openManagedTeamsModal(u.uid, u.name);
      });
    }
    usersTbody.appendChild(tr);
  }
}

function openCreateUserModal(){
  if (!modalCreateUser) return;
  clearAlert(createUserAlert);
  modalCreateUser.hidden = false;

  // Não pedir UID manualmente (vamos criar no Auth via secondaryAuth)
  try{
    const uidLabel = newUserUidEl?.closest("label");
    if (uidLabel) uidLabel.style.display = "none";
  }catch(_){}

  newUserUidEl.value = "";
  newUserNameEl.value = "";
  newUserRoleEl.value = "tecnico";
  newUserEmailEl.value = "";
  newUserPhoneEl.value = "";
  newUserActiveEl.value = "true";

  state.selectedTeamIds = [];

  // garante que os chips tenham as equipes existentes
  ensureTeamsForChips()
    .then(() => renderTeamChips())
    .catch(() => renderTeamChips());
}

function closeCreateUserModal(){ if (modalCreateUser) modalCreateUser.hidden = true; }

function renderTeamChips(){
  if (!teamChipsEl) return;
  teamChipsEl.innerHTML = "";

  const activeTeams = (state.teams || []).filter(t => t.active !== false);

  if (activeTeams.length === 0){
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.fontSize = "13px";
    hint.textContent = "Crie pelo menos 1 equipe para selecionar aqui.";
    teamChipsEl.appendChild(hint);
    return;
  }

  for (const t of activeTeams){
    const chip = document.createElement("div");
    chip.className = "chip-option" + (state.selectedTeamIds.includes(t.id) ? " selected" : "");
    chip.innerHTML = `<span class="dot"></span><span>${t.name}</span>`;

    chip.addEventListener("click", () => {
      const idx = state.selectedTeamIds.indexOf(t.id);
      if (idx >= 0) state.selectedTeamIds.splice(idx, 1);
      else state.selectedTeamIds.push(t.id);
      renderTeamChips();
    });

    teamChipsEl.appendChild(chip);
  }
}

async function createUser(){
  clearAlert(createUserAlert);

  let uid = (newUserUidEl?.value || "").trim();
  const name = (newUserNameEl?.value || "").trim();
  const role = (newUserRoleEl?.value || "").trim();
  const email = (newUserEmailEl?.value || "").trim();
  const phone = normalizePhone(newUserPhoneEl?.value || "");
  const active = (newUserActiveEl?.value || "true") === "true";
  const teamIds = Array.from(new Set(state.selectedTeamIds || []));

  // UID agora é opcional (se vazio, criamos automaticamente no Auth via Cloud Function)
  const wantsAutoAuth = !uid;

  if (!name) return setAlert(createUserAlert, "Informe o nome do usuário.");
  if (!role) return setAlert(createUserAlert, "Selecione a função.");
  if (!email || !isEmailValidBasic(email)) return setAlert(createUserAlert, "Informe um e-mail válido.");

  // Regra: Admin pode ficar sem equipe; os demais precisam de pelo menos 1 equipe
  if (role !== "admin" && teamIds.length === 0){
    return setAlert(createUserAlert, "Selecione pelo menos 1 equipe para este usuário.");
  }

  setAlert(createUserAlert, "Salvando...", "info");

  try{
    if (wantsAutoAuth){
      const data = await createUserWithAuthAndResetLink({
        companyId: state.companyId,
        name,
        email,
        phone,
        role,
        teamIds
      });

      uid = data?.uid;

      // Perfil na empresa
      await setDoc(doc(db, "companies", state.companyId, "users", uid), {
        name,
        role,
        email,
        phone,
        active,
        teamIds,
        teamId: teamIds[0] || "",
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser.uid
      });

      // Vínculo do usuário com empresa (multi-tenant)
      await setDoc(doc(db, "userCompanies", uid), { companyId: state.companyId });

      closeCreateUserModal();
      await loadUsers();

      alert(
        `Usuário criado com sucesso!

` +
        `E-mail: ${email}
UID: ${uid}

` +
        `✅ Enviamos um e-mail para o usuário definir a senha no primeiro acesso.`
      );
return;
    }

    // Fluxo manual (UID já existe no Auth)
    await setDoc(doc(db, "companies", state.companyId, "users", uid), {
      name,
      role,
      email,
      phone,
      active,
      teamIds,
      teamId: teamIds[0] || "",
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid
    });

    await setDoc(doc(db, "userCompanies", uid), { companyId: state.companyId });

    closeCreateUserModal();
    await loadUsers();

  }catch(err){
    console.error(err);
    setAlert(createUserAlert, "Erro ao salvar: " + (err?.message || err));
  }
}

/** =========================
 *  9.5) GESTOR: USUÁRIOS (TÉCNICOS)
 *  ========================= */
function openManagerUsersView(){
  if (window.location.hash !== ROUTES.managerUsers){ navigateTo(ROUTES.managerUsers); return; }
  setView("managerUsers");
  Promise.all([loadTeams(), loadManagerUsers()]).catch(err => {
    console.error(err);
    alert("Erro ao carregar usuários do gestor: " + (err?.message || err));
  });
}

function getManagedTeamIds(){
  const ids = state.profile?.managedTeamIds;
  return Array.isArray(ids) ? ids : [];
}

function populateMgrTeamFilter(){
  if (!mgrTeamFilter) return;
  const managedIds = getManagedTeamIds();
  mgrTeamFilter.innerHTML = '<option value="">Todas as minhas equipes</option>';

  const activeManagedTeams = (state.teams || [])
    .filter(t => t.active !== false && managedIds.includes(t.id))
    .sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  for (const t of activeManagedTeams){
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name || t.id;
    mgrTeamFilter.appendChild(opt);
  }
}

async function loadManagerUsers(){
  if (!mgrUsersTbody) return;

  mgrUsersTbody.innerHTML = "";
  hide(mgrUsersEmpty);

  const managedIds = getManagedTeamIds();
  populateMgrTeamFilter();

  const snap = await getDocs(collection(db, "companies", state.companyId, "users"));
  const all = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

  const q = (mgrUserSearch?.value || "").toLowerCase().trim();
  const teamFilter = (mgrTeamFilter?.value || "").trim();

  const filtered = all.filter(u => {
    if (u.role !== "tecnico") return false;

    const teamIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
    if (!intersects(teamIds, managedIds)) return false;
    if (teamFilter && !teamIds.includes(teamFilter)) return false;

    const text = `${u.uid} ${u.name||""} ${u.email||""} ${u.phone||""}`.toLowerCase();
    if (q && !text.includes(q)) return false;

    return true;
  }).sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  if (filtered.length === 0){
    show(mgrUsersEmpty);
    return;
  }

  for (const u of filtered){
    const tr = document.createElement("tr");
    const teamIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
    const teamsLabel = teamIds.length ? teamIds.map(getTeamNameById).join(", ") : "—";
    const statusLabel = (u.active === false) ? "Inativo" : "Ativo";

    tr.innerHTML = `
      <td>
        <div style="display:flex; flex-direction:column; gap:2px;">
          <div><b>${escapeHtml(u.name || "—")}</b></div>
          <div class="muted" style="font-size:12px;">UID: ${escapeHtml(u.uid)}</div>
        </div>
      </td>
      <td>${escapeHtml(u.email || "—")}</td>
      <td>${escapeHtml(u.phone || "—")}</td>
      <td>${escapeHtml(teamsLabel)}</td>
      <td><span class="badge small">${statusLabel}</span></td>
      <td>
        <div class="action-row">
          <button class="btn sm" data-act="toggle">${u.active === false ? "Ativar" : "Inativar"}</button>
        </div>
      </td>
    `;

    tr.querySelector('[data-act="toggle"]').addEventListener("click", async () => {
      const nextActive = (u.active === false);
      if (!confirm(`Deseja ${nextActive ? "ativar" : "inativar"} "${u.name}"?`)) return;
      await updateDoc(doc(db, "companies", state.companyId, "users", u.uid), { active: nextActive });
      await loadManagerUsers();
    });

    mgrUsersTbody.appendChild(tr);
  }
}

function openCreateTechModal(){
  if (!modalCreateTech) return;
  clearAlert(createTechAlert);
  modalCreateTech.hidden = false;

  // Não pedir UID manualmente (vamos criar no Auth via secondaryAuth)
  try{
    const uidLabel = techUidEl?.closest("label");
    if (uidLabel) uidLabel.style.display = "none";
  }catch(_){}

  techUidEl.value = "";
  techNameEl.value = "";
  techEmailEl.value = "";
  techPhoneEl.value = "";
  techActiveEl.value = "true";

  state.mgrSelectedTeamIds = [];
  ensureManagedTeamsForChips()
    .then(() => renderMgrTeamChips())
    .catch(() => renderMgrTeamChips());
}

function closeCreateTechModal(){ if (modalCreateTech) modalCreateTech.hidden = true; }

function renderMgrTeamChips(){
  if (!mgrTeamChipsEl) return;
  mgrTeamChipsEl.innerHTML = "";

  const managedIds = getManagedTeamIds();
  const teams = (state.teams || [])
    .filter(t => t.active !== false && managedIds.includes(t.id))
    .sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  if (teams.length === 0){
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.fontSize = "13px";
    hint.textContent = "Nenhuma equipe administrada encontrada. Peça ao Admin da empresa para definir suas equipes administradas.";
    mgrTeamChipsEl.appendChild(hint);
    return;
  }

  for (const t of teams){
    const chip = document.createElement("div");
    chip.className = "chip-option" + (state.mgrSelectedTeamIds.includes(t.id) ? " selected" : "");
    chip.innerHTML = `<span class="dot"></span><span>${escapeHtml(t.name)}</span>`;

    chip.addEventListener("click", () => {
      const idx = state.mgrSelectedTeamIds.indexOf(t.id);
      if (idx >= 0) state.mgrSelectedTeamIds.splice(idx, 1);
      else state.mgrSelectedTeamIds.push(t.id);
      renderMgrTeamChips();
    });

    mgrTeamChipsEl.appendChild(chip);
  }
}

async function createTech(){
  clearAlert(createTechAlert);

  let uid = (techUidEl.value || "").trim();
  const name = (techNameEl.value || "").trim();
  const email = (techEmailEl.value || "").trim();
  const phone = normalizePhone(techPhoneEl.value || "");
  const active = (techActiveEl.value || "true") === "true";
  const teamIds = Array.from(new Set(state.mgrSelectedTeamIds || []));

  // UID agora é opcional (se vazio, criamos automaticamente no Auth via Cloud Function)
  const wantsAutoAuth = !uid;
  if (!name) return setAlert(createTechAlert, "Informe o nome do técnico.");
  if (!email || !isEmailValidBasic(email)) return setAlert(createTechAlert, "Informe um e-mail válido.");
  if (teamIds.length === 0) return setAlert(createTechAlert, "Selecione pelo menos 1 equipe.");

  const managedIds = new Set(getManagedTeamIds());
  if (teamIds.some(t => !managedIds.has(t))){
    return setAlert(createTechAlert, "Você selecionou uma equipe fora do seu escopo de gestão.");
  }

  setAlert(createTechAlert, "Salvando...", "info");

  if (wantsAutoAuth) {
    const data = await createUserWithAuthAndResetLink({
      companyId: state.companyId,
      name,
      email,
      phone,
      role: "tecnico",
      teamIds
    });

    uid = data.uid;

    await setDoc(doc(db, "userCompanies", uid), { companyId: state.companyId });

    closeCreateTechModal();
    await loadManagerUsers();
    setAlertWithResetLink(createTechAlert, "Técnico criado com sucesso!", email, data.resetLink);
    return;
  }
  await setDoc(doc(db, "companies", state.companyId, "users", uid), {
    name,
    role: "tecnico",
    email,
    phone,
    active,
    teamIds,
    teamId: teamIds[0] || ""
  });

  await setDoc(doc(db, "userCompanies", uid), { companyId: state.companyId });

  closeCreateTechModal();
  await loadManagerUsers();
}

/** =========================
 *  9.6) ADMIN: DEFINIR EQUIPES ADMINISTRADAS (GESTOR)
 *  ========================= */
function openManagedTeamsModal(targetUid, targetName){
  if (!modalManagedTeams) return;
  clearAlert(managedTeamsAlert);
  modalManagedTeams.hidden = false;

  state.managedTeamsTargetUid = targetUid;

  const title = targetName ? `Gestor: ${targetName}` : "Gestor";
  if (managedTeamsSubtitle) managedTeamsSubtitle.textContent = `${title} • selecione as equipes administradas`;

  const row = (state._usersCache || []).find(u => u.uid === targetUid);
  const current = Array.isArray(row?.managedTeamIds) ? row.managedTeamIds : [];
  state.managedTeamsSelected = Array.from(new Set(current));

  renderManagedTeamsChips();
}

function closeManagedTeamsModal(){ if (modalManagedTeams) modalManagedTeams.hidden = true; }

function renderManagedTeamsChips(){
  if (!managedTeamsChips) return;
  managedTeamsChips.innerHTML = "";

  const activeTeams = (state.teams || [])
    .filter(t => t.active !== false)
    .sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  if (activeTeams.length === 0){
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.fontSize = "13px";
    hint.textContent = "Crie equipes antes de definir equipes administradas.";
    managedTeamsChips.appendChild(hint);
    return;
  }

  for (const t of activeTeams){
    const chip = document.createElement("div");
    chip.className = "chip-option" + (state.managedTeamsSelected.includes(t.id) ? " selected" : "");
    chip.innerHTML = `<span class="dot"></span><span>${escapeHtml(t.name)}</span>`;

    chip.addEventListener("click", () => {
      const idx = state.managedTeamsSelected.indexOf(t.id);
      if (idx >= 0) state.managedTeamsSelected.splice(idx, 1);
      else state.managedTeamsSelected.push(t.id);
      renderManagedTeamsChips();
    });

    managedTeamsChips.appendChild(chip);
  }
}

async function saveManagedTeams(){
  clearAlert(managedTeamsAlert);

  const targetUid = state.managedTeamsTargetUid;
  if (!targetUid) return setAlert(managedTeamsAlert, "UID alvo inválido.");

  const managedTeamIds = Array.from(new Set(state.managedTeamsSelected || []));
  setAlert(managedTeamsAlert, "Salvando...", "info");

  await updateDoc(doc(db, "companies", state.companyId, "users", targetUid), {
    managedTeamIds
  });

  closeManagedTeamsModal();
  await loadUsers();
}


/** =========================
 *  9.9) HASH ROUTES (SPA)
 *  ========================= */
// Guard + resolução de rotas.
// OBS: Coordenador se comporta como Gestor.
function getRole(){
  return state.profile?.role || "";
}

function setActiveNavByRoute(hash){
  const all = [navHome, navAddProject, navAddTech, navReports, navConfig].filter(Boolean);
  all.forEach(b => b.classList.remove("active"));

  // mapeamento simples (pode evoluir depois)
  if (hash === ROUTES.dashboard && navHome) navHome.classList.add("active");
  if (hash === ROUTES.admin && navConfig) navConfig.classList.add("active");
  if (hash === ROUTES.companies && navConfig) navConfig.classList.add("active");
  if (hash === ROUTES.managerUsers && navAddTech) navAddTech.classList.add("active");
}

function resolveRoute(hash){
  const user = auth.currentUser;

  // Sem sessão → sempre login
  if (!user){
    if (hash !== ROUTES.login) navigateTo(ROUTES.login);
    setView("login");
    setActiveNavByRoute(ROUTES.login);
    return;
  }

  // Sessão existe, mas ainda estamos carregando perfil (auth listener ainda não terminou)
  if (!state.profile){
    // deixa um fallback simples; quando o profile carregar, chamamos resolveRoute de novo
    setView("dashboard");
    return;
  }

  // Logado tentando acessar /login → manda pra dashboard
  if (hash === ROUTES.login){
    navigateTo(ROUTES.dashboard);
    return;
  }

  // /companies (somente superadmin)
  if (hash === ROUTES.companies){
    if (!state.isSuperAdmin){
      navigateTo(ROUTES.dashboard);
      return;
    }
    setActiveNavByRoute(hash);
    openCompaniesView(); // já faz load
    return;
  }

  // /admin (somente admin empresa)
  if (hash === ROUTES.admin){
    const role = getRole();
    if (state.isSuperAdmin || role !== "admin"){
      navigateTo(ROUTES.dashboard);
      return;
    }
    setActiveNavByRoute(hash);
    openAdminView(); // já faz load
    return;
  }

  // /manager-users (gestor/coordenador)
  if (hash === ROUTES.managerUsers){
    const role = getRole();
    if (state.isSuperAdmin || !["gestor","coordenador"].includes(role)){
      navigateTo(ROUTES.dashboard);
      return;
    }
    setActiveNavByRoute(hash);
    openManagerUsersView(); // já faz load
    return;
  }

  // /dashboard (default)
  if (hash === ROUTES.dashboard || !hash){
    setActiveNavByRoute(ROUTES.dashboard);
    setView("dashboard");
    return;
  }

  // rota desconhecida
  navigateTo(ROUTES.dashboard);
}

initHashRouter({ resolve: resolveRoute });


/** =========================
 *  10) AUTH FLOW
 *  ========================= */
// Inicializa o dropdown do avatar (não depende do login)
initUserMenu();

onAuthStateChanged(auth, async (user) => {
  clearAlert(loginAlert);

  state.companyId = null;
  state.profile = null;
  state.isSuperAdmin = false;

  if (!user){
    navigateTo(ROUTES.login);
    return;
  }

  // 1) Super Admin
  const platformUser = await fetchPlatformUser(user.uid);
  if (platformUser && platformUser.role === "superadmin" && platformUser.active !== false){
    state.isSuperAdmin = true;
    state.profile = platformUser;

    renderTopbar(platformUser, user);
    renderDashboardCards(platformUser);
    if (!window.location.hash || window.location.hash === ROUTES.login) navigateTo(ROUTES.dashboard);
    resolveRoute(window.location.hash);
    return;
  }

  // 2) Usuário comum (multi-tenant)
  const companyId = await fetchCompanyIdForUser(user.uid);
  if (!companyId){
    navigateTo(ROUTES.login);
    setAlert(loginAlert, "Seu usuário não está vinculado a nenhuma empresa. Peça ao admin para configurar.");
    await signOut(auth);
    return;
  }

  const profile = await fetchCompanyUserProfile(companyId, user.uid);
  if (!profile){
    navigateTo(ROUTES.login);
    setAlert(loginAlert, "Seu perfil não foi encontrado dentro da empresa. Peça ao admin para criar.");
    await signOut(auth);
    return;
  }

  if (profile.active === false){
    navigateTo(ROUTES.login);
    setAlert(loginAlert, "Usuário bloqueado. Fale com o administrador.");
    await signOut(auth);
    return;
  }

  state.companyId = companyId;
  state.profile = profile;

  renderTopbar(profile, user);
  renderDashboardCards(profile);
  if (!window.location.hash || window.location.hash === ROUTES.login) navigateTo(ROUTES.dashboard);
  resolveRoute(window.location.hash);
});

/** =========================
 *  11) EVENTOS
 *  ========================= */
loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert(loginAlert);

  const email = (emailEl?.value || "").trim();
  const password = passwordEl?.value || "";

  if (!email || !password){
    setAlert(loginAlert, "Preencha e-mail e senha.");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    setAlert(loginAlert, mapAuthError(err));
  }
});

btnForgot?.addEventListener("click", async () => {
  clearAlert(loginAlert);
  const email = (emailEl?.value || "").trim();
  if (!email) return setAlert(loginAlert, "Digite seu e-mail para redefinir a senha.");

  try {
    await sendPasswordResetEmail(auth, email);
    setAlert(loginAlert, "Link de redefinição enviado para seu e-mail.", "info");
  } catch (err) {
    setAlert(loginAlert, mapAuthError(err));
  }
});

navLogout?.addEventListener("click", async (e) => {
  e?.preventDefault?.();
  await signOut(auth);
});
// Dashboard navigation
btnBackToDashboard?.addEventListener("click", () => navigateTo(ROUTES.dashboard));
btnBackFromAdmin?.addEventListener("click", () => navigateTo(ROUTES.dashboard));

// Gestor Users view
btnBackFromManagerUsers?.addEventListener("click", () => navigateTo(ROUTES.dashboard));
btnReloadMgrUsers?.addEventListener("click", () => loadManagerUsers());
mgrUserSearch?.addEventListener("input", () => loadManagerUsers());
mgrTeamFilter?.addEventListener("change", () => loadManagerUsers());
btnOpenCreateTech?.addEventListener("click", async () => {
  await loadTeams();
  openCreateTechModal();
});

// Modal técnico
btnCloseCreateTech?.addEventListener("click", () => closeCreateTechModal());
btnCancelCreateTech?.addEventListener("click", () => closeCreateTechModal());
btnCreateTech?.addEventListener("click", () => {
  createTech().catch(err => {
    console.error(err);
    setAlert(createTechAlert, "Erro ao salvar: " + (err?.message || err));
  });
});
modalCreateTech?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateTechModal();
});

// Modal equipes administradas
btnCloseManagedTeams?.addEventListener("click", () => closeManagedTeamsModal());
btnCancelManagedTeams?.addEventListener("click", () => closeManagedTeamsModal());
btnSaveManagedTeams?.addEventListener("click", () => {
  saveManagedTeams().catch(err => {
    console.error(err);
    setAlert(managedTeamsAlert, "Erro ao salvar: " + (err?.message || err));
  });
});
modalManagedTeams?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeManagedTeamsModal();
});

// Companies events
btnReloadCompanies?.addEventListener("click", () => loadCompanies());
companySearch?.addEventListener("input", () => loadCompanies());
btnOpenCreateCompany?.addEventListener("click", () => openCreateCompanyModal());

companyNameEl?.addEventListener("input", () => {
  const slug = slugify(companyNameEl.value);
  if (!companyIdEl.value.trim() || companyIdEl.dataset.auto !== "false"){
    companyIdEl.value = slug;
    companyIdEl.dataset.auto = "true";
  }
});
companyIdEl?.addEventListener("input", () => {
  companyIdEl.dataset.auto = "false";
});

btnCloseCreateCompany?.addEventListener("click", () => closeCreateCompanyModal());
btnCancelCreateCompany?.addEventListener("click", () => closeCreateCompanyModal());
btnCreateCompany?.addEventListener("click", () => {
  createCompany().catch(err => {
    console.error(err);
    setAlert(createCompanyAlert, "Erro ao salvar: " + (err?.message || err));
  });
});

modalCreateCompany?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateCompanyModal();
});

modalCompanyDetail?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCompanyDetailModal();
});

// Teams events
btnReloadTeams?.addEventListener("click", () => loadTeams());
teamSearch?.addEventListener("input", () => loadTeams());
btnOpenCreateTeam?.addEventListener("click", () => openCreateTeamModal());

teamNameEl?.addEventListener("input", () => {
  const slug = slugify(teamNameEl.value);
  if (!teamIdEl.value.trim() || teamIdEl.dataset.auto !== "false"){
    teamIdEl.value = slug;
    teamIdEl.dataset.auto = "true";
  }
});
teamIdEl?.addEventListener("input", () => {
  teamIdEl.dataset.auto = "false";
});

btnCloseCreateTeam?.addEventListener("click", () => closeCreateTeamModal());
btnCancelCreateTeam?.addEventListener("click", () => closeCreateTeamModal());
btnCreateTeam?.addEventListener("click", () => {
  createTeam().catch(err => {
    console.error(err);
    setAlert(createTeamAlert, "Erro ao salvar: " + (err?.message || err));
  });
});

modalCreateTeam?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateTeamModal();
});

// Users events
btnReloadUsers?.addEventListener("click", () => loadUsers());
userSearch?.addEventListener("input", () => loadUsers());
userRoleFilter?.addEventListener("change", () => { loadUsers(); });
btnOpenCreateUser?.addEventListener("click", async () => {
  // garante que as equipes estão carregadas antes de abrir
  await loadTeams();
  openCreateUserModal();
});

btnCloseCreateUser?.addEventListener("click", () => closeCreateUserModal());
btnCancelCreateUser?.addEventListener("click", () => closeCreateUserModal());
btnCreateUser?.addEventListener("click", () => {
  createUser().catch(err => {
    console.error(err);
    setAlert(createUserAlert, "Erro ao salvar: " + (err?.message || err));
  });
});

modalCreateUser?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close === "true") closeCreateUserModal();
});

btnCloseCompanyDetail?.addEventListener("click", () => closeCompanyDetailModal());

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