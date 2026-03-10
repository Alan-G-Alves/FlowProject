/**
 * projects.domain.js
 * LÃ³gica de negÃ³cio para gestÃ£o de projetos
 */

import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

import { setAlert, clearAlert } from "../ui/alerts.js";
import { setView } from "../ui/router.js";
import { slugify } from "../utils/format.js";
import { escapeHtml } from "../utils/dom.js";
import { getTeamNameById, initialFromName } from "../utils/helpers.js";
import { ensureClientsCache } from "./clients.domain.js";

/**
 * Listener realtime do Kanban (Meus Projetos)
 */
let unsubscribeMyProjectsListener = null;

// Guarda o deps mais recente do Kanban para que busca/filters e re-renders
// nÃ£o percam state/db/auth (evita "Erro: nÃ£o autenticado" no drag&drop).
let _myProjectsDeps = null;

/* My Projects Kanban Search */
let _myProjectsLast = [];
let _myProjectsSearch = "";
let _myProjectsSearchInitialized = false;

// Create Project Modal state
let _createProjectUiInitialized = false;
let _selectedTechUids = [];
let _selectedProjectContractFile = null;
let _isCreatingProjectLocal = false;
let _editProjectUiInitialized = false;
let _editSelectedTechUids = [];
let _selectedEditProjectContractFile = null;
let _removeEditProjectContract = false;
let _editTechNamesByUid = new Map();

function _normText(v){
  return (v ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function _formatBRLAlias(num){
  if (num === null || num === undefined || num === "") return "";
  const n = Number(num);
  if (Number.isNaN(n)) return "";
  // inclui variaÃ§Ãµes Ãºteis para busca: "1500", "1500.5", "1500,50", "1.500,50", "r$ 1.500,50"
  const brl = n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const plain = String(n);
  const noSep = brl.replace(/[^0-9,]/g, "").replace(/\./g, "");
  return `${brl} ${plain} ${noSep}`.trim();
}

function _dateAliases(dateStr){
  if (!dateStr) return "";
  const s = String(dateStr).trim();
  // suporta "YYYY-MM-DD" ou "YYYY/MM/DD"
  const m = s.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})/);
  if (!m) return s;
  const yyyy = m[1], mm = m[2], dd = m[3];
  const br1 = `${dd}/${mm}/${yyyy}`;
  const br2 = `${dd}-${mm}-${yyyy}`;
  return `${s} ${br1} ${br2} ${mm}/${yyyy} ${yyyy}`.trim();
}

function _buildProjectSearchHaystack(p){
  const parts = [];
  // id/seq
  if (p?.projectNumber !== undefined && p?.projectNumber !== null) parts.push(String(p.projectNumber));
  if (p?.id) parts.push(String(p.id));
  // textos
  parts.push(p?.name || "");
  parts.push(p?.description || "");
  // prioridade (inclui alias com acento)
  const pri = String(p?.priority || "");
  if (pri) parts.push(pri, pri === "media" ? "mÃ©dia" : "", pri === "alta" ? "alta" : "", pri === "baixa" ? "baixa" : "");
  // datas
  parts.push(_dateAliases(p?.startDate));
  parts.push(_dateAliases(p?.endDate));
  // cobranÃ§a
  parts.push(_formatBRLAlias(p?.billingValue));
  if (p?.billingHours !== undefined && p?.billingHours !== null) parts.push(String(p.billingHours), `${p.billingHours}h`, `${p.billingHours}horas`);
  // status
  if (p?.status) parts.push(String(p.status));
  // remove vazios e normaliza
  return _normText(parts.filter(Boolean).join(" "));
}

function _matchesTokens(haystackNorm, query){
  const qn = _normText(query);
  if (!qn) return true;
  const tokens = qn.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every(t => haystackNorm.includes(t));
}

function _applyMyProjectsSearch(list){
  if (!Array.isArray(list)) return [];
  const q = _myProjectsSearch || "";
  if (!_normText(q)) return list;

  return list.filter(p => {
    const hay = _buildProjectSearchHaystack(p);
    return _matchesTokens(hay, q);
  });
}


function _renderMyProjectsWithFilter(refs){
  // âš ï¸ Importante: ao re-renderizar (ex.: busca), precisamos manter state/db/auth.
  // Caso contrÃ¡rio, o drag&drop cai no alert "Erro: nÃ£o autenticado".
  const deps = _myProjectsDeps || {};
  renderMyProjectsKanban(_applyMyProjectsSearch(_myProjectsLast), { ...deps, refs });
}

function initMyProjectsSearchUI(refs){
  // Busca "Meus Projetos" (Kanban)
  // ObservaÃ§Ã£o: o HTML atual nÃ£o tem botÃ£o toggle; o campo fica sempre visÃ­vel.
  if (_myProjectsSearchInitialized) return;
  _myProjectsSearchInitialized = true;

  const input = document.getElementById("myProjectsSearchInput");
  const btnClear = document.getElementById("btnClearMyProjectsSearch");

  if(!input) return;

  const syncClearBtn = () => {
    if (!btnClear) return;
    btnClear.style.visibility = input.value ? "visible" : "hidden";
  };

  // estado inicial
  input.value = _myProjectsSearch || "";
  syncClearBtn();

  input.addEventListener("input", () => {
    _myProjectsSearch = input.value || "";
    syncClearBtn();
    _renderMyProjectsWithFilter(refs);
  });

  if (btnClear) {
    btnClear.addEventListener("click", () => {
      input.value = "";
      _myProjectsSearch = "";
      syncClearBtn();
      _renderMyProjectsWithFilter(refs);
      input.focus();
    });
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (input.value) {
        input.value = "";
        _myProjectsSearch = "";
        syncClearBtn();
        _renderMyProjectsWithFilter(refs);
      }
      input.blur();
    }
  });
}

function _parseBRLToNumber(input){
  const raw = (input ?? "").toString().trim();
  if (!raw) return null;
  // remove R$, espaÃ§os e qualquer coisa que nÃ£o seja nÃºmero, ponto, vÃ­rgula, sinal
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/[^0-9,.-]/g, "");

  // pt-BR: 1.234,56
  const normalized = cleaned
    .replace(/\./g, "")
    .replace(/,/g, ".");

  const num = Number(normalized);
  if (Number.isNaN(num)) return null;
  return num;
}

