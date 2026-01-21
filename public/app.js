import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/** =========================
 *  1) CONFIG FIREBASE
 *  ========================= */
const firebaseConfig = {
  apiKey: "AIzaSyDDwKotSJLioYxaTdu0gf30U-haoT5wiyo",
  authDomain: "flowproject-17930.firebaseapp.com",
  projectId: "flowproject-17930",
  storageBucket: "flowproject-17930.firebasestorage.app",
  messagingSenderId: "254792794709",
  appId: "1:254792794709:web:fae624d7c4227b0c398adc"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/** =========================
 *  2) ESTADO
 *  ========================= */
const state = {
  companyId: null,
  profile: null,
  isSuperAdmin: false,
  teams: [],          // cache de equipes
  selectedTeamIds: [] // usado no modal usuário
};

/** =========================
 *  3) ELEMENTOS UI
 *  ========================= */
const viewLogin = document.getElementById("viewLogin");
const viewDashboard = document.getElementById("viewDashboard");
const viewAdmin = document.getElementById("viewAdmin");
const viewCompanies = document.getElementById("viewCompanies");

// Login
const loginForm = document.getElementById("loginForm");
const emailEl = document.getElementById("email");
const passwordEl = document.getElementById("password");
const btnForgot = document.getElementById("btnForgot");
const loginAlert = document.getElementById("loginAlert");

// Topbar
const btnLogout = document.getElementById("btnLogout");
const userPill = document.getElementById("userPill");
const userAvatar = document.getElementById("userAvatar");
const userName = document.getElementById("userName");
const userRole = document.getElementById("userRole");

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

const modalCreateCompany = document.getElementById("modalCreateCompany");
const btnCloseCreateCompany = document.getElementById("btnCloseCreateCompany");
const btnCancelCreateCompany = document.getElementById("btnCancelCreateCompany");
const btnCreateCompany = document.getElementById("btnCreateCompany");
const companyNameEl = document.getElementById("companyName");
const companyCnpjEl = document.getElementById("companyCnpj");
const companyIdEl = document.getElementById("companyId");
const adminUidEl = document.getElementById("adminUid");
const adminNameEl = document.getElementById("adminName");
const adminEmailEl = document.getElementById("adminEmail");
const adminPhoneEl = document.getElementById("adminPhone");
const adminActiveEl = document.getElementById("adminActive");
const createCompanyAlert = document.getElementById("createCompanyAlert");

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

/** =========================
 *  4) HELPERS
 *  ========================= */
function show(el){ if (el) el.hidden = false; }
function hide(el){ if (el) el.hidden = true; }

function setView(name){
  hide(viewLogin);
  hide(viewDashboard);
  hide(viewAdmin);
  hide(viewCompanies);

  if (name === "login") show(viewLogin);
  if (name === "dashboard") show(viewDashboard);
  if (name === "admin") show(viewAdmin);
  if (name === "companies") show(viewCompanies);
}

function clearAlert(el){ if (!el) return; el.textContent = ""; hide(el); }
function setAlert(el, msg, type="error") {
  if (!el) return;
  el.textContent = msg;
  if (type === "error") {
    el.style.borderColor = "rgba(239,68,68,.22)";
    el.style.background = "rgba(239,68,68,.08)";
    el.style.color = "#991b1b";
  } else {
    el.style.borderColor = "rgba(37,99,235,.25)";
    el.style.background = "rgba(37,99,235,.08)";
    el.style.color = "rgba(12,18,32,.85)";
  }
  show(el);
}

function normalizeRole(role){
  const map = {
    superadmin: "Master Admin",
    admin: "Admin",
    gestor: "Gestor",
    coordenador: "Coordenador",
    tecnico: "Técnico"
  };
  return map[role] || "Usuário";
}

function initialFromName(name){
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] || "U";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] || "") : "";
  return (a + b).toUpperCase();
}

