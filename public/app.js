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
import * as refs from "./src/ui/refs.js";
import * as companiesDomain from "./src/domain/companies.domain.js";
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
    setActiveNav("navHome");
    setView("dashboard");
  });
  refs.navReports?.addEventListener("click", () => {
    setActiveNav("navReports");
    alert("Em breve: Relatórios e indicadores");
  });
  refs.navAddProject?.addEventListener("click", () => {
    setActiveNav("navAddProject");
    alert("Em breve: Adicionar projeto");
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
 *  8) ADMIN (EMPRESA): TEAMS
 *  ========================= */
function openAdminView(){
  setView("admin");
  Promise.all([loadTeams(), loadUsers()]).catch(err => {
    console.error(err);
    alert("Erro ao carregar administração: " + (err?.message || err));
  });
}

async function loadTeams(){
  if (!refs.teamsGrid) return;

  refs.teamsGrid.innerHTML = "";
  hide(refs.teamsEmpty);

  const snap = await getDocs(collection(db, "companies", state.companyId, "teams"));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const q = (refs.teamSearch?.value || "").toLowerCase().trim();
  const filtered = !q ? all : all.filter(t =>
    (t.name || "").toLowerCase().includes(q) ||
    (t.id || "").toLowerCase().includes(q)
  );

  state.teams = filtered.sort((a,b) => (a.name||"").localeCompare(b.name||""));

  if (state.teams.length === 0){
    show(refs.teamsEmpty);
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
    refs.teamsGrid.appendChild(el);
  }
}

function closeTeamDetailsModal(){
  if (!refs.modalTeamDetails) return;
  refs.modalTeamDetails.hidden = true;
  clearAlert(refs.teamDetailsAlert);
  state.selectedTeamId = null;
}

async function loadTeamMembers(teamId){
  if (!refs.teamDetailsUsersEl) return [];
  refs.teamDetailsUsersEl.innerHTML = "";
  hide(refs.teamDetailsEmptyEl);

  const q = query(
    collection(db, "companies", state.companyId, "users"),
    where("teamIds", "array-contains", teamId)
  );

  const snap = await getDocs(q);
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
    .sort((a,b) => (a.name||"").localeCompare(b.name||""));

  if (users.length === 0){
    show(refs.teamDetailsEmptyEl);
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
        setAlert(refs.teamDetailsAlert, "Erro ao remover usuário: " + (err?.message || err));
      }
    });

    refs.teamDetailsUsersEl.appendChild(row);
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
  if (!refs.modalTeamDetails) return;
  clearAlert(refs.teamDetailsAlert);
  refs.modalTeamDetails.hidden = false;
  state.selectedTeamId = teamId;

  const teamRef = doc(db, "companies", state.companyId, "teams", teamId);
  const teamSnap = await getDoc(teamRef);
  if (!teamSnap.exists()){
    setAlert(refs.teamDetailsAlert, "Equipe não encontrada.");
    return;
  }
  const team = { id: teamSnap.id, ...teamSnap.data() };

  refs.teamDetailsNameEl.value = team.name || team.id;
  refs.teamDetailsIdEl.value = team.id;
  refs.teamDetailsStatusEl.value = (team.active === false) ? "Inativa" : "Ativa";

  refs.btnTeamToggleActive.textContent = (team.active === false) ? "Ativar" : "Desativar";
  refs.btnTeamToggleActive.onclick = async () => {
    try{
      const nextActive = !(team.active === false);
      if (!confirm(`Deseja ${nextActive ? "ativar" : "inativar"} a equipe "${team.name}"?`)) return;
      await updateDoc(teamRef, { active: !nextActive });
      await loadTeams();
      await openTeamDetailsModal(teamId);
      if (!refs.modalCreateUser.hidden) renderTeamChips();
    }catch(err){
      console.error(err);
      setAlert(refs.teamDetailsAlert, "Erro ao atualizar equipe: " + (err?.message || err));
    }
  };

  const members = await loadTeamMembers(teamId);

  refs.btnTeamDelete.disabled = members.length > 0;
  refs.btnTeamDelete.onclick = async () => {
    if (members.length > 0) return;
    if (!confirm(`Excluir definitivamente a equipe "${team.name}"?`)) return;
    try{
      await deleteDoc(teamRef);
      closeTeamDetailsModal();
      await loadTeams();
      if (!refs.modalCreateUser.hidden) renderTeamChips();
    }catch(err){
      console.error(err);
      setAlert(refs.teamDetailsAlert, "Erro ao excluir equipe: " + (err?.message || err));
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
  if (!refs.modalCreateTeam) return;
  clearAlert(refs.createTeamAlert);
  refs.modalCreateTeam.hidden = false;

  // Não pedir ID manual (gerar #1, #2, ...)
  try{
    const idLabel = refs.teamIdEl?.closest("label");
    if (idLabel) idLabel.style.display = "none";
  }catch(_){}

  refs.teamNameEl.value = "";
  refs.teamIdEl.value = "";

  getNextTeamId()
    .then(id => { refs.teamIdEl.value = id; })
    .catch(() => { refs.teamIdEl.value = ""; });
}

function closeCreateTeamModal(){ if (refs.modalCreateTeam) refs.modalCreateTeam.hidden = true; }

 async function createTeam(){
  clearAlert(refs.createTeamAlert);

  const name = (refs.teamNameEl.value || "").trim();
  if (!name) return setAlert(refs.createTeamAlert, "Informe o nome da equipe.");

  setAlert(refs.createTeamAlert, "Salvando...", "info");

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
  if (!refs.usersTbody) return;

  refs.usersTbody.innerHTML = "";
  hide(refs.usersEmpty);

  const snap = await getDocs(collection(db, "companies", state.companyId, "users"));
  const all = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

  const q = (refs.userSearch?.value || "").toLowerCase().trim();

  state._usersCache = all;

  const filtered = all.filter(u => {
    const text = `${u.uid} ${u.name||""} ${u.email||""} ${u.phone||""}`.toLowerCase();
    const okQ = !q || text.includes(q);
    const roleFilter = (refs.userRoleFilter?.value || "").trim();
    const okRole = !roleFilter || (u.role === roleFilter);
    return okQ && okRole;
  }).sort((a,b) => (a.name||"").localeCompare(b.name||""));

  if (filtered.length === 0){
    show(refs.usersEmpty);
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
    refs.usersTbody.appendChild(tr);
  }
}

function openCreateUserModal(){
  if (!refs.modalCreateUser) return;
  clearAlert(refs.createUserAlert);
  refs.modalCreateUser.hidden = false;

  // Não pedir UID manualmente (vamos criar no Auth via secondaryAuth)
  try{
    const uidLabel = refs.newUserUidEl?.closest("label");
    if (uidLabel) uidLabel.style.display = "none";
  }catch(_){}

  refs.newUserUidEl.value = "";
  refs.newUserNameEl.value = "";
  refs.newUserRoleEl.value = "tecnico";
  refs.newUserEmailEl.value = "";
  refs.newUserPhoneEl.value = "";
  refs.newUserActiveEl.value = "true";

  state.selectedTeamIds = [];

  // garante que os chips tenham as equipes existentes
  ensureTeamsForChips()
    .then(() => renderTeamChips())
    .catch(() => renderTeamChips());
}

function closeCreateUserModal(){ if (refs.modalCreateUser) refs.modalCreateUser.hidden = true; }

function renderTeamChips(){
  if (!refs.teamChipsEl) return;
  refs.teamChipsEl.innerHTML = "";

  const activeTeams = (state.teams || []).filter(t => t.active !== false);

  if (activeTeams.length === 0){
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.fontSize = "13px";
    hint.textContent = "Crie pelo menos 1 equipe para selecionar aqui.";
    refs.teamChipsEl.appendChild(hint);
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

    refs.teamChipsEl.appendChild(chip);
  }
}

async function createUser(){
  clearAlert(refs.createUserAlert);

  let uid = (refs.newUserUidEl?.value || "").trim();
  const name = (refs.newUserNameEl?.value || "").trim();
  const role = (refs.newUserRoleEl?.value || "").trim();
  const email = (refs.newUserEmailEl?.value || "").trim();
  const phone = normalizePhone(refs.newUserPhoneEl?.value || "");
  const active = (refs.newUserActiveEl?.value || "true") === "true";
  const teamIds = Array.from(new Set(state.selectedTeamIds || []));

  // UID agora é opcional (se vazio, criamos automaticamente no Auth via Cloud Function)
  const wantsAutoAuth = !uid;

  if (!name) return setAlert(refs.createUserAlert, "Informe o nome do usuário.");
  if (!role) return setAlert(refs.createUserAlert, "Selecione a função.");
  if (!email || !isEmailValidBasic(email)) return setAlert(refs.createUserAlert, "Informe um e-mail válido.");

  // Regra: Admin pode ficar sem equipe; os demais precisam de pelo menos 1 equipe
  if (role !== "admin" && teamIds.length === 0){
    return setAlert(refs.createUserAlert, "Selecione pelo menos 1 equipe para este usuário.");
  }

  setAlert(refs.createUserAlert, "Salvando...", "info");

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
    setAlert(refs.createUserAlert, "Erro ao salvar: " + (err?.message || err));
  }
}