function _formatBRL(input){
  const n = _parseBRLToNumber(input);
  if (n === null) return "";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function _parseHoursToNumber(input){
  const raw = (input ?? "").toString().trim();
  if (!raw) return null;
  const num = Number(raw.replace(/,/g, ".").replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(num)) return null;
  return num;
}

function _setProjectContractFileLabel(refs, text){
  if (!refs?.projectContractFileNameEl) return;
  refs.projectContractFileNameEl.textContent = text || "Nenhum PDF selecionado";
}

function _setEditProjectContractFileLabel(refs, text){
  if (!refs?.editProjectContractFileNameEl) return;
  refs.editProjectContractFileNameEl.textContent = text || "Nenhum PDF selecionado";
}

async function _uploadProjectContract(deps, companyId, projectId, file){
  const { storage } = deps || {};
  if (!storage || !file) return null;

  const isPdf = (file.type || "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name || "");
  if (!isPdf) throw new Error("Anexo invÃ¡lido. Envie um arquivo PDF.");
  if (file.size > 10 * 1024 * 1024) throw new Error("O contrato deve ter no mÃ¡ximo 10MB.");

  const safeName = (file.name || "contrato.pdf").replace(/[^\w.\-]+/g, "_");
  const path = `projectContracts/${companyId}/${projectId}/${Date.now()}_${safeName}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: "application/pdf" });
  const url = await getDownloadURL(ref);

  return {
    name: file.name || "contrato.pdf",
    path,
    url,
    size: Number(file.size || 0),
    contentType: "application/pdf"
  };
}

function _ensureCreateProjectUi(refs, state){
  if (_createProjectUiInitialized) return;
  _createProjectUiInitialized = true;

  // Prioridade (chips)
  const chipsWrap = document.getElementById("projectPriorityChips");
  const hidden = refs?.projectPriorityEl || document.getElementById("projectPriority");
  if (chipsWrap && hidden) {
    chipsWrap.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".chip[data-priority]");
      if (!btn) return;
      const val = btn.getAttribute("data-priority") || "media";

      chipsWrap.querySelectorAll(".chip").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      hidden.value = val;
    });
  }

  // Valor (mask BRL)
  const valueEl = refs?.projectBillingValueAmountEl || document.getElementById("projectBillingValueAmount");
  if (valueEl) {
    valueEl.addEventListener("blur", () => {
      const f = _formatBRL(valueEl.value);
      valueEl.value = f || "";
    });
    // Se o usuÃ¡rio comeÃ§ar a digitar "R$" etc, nÃ£o atrapalhar: apenas limpa no focus
    valueEl.addEventListener("focus", () => {
      // mantÃ©m nÃºmeros (pra facilitar ediÃ§Ã£o)
      const n = _parseBRLToNumber(valueEl.value);
      valueEl.value = n === null ? "" : String(n).replace(/\./g, ",");
    });
  }

  // TÃ©cnicos (select + chips)
  const techSelect = refs?.projectTechSelectEl || document.getElementById("projectTechSelect");
  if (techSelect) {
    techSelect.addEventListener("change", () => {
      const uid = techSelect.value || "";
      if (!uid) return;
      if (!_selectedTechUids.includes(uid)) _selectedTechUids.push(uid);
      techSelect.value = "";
      _renderSelectedTechChips(refs, state);
    });
  }

  const chipsEl = refs?.projectTechChipsEl || document.getElementById("projectTechChips");
  if (chipsEl) {
    chipsEl.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("button[data-tech-uid]");
      if (!btn) return;
      const uid = btn.getAttribute("data-tech-uid");
      _selectedTechUids = _selectedTechUids.filter(x => x !== uid);
      _renderSelectedTechChips(refs, state);
    });
  }

  const contractInput = refs?.projectContractFileEl || document.getElementById("projectContractFile");
  const removeContractBtn = refs?.btnRemoveProjectContract || document.getElementById("btnRemoveProjectContract");
  if (contractInput && !contractInput.dataset.bound) {
    contractInput.dataset.bound = "1";
    contractInput.addEventListener("change", () => {
      const file = contractInput.files?.[0] || null;
      _selectedProjectContractFile = file;
      _setProjectContractFileLabel(refs, file ? file.name : "Nenhum PDF selecionado");
    });
  }
  if (removeContractBtn && !removeContractBtn.dataset.bound) {
    removeContractBtn.dataset.bound = "1";
    removeContractBtn.addEventListener("click", () => {
      _selectedProjectContractFile = null;
      if (contractInput) contractInput.value = "";
      _setProjectContractFileLabel(refs, "Nenhum PDF selecionado");
    });
  }
}

function _ensureEditProjectUi(refs, state){
  if (_editProjectUiInitialized) return;
  _editProjectUiInitialized = true;

  const chipsWrap = document.getElementById("editProjectPriorityChips");
  const hidden = refs?.editProjectPriorityEl || document.getElementById("editProjectPriority");
  if (chipsWrap && hidden) {
    chipsWrap.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".chip[data-priority]");
      if (!btn) return;
      const val = btn.getAttribute("data-priority") || "media";

      chipsWrap.querySelectorAll(".chip").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      hidden.value = val;
    });
  }

  const techSelect = refs?.editProjectTechSelectEl || document.getElementById("editProjectTechSelect");
  if (techSelect){
    techSelect.addEventListener("change", () => {
      const uid = techSelect.value || "";
      if (!uid) return;
      if (!_editSelectedTechUids.includes(uid)) _editSelectedTechUids.push(uid);
      techSelect.value = "";
      _renderEditSelectedTechChips(refs, state);
    });
  }

  const chipsEl = refs?.editProjectTechChipsEl || document.getElementById("editProjectTechChips");
  if (chipsEl){
    chipsEl.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("button[data-edit-tech-uid]");
      if (!btn) return;
      const uid = btn.getAttribute("data-edit-tech-uid");
      _editSelectedTechUids = _editSelectedTechUids.filter(x => x !== uid);
      _renderEditSelectedTechChips(refs, state);
    });
  }

  const teamEl = refs?.editProjectTeamEl || document.getElementById("editProjectTeam");
  if (teamEl){
    teamEl.addEventListener("change", () => {
      _renderEditSelectedTechChips(refs, state);
    });
  }

  const clientEl = refs?.editProjectClientEl || document.getElementById("editProjectClient");
  if (clientEl){
    clientEl.addEventListener("change", () => {
      _renderEditProjectKeyUsers(refs, state, clientEl.value || "", []);
    });
  }

  const valueEl = refs?.editProjectBillingValueAmountEl || document.getElementById("editProjectBillingValueAmount");
  if (valueEl){
    valueEl.addEventListener("blur", () => {
      const f = _formatBRL(valueEl.value);
      valueEl.value = f || "";
    });
    valueEl.addEventListener("focus", () => {
      const n = _parseBRLToNumber(valueEl.value);
      valueEl.value = n === null ? "" : String(n).replace(/\./g, ",");
    });
  }

  const contractInput = refs?.editProjectContractFileEl || document.getElementById("editProjectContractFile");
  const removeContractBtn = refs?.btnRemoveEditProjectContract || document.getElementById("btnRemoveEditProjectContract");
  if (contractInput && !contractInput.dataset.bound) {
    contractInput.dataset.bound = "1";
    contractInput.addEventListener("change", () => {
      const file = contractInput.files?.[0] || null;
      _selectedEditProjectContractFile = file;
      _removeEditProjectContract = false;
      _setEditProjectContractFileLabel(refs, file ? file.name : "Nenhum PDF selecionado");
    });
  }
  if (removeContractBtn && !removeContractBtn.dataset.bound) {
    removeContractBtn.dataset.bound = "1";
    removeContractBtn.addEventListener("click", () => {
      _selectedEditProjectContractFile = null;
      _removeEditProjectContract = true;
      if (contractInput) contractInput.value = "";
      _setEditProjectContractFileLabel(refs, "Nenhum PDF selecionado");
    });
  }
}

function _listActiveTechs(state, teamId){
  const users = Array.isArray(state?._usersCache) ? state._usersCache : [];
  const techs = users
    .filter(u => u && u.role === "tecnico" && u.active !== false);

  if (teamId) {
    return techs.filter(u => {
      const teamIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
      return teamIds.includes(teamId);
    });
  }

  return techs;
}

function _populateTechSelect(selectEl, state, teamId){
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Selecione um tÃ©cnico</option>';

  const techs = _listActiveTechs(state, teamId);
  techs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  for (const t of techs) {
    // nÃ£o listar os jÃ¡ selecionados
    if (_selectedTechUids.includes(t.uid)) continue;
    const opt = document.createElement("option");
    opt.value = t.uid;
    opt.textContent = t.name || t.email || t.uid;
    selectEl.appendChild(opt);
  }
}

function _renderSelectedTechChips(refs, state){
  const chipsEl = refs?.projectTechChipsEl || document.getElementById("projectTechChips");
  const techSelect = refs?.projectTechSelectEl || document.getElementById("projectTechSelect");
  if (!chipsEl) return;

  const users = Array.isArray(state?._usersCache) ? state._usersCache : [];
  const byUid = new Map(users.map(u => [u.uid, u]));

  chipsEl.innerHTML = "";
  const colorClasses = ["t1", "t2", "t3", "t4", "t5", "t6"];
  _selectedTechUids.forEach((uid, idx) => {
    const u = byUid.get(uid);
    const name = (_editTechNamesByUid.get(uid) || u?.name || u?.email || uid);
    const chip = document.createElement("span");
    chip.className = `chip project-tech-chip ${colorClasses[idx % colorClasses.length]}`;
    chip.innerHTML = `
      <span>${escapeHtml(name)}</span>
      <button type="button" class="project-tech-chip-remove" data-tech-uid="${escapeHtml(uid)}" aria-label="Remover tÃ©cnico">Ã—</button>
    `;
    chipsEl.appendChild(chip);
  });

  // re-popula select para esconder os jÃ¡ escolhidos
  const teamId = (refs?.projectTeamEl?.value || document.getElementById("projectTeam")?.value || "");
  _populateTechSelect(techSelect, state, teamId);
}

function _populateEditTechSelect(selectEl, state, teamId){
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Selecione um tÃ©cnico</option>';
  const techs = _listActiveTechs(state, teamId);
  techs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  for (const t of techs){
    if (_editSelectedTechUids.includes(t.uid)) continue;
    const opt = document.createElement("option");
    opt.value = t.uid;
    opt.textContent = t.name || t.email || t.uid;
    selectEl.appendChild(opt);
  }
}

function _renderEditSelectedTechChips(refs, state){
  const chipsEl = refs?.editProjectTechChipsEl || document.getElementById("editProjectTechChips");
  const techSelect = refs?.editProjectTechSelectEl || document.getElementById("editProjectTechSelect");
  if (!chipsEl) return;

  const users = Array.isArray(state?._usersCache) ? state._usersCache : [];
  const byUid = new Map(users.map(u => [u.uid, u]));
  chipsEl.innerHTML = "";
  const colorClasses = ["t1", "t2", "t3", "t4", "t5", "t6"];
  _editSelectedTechUids.forEach((uid, idx) => {
    const u = byUid.get(uid);
    const name = (_editTechNamesByUid.get(uid) || u?.name || u?.email || uid);
    const chip = document.createElement("span");
    chip.className = `chip project-tech-chip ${colorClasses[idx % colorClasses.length]}`;
    chip.innerHTML = `
      <span>${escapeHtml(name)}</span>
      <button type="button" class="project-tech-chip-remove" data-edit-tech-uid="${escapeHtml(uid)}" aria-label="Remover tÃ©cnico">x</button>
    `;
    chipsEl.appendChild(chip);
  });

  const teamId = (refs?.editProjectTeamEl?.value || document.getElementById("editProjectTeam")?.value || "");
  _populateEditTechSelect(techSelect, state, teamId);
}

function _clientKeyUsersByClientId(state, clientId){
  const clients = Array.isArray(state?._clientsCache) ? state._clientsCache : [];
  const client = clients.find(c => c.id === clientId);
  if (!client) return [];
  if (Array.isArray(client.keyUsers) && client.keyUsers.length){
    return client.keyUsers.filter(Boolean).map(ku => ({
      name: ku?.name || "",
      email: ku?.email || "",
      phone: ku?.phone || ""
    })).filter(ku => ku.name || ku.email || ku.phone);
  }
  const legacy = {
    name: client.keyUserName || "",
    email: client.keyUserEmail || "",
    phone: client.keyUserPhone || ""
  };
  return (legacy.name || legacy.email || legacy.phone) ? [legacy] : [];
}

function _keyUserId(ku){
  return `${(ku?.name || "").trim()}|${(ku?.email || "").trim()}|${(ku?.phone || "").trim()}`;
}

async function _ensureEditProjectContext(state, db, companyId){
  if (!Array.isArray(state.teams) || !state.teams.length){
    const teamsSnap = await getDocs(collection(db, `companies/${companyId}/teams`));
    state.teams = teamsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  if (!Array.isArray(state._usersCache) || !state._usersCache.length){
    const usersSnap = await getDocs(collection(db, `companies/${companyId}/users`));
    state._usersCache = usersSnap.docs.map(d => {
      const data = d.data() || {};
      return { uid: data.uid || d.id, ...data };
    });
  }
}

/**
 * Helper: garante refs do Kanban mesmo quando deps/refs nÃ£o sÃ£o passados
 */
function getKanbanRefsSafe(deps) {
  const refs = deps?.refs || {};
  const dom = (id) => document.getElementById(id);

  return {
    // containers kanban (ordem: A Fazer, Em Andamento, Go Live, ConcluÃ­do, Parado, Backlog)
    kanbanTodo: refs.kanbanTodo || dom("kanbanTodo"),
    kanbanInProgress: refs.kanbanInProgress || dom("kanbanInProgress"),
    kanbanGoLive: refs.kanbanGoLive || dom("kanbanGoLive"),
    kanbanDone: refs.kanbanDone || dom("kanbanDone"),
    kanbanPaused: refs.kanbanPaused || dom("kanbanPaused"),
    kanbanBacklog: refs.kanbanBacklog || dom("kanbanBacklog"),

    // contadores (se existirem)
    kanbanCountTodo: refs.kanbanCountTodo || dom("kanbanCountTodo"),
    kanbanCountInProgress: refs.kanbanCountInProgress || dom("kanbanCountInProgress"),
    kanbanCountGoLive: refs.kanbanCountGoLive || dom("kanbanCountGoLive"),
    kanbanCountDone: refs.kanbanCountDone || dom("kanbanCountDone"),
    kanbanCountPaused: refs.kanbanCountPaused || dom("kanbanCountPaused"),
    kanbanCountBacklog: refs.kanbanCountBacklog || dom("kanbanCountBacklog"),
  };
}

/**
 * Abre a view de projetos
 */
export function openProjectsView(deps) {
  const { loadProjects } = deps || {};
  setView("projects");
  if (typeof loadProjects === "function") {
    loadProjects(deps).catch(err => {
      console.error(err);
      alert("Erro ao carregar projetos: " + (err?.message || err));
    });
  }
}

/**
 * Carrega lista de projetos (GRID)
 */
export async function loadProjects(deps) {
  const { refs, state, db } = deps;

  if (!refs.projectsGrid) return;

  refs.projectsGrid.innerHTML = '<div class="loading">Carregando projetos...</div>';

  if (refs.projectsEmpty) refs.projectsEmpty.hidden = true;

  try {
    const companyId = state.companyId;
    if (!companyId) throw new Error("companyId nÃ£o encontrado");

    // Query base
    let q = query(
      collection(db, `companies/${companyId}/projects`),
      orderBy("createdAt", "desc")
    );

    // Filtros (se houver refs)
    const teamFilter = refs.projectTeamFilter?.value || "";
    const statusFilter = refs.projectStatusFilter?.value || "";
    const coordinatorFilter = refs.projectCoordinatorFilter?.value || "";
    const searchText = (refs.projectSearch?.value || "").trim().toLowerCase();

    const snap = await getDocs(q);
    let projects = [];

    snap.forEach(docSnap => {
      projects.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Filtros client-side (busca livre + equipe/status/coordenador)
    if (searchText) {
      projects = projects.filter(p => _matchesTokens(_buildProjectSearchHaystack(p), searchText));
    }

    if (teamFilter) {
      projects = projects.filter(p => p.teamId === teamFilter);
    }

    if (statusFilter) {
      projects = projects.filter(p => p.status === statusFilter);
    }

    if (coordinatorFilter) {
      projects = projects.filter(p => p.coordinatorUid === coordinatorFilter);
    }

    refs.projectsGrid.innerHTML = "";

    if (projects.length === 0) {
      if (refs.projectsEmpty) refs.projectsEmpty.hidden = false;
      return;
    }

    for (const proj of projects) {
      renderProjectCard(proj, deps);
    }

  } catch (err) {
    console.error("loadProjects error", err);
    refs.projectsGrid.innerHTML = '<div class="alert">Erro ao carregar projetos.</div>';
  }
}

/**
 * Renderiza card de projeto
 */
function renderProjectCard(proj, deps) {
  const { refs, state, openProjectDetailModal } = deps;

  const card = document.createElement("div");
  card.className = "card";
  card.style.gridColumn = "span 4";

  const statusBadge = getStatusBadge(proj.status);
  const priorityBadge = getPriorityBadge(proj.priority);
  const teamName = getTeamNameById(proj.teamId, state.teams);

  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
      <h3 class="title" style="margin:0;">${escapeHtml(proj.name || "Sem nome")}</h3>
      ${statusBadge}
    </div>
    <p class="desc" style="margin:6px 0 12px 0;">${escapeHtml(proj.description || "Sem descriÃ§Ã£o")}</p>
    <div class="meta" style="display:flex; gap:8px; flex-wrap:wrap;">
      ${priorityBadge}
      <span class="badge small">${escapeHtml(teamName)}</span>
    </div>
  `;

  card.addEventListener("click", () => {
    if (openProjectDetailModal) {
      openProjectDetailModal(proj.id, deps);
    }
  });

  refs.projectsGrid.appendChild(card);
}

/**
 * Meta (UI) por status do projeto
 * - Use as mesmas cores das colunas do Kanban, para manter consistÃªncia visual.
 * - Tons "leves" (nÃ£o saturados) para nÃ£o poluir a tela.
 */
const PROJECT_STATUS_META = {
  "a-fazer":      { label: "A Fazer",       color: "#3b82f6" }, // azul leve
  "em-andamento": { label: "Em andamento",  color: "#f59e0b" }, // Ã¢mbar/laranja leve
  "go-live":      { label: "Go Live",       color: "#22c55e" }, // verde leve
  "concluido":    { label: "ConcluÃ­do",     color: "#94a3b8" }, // cinza/neutral
  "parado":       { label: "Parado",        color: "#ef4444" }, // vermelho leve
  "backlog":      { label: "Backlog",       color: "#8b5cf6" }, // roxo leve
};

function getProjectStatusMeta(status){
  const st = (status || "a-fazer").toLowerCase();
  return PROJECT_STATUS_META[st] || PROJECT_STATUS_META["a-fazer"];
}

function getStatusBadge(status) {
  const map = {
    "a-fazer":    { label: "A Fazer",      cls: "badge info"    }, // azul leve
    "em-andamento": { label: "Em Andamento", cls: "badge warn"    }, // laranja leve
    "go-live":    { label: "Go Live",      cls: "badge success" }, // verde leve
    "concluido":  { label: "ConcluÃ­do",    cls: "badge"         }, // neutro/cinza
    "parado":     { label: "Parado",       cls: "badge danger"  }, // vermelho/alarme
    "backlog":    { label: "Backlog",      cls: "badge info"    }, // roxo leve (se nÃ£o existir, cai no badge padrÃ£o)
  };

  const st = (status || "a-fazer").toLowerCase();
  const obj = map[st] || { label: st, cls: "badge" };
  return `<span class="${obj.cls}">${escapeHtml(obj.label)}</span>`;
}

/**
 * Badge de prioridade
 */
function getPriorityBadge(priority) {
  const map = {
    "baixa": '<span class="badge small" style="background:rgba(148,163,184,.10); border-color:rgba(148,163,184,.25);">Baixa</span>',
    "media": '<span class="badge small" style="background:rgba(249,115,22,.10); border-color:rgba(249,115,22,.25);">MÃ©dia</span>',
    "alta": '<span class="badge small" style="background:rgba(239,68,68,.10); border-color:rgba(239,68,68,.25); color:#b91c1c;">Alta</span>'
  };
  return map[priority] || '<span class="badge small">â€”</span>';
}

/**
 * Abre modal de criar projeto
 */
export async function openCreateProjectModal(deps) {
  const { refs, state } = deps;

  if (!refs.modalCreateProject) return;

  clearAlert(refs.createProjectAlert);

  // Limpa campos
  if (refs.projectNameEl) refs.projectNameEl.value = "";
  if (refs.projectDescriptionEl) refs.projectDescriptionEl.value = "";
  if (refs.projectManagerEl) refs.projectManagerEl.value = "";
  if (refs.projectCoordinatorEl) refs.projectCoordinatorEl.value = "";
  if (refs.projectTeamEl) refs.projectTeamEl.value = "";
  if (refs.projectClientEl) refs.projectClientEl.value = "";
  // billing/status antigos (inputs removidos do HTML) â€” mantemos compatibilidade via refs opcionais
  if (refs.projectBillingValueEl) refs.projectBillingValueEl.checked = true;
  if (refs.projectBillingHoursEl) refs.projectBillingHoursEl.checked = false;
  if (refs.projectStatusEl) refs.projectStatusEl.value = "a-fazer";
  if (refs.projectPriorityEl) refs.projectPriorityEl.value = "media";
  if (refs.projectStartDateEl) refs.projectStartDateEl.value = "";
  if (refs.projectEndDateEl) refs.projectEndDateEl.value = "";
  if (refs.projectBillingValueAmountEl) refs.projectBillingValueAmountEl.value = "";
  if (refs.projectBillingHoursAmountEl) refs.projectBillingHoursAmountEl.value = "";
  _selectedProjectContractFile = null;
  if (refs.projectContractFileEl) refs.projectContractFileEl.value = "";
  _setProjectContractFileLabel(refs, "Nenhum PDF selecionado");

  // reset tÃ©cnicos
  _selectedTechUids = [];
  if (refs.projectTechSelectEl) refs.projectTechSelectEl.value = "";
  if (refs.projectTechChipsEl) refs.projectTechChipsEl.innerHTML = "";

  // Preenche select de equipes
  populateTeamSelect(refs.projectTeamEl, state.teams);

  // Preenche select de gestores (apenas role='gestor')
  populateManagerSelect(refs.projectManagerEl, state._usersCache);

  // Preenche select de coordenadores (apenas role='coordenador')
  populateCoordinatorSelectNew(refs.projectCoordinatorEl, state._usersCache);

  // Preenche select de clientes (opcional)
  // Garante que o cache de clientes foi carregado (sem depender de abrir a tela "Clientes")
  await ensureClientsCache(deps);
  populateClientSelect(refs.projectClientEl, state._clientsCache || []);

  // UI do modal (chips + mÃ¡scara + tÃ©cnicos)
  _ensureCreateProjectUi(refs, state);

  // Reseta visual dos chips de prioridade para o padrÃ£o (mÃ©dia)
  const chipsWrap = document.getElementById("projectPriorityChips");
  if (chipsWrap) {
    chipsWrap.querySelectorAll(".chip").forEach(b => b.classList.remove("selected"));
    const def = chipsWrap.querySelector('.chip[data-priority="media"]');
    def?.classList.add("selected");
  }
  _populateTechSelect(refs.projectTechSelectEl, state, refs.projectTeamEl?.value || "");

  // Quando troca equipe, filtra tÃ©cnicos
  if (refs.projectTeamEl) {
    refs.projectTeamEl.onchange = () => {
      _populateTechSelect(refs.projectTechSelectEl, state, refs.projectTeamEl.value || "");
      _renderSelectedTechChips(refs, state);
    };
  }

  refs.modalCreateProject.hidden = false;
  document.body.classList.add("modal-open");
}

/**
 * Fecha modal de criar projeto
 */
export function closeCreateProjectModal(refs) {
  if (!refs.modalCreateProject) return;
  refs.modalCreateProject.hidden = true;
  document.body.classList.remove("modal-open");
}

/**
 * Cria projeto
 */
export async function createProject(deps) {
  const { refs, state, db, auth, closeCreateProjectModal } = deps;

  clearAlert(refs.createProjectAlert);

  const name = (refs.projectNameEl?.value || "").trim();
  const description = (refs.projectDescriptionEl?.value || "").trim();
  const managerUid = refs.projectManagerEl?.value || "";
  const coordinatorUid = refs.projectCoordinatorEl?.value || "";
  const teamId = refs.projectTeamEl?.value || "";
  const clientId = refs.projectClientEl?.value || "";
  const clientName = clientId ? ((state._clientsCache||[]).find(c=>c.id===clientId)?.name || "") : "";
  const clientNumber = clientId ? ((state._clientsCache||[]).find(c=>c.id===clientId)?.number ?? "") : "";
  // CobranÃ§a (inputs atuais do modal)
  const billingValue = _parseBRLToNumber(refs.projectBillingValueAmountEl?.value || "");
  const billingHours = _parseHoursToNumber(refs.projectBillingHoursAmountEl?.value || "");

  const billingType = (billingValue !== null && billingValue > 0)
    ? "valor"
    : (billingHours !== null && billingHours > 0)
      ? "horas"
      : "";

  const status = "a-fazer";
  const priority = refs.projectPriorityEl?.value || "media";
  const startDate = refs.projectStartDateEl?.value || "";
  const endDate = refs.projectEndDateEl?.value || "";

  // TÃ©cnicos selecionados (chips)
  const techUids = Array.isArray(_selectedTechUids) ? [..._selectedTechUids] : [];

  // ValidaÃ§Ãµes
  if (!name) {
    setAlert(refs.createProjectAlert, "Informe o nome do projeto.");
    return;
  }

  if (!managerUid) {
    setAlert(refs.createProjectAlert, "Selecione um gestor.");
    return;
  }

  if (_isCreatingProjectLocal) return;
  _isCreatingProjectLocal = true;
  setAlert(refs.createProjectAlert, "Salvando...", "info");

  try {
    const companyId = state.companyId;
    const user = auth.currentUser;

    if (!companyId || !user) throw new Error("NÃ£o autenticado ou empresa nÃ£o encontrada");

    const projectId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // âœ… SequÃªncia numÃ©rica do projeto (compatÃ­vel com o formato antigo do card)
    // EstratÃ©gia simples (sem criar coleÃ§Ã£o extra): busca o maior projectNumber e soma +1.
    // (AssunÃ§Ã£o) Volume por empresa Ã© baixo a mÃ©dio.
    let nextProjectNumber = 1;
    try {
      const snapAll = await getDocs(collection(db, `companies/${companyId}/projects`));
      let maxNum = 0;
      snapAll.forEach(s => {
        const d = s.data() || {};
        const n = d.projectNumber ?? d.number ?? d.seq ?? d.codeNumber;
        const nn = (typeof n === "number") ? n : Number(String(n || "").replace(/[^0-9]/g, ""));
        if (!Number.isNaN(nn) && nn > maxNum) maxNum = nn;
      });
      nextProjectNumber = maxNum + 1;
    } catch (e) {
      // fallback: mantÃ©m 1
      console.warn("NÃ£o consegui calcular projectNumber, usando 1.", e);
    }

    const payload = {
      projectNumber: nextProjectNumber,
      name,
      description,
      managerUid,
      coordinatorUid: coordinatorUid || "",
      teamId: teamId || "",
      clientId: clientId || "",
      clientName: clientName || "",
      clientNumber: clientNumber ?? "",
      billingType,
      billingValue: billingValue ?? null,
      billingHours: billingHours ?? null,
      techUids,
      status,
      priority,
      startDate: startDate || null,
      endDate: endDate || null,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid
    };

    if (_selectedProjectContractFile){
      const contract = await _uploadProjectContract(deps, companyId, projectId, _selectedProjectContractFile);
      if (contract){
        payload.contract = {
          ...contract,
          uploadedAt: serverTimestamp(),
          uploadedBy: user.uid
        };
      }
    }

    await setDoc(doc(db, `companies/${companyId}/projects`, projectId), payload);

    setAlert(refs.createProjectAlert, "Projeto criado com sucesso!", "success");

    setTimeout(() => {
      closeCreateProjectModal(refs);
      // âœ… grid: recarrega usando deps
      if (typeof deps.loadProjects === "function") deps.loadProjects(deps);
      // âœ… kanban realtime jÃ¡ vai refletir via onSnapshot se estiver aberto
    }, 600);

  } catch (err) {
    console.error("createProject error", err);
    setAlert(refs.createProjectAlert, "Erro ao criar projeto: " + (err?.message || err));
  } finally {
    _isCreatingProjectLocal = false;
  }
}

/**
 * Popula select de equipes
 */
function populateTeamSelect(selectEl, teams) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Selecione uma equipe</option>';

  for (const team of teams) {
    const opt = document.createElement("option");
    opt.value = team.id;
    opt.textContent = team.name || team.id;
    selectEl.appendChild(opt);
  }
}

/**
 * Popula select de gestores (apenas role='gestor')
 */
function populateManagerSelect(selectEl, users) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Selecione um gestor</option>';

  if (!users || !Array.isArray(users)) return;

  const managers = users.filter(u => u.role === "gestor" && u.active !== false);
  managers.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  for (const user of managers) {
    const opt = document.createElement("option");
    opt.value = user.uid;
    opt.textContent = user.name || user.email;
    selectEl.appendChild(opt);
  }
}