function slugify(str){
  return (str || "")
    .toString()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function normalizeCnpj(cnpj){ return (cnpj || "").replace(/\D/g, ""); }
function isCnpjValidBasic(cnpj){ return normalizeCnpj(cnpj).length === 14; }

function normalizePhone(phone){ return (phone || "").replace(/\D/g, ""); }
function isEmailValidBasic(email){ return /^\S+@\S+\.\S+$/.test((email || "").trim()); }

/** =========================
 *  5) FIRESTORE READ HELPERS
 *  ========================= */
async function fetchPlatformUser(uid){
  const ref = doc(db, "platformUsers", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

async function fetchCompanyIdForUser(uid){
  const ref = doc(db, "userCompanies", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data()?.companyId || null;
}

async function fetchUserProfile(companyId, uid){
  const ref = doc(db, "companies", companyId, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/** =========================
 *  6) DASHBOARD
 *  ========================= */
function renderTopbar(profile, user){
  show(btnLogout);
  show(userPill);

  if (userName) userName.textContent = profile.name || "Usuário";
  if (userRole) userRole.textContent = normalizeRole(profile.role);
  if (userAvatar) userAvatar.textContent = initialFromName(profile.name);

  if (chipEmail) chipEmail.textContent = `Email: ${user.email || "—"}`;

  if (state.isSuperAdmin){
    if (chipTeam) chipTeam.textContent = "Equipe: —";
    if (dashTitle) dashTitle.textContent = "Painel Master";
    if (dashSubtitle) dashSubtitle.textContent = "Acesso total à plataforma (todas as empresas).";
  } else {
    const teamIds = Array.isArray(profile.teamIds) ? profile.teamIds : (profile.teamId ? [profile.teamId] : []);
    if (chipTeam) chipTeam.textContent = `Equipes: ${teamIds.length ? teamIds.join(", ") : "—"}`;
    if (dashTitle) dashTitle.textContent = "Painel";
    if (dashSubtitle) dashSubtitle.textContent = `Empresa: ${state.companyId} • Perfil: ${normalizeRole(profile.role)}.`;
  }
}

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

    cards.push({
      title: "Criar Empresa",
      desc: "Cadastre uma nova empresa e vincule o Admin.",
      badge: "Master",
      action: () => openCreateCompanyModal()
    });
  } else {
    cards.push({
      title: "Meus Projetos",
      desc: "Em breve: Kanban de projetos e visão por equipe.",
      badge: "Fase 2",
      action: () => alert("Fase 2: Kanban de Projetos")
    });

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

  const snap = await getDocs(collection(db, "companies"));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const q = (companySearch?.value || "").toLowerCase().trim();
  const filtered = !q ? all : all.filter(c =>
    (c.name || "").toLowerCase().includes(q) ||
    (c.cnpj || "").toLowerCase().includes(q) ||
    (c.id || "").toLowerCase().includes(q)
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
        <span class="badge">${c.active ? "Ativa" : "Inativa"}</span>
      </div>
    `;
    companiesGrid.appendChild(el);
  }
}

function openCreateCompanyModal(){
  if (!modalCreateCompany) return;
  clearAlert(createCompanyAlert);
  modalCreateCompany.hidden = false;

  companyNameEl.value = "";
  companyCnpjEl.value = "";
  companyIdEl.value = "";
  companyIdEl.dataset.auto = "true";

  adminUidEl.value = "";
  adminNameEl.value = "";
  adminEmailEl.value = "";
  adminPhoneEl.value = "";
  adminActiveEl.value = "true";
}

function closeCreateCompanyModal(){ if (modalCreateCompany) modalCreateCompany.hidden = true; }

async function createCompany(){
  clearAlert(createCompanyAlert);

  const name = (companyNameEl.value || "").trim();
  const cnpjRaw = (companyCnpjEl.value || "").trim();
  const cnpj = normalizeCnpj(cnpjRaw);
  const companyId = (companyIdEl.value || "").trim();

  const adminUid = (adminUidEl.value || "").trim();
  const adminName = (adminNameEl.value || "").trim();
  const adminEmail = (adminEmailEl.value || "").trim();
  const adminPhone = normalizePhone(adminPhoneEl.value || "");
  const adminActive = (adminActiveEl.value || "true") === "true";

  if (!name) return setAlert(createCompanyAlert, "Informe o nome da empresa.");
  if (!cnpjRaw) return setAlert(createCompanyAlert, "Informe o CNPJ.");
  if (!isCnpjValidBasic(cnpjRaw)) return setAlert(createCompanyAlert, "CNPJ inválido (precisa ter 14 dígitos).");
  if (!companyId) return setAlert(createCompanyAlert, "O ID da empresa (slug) está vazio.");

  if (!adminUid) return setAlert(createCompanyAlert, "Informe o UID do Admin (Authentication).");
  if (!adminName) return setAlert(createCompanyAlert, "Informe o nome do Admin.");
  if (!adminEmail || !isEmailValidBasic(adminEmail)) return setAlert(createCompanyAlert, "Informe um e-mail válido do Admin.");

  setAlert(createCompanyAlert, "Salvando...", "info");

  // empresa
  await setDoc(doc(db, "companies", companyId), {
    name,
    cnpj,
    active: true,
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser.uid
  });

  // admin da empresa: equipe NÃO é obrigatória aqui (teamIds vazio)
  await setDoc(doc(db, "companies", companyId, "users", adminUid), {
    name: adminName,
    role: "admin",
    email: adminEmail,
    phone: adminPhone,
    active: adminActive,
    teamIds: []
  });

  // vínculo
  await setDoc(doc(db, "userCompanies", adminUid), {
    companyId
  });

  closeCreateCompanyModal();
  await loadCompanies();
  alert("Empresa criada e Admin vinculado!\n\nAgora garanta que o usuário existe no Authentication com o mesmo UID.");
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
      // Toggle ativa/inativa
      const next = !(t.active === false);
      if (!confirm(`Deseja ${next ? "inativar" : "ativar"} a equipe "${t.name}"?`)) return;
      await updateDoc(doc(db, "companies", state.companyId, "teams", t.id), { active: !next });
      await loadTeams();
      // Atualiza chips no modal usuário se estiver aberto
      if (!modalCreateUser.hidden) renderTeamChips();
    });
    teamsGrid.appendChild(el);
  }
}

function openCreateTeamModal(){
  if (!modalCreateTeam) return;
  clearAlert(createTeamAlert);
  modalCreateTeam.hidden = false;
  teamNameEl.value = "";
  teamIdEl.value = "";
  teamIdEl.dataset.auto = "true";
}
function closeCreateTeamModal(){ if (modalCreateTeam) modalCreateTeam.hidden = true; }

async function createTeam(){
  clearAlert(createTeamAlert);

  const name = (teamNameEl.value || "").trim();
  const teamId = (teamIdEl.value || "").trim();

  if (!name) return setAlert(createTeamAlert, "Informe o nome da equipe.");
  if (!teamId) return setAlert(createTeamAlert, "Informe o ID (slug) da equipe.");

  setAlert(createTeamAlert, "Salvando...", "info");

  await setDoc(doc(db, "companies", state.companyId, "teams", teamId), {
    name,
    active: true,
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
  const roleFilter = (userRoleFilter?.value || "").trim();

  const filtered = all.filter(u => {
    const text = `${u.uid} ${u.name||""} ${u.email||""} ${u.phone||""}`.toLowerCase();
    const okQ = !q || text.includes(q);
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
          <button class="btn sm" data-act="toggle">${u.active === false ? "Ativar" : "Inativar"}</button>
        </div>
      </td>
    `;

    tr.querySelector('[data-act="toggle"]').addEventListener("click", async () => {
      const nextActive = (u.active === false);
      if (!confirm(`Deseja ${nextActive ? "ativar" : "inativar"} "${u.name}"?`)) return;
      await updateDoc(doc(db, "companies", state.companyId, "users", u.uid), { active: nextActive });
      await loadUsers();
    });

    usersTbody.appendChild(tr);
  }
}

function openCreateUserModal(){
  if (!modalCreateUser) return;
  clearAlert(createUserAlert);
  modalCreateUser.hidden = false;

  newUserUidEl.value = "";
  newUserNameEl.value = "";
  newUserRoleEl.value = "tecnico";
  newUserEmailEl.value = "";
  newUserPhoneEl.value = "";
  newUserActiveEl.value = "true";

  state.selectedTeamIds = [];
  renderTeamChips();
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

  const uid = (newUserUidEl.value || "").trim();
  const name = (newUserNameEl.value || "").trim();
  const role = (newUserRoleEl.value || "").trim();
  const email = (newUserEmailEl.value || "").trim();
  const phone = normalizePhone(newUserPhoneEl.value || "");
  const active = (newUserActiveEl.value || "true") === "true";
  const teamIds = Array.from(new Set(state.selectedTeamIds || []));

  if (!uid) return setAlert(createUserAlert, "Informe o UID (Authentication).");
  if (!name) return setAlert(createUserAlert, "Informe o nome do usuário.");
  if (!role) return setAlert(createUserAlert, "Selecione a função.");
  if (!email || !isEmailValidBasic(email)) return setAlert(createUserAlert, "Informe um e-mail válido.");

  // Regra: Admin pode ficar sem equipe; os demais precisam de pelo menos 1 equipe
  if (role !== "admin" && teamIds.length === 0){
    return setAlert(createUserAlert, "Selecione pelo menos 1 equipe para este usuário.");
  }

  setAlert(createUserAlert, "Salvando...", "info");

  // Perfil na empresa
  await setDoc(doc(db, "companies", state.companyId, "users", uid), {
    name,
    role,
    email,
    phone,
    active,
    teamIds,
    // compatibilidade (opcional): mantém o primeiro como teamId
    teamId: teamIds[0] || ""
  });

  // Vínculo do usuário com empresa (multi-tenant)
  await setDoc(doc(db, "userCompanies", uid), {
    companyId: state.companyId
  });

  closeCreateUserModal();
  await loadUsers();
}

/** =========================
 *  10) AUTH FLOW
 *  ========================= */
onAuthStateChanged(auth, async (user) => {
  clearAlert(loginAlert);

  state.companyId = null;
  state.profile = null;
  state.isSuperAdmin = false;

  if (!user){
    hide(btnLogout);
    hide(userPill);
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
    setAlert(loginAlert, "Seu usuário não está vinculado a nenhuma empresa. Peça ao admin para configurar.");
    await signOut(auth);
    return;
  }

  const profile = await fetchUserProfile(companyId, user.uid);
  if (!profile){
    setView("login");
    setAlert(loginAlert, "Seu perfil não foi encontrado dentro da empresa. Peça ao admin para criar.");
    await signOut(auth);
    return;
  }

  if (profile.active === false){
    setView("login");
    setAlert(loginAlert, "Usuário bloqueado. Fale com o administrador.");
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

btnLogout?.addEventListener("click", async () => {
  await signOut(auth);
});

// Dashboard navigation
btnBackToDashboard?.addEventListener("click", () => setView("dashboard"));
btnBackFromAdmin?.addEventListener("click", () => setView("dashboard"));

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
userRoleFilter?.addEventListener("change", () => loadUsers());
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