/** =========================
 *  9.5) GESTOR: USUÁRIOS (TÉCNICOS)
 *  ========================= */
function openManagerUsersView(){
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
  if (!refs.mgrTeamFilter) return;
  const managedIds = getManagedTeamIds();
  refs.mgrTeamFilter.innerHTML = '<option value="">Todas as minhas equipes</option>';

  const activeManagedTeams = (state.teams || [])
    .filter(t => t.active !== false && managedIds.includes(t.id))
    .sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  for (const t of activeManagedTeams){
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name || t.id;
    refs.mgrTeamFilter.appendChild(opt);
  }
}

async function loadManagerUsers(){
  if (!refs.mgrUsersTbody) return;

  refs.mgrUsersTbody.innerHTML = "";
  hide(refs.mgrUsersEmpty);

  const managedIds = getManagedTeamIds();
  populateMgrTeamFilter();

  const snap = await getDocs(collection(db, "companies", state.companyId, "users"));
  const all = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

  const q = (refs.mgrUserSearch?.value || "").toLowerCase().trim();
  const teamFilter = (refs.mgrTeamFilter?.value || "").trim();

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
    show(refs.mgrUsersEmpty);
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

    refs.mgrUsersTbody.appendChild(tr);
  }
}

function openCreateTechModal(){
  if (!refs.modalCreateTech) return;
  clearAlert(refs.createTechAlert);
  refs.modalCreateTech.hidden = false;

  // Não pedir UID manualmente (vamos criar no Auth via secondaryAuth)
  try{
    const uidLabel = refs.techUidEl?.closest("label");
    if (uidLabel) uidLabel.style.display = "none";
  }catch(_){}

  refs.techUidEl.value = "";
  refs.techNameEl.value = "";
  refs.techEmailEl.value = "";
  refs.techPhoneEl.value = "";
  refs.techActiveEl.value = "true";

  state.mgrSelectedTeamIds = [];
  ensureManagedTeamsForChips()
    .then(() => renderMgrTeamChips())
    .catch(() => renderMgrTeamChips());
}