/**
 * Popula select de coordenadores (apenas role='coordenador')
 */
function populateCoordinatorSelectNew(selectEl, users) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Selecione (opcional)</option>';

  if (!users || !Array.isArray(users)) return;

  const coordinators = users.filter(u => u.role === "coordenador" && u.active !== false);
  coordinators.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  for (const user of coordinators) {
    const opt = document.createElement("option");
    opt.value = user.uid;
    opt.textContent = user.name || user.email;
    selectEl.appendChild(opt);
  }
}

function populateClientSelect(selectEl, clients){
  if (!selectEl) return;
  const list = Array.isArray(clients) ? clients.slice() : [];
  // placeholder
  const opts = ['<option value="">â€” Selecione um cliente (opcional) â€”</option>'];
  list
    .filter(c => c && c.active !== false)
    .sort((a,b)=> (a.name||"").localeCompare(b.name||""))
    .forEach(c => {
      opts.push(`<option value="${c.id}">${(c.number ?? "")} - ${escapeHtml(c.name || "")}</option>`);
    });
  selectEl.innerHTML = opts.join("");
}

/**
 * Popula select de coordenadores (Gestores + Coordenadores)
 */
async function populateCoordinatorSelect(selectEl, deps) {
  if (!selectEl) return;

  const { state, db } = deps;

  selectEl.innerHTML = '<option value="">Selecione um coordenador (opcional)</option>';

  try {
    const companyId = state.companyId;
    if (!companyId) return;

    const snap = await getDocs(
      query(
        collection(db, `companies/${companyId}/users`),
        where("role", "in", ["gestor", "coordenador"]),
        where("active", "==", true)
      )
    );

    const users = [];
    snap.forEach(docSnap => {
      users.push({ uid: docSnap.id, ...docSnap.data() });
    });

    users.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    for (const u of users) {
      const opt = document.createElement("option");
      opt.value = u.uid;
      opt.textContent = `${u.name || "Sem nome"} (${u.role === "gestor" ? "Gestor" : "Coordenador"})`;
      selectEl.appendChild(opt);
    }

  } catch (err) {
    console.error("populateCoordinatorSelect error", err);
  }
}

