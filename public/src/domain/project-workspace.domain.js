import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { setAlert, clearAlert } from "../ui/alerts.js";
import { escapeHtml } from "../utils/dom.js";
import { ensureClientsCache } from "./clients.domain.js";
import { computeProjectExpenseSummary } from "./expenses.domain.js?v=1777057015";
import { createNotifications } from "../services/notifications.service.js?v=1776052722";
import { downloadProjectStatusReportExcel, downloadProjectStatusReportPdf } from "./project-status-report.domain.js?v=1776052718";

let _bound = false;
let _activeProjectId = "";
let _activeProject = null;
let _tabs = [];
let _tasks = [];
let _activities = [];
let _expenseSummary = null;
let _activityModalBound = false;
let _activityModalMode = "view";
let _activityModalActivityId = "";
let _approvalConfirmBound = false;
let _approvalConfirmActivityId = "";
let _approvalConfirmNextStatus = "";
let _workspaceAlertDismissBound = false;
let _taskSearchTerm = "";
let _taskStatusFilters = {};
const ACTIVITY_CHIP_COLORS = ["t1", "t2", "t3", "t4", "t5", "t6"];

function formatHoursDisplay(value) {
  if (!Number.isFinite(value) || value <= 0) return "0h";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}h` : `${String(rounded).replace(".", ",")}h`;
}

function getActivityStatusValue(activity) {
  return String(activity?.status || "").toLowerCase();
}

function isApprovedStatus(activity) {
  return getActivityStatusValue(activity) === "os_aprovada";
}

function isCompletedStatus(activity) {
  const status = getActivityStatusValue(activity);
  return status === "os_gerada" || status === "os_aprovada";
}

function getTaskActivityFilterMatch(activity, filterKey, today){
  if (!filterKey || filterKey === "all") return true;
  const workDate = parseDateOnly(activity.workDate);
  const isOverdue = Boolean(workDate && workDate < today && !isCompletedStatus(activity));
  if (filterKey === "overdue") return isOverdue;
  if (filterKey === "pending") return !isCompletedStatus(activity);
  if (filterKey === "generated") return getActivityStatusValue(activity) === "os_gerada";
  if (filterKey === "approved") return getActivityStatusValue(activity) === "os_aprovada";
  return true;
}

function setWorkspaceOpenUI(deps, isOpen){
  const refs = _wsRefs(deps);
  if (refs.projectWorkspacePanel){
    refs.projectWorkspacePanel.classList.toggle("is-open", Boolean(isOpen));
  }
  refs.viewMyProjects?.classList.toggle("workspace-open", Boolean(isOpen));
}

function _wsRefs(deps){
  const r = deps?.refs || {};
  const byId = (id) => document.getElementById(id);
  return {
    viewMyProjects: r.viewMyProjects || byId("viewMyProjects"),
    projectWorkspaceTabs: r.projectWorkspaceTabs || byId("projectWorkspaceTabs"),
    projectWorkspacePanel: r.projectWorkspacePanel || byId("projectWorkspacePanel"),
    btnCloseProjectWorkspace: r.btnCloseProjectWorkspace || byId("btnCloseProjectWorkspace"),
    btnOpenWorkspaceView: r.btnOpenWorkspaceView || byId("btnOpenWorkspaceView"),
    btnOpenWorkspaceEdit: r.btnOpenWorkspaceEdit || byId("btnOpenWorkspaceEdit"),
    btnDeleteWorkspaceProject: r.btnDeleteWorkspaceProject || byId("btnDeleteWorkspaceProject"),
    projectWorkspaceTitle: r.projectWorkspaceTitle || byId("projectWorkspaceTitle"),
    projectWorkspaceSubtitle: r.projectWorkspaceSubtitle || byId("projectWorkspaceSubtitle"),
    projectWorkspaceBreadcrumb: r.projectWorkspaceBreadcrumb || byId("projectWorkspaceBreadcrumb"),
    projectWorkspaceCover: r.projectWorkspaceCover || byId("projectWorkspaceCover"),
    btnOpenTaskForm: r.btnOpenTaskForm || byId("btnOpenTaskForm"),
    projectTaskFormWrap: r.projectTaskFormWrap || byId("projectTaskFormWrap"),
    taskNameInput: r.taskNameInput || byId("taskNameInput"),
    taskStartDateInput: r.taskStartDateInput || byId("taskStartDateInput"),
    taskEndDateInput: r.taskEndDateInput || byId("taskEndDateInput"),
    taskPlannedHoursInput: r.taskPlannedHoursInput || byId("taskPlannedHoursInput"),
    btnCancelTaskForm: r.btnCancelTaskForm || byId("btnCancelTaskForm"),
    btnSaveTask: r.btnSaveTask || byId("btnSaveTask"),
    projectTaskAlert: r.projectTaskAlert || byId("projectTaskAlert"),
    projectTaskList: r.projectTaskList || byId("projectTaskList"),
    projectTaskSearchInput: r.projectTaskSearchInput || byId("projectTaskSearchInput"),
  };
}

function roleOf(state){
  return (state?.profile?.role || "").toString().toLowerCase();
}

function isTech(state){
  return roleOf(state) === "tecnico";
}

function canManageTasks(state){
  const r = roleOf(state);
  return r === "admin" || r === "gestor" || r === "coordenador";
}

function canUseRangeForActivities(state){
  return !isTech(state);
}

function fmtDate(v){
  if (!v) return "-";
  if (typeof v === "string" && v.length >= 10){
    const s = v.slice(0, 10);
    const [y, m, d] = s.split("-");
    if (y && m && d) return `${d}/${m}/${y}`;
  }
  return String(v);
}

function parseDateOnly(v){
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function overlap(aStart, aEnd, bStart, bEnd){
  const aS = parseDateOnly(aStart);
  const aE = parseDateOnly(aEnd);
  const bS = parseDateOnly(bStart);
  const bE = parseDateOnly(bEnd);
  if (!aS || !aE || !bS || !bE) return false;
  return aS <= bE && bS <= aE;
}

function parseTimeToMinutes(value){
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function diffHours(startTime, endTime, breakTime = "00:00"){
  if (!startTime || !endTime) return 0;
  const sMin = parseTimeToMinutes(startTime);
  const eMin = parseTimeToMinutes(endTime);
  const breakMin = parseTimeToMinutes(breakTime);
  if (sMin == null || eMin == null || breakMin == null) return 0;
  if (eMin <= sMin) return 0;
  const workedMinutes = eMin - sMin - breakMin;
  if (workedMinutes <= 0) return 0;
  return workedMinutes / 60;
}

function asNumber(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSearchText(value){
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatCurrencyBRL(value){
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatHoursLabel(value){
  const amount = asNumber(value);
  return `${amount.toLocaleString("pt-BR")}h`;
}

function normalizeProjectStatus(status){
  const raw = String(status || "a-fazer").trim().toLowerCase();
  const map = {
    "a-fazer": { label: "A fazer", css: "a-fazer" },
    "em-andamento": { label: "Em andamento", css: "em-andamento" },
    "go-live": { label: "Go live", css: "go-live" },
    "concluido": { label: "Concluido", css: "concluido" },
    "parado": { label: "Parado", css: "parado" },
    "backlog": { label: "Backlog", css: "backlog" }
  };
  return map[raw] || { label: status || "A fazer", css: "a-fazer" };
}

function keyUsersFromProjectClient(state, project){
  const clientId = project?.clientId || "";
  if (!clientId) return [];
  const clients = Array.isArray(state?._clientsCache) ? state._clientsCache : [];
  const c = clients.find(x => x.id === clientId);
  if (!c) return [];
  if (Array.isArray(c.keyUsers) && c.keyUsers.length){
    return c.keyUsers.filter(Boolean).map(ku => ({
      name: ku.name || "",
      email: ku.email || "",
      phone: ku.phone || ""
    }));
  }
  const legacy = {
    name: c.keyUserName || "",
    email: c.keyUserEmail || "",
    phone: c.keyUserPhone || ""
  };
  return (legacy.name || legacy.email || legacy.phone) ? [legacy] : [];
}

function techsFromProject(state, project){
  const users = Array.isArray(state?._usersCache) ? state._usersCache : [];
  const techUids = Array.isArray(project?.techUids) ? project.techUids.filter(Boolean) : [];
  if (!techUids.length) return [];
  return techUids
    .map(uid => users.find(u => u && u.uid === uid && (u.role || "").toLowerCase() === "tecnico"))
    .filter(Boolean)
    .map(u => ({
      uid: u.uid,
      name: u.name || u.email || u.uid
    }));
}

function weekdayName(idx){
  return ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"][idx] || "";
}

function datesForRangeByWeekdays(start, end, weekdaysSet){
  const out = [];
  const s = parseDateOnly(start);
  const e = parseDateOnly(end);
  if (!s || !e || s > e) return out;
  const cur = new Date(s);
  while (cur <= e){
    if (weekdaysSet.has(cur.getDay())){
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, "0");
      const d = String(cur.getDate()).padStart(2, "0");
      out.push(`${y}-${m}-${d}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