function closeCreateTechModal(){ if (refs.modalCreateTech) refs.modalCreateTech.hidden = true; }

function renderMgrTeamChips(){
  if (!refs.mgrTeamChipsEl) return;
  refs.mgrTeamChipsEl.innerHTML = "";

  const managedIds = getManagedTeamIds();
  const teams = (state.teams || [])
    .filter(t => t.active !== false && managedIds.includes(t.id))
    .sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  if (teams.length === 0){
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.fontSize = "13px";
    hint.textContent = "Nenhuma equipe administrada encontrada. Peça ao Admin da empresa para definir suas equipes administradas.";
    refs.mgrTeamChipsEl.appendChild(hint);
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

    refs.mgrTeamChipsEl.appendChild(chip);
  }
}

async function createTech(){
  clearAlert(refs.createTechAlert);

  let uid = (refs.techUidEl.value || "").trim();
  const name = (refs.techNameEl.value || "").trim();
  const email = (refs.techEmailEl.value || "").trim();
  const phone = normalizePhone(refs.techPhoneEl.value || "");
  const active = (refs.techActiveEl.value || "true") === "true";
  const teamIds = Array.from(new Set(state.mgrSelectedTeamIds || []));

  // UID agora é opcional (se vazio, criamos automaticamente no Auth via Cloud Function)
  const wantsAutoAuth = !uid;
  if (!name) return setAlert(refs.createTechAlert, "Informe o nome do técnico.");
  if (!email || !isEmailValidBasic(email)) return setAlert(refs.createTechAlert, "Informe um e-mail válido.");
  if (teamIds.length === 0) return setAlert(refs.createTechAlert, "Selecione pelo menos 1 equipe.");

  const managedIds = new Set(getManagedTeamIds());
  if (teamIds.some(t => !managedIds.has(t))){
    return setAlert(refs.createTechAlert, "Você selecionou uma equipe fora do seu escopo de gestão.");
  }

  setAlert(refs.createTechAlert, "Salvando...", "info");

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
    setAlertWithResetLink(refs.createTechAlert, "Técnico criado com sucesso!", email, data.resetLink);
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
  if (!refs.modalManagedTeams) return;
  clearAlert(refs.managedTeamsAlert);
  refs.modalManagedTeams.hidden = false;

  state.managedTeamsTargetUid = targetUid;

  const title = targetName ? `Gestor: ${targetName}` : "Gestor";
  if (refs.managedTeamsSubtitle) refs.managedTeamsSubtitle.textContent = `${title} • selecione as equipes administradas`;

  const row = (state._usersCache || []).find(u => u.uid === targetUid);
  const current = Array.isArray(row?.managedTeamIds) ? row.managedTeamIds : [];
  state.managedTeamsSelected = Array.from(new Set(current));

  renderManagedTeamsChips();
}

