/**
 * projects.domain.js
 * Lógica de negócio para gestão de projetos
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

import { setAlert, clearAlert } from "../ui/alerts.js";
import { setView } from "../ui/router.js";
import { slugify } from "../utils/format.js";
import { escapeHtml } from "../utils/dom.js";
import { getTeamNameById, initialFromName } from "../utils/helpers.js";

/**
 * Listener realtime do Kanban (Meus Projetos)
 */
let unsubscribeMyProjectsListener = null;

// Guarda o deps mais recente do Kanban para que busca/filters e re-renders
// não percam state/db/auth (evita "Erro: não autenticado" no drag&drop).
let _myProjectsDeps = null;

/* My Projects Kanban Search */
let _myProjectsLast = [];
let _myProjectsSearch = "";
let _myProjectsSearchInitialized = false;

// Create Project Modal state
let _createProjectUiInitialized = false;
let _selectedTechUids = [];
let _isCreatingProjectLocal = false;

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
  // inclui variações úteis para busca: "1500", "1500.5", "1500,50", "1.500,50", "r$ 1.500,50"
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
  if (pri) parts.push(pri, pri === "media" ? "média" : "", pri === "alta" ? "alta" : "", pri === "baixa" ? "baixa" : "");
  // datas
  parts.push(_dateAliases(p?.startDate));
  parts.push(_dateAliases(p?.endDate));
  // cobrança
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
  // ⚠️ Importante: ao re-renderizar (ex.: busca), precisamos manter state/db/auth.
  // Caso contrário, o drag&drop cai no alert "Erro: não autenticado".
  const deps = _myProjectsDeps || {};
  renderMyProjectsKanban(_applyMyProjectsSearch(_myProjectsLast), { ...deps, refs });
}

function initMyProjectsSearchUI(refs){
  // Busca "Meus Projetos" (Kanban)
  // Observação: o HTML atual não tem botão toggle; o campo fica sempre visível.
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
  // remove R$, espaços e qualquer coisa que não seja número, ponto, vírgula, sinal
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
    // Se o usuário começar a digitar "R$" etc, não atrapalhar: apenas limpa no focus
    valueEl.addEventListener("focus", () => {
      // mantém números (pra facilitar edição)
      const n = _parseBRLToNumber(valueEl.value);
      valueEl.value = n === null ? "" : String(n).replace(/\./g, ",");
    });
  }

  // Técnicos (select + chips)
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
  selectEl.innerHTML = '<option value="">Selecione um técnico</option>';

  const techs = _listActiveTechs(state, teamId);
  techs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  for (const t of techs) {
    // não listar os já selecionados
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
  for (const uid of _selectedTechUids) {
    const u = byUid.get(uid);
    const name = (u?.name || u?.email || uid);
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.display = "inline-flex";
    chip.style.alignItems = "center";
    chip.style.gap = "8px";
    chip.innerHTML = `
      <span>${escapeHtml(name)}</span>
      <button type="button" class="btn ghost sm" data-tech-uid="${escapeHtml(uid)}" aria-label="Remover técnico" style="padding:2px 8px;">✕</button>
    `;
    chipsEl.appendChild(chip);
  }

  // re-popula select para esconder os já escolhidos
  const teamId = (refs?.projectTeamEl?.value || document.getElementById("projectTeam")?.value || "");
  _populateTechSelect(techSelect, state, teamId);
}


/**
 * Helper: garante refs do Kanban mesmo quando deps/refs não são passados
 */