/**
 * Abre modal de detalhes do projeto
 */
export async function openProjectDetailModal(projectId, deps) {
  const { refs, state, db } = deps;

  if (!refs.modalProjectDetail) return;

  clearAlert(refs.projectDetailAlert);

  try {
    const companyId = state.companyId;
    if (!companyId) throw new Error("companyId nÃ£o encontrado");

    await _ensureEditProjectContext(state, db, companyId);

    const docSnap = await getDoc(doc(db, `companies/${companyId}/projects`, projectId));

    if (!docSnap.exists()) {
      throw new Error("Projeto nÃ£o encontrado");
    }

    const proj = { id: docSnap.id, ...docSnap.data() };

    _editTechNamesByUid = new Map(
      (Array.isArray(state?._usersCache) ? state._usersCache : []).map(u => [u.uid, u.name || u.email || u.uid])
    );
    const missingTechUids = (Array.isArray(proj.techUids) ? proj.techUids : []).filter(uid => !_editTechNamesByUid.has(uid));
    if (missingTechUids.length) {
      const usersSnap = await getDocs(collection(db, `companies/${companyId}/users`));
      usersSnap.forEach((userDoc) => {
        const userData = userDoc.data() || {};
        const uid = userData.uid || userDoc.id;
        if (missingTechUids.includes(uid)) {
          _editTechNamesByUid.set(uid, userData.name || userData.email || uid);
        }
      });
    }

    const teamObj = (state.teams || []).find(t => t.id === proj.teamId);
    const teamName = (
      teamObj?.name
      || proj.teamName
      || proj.team?.name
      || (typeof proj.teamId === "string" ? proj.teamId : "")
    ) || "-";
    const managerObj = (state._usersCache || []).find(u => u.uid === proj.managerUid);
    const managerName = (
      managerObj?.name
      || managerObj?.email
      || proj.managerName
      || proj.manager?.name
      || "Nenhum"
    );
    const techNames = (Array.isArray(proj.techUids) ? proj.techUids : []).map(uid => _editTechNamesByUid.get(uid) || uid);
    const keyUsers = _clientKeyUsersByClientId(state, proj.clientId || "");
    const keyUserNames = keyUsers
      .map((ku) => {
        if (typeof ku === "string") return ku;
        return ku?.name || ku?.email || ku?.phone || "";
      })
      .filter(Boolean);

    // Preenche dados do modal
    if (refs.projectDetailTitle) refs.projectDetailTitle.textContent = proj.name || "Projeto";
    if (refs.projectDetailDescription) refs.projectDetailDescription.textContent = proj.description || "Sem descricao";
    if (refs.projectDetailClient) refs.projectDetailClient.textContent = proj.clientName || "Nenhum";
    if (refs.projectDetailTeam) refs.projectDetailTeam.textContent = teamName;
    if (refs.projectDetailManager) refs.projectDetailManager.textContent = managerName;
    if (refs.projectDetailStatus) refs.projectDetailStatus.innerHTML = getStatusBadge(proj.status);
    if (refs.projectDetailPriority) refs.projectDetailPriority.innerHTML = getPriorityBadge(proj.priority);

    // Coordenador
    if (refs.projectDetailCoordinator) {
      if (proj.coordinatorUid) {
        const coordFromCache = (state._usersCache || []).find(u => u.uid === proj.coordinatorUid);
        if (coordFromCache?.name || coordFromCache?.email) {
          refs.projectDetailCoordinator.textContent = coordFromCache.name || coordFromCache.email;
        } else {
          const coordSnap = await getDoc(doc(db, `companies/${companyId}/users`, proj.coordinatorUid));
          const coordName = coordSnap.exists()
            ? (coordSnap.data().name || coordSnap.data().email || "Sem nome")
            : "Nao encontrado";
          refs.projectDetailCoordinator.textContent = coordName;
        }
      } else {
        refs.projectDetailCoordinator.textContent = proj.coordinatorName || proj.coordinator?.name || "Nenhum";
      }
    }

    // Datas
    if (refs.projectDetailStartDate) {
      refs.projectDetailStartDate.textContent = proj.startDate || "-";
    }
    if (refs.projectDetailEndDate) {
      refs.projectDetailEndDate.textContent = proj.endDate || "-";
    }
    if (refs.projectDetailBillingValue) refs.projectDetailBillingValue.textContent = proj.billingValue ? _formatBRL(proj.billingValue) : "-";
    if (refs.projectDetailBillingHours) refs.projectDetailBillingHours.textContent = proj.billingHours ? `${proj.billingHours}h` : "-";
    if (refs.projectDetailTechs) refs.projectDetailTechs.textContent = techNames.length ? techNames.join(", ") : "Nenhum tecnico vinculado";
    if (refs.projectDetailKeyUsers) refs.projectDetailKeyUsers.textContent = keyUserNames.length ? keyUserNames.join(", ") : "Nenhum key user vinculado";
    if (refs.projectDetailContract) {
      refs.projectDetailContract.innerHTML = proj?.contract?.url
        ? `<a href="${escapeHtml(proj.contract.url)}" target="_blank" rel="noopener">${escapeHtml(proj.contract.name || "Abrir contrato")}</a>`
        : "-";
    }

    refs.modalProjectDetail.hidden = false;
    document.body.classList.add("modal-open");

  } catch (err) {
    console.error("openProjectDetailModal error", err);
    alert("Erro ao abrir detalhes do projeto: " + (err?.message || err));
  }
}