async function ensureWorkspaceContext(deps){
  const { db, state } = deps || {};
  const companyId = state?.companyId;
  if (!db || !companyId) return;

  if (!Array.isArray(state.teams) || !state.teams.length){
    const teamsSnap = await getDocs(collection(db, `companies/${companyId}/teams`));
    state.teams = teamsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  if (!Array.isArray(state._usersCache) || !state._usersCache.length){
    state._usersCache = [];
  }

  // O custo tecnico estimado usa o valor/hora atual do tecnico.
  // Recarregamos os usuarios para evitar cache antigo apos edicoes no cadastro.
  const usersSnap = await getDocs(collection(db, `companies/${companyId}/users`));
  state._usersCache = usersSnap.docs.map((d) => {
    const data = d.data() || {};
    return { uid: data.uid || d.id, ...data };
  });
}

function getActivitySelectionInput(taskId, kind){
  return document.getElementById(`actSelected${kind}-${taskId}`);
}

function getActivitySelectionValues(taskId, kind){
  const input = getActivitySelectionInput(taskId, kind);
  if (!input?.value) return [];
  try {
    const parsed = JSON.parse(input.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function setActivitySelectionValues(taskId, kind, values){
  const input = getActivitySelectionInput(taskId, kind);
  if (!input) return;
  input.value = JSON.stringify(Array.isArray(values) ? values : []);
}

function renderActivitySelectionChips(taskId, kind, items){
  const wrap = document.getElementById(`act${kind}Chips-${taskId}`);
  if (!wrap) return;
  const list = Array.isArray(items) ? items : [];
  if (!list.length){
    wrap.innerHTML = `<span class="muted">Nenhum selecionado.</span>`;
    return;
  }
  wrap.innerHTML = list.map((item, idx) => `
    <span class="chip project-tech-chip ${ACTIVITY_CHIP_COLORS[idx % ACTIVITY_CHIP_COLORS.length]}">
      <span>${escapeHtml(item.label)}</span>
      <button
        type="button"
        class="project-tech-chip-remove"
        data-remove-activity-${kind.toLowerCase()}="${escapeHtml(taskId)}"
        data-remove-value="${escapeHtml(item.value)}"
        aria-label="Remover ${kind.toLowerCase()}"
      >x</button>
    </span>
  `).join("");
}

function addActivitySelection(taskId, kind, value, label){
  if (!taskId || !value) return;
  const current = getActivitySelectionValues(taskId, kind);
  if (current.some(item => item?.value === value)) return;
  const next = [...current, { value, label: label || value }];
  setActivitySelectionValues(taskId, kind, next);
  renderActivitySelectionChips(taskId, kind, next);
}

function removeActivitySelection(taskId, kind, value){
  const next = getActivitySelectionValues(taskId, kind).filter(item => item?.value !== value);
  setActivitySelectionValues(taskId, kind, next);
  renderActivitySelectionChips(taskId, kind, next);
}

function syncActivityWeekdaysVisibility(taskId){
  if (!taskId) return;
  const wrap = document.getElementById(`actWeekdays-${taskId}`);
  const start = document.getElementById(`actRangeStart-${taskId}`)?.value || "";
  const end = document.getElementById(`actRangeEnd-${taskId}`)?.value || "";
  if (!wrap) return;

  const isSingleDay = !!start && !!end && start === end;
  wrap.hidden = isSingleDay;
}

function ensureActivityActionModal(){
  let modal = document.getElementById("modalWorkspaceActivity");
  if (modal) return modal;

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal" hidden id="modalWorkspaceActivity">
      <div class="modal-backdrop" data-close-activity-modal="true"></div>
      <div class="modal-card activity-modal-card">
        <div class="modal-header">
          <div>
            <h2 id="activityModalTitle">Atividade</h2>
            <p class="muted" id="activityModalSubtitle">Detalhes da atividade.</p>
          </div>
          <button class="btn ghost" id="btnCloseWorkspaceActivity" type="button">X</button>
        </div>
        <div class="modal-body">
          <div class="alert" hidden id="activityModalAlert"></div>
          <div class="activity-modal-grid" id="activityModalLegacyGrid">
            <label class="field">
              <span>Nome da atividade</span>
              <input id="activityModalName" maxlength="100" />
            </label>
            <label class="field">
              <span>Data</span>
              <input type="date" id="activityModalDate" />
            </label>
            <label class="field">
              <span>Horas</span>
              <input type="number" id="activityModalHours" min="1" max="12" step="0.5" />
            </label>
            <label class="field">
              <span>Tecnico</span>
              <input id="activityModalTech" disabled />
            </label>
            <label class="field span-2">
              <span>Key users</span>
              <input id="activityModalKeyUsers" placeholder="Separe por virgula" />
            </label>
            <label class="field span-2">
              <span>Observacao</span>
              <textarea id="activityModalNote" rows="4" placeholder="Observacao da atividade"></textarea>
            </label>
          </div>
          <div class="my-activity-modal-shell" hidden id="activityModalGeneratedShell">
            <section class="my-activity-section my-activity-section--context">
              <div class="my-activity-section-head">
                <div>
                  <div class="my-activity-section-kicker">Contexto</div>
                  <h3>Detalhes da atividade</h3>
                </div>
                <span class="my-activity-status-badge" id="activityModalGeneratedStatusBadge">OS Enviada</span>
              </div>

              <div class="my-activity-modal-grid">
                <label class="field">
                  <span>Projeto</span>
                  <input id="activityModalGeneratedProject" disabled />
                </label>
                <label class="field">
                  <span>Cliente</span>
                  <input id="activityModalGeneratedClient" disabled />
                </label>
                <label class="field">
                  <span>Tarefa</span>
                  <input id="activityModalGeneratedTask" disabled />
                </label>
                <label class="field span-2">
                  <span>Atividade</span>
                  <input id="activityModalGeneratedName" disabled />
                </label>
                <label class="field">
                  <span>Data</span>
                  <input id="activityModalGeneratedDate" disabled />
                </label>
                <label class="field">
                  <span>Horas previstas</span>
                  <input id="activityModalGeneratedHours" disabled />
                </label>
                <label class="field span-2">
                  <span>Tecnico</span>
                  <input id="activityModalGeneratedTech" disabled />
                </label>
                <label class="field span-2">
                  <span>Key users</span>
                  <textarea id="activityModalGeneratedKeyUsers" rows="2" disabled></textarea>
                </label>
              </div>
            </section>

            <section class="my-activity-section my-activity-section--worklog">
              <div class="my-activity-section-head">
                <div>
                  <div class="my-activity-section-kicker">Apontamento</div>
                  <h3>Registro do tecnico</h3>
                </div>
                <div class="my-activity-tip" id="activityModalGeneratedTip">Confira o apontamento enviado pelo tecnico.</div>
              </div>

              <div class="my-activity-time-grid">
                <label class="field">
                  <span>Inicio</span>
                  <input id="activityModalGeneratedStartTime" type="time" />
                </label>
                <label class="field">
                  <span>Fim</span>
                  <input id="activityModalGeneratedEndTime" type="time" />
                </label>
                <label class="field">
                  <span>Descanso</span>
                  <input id="activityModalGeneratedBreakTime" type="time" value="01:00" />
                </label>
                <label class="field">
                  <span>Status atual</span>
                  <input id="activityModalGeneratedStatus" disabled />
                </label>
              </div>

              <div class="my-activity-hours-summary">
                <div class="my-activity-hours-card">
                  <span class="my-activity-hours-label">Horas apontadas</span>
                  <strong id="activityModalGeneratedComputedHours">0h</strong>
                </div>
                <div class="my-activity-hours-hint" id="activityModalGeneratedComputedHoursHint">Informe inicio e fim para calcular o total.</div>
              </div>

              <label class="field span-2 my-activity-note-field">
                <span>Observacao do tecnico</span>
                <textarea id="activityModalGeneratedNote" rows="6" placeholder="Observacao do apontamento"></textarea>
                <div class="my-activity-note-meta">
                  <small>Este apontamento foi enviado pelo tecnico e pode ser revisado pelos perfis de gestao.</small>
                  <strong id="activityModalGeneratedNoteCounter">0/50 minimo</strong>
                </div>
              </label>
            </section>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn ghost" id="btnCancelWorkspaceActivity" type="button">Fechar</button>
          <button class="btn danger" id="btnDeleteWorkspaceActivity" type="button">Excluir atividade</button>
          <button class="btn primary" id="btnSaveWorkspaceActivity" type="button">Salvar alteracoes</button>
        </div>
      </div>
    </div>
  `);

  return document.getElementById("modalWorkspaceActivity");
}

function ensureApprovalConfirmModal(){
  let modal = document.getElementById("modalWorkspaceApprovalConfirm");
  if (modal) return modal;

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal" hidden id="modalWorkspaceApprovalConfirm">
      <div class="modal-backdrop" data-close-workspace-approval="true"></div>
      <div class="modal-card workspace-approval-modal-card">
        <div class="modal-header">
          <div>
            <h2 id="workspaceApprovalTitle">Confirmar acao</h2>
            <p class="muted" id="workspaceApprovalSubtitle">Revise antes de continuar.</p>
          </div>
          <button class="btn ghost" id="btnCloseWorkspaceApproval" type="button">X</button>
        </div>
        <div class="modal-body">
          <div class="workspace-approval-summary" id="workspaceApprovalSummary"></div>
        </div>
        <div class="modal-footer">
          <button class="btn ghost" id="btnCancelWorkspaceApproval" type="button">Cancelar</button>
          <button class="btn primary" id="btnConfirmWorkspaceApproval" type="button">Confirmar</button>
        </div>
      </div>
    </div>
  `);

  return document.getElementById("modalWorkspaceApprovalConfirm");
}

function getApprovalConfirmModalRefs(){
  ensureApprovalConfirmModal();
  const byId = (id) => document.getElementById(id);
  return {
    modal: byId("modalWorkspaceApprovalConfirm"),
    title: byId("workspaceApprovalTitle"),
    subtitle: byId("workspaceApprovalSubtitle"),
    summary: byId("workspaceApprovalSummary"),
    btnClose: byId("btnCloseWorkspaceApproval"),
    btnCancel: byId("btnCancelWorkspaceApproval"),
    btnConfirm: byId("btnConfirmWorkspaceApproval")
  };
}

function getActivityActionModalRefs(){
  ensureActivityActionModal();
  const byId = (id) => document.getElementById(id);
  return {
    modal: byId("modalWorkspaceActivity"),
    title: byId("activityModalTitle"),
    subtitle: byId("activityModalSubtitle"),
    alert: byId("activityModalAlert"),
    name: byId("activityModalName"),
    date: byId("activityModalDate"),
    hours: byId("activityModalHours"),
    tech: byId("activityModalTech"),
    keyUsers: byId("activityModalKeyUsers"),
    note: byId("activityModalNote"),
    legacyGrid: byId("activityModalLegacyGrid"),
    generatedShell: byId("activityModalGeneratedShell"),
    generatedStatusBadge: byId("activityModalGeneratedStatusBadge"),
    generatedProject: byId("activityModalGeneratedProject"),
    generatedClient: byId("activityModalGeneratedClient"),
    generatedTask: byId("activityModalGeneratedTask"),
    generatedName: byId("activityModalGeneratedName"),
    generatedDate: byId("activityModalGeneratedDate"),
    generatedHours: byId("activityModalGeneratedHours"),
    generatedTech: byId("activityModalGeneratedTech"),
    generatedKeyUsers: byId("activityModalGeneratedKeyUsers"),
    generatedStartTime: byId("activityModalGeneratedStartTime"),
    generatedEndTime: byId("activityModalGeneratedEndTime"),
    generatedBreakTime: byId("activityModalGeneratedBreakTime"),
    generatedStatus: byId("activityModalGeneratedStatus"),
    generatedComputedHours: byId("activityModalGeneratedComputedHours"),
    generatedComputedHoursHint: byId("activityModalGeneratedComputedHoursHint"),
    generatedNote: byId("activityModalGeneratedNote"),
    generatedNoteCounter: byId("activityModalGeneratedNoteCounter"),
    generatedTip: byId("activityModalGeneratedTip"),
    btnClose: byId("btnCloseWorkspaceActivity"),
    btnCancel: byId("btnCancelWorkspaceActivity"),
    btnSave: byId("btnSaveWorkspaceActivity"),
    btnDelete: byId("btnDeleteWorkspaceActivity"),
  };
}

function updateWorkspaceGeneratedNoteCounter(modalRefs){
  if (!modalRefs?.generatedNoteCounter) return;
  const noteLength = String(modalRefs.generatedNote?.value || "").trim().length;
  modalRefs.generatedNoteCounter.textContent = `${noteLength}/50 minimo`;
  modalRefs.generatedNoteCounter.classList.toggle("is-ready", noteLength >= 50);
}

function updateWorkspaceGeneratedComputedHours(modalRefs, activity){
  if (!modalRefs?.generatedComputedHours || !modalRefs?.generatedComputedHoursHint) return;
  const start = modalRefs.generatedStartTime?.value || "";
  const end = modalRefs.generatedEndTime?.value || "";
  const breakTime = modalRefs.generatedBreakTime?.value || "01:00";
  const total = diffHours(start, end, breakTime);
  const planned = asNumber(activity?.hoursWorked);

  modalRefs.generatedComputedHours.textContent = formatHoursDisplay(total);
  modalRefs.generatedComputedHours.classList.toggle("is-over", total > 0 && planned > 0 && total > planned);

  if (!start || !end) {
    modalRefs.generatedComputedHoursHint.textContent = "Informe inicio e fim para calcular o total.";
    return;
  }
  if (total <= 0) {
    modalRefs.generatedComputedHoursHint.textContent = "Horario invalido. O total precisa ser maior que zero apos descontar o descanso.";
    return;
  }
  modalRefs.generatedComputedHoursHint.textContent = `Previsto para a atividade: ${formatHoursDisplay(planned)}. Descanso aplicado: ${breakTime}.`;
}

function normalizeCommaList(raw){
  const seen = new Set();
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getTaskHoursAvailability(taskId, excludeActivityId = ""){
  const task = _tasks.find((item) => item.id === taskId);
  if (!task) return { plannedHours: 0, usedHours: 0, availableHours: 0 };

  const plannedHours = asNumber(task.plannedHours);
  const usedHours = _activities
    .filter((activity) => activity.taskId === taskId && activity.id !== excludeActivityId)
    .reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);

  return {
    plannedHours,
    usedHours,
    availableHours: Math.max(0, plannedHours - usedHours),
  };
}

function closeActivityActionModal(){
  const modalRefs = getActivityActionModalRefs();
  clearAlert(modalRefs.alert);
  if (modalRefs.modal) modalRefs.modal.hidden = true;
  _activityModalMode = "view";
  _activityModalActivityId = "";
}

function closeApprovalConfirmModal(){
  const modalRefs = getApprovalConfirmModalRefs();
  if (modalRefs.modal) modalRefs.modal.hidden = true;
  _approvalConfirmActivityId = "";
  _approvalConfirmNextStatus = "";
}

function openApprovalConfirmModal(activityId, nextStatus){
  const modalRefs = getApprovalConfirmModalRefs();
  const activity = _activities.find((item) => item.id === activityId);
  if (!activity) return;
  _approvalConfirmActivityId = activityId;
  _approvalConfirmNextStatus = nextStatus;
  if (modalRefs.title) modalRefs.title.textContent = nextStatus === "os_aprovada" ? "Confirma a aprovacao?" : "Confirma o estorno?";
  if (modalRefs.subtitle) modalRefs.subtitle.textContent = "";
  if (modalRefs.summary) {
    modalRefs.summary.innerHTML = `
      <strong>${escapeHtml(activity.name || "Atividade")}</strong>
      <span>${escapeHtml(activity.taskName || (_tasks.find((item) => item.id === activity.taskId)?.name || "Tarefa"))}</span>
    `;
  }
  if (modalRefs.btnConfirm) {
    modalRefs.btnConfirm.textContent = "Sim";
    modalRefs.btnConfirm.className = `btn ${nextStatus === "os_aprovada" ? "primary" : "danger"}`;
  }
  if (modalRefs.btnCancel) modalRefs.btnCancel.textContent = "Nao";
  if (modalRefs.modal) modalRefs.modal.hidden = false;
}

async function confirmApprovalStatusChange(deps){
  const { state, db, auth } = deps;
  const activity = _activities.find((item) => item.id === _approvalConfirmActivityId);
  if (!activity || !_approvalConfirmNextStatus) return;
  const currentUid = auth?.currentUser?.uid || "";
  const currentUser = (state._usersCache || []).find((item) => item.uid === currentUid) || null;
  const currentName = currentUser?.name || auth?.currentUser?.email || "";
  const currentEmail = auth?.currentUser?.email || "";

  const payload = _approvalConfirmNextStatus === "os_aprovada"
    ? {
        status: "os_aprovada",
        approvedAt: serverTimestamp(),
        approvedBy: currentUid,
        approvedByName: currentName,
        approvedByEmail: currentEmail,
        approvalRevertedAt: null,
        approvalRevertedBy: null,
        approvalRevertedByName: null,
        updatedAt: serverTimestamp(),
        updatedBy: currentUid
      }
    : {
        status: "os_gerada",
        approvalRevertedAt: serverTimestamp(),
        approvalRevertedBy: currentUid,
        approvalRevertedByName: currentName,
        updatedAt: serverTimestamp(),
        updatedBy: currentUid
      };

  await updateDoc(doc(db, `companies/${state.companyId}/activities`, activity.id), payload);
  await createNotifications(db, state.companyId, activity.techUids || [], {
    type: _approvalConfirmNextStatus === "os_aprovada" ? "os_approved" : "os_reverted",
    title: _approvalConfirmNextStatus === "os_aprovada" ? "OS aprovada" : "OS estornada",
    message: `${currentName || "Gestao"} ${_approvalConfirmNextStatus === "os_aprovada" ? "aprovou" : "estornou"} sua OS em ${_activeProject?.name || "um projeto"}.`,
    entityType: "activity",
    entityId: activity.id,
    activityId: activity.id,
    projectId: activity.projectId || _activeProjectId || "",
    taskId: activity.taskId || "",
    createdBy: currentUid,
    createdByName: currentName,
    createdByEmail: currentEmail
  }).catch((err) => console.warn("[notifications:workspace-approval]", err));
  closeApprovalConfirmModal();
  await refreshWorkspace(deps);
}

function isVisibleAlert(el){
  return Boolean(el && !el.hidden && String(el.textContent || "").trim());
}

function isInsideProjectTaskActionArea(target, refs){
  if (!target || !refs) return false;
  if (refs.projectTaskAlert?.contains?.(target)) return true;
  if (target.closest?.("[data-open-activity-form]")) return true;
  if (target.closest?.("[data-cancel-activity-form]")) return true;
  if (target.closest?.("[data-save-activity]")) return true;
  if (target.closest?.("[data-save-tech-fill]")) return true;
  if (target.closest?.("[data-activity-tech-select]")) return true;
  if (target.closest?.("[data-activity-keyuser-select]")) return true;
  if (target.closest?.("[data-remove-activity-techs]")) return true;
  if (target.closest?.("[data-remove-activity-keyusers]")) return true;
  return false;
}

function isInsideActivityModalActionArea(target, modalRefs){
  if (!target || !modalRefs?.modal || modalRefs.modal.hidden) return false;
  if (modalRefs.alert?.contains?.(target)) return true;
  const card = modalRefs.modal.querySelector(".activity-modal-card");
  return Boolean(card?.contains?.(target));
}

function openActivityActionModal(activityId, mode){
  const modalRefs = getActivityActionModalRefs();
  const activity = _activities.find((item) => item.id === activityId);
  if (!activity) return;
  const modalCard = modalRefs.modal?.querySelector?.(".activity-modal-card");

  _activityModalMode = mode;
  _activityModalActivityId = activityId;
  clearAlert(modalRefs.alert);

  const readOnly = mode !== "edit";
  const isGenerated = isCompletedStatus(activity) && mode !== "delete";
  modalRefs.title.textContent = mode === "edit" ? "Editar atividade" : (mode === "delete" ? "Excluir atividade" : "Visualizar atividade");
  modalRefs.subtitle.textContent = mode === "edit"
    ? "Atualize os dados da atividade."
    : (mode === "delete" ? "Confira os dados antes de confirmar a exclusao." : "Detalhes completos da atividade.");

  if (modalRefs.legacyGrid) {
    modalRefs.legacyGrid.hidden = isGenerated;
    modalRefs.legacyGrid.style.display = isGenerated ? "none" : "grid";
  }
  if (modalRefs.generatedShell) {
    modalRefs.generatedShell.hidden = !isGenerated;
    modalRefs.generatedShell.style.display = isGenerated ? "grid" : "none";
  }
  if (modalCard) modalCard.classList.toggle("my-activity-modal-card", isGenerated);

  modalRefs.name.value = activity.name || "";
  modalRefs.date.value = activity.workDate || "";
  modalRefs.hours.value = String(activity.hoursWorked ?? "");
  modalRefs.tech.value = Array.isArray(activity.techNames) && activity.techNames.length ? activity.techNames.join(", ") : "Sem tecnico";
  modalRefs.keyUsers.value = Array.isArray(activity.keyUsers) ? activity.keyUsers.join(", ") : "";
  modalRefs.note.value = activity.note || "";

  [modalRefs.name, modalRefs.date, modalRefs.hours, modalRefs.keyUsers, modalRefs.note].forEach((field) => {
    if (field) field.disabled = readOnly;
  });

  if (isGenerated) {
    const clientName = _activeProject?.clientName || _activeProject?.client?.name || "";
    if (modalRefs.generatedProject) modalRefs.generatedProject.value = _activeProject?.name || activity.projectName || "Projeto";
    if (modalRefs.generatedClient) modalRefs.generatedClient.value = clientName || "-";
    if (modalRefs.generatedTask) modalRefs.generatedTask.value = activity.taskName || (_tasks.find((item) => item.id === activity.taskId)?.name || "");
    if (modalRefs.generatedName) modalRefs.generatedName.value = activity.name || "";
    if (modalRefs.generatedDate) modalRefs.generatedDate.value = fmtDate(activity.workDate);
    if (modalRefs.generatedHours) modalRefs.generatedHours.value = formatHoursDisplay(asNumber(activity.hoursWorked));
    if (modalRefs.generatedTech) modalRefs.generatedTech.value = Array.isArray(activity.techNames) && activity.techNames.length ? activity.techNames.join(", ") : "Sem tecnico";
    if (modalRefs.generatedKeyUsers) modalRefs.generatedKeyUsers.value = Array.isArray(activity.keyUsers) ? activity.keyUsers.join(", ") : "";
    if (modalRefs.generatedStartTime) modalRefs.generatedStartTime.value = activity.startTime || "";
    if (modalRefs.generatedEndTime) modalRefs.generatedEndTime.value = activity.endTime || "";
    if (modalRefs.generatedBreakTime) modalRefs.generatedBreakTime.value = activity.breakTime || "01:00";
    if (modalRefs.generatedStatus) modalRefs.generatedStatus.value = isApprovedStatus(activity) ? "OS Aprovada" : "OS Enviada";
    if (modalRefs.generatedNote) modalRefs.generatedNote.value = activity.note || "";
    if (modalRefs.generatedStatusBadge) {
      modalRefs.generatedStatusBadge.textContent = isApprovedStatus(activity) ? "OS Aprovada" : "OS Enviada";
      modalRefs.generatedStatusBadge.className = `my-activity-status-badge ${isApprovedStatus(activity) ? "my-activity-status-badge--ok" : "my-activity-status-badge--sent"}`;
    }
    if (modalRefs.generatedTip) {
      modalRefs.generatedTip.textContent = readOnly
        ? "Confira o apontamento enviado pelo tecnico."
        : "Revise o apontamento do tecnico mantendo o mesmo contexto exibido para ele.";
    }
    [modalRefs.generatedStartTime, modalRefs.generatedEndTime, modalRefs.generatedBreakTime, modalRefs.generatedNote].forEach((field) => {
      if (field) field.disabled = readOnly;
    });
    updateWorkspaceGeneratedNoteCounter(modalRefs);
    updateWorkspaceGeneratedComputedHours(modalRefs, activity);
  }

  if (modalRefs.btnSave) modalRefs.btnSave.hidden = mode !== "edit";
  if (modalRefs.btnDelete) modalRefs.btnDelete.hidden = mode === "view";
  if (modalRefs.btnDelete) modalRefs.btnDelete.textContent = mode === "delete" ? "Confirmar exclusao" : "Excluir atividade";
  if (modalRefs.btnCancel) modalRefs.btnCancel.textContent = mode === "edit" ? "Cancelar" : "Fechar";

  if (modalRefs.modal) modalRefs.modal.hidden = false;
}

async function saveActivityModalChanges(deps){
  const { state, db, auth } = deps;
  const modalRefs = getActivityActionModalRefs();
  const activity = _activities.find((item) => item.id === _activityModalActivityId);
  if (!activity) return;

  clearAlert(modalRefs.alert);

  if (isCompletedStatus(activity)) {
    const start = modalRefs.generatedStartTime?.value || "";
    const end = modalRefs.generatedEndTime?.value || "";
    const breakTime = modalRefs.generatedBreakTime?.value || "01:00";
    const note = (modalRefs.generatedNote?.value || "").trim();
    const hoursDiff = diffHours(start, end, breakTime);
    const maxHours = asNumber(activity.hoursWorked);

    if (hoursDiff <= 0) {
      setAlert(modalRefs.alert, "Informe hora inicio, fim e descanso validos.", "error");
      return;
    }
    if (hoursDiff > maxHours) {
      setAlert(modalRefs.alert, `O apontamento nao pode ultrapassar ${maxHours}h previstas para a atividade.`, "error");
      return;
    }
    if (note.length < 50) {
      setAlert(modalRefs.alert, "A observacao precisa ter no minimo 50 caracteres.", "error");
      return;
    }

    await updateDoc(doc(db, `companies/${state.companyId}/activities`, activity.id), {
      startTime: start,
      endTime: end,
      breakTime,
      workedHours: hoursDiff,
      note,
      status: isApprovedStatus(activity) ? "os_aprovada" : "os_gerada",
      updatedAt: serverTimestamp(),
      updatedBy: auth?.currentUser?.uid || ""
    });

    closeActivityActionModal();
    await refreshWorkspace(deps);
    return;
  }

  const nextName = (modalRefs.name?.value || "").trim();
  const nextDate = modalRefs.date?.value || "";
  const nextHours = asNumber(modalRefs.hours?.value || 0);
  const nextKeyUsers = normalizeCommaList(modalRefs.keyUsers?.value || "");
  const nextNote = (modalRefs.note?.value || "").trim();

  if (!nextName || !nextDate || nextHours <= 0){
    setAlert(modalRefs.alert, "Preencha nome, data e horas da atividade.", "error");
    return;
  }
  if (nextHours > 12){
    setAlert(modalRefs.alert, "A atividade aceita no maximo 12 horas por dia.", "error");
    return;
  }
  if (!nextKeyUsers.length){
    setAlert(modalRefs.alert, "Informe ao menos um key user para a atividade.", "error");
    return;
  }

  const task = _tasks.find((item) => item.id === activity.taskId);
  if (!task) {
    setAlert(modalRefs.alert, "Tarefa da atividade nao encontrada.", "error");
    return;
  }
  if (!overlap(nextDate, nextDate, task.startDate, task.endDate)){
    setAlert(modalRefs.alert, `A data ${fmtDate(nextDate)} esta fora do periodo da tarefa.`, "error");
    return;
  }

  const hoursInfo = getTaskHoursAvailability(activity.taskId, activity.id);
  if (hoursInfo.plannedHours > 0 && nextHours > hoursInfo.availableHours){
    setAlert(
      modalRefs.alert,
      `Horas insuficientes nesta tarefa. Disponiveis: ${hoursInfo.availableHours}h. A atividade editada ficaria com ${nextHours}h.`,
      "error"
    );
    return;
  }

  await updateDoc(doc(db, `companies/${state.companyId}/activities`, activity.id), {
    name: nextName,
    workDate: nextDate,
    hoursWorked: nextHours,
    keyUsers: nextKeyUsers,
    note: nextNote,
    updatedAt: serverTimestamp(),
    updatedBy: auth?.currentUser?.uid || ""
  });

  closeActivityActionModal();
  await refreshWorkspace(deps);
}

async function deleteActivityModalItem(deps){
  const { state, db } = deps;
  const activity = _activities.find((item) => item.id === _activityModalActivityId);
  if (!activity) return;

  await deleteDoc(doc(db, `companies/${state.companyId}/activities`, activity.id));
  closeActivityActionModal();
  await refreshWorkspace(deps);
}

function bindOnce(deps){
  if (_bound) return;
  _bound = true;
  const refs = _wsRefs(deps);
  const activityModalRefs = getActivityActionModalRefs();
  const approvalModalRefs = getApprovalConfirmModalRefs();

  if (!_activityModalBound){
    _activityModalBound = true;

    activityModalRefs.btnClose?.addEventListener("click", closeActivityActionModal);
    activityModalRefs.btnCancel?.addEventListener("click", closeActivityActionModal);
    activityModalRefs.generatedNote?.addEventListener("input", () => updateWorkspaceGeneratedNoteCounter(activityModalRefs));
    activityModalRefs.generatedStartTime?.addEventListener("input", () => {
      const activity = _activities.find((item) => item.id === _activityModalActivityId);
      updateWorkspaceGeneratedComputedHours(activityModalRefs, activity);
    });
    activityModalRefs.generatedEndTime?.addEventListener("input", () => {
      const activity = _activities.find((item) => item.id === _activityModalActivityId);
      updateWorkspaceGeneratedComputedHours(activityModalRefs, activity);
    });
    activityModalRefs.generatedBreakTime?.addEventListener("input", () => {
      const activity = _activities.find((item) => item.id === _activityModalActivityId);
      updateWorkspaceGeneratedComputedHours(activityModalRefs, activity);
    });
    activityModalRefs.modal?.addEventListener("click", (ev) => {
      if (ev.target?.dataset?.closeActivityModal === "true") closeActivityActionModal();
    });
    activityModalRefs.btnSave?.addEventListener("click", async () => {
      await saveActivityModalChanges(deps);
    });
    activityModalRefs.btnDelete?.addEventListener("click", async () => {
      if (_activityModalMode === "edit"){
        openActivityActionModal(_activityModalActivityId, "delete");
        return;
      }
      await deleteActivityModalItem(deps);
    });
  }

  if (!_approvalConfirmBound){
    _approvalConfirmBound = true;
    approvalModalRefs.btnClose?.addEventListener("click", closeApprovalConfirmModal);
    approvalModalRefs.btnCancel?.addEventListener("click", closeApprovalConfirmModal);
    approvalModalRefs.modal?.addEventListener("click", (ev) => {
      if (ev.target?.dataset?.closeWorkspaceApproval === "true") closeApprovalConfirmModal();
    });
    approvalModalRefs.btnConfirm?.addEventListener("click", async () => {
      await confirmApprovalStatusChange(deps);
    });
  }

  refs.btnCloseProjectWorkspace?.addEventListener("click", () => {
    closeProjectWorkspace(deps);
  });

  refs.btnOpenWorkspaceEdit?.addEventListener("click", async () => {
    if (!_activeProjectId) return;
    if (typeof deps.openEditProjectModal === "function"){
      await deps.openEditProjectModal(_activeProjectId);
    }
  });

  refs.btnOpenWorkspaceView?.addEventListener("click", async () => {
    if (!_activeProjectId) return;
    if (typeof deps.openProjectDetailModal === "function"){
      await deps.openProjectDetailModal(_activeProjectId);
    }
  });

  refs.btnDeleteWorkspaceProject?.addEventListener("click", async () => {
    await deleteActiveProject(deps);
  });

  refs.btnOpenTaskForm?.addEventListener("click", () => {
    if (!canManageTasks(deps.state)) return;
    refs.projectTaskFormWrap.hidden = false;
  });

  refs.btnCancelTaskForm?.addEventListener("click", () => {
    refs.projectTaskFormWrap.hidden = true;
    clearTaskForm(refs);
  });

  refs.btnSaveTask?.addEventListener("click", async () => {
    await saveTask(deps);
  });

  refs.projectTaskSearchInput?.addEventListener("input", () => {
    _taskSearchTerm = refs.projectTaskSearchInput?.value || "";
    renderTasks(deps);
  });

  refs.projectWorkspaceTabs?.addEventListener("click", async (ev) => {
    const closeBtn = ev.target?.closest?.("[data-close-tab]");
    if (closeBtn){
      const pid = closeBtn.getAttribute("data-close-tab");
      _tabs = _tabs.filter(t => t.id !== pid);
      if (_activeProjectId === pid){
        _activeProjectId = "";
        _activeProject = null;
        if (_tabs.length){
          await openProjectWorkspace(_tabs[0].id, deps);
        } else {
          closeProjectWorkspace(deps);
        }
      } else {
        renderTabs(refs);
      }
      return;
    }

    const tab = ev.target?.closest?.("[data-open-tab]");
    if (!tab) return;
    const pid = tab.getAttribute("data-open-tab");
    if (!pid) return;
    if (refs.viewMyProjects?.hidden && typeof deps.setView === "function"){
      deps.setView("myProjects");
    }
    await openProjectWorkspace(pid, deps);
  });

  refs.projectWorkspaceBreadcrumb?.addEventListener("click", (ev) => {
    const backBtn = ev.target?.closest?.("[data-back-kanban]");
    if (!backBtn) return;
    closeProjectWorkspace(deps);
  });

  refs.projectTaskList?.addEventListener("click", async (ev) => {
    const statusFilterBtn = ev.target?.closest?.("[data-task-status-filter]");
    if (statusFilterBtn){
      ev.preventDefault();
      ev.stopPropagation();
      const taskId = statusFilterBtn.getAttribute("data-task-status-filter");
      const nextFilter = statusFilterBtn.getAttribute("data-filter-value") || "all";
      const currentFilter = _taskStatusFilters[taskId] || "all";
      if (currentFilter === nextFilter) delete _taskStatusFilters[taskId];
      else _taskStatusFilters[taskId] = nextFilter;
      renderTasks(deps);
      const taskCard = refs.projectTaskList.querySelector(`details.task-card [data-task-status-filter="${taskId}"]`)?.closest(".task-card");
      if (taskCard) taskCard.open = true;
      return;
    }

    const addActivityBtn = ev.target?.closest?.("[data-open-activity-form]");
    if (addActivityBtn){
      ev.preventDefault();
      const taskId = addActivityBtn.getAttribute("data-open-activity-form");
      const wrap = document.getElementById(`activityFormWrap-${taskId}`);
      const taskCard = addActivityBtn.closest(".task-card");
      if (wrap) {
        wrap.hidden = !wrap.hidden;
        syncActivityWeekdaysVisibility(taskId);
      }
      if (taskCard && wrap && !wrap.hidden) taskCard.open = true;
      return;
    }

    const cancelActivityBtn = ev.target?.closest?.("[data-cancel-activity-form]");
    if (cancelActivityBtn){
      const taskId = cancelActivityBtn.getAttribute("data-cancel-activity-form");
      const wrap = document.getElementById(`activityFormWrap-${taskId}`);
      if (wrap) wrap.hidden = true;
      return;
    }

    const saveActivityBtn = ev.target?.closest?.("[data-save-activity]");
    if (saveActivityBtn){
      const taskId = saveActivityBtn.getAttribute("data-save-activity");
      await saveActivity(taskId, deps);
      return;
    }

    const saveTechFillBtn = ev.target?.closest?.("[data-save-tech-fill]");
    if (saveTechFillBtn){
      const activityId = saveTechFillBtn.getAttribute("data-save-tech-fill");
      await saveTechFill(activityId, deps);
      return;
    }

    const viewActivityBtn = ev.target?.closest?.("[data-view-activity]");
    if (viewActivityBtn){
      openActivityActionModal(viewActivityBtn.getAttribute("data-view-activity"), "view");
      return;
    }

    const editActivityBtn = ev.target?.closest?.("[data-edit-activity]");
    if (editActivityBtn){
      openActivityActionModal(editActivityBtn.getAttribute("data-edit-activity"), "edit");
      return;
    }

    const deleteActivityBtn = ev.target?.closest?.("[data-delete-activity]");
    if (deleteActivityBtn){
      openActivityActionModal(deleteActivityBtn.getAttribute("data-delete-activity"), "delete");
      return;
    }

    const approveActivityBtn = ev.target?.closest?.("[data-approve-activity]");
    if (approveActivityBtn){
      openApprovalConfirmModal(
        approveActivityBtn.getAttribute("data-approve-activity"),
        approveActivityBtn.getAttribute("data-approve-next-status") || "os_aprovada"
      );
      return;
    }

    const removeTechBtn = ev.target?.closest?.("[data-remove-activity-techs]");
    if (removeTechBtn){
      removeActivitySelection(
        removeTechBtn.getAttribute("data-remove-activity-techs"),
        "Techs",
        removeTechBtn.getAttribute("data-remove-value")
      );
      return;
    }

    const removeKeyUserBtn = ev.target?.closest?.("[data-remove-activity-keyusers]");
    if (removeKeyUserBtn){
      removeActivitySelection(
        removeKeyUserBtn.getAttribute("data-remove-activity-keyusers"),
        "KeyUsers",
        removeKeyUserBtn.getAttribute("data-remove-value")
      );
      return;
    }
  });

  refs.projectTaskList?.addEventListener("change", (ev) => {
    const rangeStartInput = ev.target?.closest?.("[id^='actRangeStart-']");
    if (rangeStartInput){
      const taskId = String(rangeStartInput.id || "").replace("actRangeStart-", "");
      syncActivityWeekdaysVisibility(taskId);
      return;
    }

    const rangeEndInput = ev.target?.closest?.("[id^='actRangeEnd-']");
    if (rangeEndInput){
      const taskId = String(rangeEndInput.id || "").replace("actRangeEnd-", "");
      syncActivityWeekdaysVisibility(taskId);
      return;
    }

    const techSelect = ev.target?.closest?.("[data-activity-tech-select]");
    if (techSelect){
      const taskId = techSelect.getAttribute("data-activity-tech-select");
      const value = techSelect.value || "";
      const label = techSelect.options?.[techSelect.selectedIndex]?.textContent?.trim() || value;
      if (value) addActivitySelection(taskId, "Techs", value, label);
      techSelect.value = "";
      return;
    }

    const keyUserSelect = ev.target?.closest?.("[data-activity-keyuser-select]");
    if (keyUserSelect){
      const taskId = keyUserSelect.getAttribute("data-activity-keyuser-select");
      const value = keyUserSelect.value || "";
      const label = keyUserSelect.options?.[keyUserSelect.selectedIndex]?.textContent?.trim() || value;
      if (value) addActivitySelection(taskId, "KeyUsers", value, label);
      keyUserSelect.value = "";
    }
  });

  if (!_workspaceAlertDismissBound){
    _workspaceAlertDismissBound = true;
    document.addEventListener("click", (ev) => {
      const target = ev.target;
      if (isVisibleAlert(refs.projectTaskAlert) && !isInsideProjectTaskActionArea(target, refs)){
        clearAlert(refs.projectTaskAlert);
      }
      if (isVisibleAlert(activityModalRefs.alert) && !isInsideActivityModalActionArea(target, activityModalRefs)){
        clearAlert(activityModalRefs.alert);
      }
    });
  }
}

function clearTaskForm(refs){
  if (refs.taskNameInput) refs.taskNameInput.value = "";
  if (refs.taskStartDateInput) refs.taskStartDateInput.value = "";
  if (refs.taskEndDateInput) refs.taskEndDateInput.value = "";
  if (refs.taskPlannedHoursInput) refs.taskPlannedHoursInput.value = "";
}

function renderTabs(refs){
  if (!refs.projectWorkspaceTabs) return;
  if (!_tabs.length){
    refs.projectWorkspaceTabs.innerHTML = "";
    return;
  }
  refs.projectWorkspaceTabs.innerHTML = _tabs.map(t => `
    <button class="workspace-tab ${t.id === _activeProjectId ? "active" : ""} ${t.needsAttention ? "workspace-tab--attention" : ""}" data-open-tab="${escapeHtml(t.id)}" type="button">
      <span>${escapeHtml(t.label)}</span>
      <span class="workspace-tab-close" data-close-tab="${escapeHtml(t.id)}">x</span>
    </button>
  `).join("");
}

async function ensureTab(projectId, deps){
  if (!projectId) return;
  const existing = _tabs.find(t => t.id === projectId);
  if (existing) return;

  let label = `Projeto ${projectId}`;
  try{
    const companyId = deps?.state?.companyId;
    if (companyId){
      const snap = await getDoc(doc(deps.db, `companies/${companyId}/projects`, projectId));
      if (snap.exists()){
        const data = snap.data() || {};
        const fromProject = `${data.projectNumber || ""} ${data.name || ""}`.trim();
        if (fromProject) label = fromProject;
      }
    }
  }catch(_){ }

  _tabs.unshift({ id: projectId, label, needsAttention: false });
}

function renderCover(refs, project, state){
  if (!refs.projectWorkspaceCover) return;
  const teamName = (state.teams || []).find(t => t.id === project.teamId)?.name || "-";
  const statusInfo = normalizeProjectStatus(project.status);
  const client = project.clientName || "-";
  const manager = (state._usersCache || []).find(u => u.uid === project.managerUid)?.name || "-";
  const coordinator = (state._usersCache || []).find(u => u.uid === project.coordinatorUid)?.name || "-";
  const endDate = fmtDate(project.endDate);
  const users = Array.isArray(state?._usersCache) ? state._usersCache : [];
  const taskCount = _tasks.length;
  const plannedActivityHours = _activities.reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const executedActivityHours = _activities
    .filter((activity) => isCompletedStatus(activity))
    .reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const pendingActivities = _activities.filter((activity) => !isCompletedStatus(activity)).length;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueActivities = _activities.filter((activity) => {
    const workDate = parseDateOnly(activity.workDate);
    return Boolean(workDate && workDate < today && !isCompletedStatus(activity));
  }).length;
  const billingHours = asNumber(project.billingHours);
  const billingValueNumber = asNumber(project.billingValue);
  const billingValue = billingValueNumber > 0 ? formatCurrencyBRL(billingValueNumber) : "-";
  const clientHourlyRate = (billingHours > 0 && billingValueNumber > 0) ? (billingValueNumber / billingHours) : null;
  const approvedInternalExpenses = asNumber(_expenseSummary?.approvedInternal);
  const approvedClientExpenses = asNumber(_expenseSummary?.approvedClient);
  const pendingExpenses = asNumber(_expenseSummary?.totalPending);
  const estimatedTechCost = _activities.reduce((acc, activity) => {
    const techIds = Array.isArray(activity.techUids) ? activity.techUids.filter(Boolean) : [];
    const plannedHours = asNumber(activity.hoursWorked);
    if (!plannedHours || !techIds.length) return acc;
    const activityRate = techIds.reduce((sum, uid) => {
      const tech = users.find(u => u.uid === uid);
      return sum + asNumber(tech?.hourlyRate);
    }, 0);
    return acc + (activityRate * plannedHours);
  }, 0);
  const projectCost = estimatedTechCost + approvedInternalExpenses;
  const profitValue = billingValueNumber > 0 ? (billingValueNumber - estimatedTechCost - approvedInternalExpenses) : null;
  const profitPercent = (billingValueNumber > 0 && profitValue !== null) ? ((profitValue / billingValueNumber) * 100) : null;
  const profitTone = profitValue === null ? "neutral" : (profitValue >= 0 ? "positive" : "negative");
  const projectCompletion = billingHours > 0 ? Math.min(100, Math.round((executedActivityHours / billingHours) * 100)) : 0;

  refs.projectWorkspaceCover.innerHTML = `
    <div class="project-cover-hero">
      <div class="project-cover-main">
        <div class="project-cover-eyebrow"><span class="project-cover-id">#${escapeHtml(String(project.projectNumber || project.id || "-"))}</span><span class="project-cover-eyebrow-text">PROJETO</span></div>
        <div class="project-cover-title">${escapeHtml(project.name || "Projeto")}</div>
        <div class="project-cover-subtitle">Workspace central do projeto com tarefas e atividades vinculadas.</div>
        <div class="project-cover-kpis">
          <div class="project-cover-kpi">
            <span class="project-cover-kpi-label">Qtde de tarefas</span>
            <strong>${escapeHtml(String(taskCount))}</strong>
          </div>
          <div class="project-cover-kpi">
            <span class="project-cover-kpi-label">Horas planejadas</span>
            <strong>${escapeHtml(formatHoursLabel(plannedActivityHours))}</strong>
          </div>
          <div class="project-cover-kpi">
            <span class="project-cover-kpi-label">Horas executadas</span>
            <strong>${escapeHtml(formatHoursLabel(executedActivityHours))}</strong>
          </div>
          <div class="project-cover-kpi">
            <span class="project-cover-kpi-label">Atividades pendentes</span>
            <strong>${escapeHtml(String(pendingActivities))}</strong>
            <span class="project-cover-meta">${escapeHtml(String(overdueActivities))} atrasada(s)</span>
          </div>
          <div class="project-cover-kpi">
            <span class="project-cover-kpi-label">Despesas internas</span>
            <strong>${escapeHtml(formatCurrencyBRL(approvedInternalExpenses))}</strong>
            <span class="project-cover-meta">Internas aprovadas</span>
          </div>
          <div class="project-cover-kpi">
            <span class="project-cover-kpi-label">Custo tecnico estimado</span>
            <strong>${escapeHtml(estimatedTechCost > 0 ? formatCurrencyBRL(estimatedTechCost) : "-")}</strong>
            <span class="project-cover-meta">Horas planejadas</span>
          </div>
        </div>
      </div>
      <div class="project-cover-badges">
        <div class="project-cover-highlight-row">
          <div class="project-cover-highlight project-cover-highlight--status project-cover-highlight--${escapeHtml(statusInfo.css)}">
            <span class="project-cover-highlight-label">Status</span>
            <strong>${escapeHtml(statusInfo.label)}</strong>
          </div>
          <div class="project-cover-highlight project-cover-highlight--profit project-cover-highlight--${escapeHtml(profitTone)}">
            <span class="project-cover-highlight-label">Margem estimada</span>
            <strong>${escapeHtml(profitValue !== null ? formatCurrencyBRL(profitValue) : "-")}</strong>
            <span class="project-cover-highlight-meta">${escapeHtml(profitPercent !== null ? `${profitPercent.toFixed(1).replace(".", ",")}% apos despesas internas aprovadas` : "Sem base suficiente")}</span>
          </div>
          <div class="project-cover-highlight project-cover-highlight--deadline">
            <span class="project-cover-highlight-label">Despesas</span>
            <strong>${escapeHtml(formatCurrencyBRL(pendingExpenses))}</strong>
            <span class="project-cover-highlight-meta">${escapeHtml(`${String(asNumber(_expenseSummary?.countPending))} pendente(s) - Cliente ${formatCurrencyBRL(approvedClientExpenses)}`)}</span>
          </div>
          <div class="project-cover-highlight project-cover-highlight--deadline">
            <span class="project-cover-highlight-label">Prazo final</span>
            <strong>${escapeHtml(endDate)}</strong>
          </div>
        </div>
        <div class="project-cover-actions" id="projectCoverActionsSlot">
          <button class="icon-btn xs btn-report-pdf" id="btnDownloadStatusReportPdf" type="button" title="Baixar status report em PDF" aria-label="Baixar status report em PDF">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
              <path d="M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
              <path d="M8 16h2.2a1.4 1.4 0 0 0 0-2.8H8V18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
              <path d="M13 18v-4.8h1.4a1.8 1.8 0 1 1 0 3.6H13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </button>
          <button class="icon-btn xs btn-report-excel" id="btnDownloadStatusReportExcel" type="button" title="Baixar status report em Excel" aria-label="Baixar status report em Excel">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
              <path d="M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
              <path d="m8.5 18 3-5-3-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
              <path d="m14.5 18-3-5 3-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
    <div class="project-cover-profit-strip">
      <div class="project-cover-profit-item">
        <span class="project-cover-label">Horas do projeto</span>
        <strong>${escapeHtml(formatHoursLabel(billingHours))}</strong>
      </div>
      <div class="project-cover-profit-item">
        <span class="project-cover-label">Valor do projeto</span>
        <strong>${escapeHtml(billingValue)}</strong>
      </div>
      <div class="project-cover-profit-item">
        <span class="project-cover-label">Custo do projeto</span>
        <strong>${escapeHtml(projectCost > 0 ? formatCurrencyBRL(projectCost) : "-")}</strong>
        <span class="project-cover-meta">Tecnico + despesas internas</span>
      </div>
      <div class="project-cover-profit-item">
        <span class="project-cover-label">Consumo das horas</span>
        <strong>${escapeHtml(`${projectCompletion}%`)}</strong>
      </div>
    </div>
    <div class="project-cover-grid">
      <div class="project-cover-card">
        <span class="project-cover-label">Cliente</span>
        <strong>${escapeHtml(client)}</strong>
      </div>
      <div class="project-cover-card">
        <span class="project-cover-label">Equipe</span>
        <strong>${escapeHtml(teamName)}</strong>
      </div>
      <div class="project-cover-card">
        <span class="project-cover-label">Gestor</span>
        <strong>${escapeHtml(manager)}</strong>
      </div>
      <div class="project-cover-card">
        <span class="project-cover-label">Coordenador</span>
        <strong>${escapeHtml(coordinator)}</strong>
      </div>
      <div class="project-cover-card">
        <span class="project-cover-label">Valor hora cliente</span>
        <strong>${escapeHtml(clientHourlyRate !== null ? formatCurrencyBRL(clientHourlyRate) : "-")}</strong>
      </div>
    </div>
  `;

  const actionsSlot = document.getElementById("projectCoverActionsSlot");
  if (actionsSlot){
    [refs.btnOpenWorkspaceView, refs.btnOpenWorkspaceEdit, refs.btnDeleteWorkspaceProject].forEach((btn) => {
      if (btn) actionsSlot.appendChild(btn);
    });
  }

  document.getElementById("btnDownloadStatusReportPdf")?.addEventListener("click", async () => {
    try{
      await downloadProjectStatusReportPdf({
        project,
        tasks: _tasks,
        activities: _activities,
        state
      });
    }catch(err){
      console.error("[status-report:pdf]", err);
      setAlert(refs.projectTaskAlert, err?.message || "Nao foi possivel gerar o status report em PDF.", "error");
    }
  });

  document.getElementById("btnDownloadStatusReportExcel")?.addEventListener("click", async () => {
    try{
      await downloadProjectStatusReportExcel({
        project,
        tasks: _tasks,
        activities: _activities,
        state
      });
    }catch(err){
      console.error("[status-report:excel]", err);
      setAlert(refs.projectTaskAlert, err?.message || "Nao foi possivel gerar o status report em Excel.", "error");
    }
  });
}

function renderBreadcrumb(refs, project){
  if (!refs.projectWorkspaceBreadcrumb) return;
  const name = project?.name || "Projeto";
  refs.projectWorkspaceBreadcrumb.innerHTML = `
    <button class="crumb-link" data-back-kanban="1" type="button">Meus Projetos</button>
    <span class="crumb-sep">/</span>
    <span class="crumb-current">${escapeHtml(name)}</span>
  `;
}

function renderTasks(deps){
  const { refs, state } = deps;
  if (!refs.projectTaskList) return;
  const isUserTech = isTech(state);
  const searchTerm = normalizeSearchText(_taskSearchTerm);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const iconPending = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true"><path d="M12 8v5l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/></svg>';
  const iconDone = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true"><path d="M5 12l4 4L19 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const iconOverdue = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true"><path d="M12 8v5m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const keyUsers = keyUsersFromProjectClient(state, _activeProject);
  const projectTechs = techsFromProject(state, _activeProject);
  const byTask = new Map();
  _activities.forEach(a => {
    const arr = byTask.get(a.taskId) || [];
    arr.push(a);
    byTask.set(a.taskId, arr);
  });

  if (!_tasks.length){
    refs.projectTaskList.innerHTML = `<div class="panel subtle"><p class="muted">Nenhuma tarefa cadastrada neste projeto.</p></div>`;
    return;
  }

  const renderedTasks = _tasks.map(t => {
    const taskActs = byTask.get(t.id) || [];
    const activeStatusFilter = _taskStatusFilters[t.id] || "all";
    const taskSearchText = normalizeSearchText([
      t.id,
      t.taskNumber,
      t.name,
      t.startDate,
      t.endDate,
      fmtDate(t.startDate),
      fmtDate(t.endDate)
    ].join(" "));
    const taskMatches = !searchTerm || taskSearchText.includes(searchTerm);
    const activityMatchesSearch = (activity) => {
      if (!searchTerm) return true;
      const activitySearchText = normalizeSearchText([
        activity.id,
        activity.name,
        activity.taskName,
        activity.workDate,
        fmtDate(activity.workDate),
        ...(Array.isArray(activity.techNames) ? activity.techNames : []),
        ...(Array.isArray(activity.techUids) ? activity.techUids : []),
        ...(Array.isArray(activity.keyUsers) ? activity.keyUsers : [])
      ].join(" "));
      return activitySearchText.includes(searchTerm);
    };
    const visibleTaskActs = searchTerm
      ? (taskMatches ? taskActs : taskActs.filter(activityMatchesSearch))
      : taskActs;
    if (searchTerm && !taskMatches && !visibleTaskActs.length){
      return "";
    }
    const filteredTaskActs = visibleTaskActs.filter((activity) => getTaskActivityFilterMatch(activity, activeStatusFilter, today));
    const worked = visibleTaskActs.reduce((acc, a) => acc + asNumber(a.hoursWorked), 0);
    const planned = asNumber(t.plannedHours);
    const balance = Math.max(0, planned - worked);
    const statusCounters = visibleTaskActs.reduce((acc, a) => {
      const workDate = parseDateOnly(a.workDate);
      const isOverdue = Boolean(workDate && workDate < today && !isCompletedStatus(a));
      if (isApprovedStatus(a)) acc.approved += 1;
      else if (getActivityStatusValue(a) === "os_gerada") acc.generated += 1;
      else acc.pending += 1;
      if (isOverdue) acc.overdue += 1;
      return acc;
    }, { pending: 0, generated: 0, approved: 0, overdue: 0 });
    const groupedActs = new Map();
    filteredTaskActs.forEach((a) => {
      const activityName = (a.name || "Atividade").trim();
      const names = Array.isArray(a.techNames) && a.techNames.length ? a.techNames : ["Sem tecnico"];
      const techKey = names.join(" | ");
      const workDate = parseDateOnly(a.workDate);
      const isOverdue = Boolean(workDate && workDate < today && !isCompletedStatus(a));

      const current = groupedActs.get(activityName) || {
        label: activityName,
        techGroups: new Map(),
        activities: [],
        overdue: 0,
        pending: 0,
        earliestDate: null
      };

      const techGroup = current.techGroups.get(techKey) || {
        label: names.join(", "),
        activities: [],
        overdue: 0,
        pending: 0,
        earliestDate: null
      };

      techGroup.activities.push(a);
      current.activities.push(a);
      if (!isCompletedStatus(a)) {
        techGroup.pending += 1;
        current.pending += 1;
      }
      if (isOverdue) {
        techGroup.overdue += 1;
        current.overdue += 1;
      }
      if (workDate && (!techGroup.earliestDate || workDate < techGroup.earliestDate)) techGroup.earliestDate = workDate;
      if (workDate && (!current.earliestDate || workDate < current.earliestDate)) current.earliestDate = workDate;

      current.techGroups.set(techKey, techGroup);
      groupedActs.set(activityName, current);
    });
    const activityRows = Array.from(groupedActs.values())
      .sort((a, b) => {
        if (b.overdue !== a.overdue) return b.overdue - a.overdue;
        if (b.pending !== a.pending) return b.pending - a.pending;
        if (a.earliestDate && b.earliestDate) return a.earliestDate - b.earliestDate;
        if (a.earliestDate) return -1;
        if (b.earliestDate) return 1;
        return a.label.localeCompare(b.label);
      })
      .map((group, groupIdx) => {
      const groupHours = group.activities.reduce((acc, a) => acc + asNumber(a.hoursWorked), 0);
      const techGroupRows = Array.from(group.techGroups.values())
        .sort((a, b) => {
          if (b.overdue !== a.overdue) return b.overdue - a.overdue;
          if (b.pending !== a.pending) return b.pending - a.pending;
          if (a.earliestDate && b.earliestDate) return a.earliestDate - b.earliestDate;
          if (a.earliestDate) return -1;
          if (b.earliestDate) return 1;
          return a.label.localeCompare(b.label);
        })
        .map((techGroup, techIdx) => {
        const techGroupHours = techGroup.activities.reduce((acc, a) => acc + asNumber(a.hoursWorked), 0);
        const activityCards = techGroup.activities.map(a => {
      const canTechFill = isUserTech && ["admin","gestor","coordenador"].includes((a.createdByRole || "").toLowerCase());
      const canManageActivity = canManageTasks(state);
      const canApproveActivity = canManageTasks(state) && (getActivityStatusValue(a) === "os_gerada" || getActivityStatusValue(a) === "os_aprovada");
      const assignedTechs = Array.isArray(a.techNames) && a.techNames.length ? a.techNames.join(", ") : "Sem tecnico";
      const workDate = parseDateOnly(a.workDate);
      const isOverdue = Boolean(workDate && workDate < today && !isCompletedStatus(a));
      const isApproved = isApprovedStatus(a);
      const approvalNextStatus = isApproved ? "os_gerada" : "os_aprovada";
      const approvalTitle = isApproved ? "Estornar aprovacao da atividade" : "Aprovar atividade";
      return `
        <div class="activity-item ${isOverdue ? "overdue" : (isCompletedStatus(a) ? "ok" : "pending")}">
          <div class="activity-main">
            <div>
              <b>${escapeHtml(a.name || "Atividade")}</b>
              <div class="activity-meta-line">${escapeHtml(fmtDate(a.workDate))} | ${escapeHtml(String(a.hoursWorked || 0))}h</div>
            </div>
            <div class="activity-head-actions">
              <span class="activity-status ${isOverdue ? "orange" : (isApproved ? "green" : (isCompletedStatus(a) ? "amber" : "red"))}">${isOverdue ? "Atrasada" : (isApproved ? "OS Aprovada" : (getActivityStatusValue(a) === "os_gerada" ? "OS Enviada" : "Sem Ordem de Servico"))}</span>
              ${canManageActivity ? `
                <div class="activity-action-bar">
                  <button class="icon-btn xs activity-action activity-action-view" data-view-activity="${escapeHtml(a.id)}" type="button" title="Visualizar atividade" aria-label="Visualizar atividade">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M1.5 12s3.8-6.5 10.5-6.5S22.5 12 22.5 12 18.7 18.5 12 18.5 1.5 12 1.5 12Z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.8"/></svg>
                  </button>
                  ${canApproveActivity ? `
                    <button class="icon-btn xs activity-action ${isApproved ? "activity-action-revert" : "activity-action-approve"}" data-approve-activity="${escapeHtml(a.id)}" data-approve-next-status="${escapeHtml(approvalNextStatus)}" type="button" title="${escapeHtml(approvalTitle)}" aria-label="${escapeHtml(approvalTitle)}">
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        ${isApproved
                          ? `<path d="M9 9H5v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 13a7 7 0 1 0 2-4.95L5 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
                          : `<path d="M5 12l4 4L19 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`}
                      </svg>
                    </button>
                  ` : ""}
                  <button class="icon-btn xs activity-action activity-action-edit" data-edit-activity="${escapeHtml(a.id)}" type="button" title="Editar atividade" aria-label="Editar atividade">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m12 6 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                  </button>
                  <button class="icon-btn xs activity-action activity-action-delete" data-delete-activity="${escapeHtml(a.id)}" type="button" title="Excluir atividade" aria-label="Excluir atividade">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
                  </button>
                </div>
              ` : ""}
            </div>
          </div>
          <div class="activity-tags">
            <span class="activity-tag">Tecnicos: ${escapeHtml(assignedTechs)}</span>
            <span class="activity-tag">Key users: ${escapeHtml(Array.isArray(a.keyUsers) && a.keyUsers.length ? a.keyUsers.join(", ") : "-")}</span>
            ${isOverdue ? `<span class="activity-tag activity-tag--warn">Acao necessaria</span>` : ""}
          </div>
          ${canTechFill ? `
            <div class="activity-tech-fill">
              <input type="time" id="actStart-${escapeHtml(a.id)}" />
              <input type="time" id="actEnd-${escapeHtml(a.id)}" />
              <textarea id="actObs-${escapeHtml(a.id)}" rows="2" placeholder="Observacao do tecnico (minimo 50 caracteres)">${escapeHtml(a.note || "")}</textarea>
              <button class="btn primary sm" data-save-tech-fill="${escapeHtml(a.id)}" type="button">Salvar preenchimento</button>
            </div>
          ` : ""}
        </div>
      `;
      }).join("");
      return `
        <details class="activity-group activity-group--nested">
          <summary class="activity-group-summary">
            <div>
              <div class="activity-group-title">${escapeHtml(techGroup.label)}</div>
              <div class="activity-group-subtitle">${escapeHtml(String(techGroup.activities.length))} atividade(s) | ${escapeHtml(String(techGroupHours))}h | Pendentes: ${escapeHtml(String(techGroup.pending))}</div>
            </div>
            <span class="activity-group-toggle">Expandir</span>
          </summary>
          <div class="activity-group-list">
            ${activityCards}
          </div>
        </details>
      `;
      }).join("");
      return `
        <details class="activity-group">
          <summary class="activity-group-summary">
            <div>
              <div class="activity-group-title">${escapeHtml(group.label)}</div>
              <div class="activity-group-subtitle">${escapeHtml(String(group.activities.length))} atividade(s) | ${escapeHtml(String(groupHours))}h | Tecnicos: ${escapeHtml(String(group.techGroups.size))} | Pendentes: ${escapeHtml(String(group.pending))}</div>
            </div>
            <span class="activity-group-toggle">Expandir</span>
          </summary>
          <div class="activity-group-list">
            <div class="activity-subsection-title">Tecnicos com esta atividade</div>
            ${techGroupRows}
          </div>
        </details>
      `;
    }).join("");

    const keyUserOptions = keyUsers.map((ku, idx) => {
      const label = ku.name || ku.email || ku.phone || `Key user ${idx + 1}`;
      return `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`;
    }).join("");
    const techOptions = projectTechs.map((t) => (
      `<option value="${escapeHtml(t.uid)}">${escapeHtml(t.name)}</option>`
    )).join("");

    return `
      <details class="task-card task-tree ${statusCounters.overdue ? "task-card--overdue" : ""}">
        <summary class="task-summary">
          <div class="task-summary-main">
            <div class="task-head-main">
              <div class="task-step">Tarefa</div>
              <div class="task-title-row">
                <h4>#${escapeHtml(String(t.taskNumber || "-"))} ${escapeHtml(t.name || "")}</h4>
                <span class="task-validity-inline">Validade: ${escapeHtml(fmtDate(t.startDate))} ate ${escapeHtml(fmtDate(t.endDate))}</span>
              </div>
            </div>
            <div class="task-summary-statuses">
              <div class="task-top-metrics">
                <div class="task-kpis">
                ${isUserTech ? `<span class="kpi">Horas orcadas: <b>-</b></span>` : `<span class="kpi">Horas orcadas: <b>${escapeHtml(String(planned))}h</b></span>`}
                <span class="kpi">Horas trabalhadas: <b>${escapeHtml(String(worked))}h</b></span>
                <span class="kpi">Saldo disponivel: <b>${escapeHtml(String(balance))}h</b></span>
                <span class="kpi">Atividades: <b>${escapeHtml(String(filteredTaskActs.length))}</b></span>
                </div>
                <div class="task-status-strip">
                  <button class="task-status-pill task-status-pill--pending ${activeStatusFilter === "pending" ? "is-active" : ""}" data-task-status-filter="${escapeHtml(t.id)}" data-filter-value="pending" type="button">${iconPending} Sem OS: <b>${escapeHtml(String(statusCounters.pending))}</b></button>
                  <button class="task-status-pill task-status-pill--sent ${activeStatusFilter === "generated" ? "is-active" : ""}" data-task-status-filter="${escapeHtml(t.id)}" data-filter-value="generated" type="button">${iconDone} OS Enviada: <b>${escapeHtml(String(statusCounters.generated))}</b></button>
                  <button class="task-status-pill task-status-pill--done ${activeStatusFilter === "approved" ? "is-active" : ""}" data-task-status-filter="${escapeHtml(t.id)}" data-filter-value="approved" type="button">${iconDone} OS Aprovada: <b>${escapeHtml(String(statusCounters.approved))}</b></button>
                  <button class="task-status-pill task-status-pill--overdue ${activeStatusFilter === "overdue" ? "is-active" : ""}" data-task-status-filter="${escapeHtml(t.id)}" data-filter-value="overdue" type="button">${iconOverdue} Atrasadas: <b>${escapeHtml(String(statusCounters.overdue))}</b></button>
                </div>
              </div>
            </div>
          </div>
          <div class="task-summary-right">
            <button class="btn primary sm" data-open-activity-form="${escapeHtml(t.id)}" type="button">+ Nova atividade</button>
            <span class="task-toggle-label">Expandir</span>
          </div>
        </summary>
        <div class="task-body">
          <div class="panel subtle" id="activityFormWrap-${escapeHtml(t.id)}" hidden>
          <div class="activity-form-head">
            <div class="activity-form-eyebrow">Nova atividade</div>
            <div class="activity-form-subtitle">Preencha os dados para vincular uma nova atividade a esta tarefa.</div>
          </div>
          <div class="project-form-grid">
            <label class="field">
              <span>Nome da atividade</span>
              <input id="actName-${escapeHtml(t.id)}" maxlength="100" placeholder="Ex.: Reuniao com cliente" />
            </label>
            <label class="field">
              <span>Range inicio</span>
              <input type="date" id="actRangeStart-${escapeHtml(t.id)}" />
            </label>
            <label class="field">
              <span>Range fim</span>
              <input type="date" id="actRangeEnd-${escapeHtml(t.id)}" />
            </label>
            <label class="field">
              <span>Horas (1 a 12)</span>
              <input type="number" id="actHours-${escapeHtml(t.id)}" min="1" max="12" step="0.5" placeholder="8" />
            </label>
            <div class="field">
              <span>Key users</span>
              <select id="actKeyUsers-${escapeHtml(t.id)}" data-activity-keyuser-select="${escapeHtml(t.id)}">
                <option value="">Selecione um key user</option>
                ${keyUserOptions || `<option value="" disabled>Nenhum key user vinculado ao cliente do projeto</option>`}
              </select>
              <div class="help">Selecao multipla em chips coloridos.</div>
              <input type="hidden" id="actSelectedKeyUsers-${escapeHtml(t.id)}" value="[]" />
              <div id="actKeyUsersChips-${escapeHtml(t.id)}" class="chips project-tech-chips activity-selection-chips"><span class="muted">Nenhum selecionado.</span></div>
            </div>
            <div class="field">
              <span>Tecnicos do projeto</span>
              <select id="actTechs-${escapeHtml(t.id)}" data-activity-tech-select="${escapeHtml(t.id)}">
                <option value="">Selecione um tecnico</option>
                ${techOptions || `<option value="" disabled>Nenhum tecnico vinculado ao projeto</option>`}
              </select>
              <div class="help">Selecao multipla em chips coloridos.</div>
              <input type="hidden" id="actSelectedTechs-${escapeHtml(t.id)}" value="[]" />
              <div id="actTechsChips-${escapeHtml(t.id)}" class="chips project-tech-chips activity-selection-chips"><span class="muted">Nenhum selecionado.</span></div>
            </div>
            <label class="field span-2">
              <span>Observacao</span>
              <textarea id="actObsInput-${escapeHtml(t.id)}" rows="2" placeholder="Observacao da atividade"></textarea>
            </label>
          </div>
          <div class="weekdays-pills" id="actWeekdays-${escapeHtml(t.id)}">
            ${[1,2,3,4,5,6,0].map(d => `<label class="weekday-pill"><input type="checkbox" value="${d}" />${weekdayName(d)}</label>`).join("")}
          </div>
          <div class="project-form-actions">
            <button class="btn ghost sm" data-cancel-activity-form="${escapeHtml(t.id)}" type="button">Cancelar</button>
            <button class="btn primary sm" data-save-activity="${escapeHtml(t.id)}" type="button">Salvar atividade</button>
          </div>
          </div>

          <div class="activity-tree">
            <div class="activity-tree-head">
              <div>
                <div class="task-step">Atividades</div>
                <div class="muted">Agrupadas por nome da atividade e expandidas por tecnicos${activeStatusFilter !== "all" ? ` • Filtro ativo: ${escapeHtml(activeStatusFilter === "pending" ? "Sem OS" : activeStatusFilter === "generated" ? "OS Enviada" : activeStatusFilter === "approved" ? "OS Aprovada" : "Atrasadas")}` : ""}.</div>
              </div>
              <span class="activity-tree-hint">Clique nos grupos para expandir</span>
            </div>
            <div class="activity-list">${activityRows || `<p class="muted">Sem atividades para este status.</p>`}</div>
          </div>
        </div>
      </details>
    `;
  }).filter(Boolean).join("");

  if (!renderedTasks){
    refs.projectTaskList.innerHTML = `<div class="panel subtle workspace-search-empty"><p class="muted">Nenhum resultado encontrado para a busca informada.</p></div>`;
    return;
  }

  refs.projectTaskList.innerHTML = renderedTasks;
}

async function loadProjectData(deps, projectId){
  const { db, state } = deps;
  const companyId = state.companyId;
  if (!companyId) throw new Error("Empresa não identificada.");

  await ensureWorkspaceContext(deps);
  try { await ensureClientsCache(deps); } catch (_) {}

  const pSnap = await getDoc(doc(db, `companies/${companyId}/projects`, projectId));
  if (!pSnap.exists()) throw new Error("Projeto não encontrado.");
  _activeProject = { id: pSnap.id, ...pSnap.data() };

  const tSnap = await getDocs(query(collection(db, `companies/${companyId}/tasks`), where("projectId", "==", projectId)));
  _tasks = tSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => asNumber(a.taskNumber) - asNumber(b.taskNumber));

  const aSnap = await getDocs(query(collection(db, `companies/${companyId}/activities`), where("projectId", "==", projectId)));
  _activities = aSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => String(a.workDate || "").localeCompare(String(b.workDate || "")));
  _expenseSummary = await computeProjectExpenseSummary(db, companyId, projectId).catch(() => ({
    totalApproved: 0,
    totalPending: 0,
    approvedInternal: 0,
    approvedClient: 0,
    countPending: 0,
    countApproved: 0,
    countRejected: 0
  }));
}

async function saveTask(deps){
  const { refs, state, db, auth } = deps;
  if (!canManageTasks(state)){
    setAlert(refs.projectTaskAlert, "Somente gestor, admin e coordenador podem criar tarefas.", "error");
    return;
  }
  clearAlert(refs.projectTaskAlert);
  const name = (refs.taskNameInput?.value || "").trim();
  const startDate = refs.taskStartDateInput?.value || "";
  const endDate = refs.taskEndDateInput?.value || "";
  const plannedHours = asNumber(refs.taskPlannedHoursInput?.value || 0);
  if (!name || !startDate || !endDate){
    setAlert(refs.projectTaskAlert, "Preencha nome e período da tarefa.", "error");
    return;
  }
  if (parseDateOnly(endDate) < parseDateOnly(startDate)){
    setAlert(refs.projectTaskAlert, "A data final da tarefa não pode ser menor que a inicial.", "error");
    return;
  }

  const projectHours = asNumber(_activeProject?.billingHours || 0);
  const totalPlanned = _tasks.reduce((acc, t) => acc + asNumber(t.plannedHours), 0);
  if (projectHours > 0 && (totalPlanned + plannedHours) > projectHours){
    const saldo = Math.max(0, projectHours - totalPlanned);
    setAlert(refs.projectTaskAlert, `Horas orçadas excedem o projeto. Saldo disponível: ${saldo}h`, "error");
    return;
  }

  const overlaps = _tasks.filter(t => overlap(startDate, endDate, t.startDate, t.endDate));
  if (overlaps.length){
    const names = overlaps.map(t => t.name).join(", ");
    setAlert(refs.projectTaskAlert, `Aviso: já existem tarefas neste período (${names}).`, "info");
  }

  const companyId = state.companyId;
  const uid = auth?.currentUser?.uid || "";
  const nextTaskNumber = _tasks.reduce((mx, t) => Math.max(mx, asNumber(t.taskNumber)), 0) + 1;
  const taskId = `tsk-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const payload = {
    taskNumber: nextTaskNumber,
    projectId: _activeProject.id,
    projectName: _activeProject.name || "",
    name,
    startDate,
    endDate,
    plannedHours,
    createdBy: uid,
    createdByRole: roleOf(state),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid
  };
  await setDoc(doc(db, `companies/${companyId}/tasks`, taskId), payload);
  refs.projectTaskFormWrap.hidden = true;
  clearTaskForm(refs);
  await refreshWorkspace(deps);
}

async function saveActivity(taskId, deps){
  const { refs, state, db, auth } = deps;
  const task = _tasks.find(t => t.id === taskId);
  if (!task) return;
  const projectKeyUsers = keyUsersFromProjectClient(state, _activeProject);

  const name = (document.getElementById(`actName-${taskId}`)?.value || "").trim();
  const rangeStart = document.getElementById(`actRangeStart-${taskId}`)?.value || "";
  const rangeEnd = document.getElementById(`actRangeEnd-${taskId}`)?.value || "";
  const mode = (rangeStart && rangeEnd && rangeStart !== rangeEnd) ? "range" : "single";
  const singleDate = rangeStart;
  const hoursWorked = asNumber(document.getElementById(`actHours-${taskId}`)?.value || 0);
  const note = (document.getElementById(`actObsInput-${taskId}`)?.value || "").trim();
  const keyUsers = getActivitySelectionValues(taskId, "KeyUsers").map(item => item?.value).filter(Boolean);
  const techUids = getActivitySelectionValues(taskId, "Techs").map(item => item?.value).filter(Boolean);

  if (!name || hoursWorked <= 0){
    setAlert(refs.projectTaskAlert, "Preencha nome e horas da atividade.", "error");
    return;
  }
  if (!projectKeyUsers.length){
    setAlert(refs.projectTaskAlert, "Nao ha key user vinculado ao cliente deste projeto. Cadastre key user no cliente para incluir atividades.", "error");
    return;
  }
  if (!keyUsers.length){
    setAlert(refs.projectTaskAlert, "Selecione ao menos um key user para a atividade.", "error");
    return;
  }
  if (hoursWorked > 12){
    setAlert(refs.projectTaskAlert, "A atividade aceita no máximo 12 horas por dia.", "error");
    return;
  }
  if (!techUids.length){
    setAlert(refs.projectTaskAlert, "Selecione ao menos um tecnico do projeto para a atividade.", "error");
    return;
  }

  if (!rangeStart || !rangeEnd){
    setAlert(refs.projectTaskAlert, "Informe o periodo da atividade.", "error");
    return;
  }
  if (parseDateOnly(rangeEnd) < parseDateOnly(rangeStart)){
    setAlert(refs.projectTaskAlert, "A data final da atividade nao pode ser menor que a inicial.", "error");
    return;
  }

  if (mode === "range" && !canUseRangeForActivities(state)){
    setAlert(refs.projectTaskAlert, "Técnico só pode incluir atividade em dia único.", "error");
    return;
  }

  const companyId = state.companyId;
  const uid = auth?.currentUser?.uid || "";
  const creatorRole = roleOf(state);
  const selectedTechs = techsFromProject(state, _activeProject)
    .filter(t => techUids.includes(t.uid));
  let dates = [];
  if (mode === "single"){
    if (!singleDate){
      setAlert(refs.projectTaskAlert, "Informe o dia da atividade.", "error");
      return;
    }
    dates = [singleDate];
  } else {
    if (!rangeStart || !rangeEnd){
      setAlert(refs.projectTaskAlert, "Informe o range de dias.", "error");
      return;
    }
    const weekdayChecks = Array.from(document.querySelectorAll(`#actWeekdays-${taskId} input[type=checkbox]:checked`));
    if (!weekdayChecks.length){
      setAlert(refs.projectTaskAlert, "Selecione ao menos um dia da semana para o range.", "error");
      return;
    }
    const setDays = new Set(weekdayChecks.map(x => Number(x.value)));
    dates = datesForRangeByWeekdays(rangeStart, rangeEnd, setDays);
    if (!dates.length){
      setAlert(refs.projectTaskAlert, "Nenhum dia útil gerado para o range selecionado.", "error");
      return;
    }
  }

  // datas dentro da validade da tarefa
  for (const d of dates){
    if (!overlap(d, d, task.startDate, task.endDate)){
      setAlert(refs.projectTaskAlert, `A data ${fmtDate(d)} está fora do período da tarefa.`, "error");
      return;
    }
  }

  const plannedHours = asNumber(task.plannedHours);
  const currentWorked = _activities
    .filter(a => a.taskId === taskId)
    .reduce((acc, a) => acc + asNumber(a.hoursWorked), 0);
  const newActivitiesHours = dates.length * selectedTechs.length * hoursWorked;
  const availableHours = Math.max(0, plannedHours - currentWorked);
  const activeManagerName = ((state._usersCache || []).find((u) => u.uid === _activeProject?.managerUid)?.name || _activeProject?.managerName || "").trim();

  if (plannedHours > 0 && newActivitiesHours > availableHours){
    setAlert(
      refs.projectTaskAlert,
      `Horas insuficientes nesta tarefa. Disponiveis: ${availableHours}h. As novas atividades somam ${newActivitiesHours}h.`,
      "error"
    );
    return;
  }

  for (const d of dates){
    for (const tech of selectedTechs){
      const actId = `act-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
      await setDoc(doc(db, `companies/${companyId}/activities`, actId), {
        projectId: _activeProject.id,
        projectName: _activeProject.name || "",
        managerUid: _activeProject.managerUid || "",
        managerName: activeManagerName,
        taskId,
        taskName: task.name || "",
        name,
        workDate: d,
        hoursWorked,
        techUids: [tech.uid],
        techNames: [tech.name],
        keyUsers,
        note,
        status: "sem_os",
        createdBy: uid,
        createdByName: state.profile?.name || "",
        createdByRole: creatorRole,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: uid
      });
    }
  }

  await refreshWorkspace(deps);
}

async function saveTechFill(activityId, deps){
  const { refs, state, db, auth } = deps;
  const act = _activities.find(a => a.id === activityId);
  if (!act) return;

  const start = document.getElementById(`actStart-${activityId}`)?.value || "";
  const end = document.getElementById(`actEnd-${activityId}`)?.value || "";
  const note = (document.getElementById(`actObs-${activityId}`)?.value || "").trim();
  const hoursDiff = diffHours(start, end);
  const maxHours = asNumber(act.hoursWorked);

  if (hoursDiff <= 0){
    setAlert(refs.projectTaskAlert, "Informe hora início e fim válidas.", "error");
    return;
  }
  if (hoursDiff > maxHours){
    setAlert(refs.projectTaskAlert, `A soma início/fim não pode ultrapassar ${maxHours}h.`, "error");
    return;
  }
  if (note.length < 50){
    setAlert(refs.projectTaskAlert, "A observação precisa ter no mínimo 50 caracteres.", "error");
    return;
  }

  const companyId = state.companyId;
  const uid = auth?.currentUser?.uid || "";
  await updateDoc(doc(db, `companies/${companyId}/activities`, activityId), {
    startTime: start,
    endTime: end,
    note,
    status: "os_gerada",
    updatedAt: serverTimestamp(),
    updatedBy: uid
  });

  await refreshWorkspace(deps);
}

async function refreshWorkspace(deps){
  if (!_activeProjectId) return;
  await loadProjectData(deps, _activeProjectId);
  const refs = _wsRefs(deps);
  const { state } = deps;
  renderTabs(refs);
  renderCover(refs, _activeProject, state);
  renderTasks(deps);
}

async function deleteActiveProject(deps){
  const { state, db } = deps;
  const refs = _wsRefs(deps);
  if (!_activeProjectId || !state?.companyId) return;

  if (_tasks.length || _activities.length){
    setAlert(refs.projectTaskAlert, "Nao e permitido excluir um projeto com tarefas ou atividades vinculadas.", "error");
    return;
  }

  const tasksSnap = await getDocs(query(collection(db, `companies/${state.companyId}/tasks`), where("projectId", "==", _activeProjectId)));
  const actsSnap = await getDocs(query(collection(db, `companies/${state.companyId}/activities`), where("projectId", "==", _activeProjectId)));
  if (!tasksSnap.empty || !actsSnap.empty){
    setAlert(refs.projectTaskAlert, "Nao e permitido excluir um projeto com tarefas ou atividades vinculadas.", "error");
    return;
  }

  const projectName = _activeProject?.name || "este projeto";
  if (!confirm(`Deseja realmente excluir ${projectName}?`)) return;

  await deleteDoc(doc(db, `companies/${state.companyId}/projects`, _activeProjectId));
  _tabs = _tabs.filter(t => t.id !== _activeProjectId);
  closeProjectWorkspace(deps);
}

export async function openProjectTab(projectId, deps){
  bindOnce(deps);
  const refs = _wsRefs(deps);
  await ensureTab(projectId, deps);
  _tabs = _tabs.map((tab) => tab.id === projectId ? { ...tab, needsAttention: true } : tab);
  renderTabs(refs);
}

export async function openProjectWorkspace(projectId, deps){
  bindOnce(deps);
  const refs = _wsRefs(deps);
  if (!refs.projectWorkspacePanel) return;
  await ensureTab(projectId, deps);
  _activeProjectId = projectId;
  _tabs = _tabs.map((tab) => tab.id === projectId ? { ...tab, needsAttention: false } : tab);
  setWorkspaceOpenUI(deps, true);
  if (refs.projectWorkspaceTitle) refs.projectWorkspaceTitle.textContent = "Carregando projeto...";
  if (refs.projectWorkspaceSubtitle) refs.projectWorkspaceSubtitle.textContent = `ID: ${projectId}`;
  if (refs.projectWorkspaceBreadcrumb) {
    refs.projectWorkspaceBreadcrumb.innerHTML = `<span class="crumb-current">Carregando projeto...</span>`;
  }
  if (refs.projectWorkspaceCover) {
    refs.projectWorkspaceCover.innerHTML = `<p class="muted">Carregando dados do projeto...</p>`;
  }
  if (refs.projectTaskList) {
    refs.projectTaskList.innerHTML = `<div class="panel subtle"><p class="muted">Carregando tarefas...</p></div>`;
  }

  try{
    await loadProjectData(deps, projectId);
    const label = `${_activeProject?.projectNumber || ""} ${_activeProject?.name || "Projeto"}`.trim();
    _tabs = _tabs.map(t => t.id === projectId ? { ...t, label } : t);
    if (refs.projectWorkspaceTitle) refs.projectWorkspaceTitle.textContent = "";
    if (refs.projectWorkspaceSubtitle) refs.projectWorkspaceSubtitle.textContent = "";
    if (refs.btnOpenWorkspaceView) refs.btnOpenWorkspaceView.style.display = "";
    if (refs.btnOpenWorkspaceEdit) refs.btnOpenWorkspaceEdit.style.display = isTech(deps.state) ? "none" : "";
    if (refs.btnDeleteWorkspaceProject) refs.btnDeleteWorkspaceProject.style.display = isTech(deps.state) ? "none" : "";
    if (refs.btnOpenTaskForm) refs.btnOpenTaskForm.style.display = canManageTasks(deps.state) ? "" : "none";
    if (refs.projectTaskFormWrap) refs.projectTaskFormWrap.hidden = true;
    _taskSearchTerm = "";
    if (refs.projectTaskSearchInput) refs.projectTaskSearchInput.value = "";
    clearAlert(refs.projectTaskAlert);
    clearTaskForm(refs);

    renderTabs(refs);
    if (refs.projectWorkspaceBreadcrumb) refs.projectWorkspaceBreadcrumb.innerHTML = "";
    renderCover(refs, _activeProject, deps.state);
    renderTasks(deps);
  }catch(err){
    console.error("[workspace] open error:", err);
    if (refs.projectTaskAlert) setAlert(refs.projectTaskAlert, err?.message || "Não foi possível abrir o workspace do projeto.", "error");
    if (refs.projectWorkspaceCover) {
      refs.projectWorkspaceCover.innerHTML = `<p class="muted">Não foi possível carregar os dados do projeto.</p>`;
    }
  }
}

export function closeProjectWorkspace(deps){
  const refs = _wsRefs(deps);
  setWorkspaceOpenUI(deps, false);
  _activeProjectId = "";
  _activeProject = null;
  _taskSearchTerm = "";
  if (refs.projectTaskSearchInput) refs.projectTaskSearchInput.value = "";
  if (refs.projectWorkspaceBreadcrumb) refs.projectWorkspaceBreadcrumb.innerHTML = "";
  renderTabs(refs);
}