function getKanbanRefsSafe(deps) {
  const refs = deps?.refs || {};
  const dom = (id) => document.getElementById(id);

  return {
    // containers kanban (ordem: A Fazer, Em Andamento, Go Live, Concluído, Parado, Backlog)
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
    if (!companyId) throw new Error("companyId não encontrado");

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
    <p class="desc" style="margin:6px 0 12px 0;">${escapeHtml(proj.description || "Sem descrição")}</p>
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
 * - Use as mesmas cores das colunas do Kanban, para manter consistência visual.
 * - Tons "leves" (não saturados) para não poluir a tela.
 */
const PROJECT_STATUS_META = {
  "a-fazer":      { label: "A Fazer",       color: "#3b82f6" }, // azul leve
  "em-andamento": { label: "Em andamento",  color: "#f59e0b" }, // âmbar/laranja leve
  "go-live":      { label: "Go Live",       color: "#22c55e" }, // verde leve
  "concluido":    { label: "Concluído",     color: "#94a3b8" }, // cinza/neutral
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
    "concluido":  { label: "Concluído",    cls: "badge"         }, // neutro/cinza
    "parado":     { label: "Parado",       cls: "badge danger"  }, // vermelho/alarme
    "backlog":    { label: "Backlog",      cls: "badge info"    }, // roxo leve (se não existir, cai no badge padrão)
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
    "media": '<span class="badge small" style="background:rgba(249,115,22,.10); border-color:rgba(249,115,22,.25);">Média</span>',
    "alta": '<span class="badge small" style="background:rgba(239,68,68,.10); border-color:rgba(239,68,68,.25); color:#b91c1c;">Alta</span>'
  };
  return map[priority] || '<span class="badge small">—</span>';
}

/**
 * Abre modal de criar projeto
 */
export function openCreateProjectModal(deps) {
  const { refs, state } = deps;

  if (!refs.modalCreateProject) return;

  clearAlert(refs.createProjectAlert);

  // Limpa campos
  if (refs.projectNameEl) refs.projectNameEl.value = "";
  if (refs.projectDescriptionEl) refs.projectDescriptionEl.value = "";
  if (refs.projectManagerEl) refs.projectManagerEl.value = "";
  if (refs.projectCoordinatorEl) refs.projectCoordinatorEl.value = "";
  if (refs.projectTeamEl) refs.projectTeamEl.value = "";
  // billing/status antigos (inputs removidos do HTML) — mantemos compatibilidade via refs opcionais
  if (refs.projectBillingValueEl) refs.projectBillingValueEl.checked = true;
  if (refs.projectBillingHoursEl) refs.projectBillingHoursEl.checked = false;
  if (refs.projectStatusEl) refs.projectStatusEl.value = "a-fazer";
  if (refs.projectPriorityEl) refs.projectPriorityEl.value = "media";
  if (refs.projectStartDateEl) refs.projectStartDateEl.value = "";
  if (refs.projectEndDateEl) refs.projectEndDateEl.value = "";
  if (refs.projectBillingValueAmountEl) refs.projectBillingValueAmountEl.value = "";
  if (refs.projectBillingHoursAmountEl) refs.projectBillingHoursAmountEl.value = "";

  // reset técnicos
  _selectedTechUids = [];
  if (refs.projectTechSelectEl) refs.projectTechSelectEl.value = "";
  if (refs.projectTechChipsEl) refs.projectTechChipsEl.innerHTML = "";

  // Preenche select de equipes
  populateTeamSelect(refs.projectTeamEl, state.teams);

  // Preenche select de gestores (apenas role='gestor')
  populateManagerSelect(refs.projectManagerEl, state._usersCache);

  // Preenche select de coordenadores (apenas role='coordenador')
  populateCoordinatorSelectNew(refs.projectCoordinatorEl, state._usersCache);

  // UI do modal (chips + máscara + técnicos)
  _ensureCreateProjectUi(refs, state);

  // Reseta visual dos chips de prioridade para o padrão (média)
  const chipsWrap = document.getElementById("projectPriorityChips");
  if (chipsWrap) {
    chipsWrap.querySelectorAll(".chip").forEach(b => b.classList.remove("selected"));
    const def = chipsWrap.querySelector('.chip[data-priority="media"]');
    def?.classList.add("selected");
  }
  _populateTechSelect(refs.projectTechSelectEl, state, refs.projectTeamEl?.value || "");

  // Quando troca equipe, filtra técnicos
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
  // Cobrança (inputs atuais do modal)
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

  // Técnicos selecionados (chips)
  const techUids = Array.isArray(_selectedTechUids) ? [..._selectedTechUids] : [];

  // Validações
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

    if (!companyId || !user) throw new Error("Não autenticado ou empresa não encontrada");

    const projectId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // ✅ Sequência numérica do projeto (compatível com o formato antigo do card)
    // Estratégia simples (sem criar coleção extra): busca o maior projectNumber e soma +1.
    // (Assunção) Volume por empresa é baixo a médio.
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
      // fallback: mantém 1
      console.warn("Não consegui calcular projectNumber, usando 1.", e);
    }

    const payload = {
      projectNumber: nextProjectNumber,
      name,
      description,
      managerUid,
      coordinatorUid: coordinatorUid || "",
      teamId: teamId || "",
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

    await setDoc(doc(db, `companies/${companyId}/projects`, projectId), payload);

    setAlert(refs.createProjectAlert, "Projeto criado com sucesso!", "success");

    setTimeout(() => {
      closeCreateProjectModal(refs);
      // ✅ grid: recarrega usando deps
      if (typeof deps.loadProjects === "function") deps.loadProjects(deps);
      // ✅ kanban realtime já vai refletir via onSnapshot se estiver aberto
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
    if (!companyId) throw new Error("companyId não encontrado");

    const docSnap = await getDoc(doc(db, `companies/${companyId}/projects`, projectId));

    if (!docSnap.exists()) {
      throw new Error("Projeto não encontrado");
    }

    const proj = { id: docSnap.id, ...docSnap.data() };

    // Preenche dados do modal
    if (refs.projectDetailTitle) refs.projectDetailTitle.textContent = proj.name || "Projeto";
    if (refs.projectDetailDescription) refs.projectDetailDescription.textContent = proj.description || "Sem descrição";
    if (refs.projectDetailTeam) refs.projectDetailTeam.textContent = getTeamNameById(proj.teamId, state.teams);
    if (refs.projectDetailStatus) refs.projectDetailStatus.innerHTML = getStatusBadge(proj.status);
    if (refs.projectDetailPriority) refs.projectDetailPriority.innerHTML = getPriorityBadge(proj.priority);

    // Coordenador
    if (refs.projectDetailCoordinator) {
      if (proj.coordinatorUid) {
        const coordSnap = await getDoc(doc(db, `companies/${companyId}/users`, proj.coordinatorUid));
        const coordName = coordSnap.exists() ? (coordSnap.data().name || "Sem nome") : "Não encontrado";
        refs.projectDetailCoordinator.textContent = coordName;
      } else {
        refs.projectDetailCoordinator.textContent = "Nenhum";
      }
    }

    // Datas
    if (refs.projectDetailStartDate) {
      refs.projectDetailStartDate.textContent = proj.startDate || "—";
    }
    if (refs.projectDetailEndDate) {
      refs.projectDetailEndDate.textContent = proj.endDate || "—";
    }

    // Botões de ação
    if (refs.btnEditProject) {
      refs.btnEditProject.onclick = () => {
        closeProjectDetailModal(refs);
        openEditProjectModal(projectId, deps);
      };
    }

    if (refs.btnDeleteProject) {
      refs.btnDeleteProject.onclick = async () => {
        if (!confirm(`Deseja realmente deletar o projeto "${proj.name}"?`)) return;

        try {
          await deleteDoc(doc(db, `companies/${companyId}/projects`, projectId));
          closeProjectDetailModal(refs);
          if (typeof deps.loadProjects === "function") deps.loadProjects(deps);
          alert("Projeto deletado com sucesso!");
          // ✅ Kanban realtime reflete automaticamente
        } catch (err) {
          console.error("deleteProject error", err);
          setAlert(refs.projectDetailAlert, "Erro ao deletar projeto.");
        }
      };
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

    const docSnap = await getDoc(doc(db, `companies/${companyId}/projects`, projectId));

    if (!docSnap.exists()) {
      throw new Error("Projeto não encontrado");
    }

    const proj = { id: docSnap.id, ...docSnap.data() };

    // Preenche campos
    if (refs.editProjectNameEl) refs.editProjectNameEl.value = proj.name || "";
    if (refs.editProjectDescriptionEl) refs.editProjectDescriptionEl.value = proj.description || "";
    if (refs.editProjectTeamEl) refs.editProjectTeamEl.value = proj.teamId || "";
    if (refs.editProjectCoordinatorEl) refs.editProjectCoordinatorEl.value = proj.coordinatorUid || "";
    if (refs.editProjectStatusEl) refs.editProjectStatusEl.value = proj.status || "a-fazer";
    if (refs.editProjectPriorityEl) refs.editProjectPriorityEl.value = proj.priority || "media";
    if (refs.editProjectStartDateEl) refs.editProjectStartDateEl.value = proj.startDate || "";
    if (refs.editProjectEndDateEl) refs.editProjectEndDateEl.value = proj.endDate || "";

    // Preenche selects
    populateTeamSelect(refs.editProjectTeamEl, state.teams);
    await populateCoordinatorSelect(refs.editProjectCoordinatorEl, deps);

    // Define valores depois de preencher options
    if (refs.editProjectTeamEl) refs.editProjectTeamEl.value = proj.teamId || "";
    if (refs.editProjectCoordinatorEl) refs.editProjectCoordinatorEl.value = proj.coordinatorUid || "";

    // Salva ID do projeto no modal (para update)
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
  const teamId = refs.editProjectTeamEl?.value || "";
  const coordinatorUid = refs.editProjectCoordinatorEl?.value || "";
  const status = refs.editProjectStatusEl?.value || "a-fazer";
  const priority = refs.editProjectPriorityEl?.value || "media";
  const startDate = refs.editProjectStartDateEl?.value || "";
  const endDate = refs.editProjectEndDateEl?.value || "";

  if (!name) {
    setAlert(refs.editProjectAlert, "Informe o nome do projeto.");
    return;
  }

  if (!teamId) {
    setAlert(refs.editProjectAlert, "Selecione uma equipe.");
    return;
  }

  setAlert(refs.editProjectAlert, "Salvando...", "info");

  try {
    const companyId = state.companyId;
    const user = auth.currentUser;

    if (!companyId || !user) throw new Error("Não autenticado ou empresa não encontrada");

    const payload = {
      name,
      description,
      teamId,
      coordinatorUid: coordinatorUid || "",
      status,
      priority,
      startDate: startDate || null,
      endDate: endDate || null,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid
    };

    await updateDoc(doc(db, `companies/${companyId}/projects`, projectId), payload);

    setAlert(refs.editProjectAlert, "Projeto atualizado com sucesso!", "success");

    setTimeout(() => {
      closeEditProjectModal(refs);
      // ✅ grid atualiza por getDocs, kanban atualiza por realtime
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

  // Mantém o deps da view para re-renders (busca, snapshot, etc.)
  _myProjectsDeps = safeDeps;

  const refs = getKanbanRefsSafe(safeDeps);
  initMyProjectsSearchUI(refs);

  // Se não temos os containers do Kanban, não tem o que renderizar
  if (!refs.kanbanTodo || !refs.kanbanInProgress || !refs.kanbanDone) {
    console.warn("subscribeMyProjects: containers do Kanban não encontrados no DOM/refs.");
    return;
  }

  // Loading inicial
  refs.kanbanTodo.innerHTML = '<p class="muted" style="padding:12px;">Carregando...</p>';
  refs.kanbanInProgress.innerHTML = '<p class="muted" style="padding:12px;">Carregando...</p>';
  refs.kanbanDone.innerHTML = '<p class="muted" style="padding:12px;">Carregando...</p>';

  const companyId = state.companyId;
  if (!companyId) {
    console.error("subscribeMyProjects: companyId não encontrado");
    refs.kanbanTodo.innerHTML = '<p class="muted" style="padding:12px;">Empresa não encontrada.</p>';
    refs.kanbanInProgress.innerHTML = '<p class="muted" style="padding:12px;">Empresa não encontrada.</p>';
    refs.kanbanDone.innerHTML = '<p class="muted" style="padding:12px;">Empresa não encontrada.</p>';
    return;
  }

  if (!db) {
    console.error("subscribeMyProjects: db não encontrado em deps");
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
      // Usa refs safe para não depender de deps.refs
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
 * Renderiza Kanban a partir de uma lista de projetos (já carregada)
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
  const { openEditProjectModal, openProjectDetailModal, state, db, auth } = deps || {};

  // Sempre prepara a dropzone (inclusive coluna vazia)
  setupDropZone(container, state, db, auth, deps);

  container.innerHTML = "";

  // Helpers de apresentação (kanban card)
  const _fmtDateBR = (v) => {
    if (!v) return "";
    try {
      // v pode ser 'YYYY-MM-DD' ou Timestamp serializado
      if (typeof v === "string") {
        // mantém apenas a parte de data
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
      // se já veio com # ou é numérico
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
      media: "Média",
      alta: "Alta"
    }[project.priority] || "Média";

    const displayId = _projectDisplayId(project);
    const endBR = _fmtDateBR(project.endDate || project.endAt || project.dateEnd);
    const valueBRL = _fmtBRL(project.billingValue ?? project.value ?? project.billing?.value ?? project.cobrancaValor);
    const hoursTxt = _fmtHours(project.billingHours ?? project.hours ?? project.billing?.hours ?? project.cobrancaHoras);

    const icCalendar = `<svg class="mini-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3v3M17 3v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M4 8h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M6 21h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;

    const icMoney = `<svg class="mini-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M17 7.5c0-1.93-2.24-3.5-5-3.5s-5 1.57-5 3.5S9.24 11 12 11s5 1.57 5 3.5S14.76 18 12 18s-5-1.57-5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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
        ${endBR ? `<span class="kanban-mini" title="Data final">${icCalendar}<span>${escapeHtml(endBR)}</span></span>` : ""}
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

      if (typeof openProjectDetailModal === "function") {
        openProjectDetailModal(project.id, deps);
        return;
      }

      // fallback: abre edição se o modal de detalhes não existir
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

    // Se já está no status correto, não fazer nada
    if (currentStatus === targetStatus) return;

    try {
      const companyId = state?.companyId;
      if (!companyId || !auth?.currentUser) {
        alert("Erro: não autenticado");
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

      // ✅ Não precisa recarregar: onSnapshot atualiza automaticamente

    } catch (err) {
      console.error("Erro ao mover projeto:", err);
      alert("Erro ao mover projeto: " + (err?.message || err));
    }
  });
}