/**
 * Fecha modal de detalhes do projeto
 */
export function closeProjectDetailModal(refs) {
  if (!refs.modalProjectDetail) return;
  refs.modalProjectDetail.hidden = true;
  document.body.classList.remove("modal-open");
}

/**
 * Abre modal de editar projeto
 */
export async function openEditProjectModal(projectId, deps) {
  const { refs, state, db } = deps;

  if (!refs.modalEditProject) return;

  clearAlert(refs.editProjectAlert);

  try {
    const companyId = state.companyId;
    if (!companyId) throw new Error("companyId não encontrado");

    await _ensureEditProjectContext(state, db, companyId);

    const docSnap = await getDoc(doc(db, `companies/${companyId}/projects`, projectId));

    if (!docSnap.exists()) {
      throw new Error("Projeto não encontrado");
    }

    const proj = { id: docSnap.id, ...docSnap.data() };

    _editTechNamesByUid = new Map(
      (Array.isArray(state?._usersCache) ? state._usersCache : []).map(u => [u.uid, u.name || u.email || u.uid])
    );
    const missingTechUids = (Array.isArray(proj.techUids) ? proj.techUids : []).filter(uid => !_editTechNamesByUid.has(uid));
    if (missingTechUids.length) {
      const usersSnap = await getDocs(collection(db, `companies/${companyId}/users`));
      usersSnap.forEach((userDoc) => {
        const userData = userDoc.data() || {};
        const uid = userData.uid || userDoc.id;
        if (missingTechUids.includes(uid)) {
          _editTechNamesByUid.set(uid, userData.name || userData.email || uid);
        }
      });
    }

    await ensureClientsCache(deps);
    _ensureEditProjectUi(refs, state);

    _selectedEditProjectContractFile = null;
    _removeEditProjectContract = false;
    if (refs.editProjectContractFileEl) refs.editProjectContractFileEl.value = "";

    populateTeamSelect(refs.editProjectTeamEl, state.teams);
    populateManagerSelect(refs.editProjectManagerEl, state._usersCache);
    populateCoordinatorSelectNew(refs.editProjectCoordinatorEl, state._usersCache);
    populateClientSelect(refs.editProjectClientEl, state._clientsCache || []);

    if (refs.editProjectNameEl) refs.editProjectNameEl.value = proj.name || "";
    if (refs.editProjectDescriptionEl) refs.editProjectDescriptionEl.value = proj.description || "";
    if (refs.editProjectClientEl) refs.editProjectClientEl.value = proj.clientId || "";
    if (refs.editProjectTeamEl) refs.editProjectTeamEl.value = proj.teamId || "";
    if (refs.editProjectManagerEl) refs.editProjectManagerEl.value = proj.managerUid || "";
    if (refs.editProjectCoordinatorEl) refs.editProjectCoordinatorEl.value = proj.coordinatorUid || "";
    if (refs.editProjectStatusEl) refs.editProjectStatusEl.value = proj.status || "a-fazer";
    if (refs.editProjectPriorityEl) refs.editProjectPriorityEl.value = proj.priority || "media";
    if (refs.editProjectStartDateEl) refs.editProjectStartDateEl.value = proj.startDate || "";
    if (refs.editProjectEndDateEl) refs.editProjectEndDateEl.value = proj.endDate || "";
    if (refs.editProjectBillingValueAmountEl) refs.editProjectBillingValueAmountEl.value = _formatBRL(proj.billingValue ?? "");
    if (refs.editProjectBillingHoursAmountEl) refs.editProjectBillingHoursAmountEl.value = (proj.billingHours ?? "");
    _setEditProjectContractFileLabel(refs, proj?.contract?.name || "Nenhum PDF selecionado");

    const priorityWrap = document.getElementById("editProjectPriorityChips");
    if (priorityWrap) {
      priorityWrap.querySelectorAll(".chip").forEach(b => b.classList.remove("selected"));
      priorityWrap.querySelector(`.chip[data-priority="${proj.priority || "media"}"]`)?.classList.add("selected");
    }

    _editSelectedTechUids = Array.isArray(proj.techUids) ? [...proj.techUids] : [];
    _renderEditSelectedTechChips(refs, state);
    refs.modalEditProject.dataset.projectId = projectId;
    refs.modalEditProject.hidden = false;
    document.body.classList.add("modal-open");

  } catch (err) {
    console.error("openEditProjectModal error", err);
    alert("Erro ao abrir editor de projeto: " + (err?.message || err));
  }
}