function closeManagedTeamsModal(){ if (refs.modalManagedTeams) refs.modalManagedTeams.hidden = true; }

function renderManagedTeamsChips(){
  if (!refs.managedTeamsChips) return;
  refs.managedTeamsChips.innerHTML = "";

  const activeTeams = (state.teams || [])
    .filter(t => t.active !== false)
    .sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  if (activeTeams.length === 0){
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.fontSize = "13px";
    hint.textContent = "Crie equipes antes de definir equipes administradas.";
    refs.managedTeamsChips.appendChild(hint);
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

    refs.managedTeamsChips.appendChild(chip);
  }
}

async function saveManagedTeams(){
  clearAlert(refs.managedTeamsAlert);

  const targetUid = state.managedTeamsTargetUid;
  if (!targetUid) return setAlert(refs.managedTeamsAlert, "UID alvo inválido.");

  const managedTeamIds = Array.from(new Set(state.managedTeamsSelected || []));
  setAlert(refs.managedTeamsAlert, "Salvando...", "info");

  await updateDoc(doc(db, "companies", state.companyId, "users", targetUid), {
    managedTeamIds
  });

  closeManagedTeamsModal();
  await loadUsers();
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

  // 1) Super Admin
  const platformUser = await fetchPlatformUser(user.uid);
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
  if (!companyId){
    setView("login");
    setAlert(refs.loginAlert, "Seu usuário não está vinculado a nenhuma empresa. Peça ao admin para configurar.");
    await signOut(auth);
    return;
  }

  const profile = await fetchCompanyUserProfile(companyId, user.uid);
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
  state.profile = profile;

  renderTopbar(profile, user);
  renderDashboardCards(profile);
  setView("dashboard");
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