/**
 * Fecha modal de editar projeto
 */
export function closeEditProjectModal(refs) {
  if (!refs.modalEditProject) return;
  refs.modalEditProject.hidden = true;
  _editSelectedTechUids = [];
  _selectedEditProjectContractFile = null;
  _removeEditProjectContract = false;
  _editTechNamesByUid = new Map();
  if (refs.editProjectTechChipsEl) refs.editProjectTechChipsEl.innerHTML = "";
  if (refs.editProjectContractFileEl) refs.editProjectContractFileEl.value = "";
  _setEditProjectContractFileLabel(refs, "Nenhum PDF selecionado");
  document.body.classList.remove("modal-open");
}

/**
 * Atualiza projeto
 */
export async function updateProject(deps) {
  const { refs, state, db, auth, loadProjects } = deps;

  clearAlert(refs.editProjectAlert);

  const projectId = refs.modalEditProject?.dataset?.projectId;
  if (!projectId) {
    setAlert(refs.editProjectAlert, "ID do projeto não encontrado.");
    return;
  }

  const name = (refs.editProjectNameEl?.value || "").trim();
  const description = (refs.editProjectDescriptionEl?.value || "").trim();
  const clientId = refs.editProjectClientEl?.value || "";
  const teamId = refs.editProjectTeamEl?.value || "";
  const managerUid = refs.editProjectManagerEl?.value || "";
  const coordinatorUid = refs.editProjectCoordinatorEl?.value || "";
  const status = refs.editProjectStatusEl?.value || "a-fazer";
  const priority = refs.editProjectPriorityEl?.value || "media";
  const startDate = refs.editProjectStartDateEl?.value || "";
  const endDate = refs.editProjectEndDateEl?.value || "";
  const billingValue = _parseBRLToNumber(refs.editProjectBillingValueAmountEl?.value || "");
  const billingHours = _parseHoursToNumber(refs.editProjectBillingHoursAmountEl?.value || "");
  const techUids = Array.isArray(_editSelectedTechUids) ? [..._editSelectedTechUids] : [];
  const client = clientId ? (state._clientsCache || []).find(c => c.id === clientId) : null;

  if (!name) {
    setAlert(refs.editProjectAlert, "Informe o nome do projeto.");
    return;
  }
  if (!managerUid) {
    setAlert(refs.editProjectAlert, "Selecione um gestor.");
    return;
  }
  if (!teamId) {
    setAlert(refs.editProjectAlert, "Selecione uma equipe.");
    return;
  }
  if (startDate && endDate && endDate < startDate) {
    setAlert(refs.editProjectAlert, "A data final não pode ser menor que a inicial.");
    return;
  }

  setAlert(refs.editProjectAlert, "Salvando...", "info");

  try {
    const companyId = state.companyId;
    const user = auth.currentUser;

    if (!companyId || !user) throw new Error("Não autenticado ou empresa não encontrada");

    const currentSnap = await getDoc(doc(db, `companies/${companyId}/projects`, projectId));
    if (!currentSnap.exists()) throw new Error("Projeto não encontrado.");
    const current = currentSnap.data() || {};

    const payload = {
      name,
      description,
      clientId: clientId || "",
      clientName: client?.name || "",
      clientNumber: client?.number ?? "",
      teamId,
      managerUid,
      coordinatorUid: coordinatorUid || "",
      status,
      priority,
      startDate: startDate || null,
      endDate: endDate || null,
      billingValue: billingValue ?? null,
      billingHours: billingHours ?? null,
      billingType: (billingValue !== null && billingValue > 0) ? "valor" : ((billingHours !== null && billingHours > 0) ? "horas" : ""),
      techUids,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid
    };

    if (_selectedEditProjectContractFile) {
      const contract = await _uploadProjectContract(deps, companyId, projectId, _selectedEditProjectContractFile);
      if (contract) {
        payload.contract = {
          ...contract,
          uploadedAt: serverTimestamp(),
          uploadedBy: user.uid
        };
      }
    } else if (_removeEditProjectContract) {
      payload.contract = null;
    } else if (current.contract) {
      payload.contract = current.contract;
    }

    await updateDoc(doc(db, `companies/${companyId}/projects`, projectId), payload);

    setAlert(refs.editProjectAlert, "Projeto atualizado com sucesso!", "success");

    setTimeout(() => {
      closeEditProjectModal(refs);
      if (typeof loadProjects === "function") loadProjects(deps);
    }, 600);

  } catch (err) {
    console.error("updateProject error", err);
    setAlert(refs.editProjectAlert, "Erro ao atualizar projeto: " + (err?.message || err));
  }
}

/**
 * Abre view Meus Projetos (Kanban)
 */
export function openMyProjectsView(deps) {
  setView("myProjects");
  subscribeMyProjects(deps);
}

/**
 * Inicia listener realtime do Kanban
 * (Agora robusto mesmo se deps/refs vierem undefined)
 */
export function subscribeMyProjects(deps) {
  const safeDeps = deps || {};
  const state = safeDeps.state || {};
  const db = safeDeps.db;

  // MantÃ©m o deps da view para re-renders (busca, snapshot, etc.)
  _myProjectsDeps = safeDeps;

  const refs = getKanbanRefsSafe(safeDeps);
  initMyProjectsSearchUI(refs);

  // Se nÃ£o temos os containers do Kanban, nÃ£o tem o que renderizar
  if (!refs.kanbanTodo || !refs.kanbanInProgress || !refs.kanbanDone) {
    console.warn("subscribeMyProjects: containers do Kanban nÃ£o encontrados no DOM/refs.");
    return;
  }

  // Loading inicial
  refs.kanbanTodo.innerHTML = '<p class="muted" style="padding:12px;">Carregando...</p>';
  refs.kanbanInProgress.innerHTML = '<p class="muted" style="padding:12px;">Carregando...</p>';
  refs.kanbanDone.innerHTML = '<p class="muted" style="padding:12px;">Carregando...</p>';

  const companyId = state.companyId;
  if (!companyId) {
    console.error("subscribeMyProjects: companyId nÃ£o encontrado");
    refs.kanbanTodo.innerHTML = '<p class="muted" style="padding:12px;">Empresa nÃ£o encontrada.</p>';
    refs.kanbanInProgress.innerHTML = '<p class="muted" style="padding:12px;">Empresa nÃ£o encontrada.</p>';
    refs.kanbanDone.innerHTML = '<p class="muted" style="padding:12px;">Empresa nÃ£o encontrada.</p>';
    return;
  }

  if (!db) {
    console.error("subscribeMyProjects: db nÃ£o encontrado em deps");
    refs.kanbanTodo.innerHTML = '<p class="muted" style="padding:12px;">Erro interno (db).</p>';
    refs.kanbanInProgress.innerHTML = '<p class="muted" style="padding:12px;">Erro interno (db).</p>';
    refs.kanbanDone.innerHTML = '<p class="muted" style="padding:12px;">Erro interno (db).</p>';
    return;
  }

  // Remove listener anterior
  if (unsubscribeMyProjectsListener) {
    unsubscribeMyProjectsListener();
    unsubscribeMyProjectsListener = null;
  }

  const q = query(
    collection(db, `companies/${companyId}/projects`),
    orderBy("createdAt", "desc")
  );

  unsubscribeMyProjectsListener = onSnapshot(
    q,
    (snapshot) => {
      const projects = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      // Usa refs safe para nÃ£o depender de deps.refs
      _myProjectsLast = projects;
      _renderMyProjectsWithFilter(refs);
    },
    (error) => {
      console.error("onSnapshot(myProjects) error", error);
      refs.kanbanTodo.innerHTML = '<p class="muted" style="padding:12px;">Erro ao carregar projetos.</p>';
      refs.kanbanInProgress.innerHTML = '<p class="muted" style="padding:12px;">Erro ao carregar projetos.</p>';
      refs.kanbanDone.innerHTML = '<p class="muted" style="padding:12px;">Erro ao carregar projetos.</p>';
    }
  );
}

/**
 * Para listener realtime do Kanban
 * (chame ao sair da view myProjects para evitar leak)
 */
export function unsubscribeMyProjects() {
  if (unsubscribeMyProjectsListener) {
    unsubscribeMyProjectsListener();
    unsubscribeMyProjectsListener = null;
  }
}

/**
 * Mantido por compatibilidade: se algum lugar ainda chamar loadMyProjects,
 * agora apenas liga o realtime.
 */
export async function loadMyProjects(deps) {
  subscribeMyProjects(deps);
}

/**
 * Renderiza Kanban a partir de uma lista de projetos (jÃ¡ carregada)
 */
function renderMyProjectsKanban(projects, deps) {
  const k = getKanbanRefsSafe(deps);

  const todo = [];
  const doing = [];
  const goLive = [];
  const done = [];
  const paused = [];
  const backlog = [];

  (projects || []).forEach((p) => {
    const st = (p?.status || "a-fazer").toLowerCase();
    if (st === "a-fazer") todo.push(p);
    else if (st === "em-andamento") doing.push(p);
    else if (st === "go-live") goLive.push(p);
    else if (st === "concluido") done.push(p);
    else if (st === "parado") paused.push(p);
    else if (st === "backlog") backlog.push(p);
    else backlog.push(p); // fallback
  });

  renderKanbanCards(k.kanbanTodo, todo, deps);
  renderKanbanCards(k.kanbanInProgress, doing, deps);
  renderKanbanCards(k.kanbanGoLive, goLive, deps);
  renderKanbanCards(k.kanbanDone, done, deps);
  renderKanbanCards(k.kanbanPaused, paused, deps);
  renderKanbanCards(k.kanbanBacklog, backlog, deps);

  if (k.kanbanCountTodo) k.kanbanCountTodo.textContent = String(todo.length);
  if (k.kanbanCountInProgress) k.kanbanCountInProgress.textContent = String(doing.length);
  if (k.kanbanCountGoLive) k.kanbanCountGoLive.textContent = String(goLive.length);
  if (k.kanbanCountDone) k.kanbanCountDone.textContent = String(done.length);
  if (k.kanbanCountPaused) k.kanbanCountPaused.textContent = String(paused.length);
  if (k.kanbanCountBacklog) k.kanbanCountBacklog.textContent = String(backlog.length);

  // Habilita drag & drop em todas as colunas (uma vez)
  setupDropZone(k.kanbanTodo, deps.state, deps.db, deps.auth, deps);
  setupDropZone(k.kanbanInProgress, deps.state, deps.db, deps.auth, deps);
  setupDropZone(k.kanbanGoLive, deps.state, deps.db, deps.auth, deps);
  setupDropZone(k.kanbanDone, deps.state, deps.db, deps.auth, deps);
  setupDropZone(k.kanbanPaused, deps.state, deps.db, deps.auth, deps);
  setupDropZone(k.kanbanBacklog, deps.state, deps.db, deps.auth, deps);
}

/**
 * Renderiza cards no Kanban
 */
function renderKanbanCards(container, projects, deps) {
  const { openEditProjectModal, openProjectDetailModal, openProjectWorkspace, openProjectTab, state, db, auth } = deps || {};

  // Sempre prepara a dropzone (inclusive coluna vazia)
  setupDropZone(container, state, db, auth, deps);

  container.innerHTML = "";

  // Helpers de apresentaÃ§Ã£o (kanban card)
  const _fmtDateBR = (v) => {
    if (!v) return "";
    try {
      // v pode ser 'YYYY-MM-DD' ou Timestamp serializado
      if (typeof v === "string") {
        // mantÃ©m apenas a parte de data
        const s = v.slice(0, 10);
        const [y, m, d] = s.split("-");
        if (y && m && d) return `${d}/${m}/${y}`;
        return v;
      }
      if (v?.toDate) {
        const dt = v.toDate();
        const dd = String(dt.getDate()).padStart(2, "0");
        const mm = String(dt.getMonth() + 1).padStart(2, "0");
        const yy = dt.getFullYear();
        return `${dd}/${mm}/${yy}`;
      }
    } catch {}
    return "";
  };

  const _projectDisplayId = (p) => {
    const n = p?.projectNumber ?? p?.number ?? p?.seq ?? p?.codeNumber;
    if (typeof n === "number") return `${n}`;
    if (typeof n === "string" && n.trim()) {
      // se jÃ¡ veio com # ou Ã© numÃ©rico
      const s = n.trim();
      if (/^#?\d+$/.test(s)) return s.replace(/^#/, "");
      return s.replace(/^#/, "");
    }
    // fallback: usa parte do doc id
    const id = String(p?.id || "");
    if (!id) return "";
    const m = id.match(/(\d{1,6})/);
    if (m) return `${m[1]}`;
    return id.length > 8 ? `${id.slice(-6)}` : `${id}`;
  };

  const _fmtBRL = (val) => {
    if (val === null || val === undefined || val === "") return "";
    const num = typeof val === "number"
      ? val
      : Number(String(val).replace(/[^0-9.,-]/g, "").replace(".", "").replace(",", "."));
    if (Number.isNaN(num)) return "";
    return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const _fmtHours = (val) => {
    if (val === null || val === undefined || val === "") return "";
    const num = typeof val === "number" ? val : Number(String(val).replace(/[^0-9.,-]/g, "").replace(",", "."));
    if (Number.isNaN(num)) return "";
    return `${num}`;
  };

  const _toDateOnly = (v) => {
    if (!v) return null;
    try {
      if (typeof v === "string") {
        const s = v.trim();
        // yyyy-mm-dd
        const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
        // dd/mm/yyyy
        const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
        return null;
      }
      if (v?.toDate) {
        const dt = v.toDate();
        return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
      }
      if (typeof v?.seconds === "number") {
        const dt = new Date(v.seconds * 1000);
        return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
      }
    } catch {}
    return null;
  };

  const _isDeadlineCritical = (v) => {
    const due = _toDateOnly(v);
    if (!due) return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 7;
  };

  if (!projects || projects.length === 0) {
    container.innerHTML = '<p class="muted" style="padding:12px;">Nenhum projeto</p>';
    return;
  }

  projects.forEach(project => {
    const card = document.createElement("div");
    card.className = "kanban-card";
    card.draggable = true;
    card.dataset.projectId = project.id;
    card.dataset.currentStatus = project.status || "a-fazer";
    const meta = getProjectStatusMeta(card.dataset.currentStatus);
    card.style.boxShadow = `inset 4px 0 0 ${meta.color}`;

    const priorityText = {
      baixa: "Baixa",
      media: "MÃ©dia",
      alta: "Alta"
    }[project.priority] || "MÃ©dia";

    const displayId = _projectDisplayId(project);
    const endRaw = (project.endDate || project.endAt || project.dateEnd);
    const endBR = _fmtDateBR(endRaw);
    const deadlineCritical = _isDeadlineCritical(endRaw);
    const clientName = (project.clientName || project.client?.name || project.customerName || "").toString();
    const valueBRL = _fmtBRL(project.billingValue ?? project.value ?? project.billing?.value ?? project.cobrancaValor);
    const hoursTxt = _fmtHours(project.billingHours ?? project.hours ?? project.billing?.hours ?? project.cobrancaHoras);

    const icCalendar = `<svg class="mini-ic ${deadlineCritical ? "mini-ic--danger" : ""}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3h10M7 21h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M8 3c0 4 3 4.5 4 6 1 1.5 1 2.5 0 4-1 1.5-4 2-4 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M16 3c0 4-3 4.5-4 6-1 1.5-1 2.5 0 4 1 1.5 4 2 4 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;

    const icMoney = `<svg class="mini-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M17 7.5c0-1.93-2.24-3.5-5-3.5s-5 1.57-5 3.5S9.24 11 12 11s5 1.57 5 3.5S14.76 18 12 18s-5-1.57-5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    const icBuilding = `<svg class="mini-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 21V3h10v18" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      <path d="M14 9h6v12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      <path d="M8 7h2M8 11h2M8 15h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M16 13h2M16 17h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;

    const icClock = `<svg class="mini-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 8v5l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Z" stroke="currentColor" stroke-width="2"/>
    </svg>`;

    card.innerHTML = `
      <div class="kanban-card-title">
        <span class="kanban-card-id">${escapeHtml(displayId)}</span>
        <span class="kanban-card-name">${escapeHtml(project.name || "")}</span>
      </div>

      <div class="kanban-card-meta kanban-card-meta--row">
        ${clientName ? `<span class="kanban-mini kanban-mini--client" title="Cliente">${icBuilding}<span class="kanban-mini-text">${escapeHtml(clientName)}</span></span>` : ""}
        ${endBR ? `<span class="kanban-mini" title="Prazo">${icCalendar}<span>${escapeHtml(endBR)}</span></span>` : ""}
        ${valueBRL ? `<span class="kanban-mini" title="Valor">${icMoney}<span>${escapeHtml(valueBRL)}</span></span>` : ""}
        ${hoursTxt ? `<span class="kanban-mini" title="Horas">${icClock}<span>${escapeHtml(hoursTxt)}h</span></span>` : ""}
        <span class="kanban-card-priority ${project.priority || "media"}">${priorityText}</span>
      </div>
    `;

    card.addEventListener("dragstart", (e) => {
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", project.id);
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
    });

    card.addEventListener("click", () => {
      if (card.classList.contains("dragging")) return;

      if (typeof openProjectTab === "function") {
        openProjectTab(project.id, deps);
        return;
      }

      if (typeof openProjectWorkspace === "function") {
        openProjectWorkspace(project.id, deps);
        return;
      }

      // fallback: abre ediÃ§Ã£o se o modal de detalhes nÃ£o existir
      if (typeof openEditProjectModal === "function") {
        openEditProjectModal(project.id, deps);
      }
    });

    container.appendChild(card);
  });
}

/**
 * Configura zona de drop para receber cards
 */
function setupDropZone(container, state, db, auth, deps) {
  if (!container) return;

  if (container.dataset.dropReady === "1") return;
  container.dataset.dropReady = "1";

  // Determinar status baseado no ID do container
  let targetStatus = "";
  if (container.id === "kanbanTodo") targetStatus = "a-fazer";
  else if (container.id === "kanbanInProgress") targetStatus = "em-andamento";
  else if (container.id === "kanbanGoLive") targetStatus = "go-live";
  else if (container.id === "kanbanDone") targetStatus = "concluido";
  else if (container.id === "kanbanPaused") targetStatus = "parado";
  else if (container.id === "kanbanBacklog") targetStatus = "backlog";

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    container.classList.add("drag-over");
  });

  container.addEventListener("dragleave", () => {
    container.classList.remove("drag-over");
  });

  container.addEventListener("drop", async (e) => {
    e.preventDefault();
    container.classList.remove("drag-over");

    const projectId = e.dataTransfer.getData("text/plain");
    const draggedCard = document.querySelector(`[data-project-id="${projectId}"]`);
    const currentStatus = draggedCard?.dataset?.currentStatus;

    // Se jÃ¡ estÃ¡ no status correto, nÃ£o fazer nada
    if (currentStatus === targetStatus) return;

    try {
      const companyId = state?.companyId;
      if (!companyId || !auth?.currentUser) {
        alert("Erro: nÃ£o autenticado");
        return;
      }

      await updateDoc(
        doc(db, `companies/${companyId}/projects`, projectId),
        {
          status: targetStatus,
          updatedAt: serverTimestamp(),
          updatedBy: auth.currentUser.uid
        }
      );

      // âœ… NÃ£o precisa recarregar: onSnapshot atualiza automaticamente

    } catch (err) {
      console.error("Erro ao mover projeto:", err);
      alert("Erro ao mover projeto: " + (err?.message || err));
    }
  });
}

