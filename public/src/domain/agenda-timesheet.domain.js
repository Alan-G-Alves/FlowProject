import {
  deleteAgendaActivity,
  findActivitiesByFilters,
  getCompanySettings,
  loadAgendaContext,
  createAgendaActivity,
  createAbsence
} from "../services/agenda.service.js?v=1781582000";
import { clearAlert, setAlert } from "../ui/alerts.js";
import { escapeHtml } from "../utils/dom.js";

let _bound = false;
let _deps = null;
let _ctx = { projects: [], tasks: [], activities: [], clients: [], users: [], absences: [] };
let _cursor = firstDay(new Date());
let _mode = "resources";
let _filter = { kind: "", id: "" };
let _selectedClearIds = new Set();
let _scheduleCursor = firstDay(new Date());
let _scheduleSelectedDates = new Set();
let _scheduleKeyUsers = [];
let _scheduleResources = [];
let _agendaMoreAnchor = null;

const ALLOWED_ROLES = new Set(["admin", "gestor", "coordenador"]);
const ABSENCE_TYPES = [
  ["ferias", "Ferias"],
  ["folga", "Folga"],
  ["atestado", "Atestado"],
  ["treinamento", "Treinamento"],
  ["feriado-regional", "Feriado Regional"],
  ["outro", "Outro"]
];

function byId(id){ return document.getElementById(id); }
function roleOf(state){ return String(state?.profile?.role || "").toLowerCase(); }
function canAccess(state){ return !state?.isSuperAdmin && ALLOWED_ROLES.has(roleOf(state)); }
function asNumber(value){ const n = Number(value); return Number.isFinite(n) ? n : 0; }
function dateKey(date){ return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function firstDay(date){ return new Date(date.getFullYear(), date.getMonth(), 1); }
function monthEnd(date){ return new Date(date.getFullYear(), date.getMonth() + 1, 0); }
function monthLabel(date){ return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); }
function fmtDate(value){
  const raw = String(value || "").slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "-";
}
function formatHours(value){
  const rounded = Math.round(asNumber(value) * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : String(rounded).replace(".", ",")}h`;
}
function parseDate(value){
  const m = String(value || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function datesBetween(start, end){
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s || !e || s > e) return [];
  const out = [];
  const cur = new Date(s);
  while (cur <= e){
    out.push(dateKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
function parseMinutes(value){
  const m = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function diffHours(start, end){
  const s = parseMinutes(start);
  const e = parseMinutes(end);
  if (s == null || e == null || e <= s) return 0;
  return (e - s) / 60;
}
function statusLabel(status){
  const raw = String(status || "").toLowerCase();
  if (raw === "os_aprovada") return "OS Aprovada";
  if (raw === "os_gerada") return "OS Enviada";
  return "Sem OS";
}
function projectStatusLabel(status){
  const map = {
    "a-fazer": "A fazer",
    "em-andamento": "Em andamento",
    "go-live": "Go live",
    "concluido": "Concluido",
    "parado": "Parado",
    "backlog": "Backlog"
  };
  return map[String(status || "").toLowerCase()] || status || "-";
}
function projectStatusTone(status){
  const raw = String(status || "a-fazer").toLowerCase();
  return ["a-fazer", "em-andamento", "go-live", "concluido", "parado", "backlog"].includes(raw) ? raw : "a-fazer";
}
function activityStatusTone(activity){
  const raw = String(activity?.status || "").toLowerCase();
  const workDate = parseDate(String(activity?.workDate || "").slice(0, 10));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = workDate && workDate < today && raw !== "os_gerada" && raw !== "os_aprovada";
  if (overdue) return "overdue";
  if (raw === "os_aprovada") return "done";
  if (raw === "os_gerada") return "sent";
  return "pending";
}
function statusIcon(kind){
  if (kind === "done" || kind === "sent") {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12l4 4L19 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (kind === "overdue") {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8v5m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8v5l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/></svg>`;
}
function projectStatusBadge(status){
  const tone = projectStatusTone(status);
  return `<span class="agenda-ts-status-badge agenda-ts-project-status agenda-ts-project-status--${escapeHtml(tone)}">${escapeHtml(projectStatusLabel(status))}</span>`;
}
function activityStatusBadge(activity){
  const tone = activityStatusTone(activity);
  const label = tone === "overdue" ? "Atrasada" : statusLabel(activity?.status);
  return `<span class="agenda-ts-status-badge agenda-ts-activity-status agenda-ts-activity-status--${escapeHtml(tone)}">${statusIcon(tone)}${escapeHtml(label)}</span>`;
}
function conflictIcon(){
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8v5m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function activeResources(){
  return _ctx.users
    .filter((u) => String(u.role || "").toLowerCase() === "tecnico" && u.active !== false)
    .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")));
}
function resourceIdOf(user){
  return user?.uid || user?.id || "";
}
function projectResourceIds(project){
  return Array.isArray(project?.techUids) ? project.techUids.filter(Boolean) : [];
}
function resourcesForProject(projectId){
  const project = _ctx.projects.find((item) => item.id === projectId) || null;
  const allowed = new Set(projectResourceIds(project));
  if (!projectId) return activeResources();
  return activeResources().filter((user) => allowed.has(resourceIdOf(user)));
}
function projectsForResource(resourceId){
  if (!resourceId) return _ctx.projects.slice();
  return _ctx.projects.filter((project) => projectResourceIds(project).includes(resourceId));
}
function isResourceLinkedToProject(projectId, resourceId){
  if (!projectId || !resourceId) return false;
  const project = _ctx.projects.find((item) => item.id === projectId) || null;
  return projectResourceIds(project).includes(resourceId);
}
function projectOptionsHtml(projects, selectedId = ""){
  return `<option value="">Selecione</option>${(projects || []).map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.name || "Projeto")}</option>`).join("")}`;
}
function resourceOptionsHtml(resources, selectedId = ""){
  return `<option value="">Selecione</option>${(resources || []).map((u) => {
    const id = resourceIdOf(u);
    return `<option value="${escapeHtml(id)}" ${id === selectedId ? "selected" : ""}>${escapeHtml(u.name || u.email || "Recurso")}</option>`;
  }).join("")}`;
}
function clientForProject(project){
  return _ctx.clients.find((c) => c.id === project?.clientId) || null;
}
function initials(value){
  const text = String(value || "").trim();
  if (!text) return "?";
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
function clientAvatarHtml(projectId){
  const project = _ctx.projects.find((item) => item.id === projectId) || null;
  const client = clientForProject(project) || null;
  const name = client?.name || project?.clientName || "Cliente";
  const photo = String(client?.photoURL || "").trim();
  return `<span class="agenda-ts-client-avatar" title="${escapeHtml(name)}">${photo ? `<img src="${escapeHtml(photo)}" alt="" />` : `<span>${escapeHtml(initials(name))}</span>`}</span>`;
}
function projectClientName(projectId, activities = []){
  const project = _ctx.projects.find((item) => item.id === projectId) || null;
  const client = clientForProject(project) || null;
  return client?.name || project?.clientName || activities.find((activity) => activity.clientName)?.clientName || "";
}
function projectChipTitle(projectId, activities = []){
  const project = projectName(projectId);
  const client = projectClientName(projectId, activities);
  return client ? `${client} - ${project}` : project;
}
function tasksForProject(projectId){
  return _ctx.tasks.filter((task) => task.projectId === projectId).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}
function keyUsersForProject(project){
  const client = clientForProject(project);
  if (!client) return [];
  if (Array.isArray(client.keyUsers) && client.keyUsers.length) {
    return client.keyUsers.map((item) => item.name || item.email || item.phone).filter(Boolean);
  }
  return [client.keyUserName, client.keyUserEmail, client.keyUserPhone].filter(Boolean);
}
function setScheduleKeyUsers(items){
  _scheduleKeyUsers = (Array.isArray(items) ? items : []).filter(Boolean);
}
function setScheduleResources(items){
  _scheduleResources = (Array.isArray(items) ? items : []).filter((item) => item?.id);
}
function addScheduleResource(id, label){
  const item = String(id || "").trim();
  if (!item || _scheduleResources.some((resource) => resource.id === item)) return;
  _scheduleResources = [..._scheduleResources, { id: item, label: label || resourceName(item) }];
  renderScheduleResourceChips();
  renderScheduleCalendar();
  updateScheduleTaskSummary();
}
function removeScheduleResource(id){
  _scheduleResources = _scheduleResources.filter((item) => item.id !== id);
  renderScheduleResourceChips();
  renderScheduleCalendar();
  updateScheduleTaskSummary();
}
function addScheduleKeyUser(value){
  const item = String(value || "").trim();
  if (!item || _scheduleKeyUsers.includes(item)) return;
  _scheduleKeyUsers = [..._scheduleKeyUsers, item];
  renderScheduleKeyUserChips();
}
function removeScheduleKeyUser(value){
  _scheduleKeyUsers = _scheduleKeyUsers.filter((item) => item !== value);
  renderScheduleKeyUserChips();
}
function renderScheduleKeyUserChips(){
  const wrap = byId("agendaScheduleKeyUserChips");
  if (!wrap) return;
  if (!_scheduleKeyUsers.length) {
    wrap.innerHTML = `<span class="muted">Nenhum key user selecionado.</span>`;
    return;
  }
  wrap.innerHTML = _scheduleKeyUsers.map((item, idx) => `
    <span class="chip project-tech-chip t${(idx % 6) + 1}">
      <span>${escapeHtml(item)}</span>
      <button class="project-tech-chip-remove" data-remove-schedule-keyuser="${escapeHtml(item)}" type="button" aria-label="Remover key user">x</button>
    </span>
  `).join("");
}
function renderScheduleResourceChips(){
  const wrap = byId("agendaScheduleResourceChips");
  if (!wrap) return;
  if (!_scheduleResources.length) {
    wrap.innerHTML = `<span class="muted">Nenhum recurso selecionado.</span>`;
    return;
  }
  wrap.innerHTML = _scheduleResources.map((item, idx) => `
    <span class="chip project-tech-chip t${(idx % 6) + 1}">
      <span>${escapeHtml(item.label || resourceName(item.id))}</span>
      <button class="project-tech-chip-remove" data-remove-schedule-resource="${escapeHtml(item.id)}" type="button" aria-label="Remover recurso">x</button>
    </span>
  `).join("");
}
function clearAgendaScheduleInlineAlert(){
  clearAlert(byId("agendaScheduleInlineAlert"));
}
function resourceName(uid){
  const user = _ctx.users.find((item) => String(item.uid || item.id) === String(uid));
  return user?.name || user?.email || uid || "-";
}
function projectName(id){
  const project = _ctx.projects.find((item) => item.id === id);
  return project?.name || "Projeto";
}
function taskName(id){
  const task = _ctx.tasks.find((item) => item.id === id);
  return task?.name || "Tarefa";
}
function monthActivities(){
  const start = dateKey(_cursor);
  const end = dateKey(monthEnd(_cursor));
  return _ctx.activities.filter((activity) => {
    const workDate = String(activity.workDate || "").slice(0, 10);
    if (!workDate || workDate < start || workDate > end) return false;
    if (_filter.kind === "resource") return Array.isArray(activity.techUids) && activity.techUids.includes(_filter.id);
    if (_filter.kind === "project") return activity.projectId === _filter.id;
    return true;
  });
}
function monthActivitiesUnfiltered(){
  const start = dateKey(_cursor);
  const end = dateKey(monthEnd(_cursor));
  return _ctx.activities.filter((activity) => {
    const workDate = String(activity.workDate || "").slice(0, 10);
    return !!workDate && workDate >= start && workDate <= end;
  });
}
function getMonthConflicts(){
  const byResourceDay = new Map();
  monthActivitiesUnfiltered().forEach((activity) => {
    const workDate = String(activity.workDate || "").slice(0, 10);
    const techUids = Array.isArray(activity.techUids) ? activity.techUids.filter(Boolean) : [];
    techUids.forEach((uid) => {
      const key = `${uid}__${workDate}`;
      const list = byResourceDay.get(key) || [];
      list.push(activity);
      byResourceDay.set(key, list);
    });
  });
  return Array.from(byResourceDay.entries())
    .filter(([, items]) => items.length > 1)
    .flatMap(([key, items]) => {
      const [resourceId, workDate] = key.split("__");
      return items
        .slice()
        .sort((a, b) => String(a.projectName || projectName(a.projectId)).localeCompare(String(b.projectName || projectName(b.projectId))))
        .map((activity) => ({ resourceId, workDate, activity, conflictCount: items.length }));
    })
    .sort((a, b) => {
      if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
      return resourceName(a.resourceId).localeCompare(resourceName(b.resourceId));
    });
}
function absenceOverlaps(resourceId, startDate, endDate){
  return _ctx.absences.some((absence) => {
    if (absence.active === false || String(absence.resourceId || "") !== String(resourceId || "")) return false;
    const aStart = String(absence.startDate || "").slice(0, 10);
    const aEnd = String(absence.endDate || absence.startDate || "").slice(0, 10);
    return aStart <= endDate && startDate <= aEnd;
  });
}
function hasTimeConflict(resourceId, date, startTime, endTime){
  const nextStart = parseMinutes(startTime);
  const nextEnd = parseMinutes(endTime);
  if (nextStart == null || nextEnd == null) return false;
  return _ctx.activities.some((activity) => {
    if (String(activity.workDate || "").slice(0, 10) !== date) return false;
    if (!Array.isArray(activity.techUids) || !activity.techUids.includes(resourceId)) return false;
    const currentStart = parseMinutes(activity.startTime || "00:00");
    const currentEnd = parseMinutes(activity.endTime || "23:59");
    if (currentStart == null || currentEnd == null) return false;
    return currentStart < nextEnd && nextStart < currentEnd;
  });
}
function dailyResourceHours(resourceId, date){
  return _ctx.activities.reduce((sum, activity) => {
    if (String(activity.workDate || "").slice(0, 10) !== date) return sum;
    if (!Array.isArray(activity.techUids) || !activity.techUids.includes(resourceId)) return sum;
    return sum + asNumber(activity.hoursWorked);
  }, 0);
}
function taskHoursInfo(taskId){
  const task = _ctx.tasks.find((item) => item.id === taskId) || null;
  const plannedHours = asNumber(task?.plannedHours);
  const usedHours = _ctx.activities
    .filter((activity) => activity.taskId === taskId)
    .reduce((sum, activity) => sum + asNumber(activity.hoursWorked), 0);
  return {
    plannedHours,
    usedHours,
    availableHours: plannedHours > 0 ? Math.max(0, plannedHours - usedHours) : 0,
    hasLimit: plannedHours > 0
  };
}
function renderShell(){
  const root = byId("agendaTimeSheetRoot");
  if (!root) return;
  root.innerHTML = `
    <div class="agenda-ts-page">
      <header class="agenda-ts-head">
        <div>
          <h1>Agendas TimeSheet</h1>
          <p class="muted">Calendario de atividades planejadas por recurso e projeto.</p>
        </div>
        <div class="agenda-ts-actions">
          <button class="btn ghost sm" id="btnAgendaTsPrev" type="button" aria-label="Mes anterior">&lsaquo;</button>
          <strong id="agendaTsMonth">${escapeHtml(monthLabel(_cursor))}</strong>
          <button class="btn ghost sm" id="btnAgendaTsNext" type="button" aria-label="Proximo mes">&rsaquo;</button>
          <button class="btn primary sm agenda-ts-action-btn" id="btnAgendaTsSchedule" type="button">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.5" stroke="currentColor" stroke-width="2"/><path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 15h3M13.5 15H16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Agendar
          </button>
          <button class="btn danger sm agenda-ts-action-btn" id="btnAgendaTsClear" type="button">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 7V4h6v3" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
            Limpar Agendas
          </button>
          <button class="btn sm agenda-ts-action-btn agenda-ts-absence-btn" id="btnAgendaTsAbsence" type="button">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 7.5c0-2 1.7-3.5 5-3.5s5 1.5 5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 21c.8-2 2.1-3 4-3s3.2 1 4 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Registrar Ausencia
          </button>
        </div>
      </header>
      <div class="alert" hidden id="agendaTsAlert"></div>
      <div class="agenda-ts-layout">
        <aside class="agenda-ts-sidebar">
          <div class="agenda-ts-tabs">
            <button class="${_mode === "resources" ? "is-active" : ""}" data-agenda-mode="resources" type="button">Recursos</button>
            <button class="${_mode === "projects" ? "is-active" : ""}" data-agenda-mode="projects" type="button">Projetos</button>
          </div>
          <div class="agenda-ts-side-list" id="agendaTsSidebarList"></div>
          <section class="agenda-ts-conflicts" id="agendaTsConflicts"></section>
        </aside>
        <section class="agenda-ts-calendar-wrap">
          <div class="agenda-ts-weekdays">${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].map((d) => `<span>${d}</span>`).join("")}</div>
          <div class="agenda-ts-calendar" id="agendaTsCalendar"></div>
        </section>
      </div>
    </div>
  `;
  bindShellEvents();
}
function bindShellEvents(){
  byId("btnAgendaTsPrev")?.addEventListener("click", () => { _cursor = new Date(_cursor.getFullYear(), _cursor.getMonth() - 1, 1); renderAll(); });
  byId("btnAgendaTsNext")?.addEventListener("click", () => { _cursor = new Date(_cursor.getFullYear(), _cursor.getMonth() + 1, 1); renderAll(); });
  byId("btnAgendaTsSchedule")?.addEventListener("click", openScheduleModal);
  byId("btnAgendaTsClear")?.addEventListener("click", openClearModal);
  byId("btnAgendaTsAbsence")?.addEventListener("click", openAbsenceModal);
  byId("agendaTimeSheetRoot")?.querySelectorAll("[data-agenda-mode]").forEach((btn) => {
    btn.addEventListener("click", () => { _mode = btn.dataset.agendaMode || "resources"; _filter = { kind: "", id: "" }; renderAll(); });
  });
}
function renderSidebar(){
  const list = byId("agendaTsSidebarList");
  if (!list) return;
  const activities = monthActivities();
  if (_mode === "resources"){
    const totals = new Map();
    activities.forEach((activity) => (activity.techUids || []).forEach((uid) => totals.set(uid, asNumber(totals.get(uid)) + asNumber(activity.hoursWorked))));
    list.innerHTML = activeResources().map((user) => {
      const uid = user.uid || user.id;
      return `<button class="agenda-ts-side-item ${_filter.kind === "resource" && _filter.id === uid ? "is-active" : ""}" data-agenda-resource="${escapeHtml(uid)}" type="button">
        <span>${escapeHtml(user.name || user.email || "Recurso")}</span><strong>${escapeHtml(formatHours(totals.get(uid) || 0))}</strong>
      </button>`;
    }).join("") || `<div class="agenda-ts-empty">Nenhum recurso ativo.</div>`;
  } else {
    const totals = new Map();
    activities.forEach((activity) => totals.set(activity.projectId, asNumber(totals.get(activity.projectId)) + asNumber(activity.hoursWorked)));
    list.innerHTML = _ctx.projects.map((project) => `<button class="agenda-ts-side-item ${_filter.kind === "project" && _filter.id === project.id ? "is-active" : ""}" data-agenda-project="${escapeHtml(project.id)}" type="button">
      <span>${escapeHtml(project.name || "Projeto")}</span><strong>${escapeHtml(formatHours(totals.get(project.id) || 0))}</strong>
    </button>`).join("") || `<div class="agenda-ts-empty">Nenhum projeto cadastrado.</div>`;
  }
  list.querySelectorAll("[data-agenda-resource]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.agendaResource || "";
    _filter = _filter.kind === "resource" && _filter.id === id ? { kind: "", id: "" } : { kind: "resource", id };
    renderAll();
  }));
  list.querySelectorAll("[data-agenda-project]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.agendaProject || "";
    _filter = _filter.kind === "project" && _filter.id === id ? { kind: "", id: "" } : { kind: "project", id };
    renderAll();
  }));
  renderConflicts();
}
function renderConflicts(){
  const box = byId("agendaTsConflicts");
  if (!box) return;
  const conflicts = getMonthConflicts();
  box.innerHTML = `
    <div class="agenda-ts-conflicts-head">
      <h3>Conflitos</h3>
      <span>${escapeHtml(String(conflicts.length))}</span>
    </div>
    ${conflicts.length ? `
      <div class="agenda-ts-conflicts-list">
        ${conflicts.map(({ resourceId, workDate, activity, conflictCount }) => `
          <button class="agenda-ts-conflict-item" data-agenda-detail="${escapeHtml(activity.id)}" type="button" title="Abrir detalhes da agenda">
            <strong>${conflictIcon()} ${escapeHtml(resourceName(resourceId))}</strong>
            <small>${escapeHtml(fmtDate(workDate))} - ${escapeHtml(projectName(activity.projectId))}</small>
            <em>${escapeHtml(activity.name || "Atividade")} - ${escapeHtml(String(conflictCount))} agendas no dia</em>
          </button>
        `).join("")}
      </div>
    ` : `<p class="agenda-ts-conflicts-empty">Nenhum conflito neste mes.</p>`}
  `;
  box.querySelectorAll("[data-agenda-detail]").forEach((btn) => btn.addEventListener("click", () => openDetailsModal(btn.dataset.agendaDetail || "")));
}
function calendarEntriesForDay(items, workDate){
  if (_mode !== "projects") return (items || []).map((activity) => ({ type: "activity", activity }));
  const byProject = new Map();
  (items || []).forEach((activity) => {
    const projectId = activity.projectId || "";
    if (!projectId) return;
    const list = byProject.get(projectId) || [];
    list.push(activity);
    byProject.set(projectId, list);
  });
  return Array.from(byProject.entries())
    .map(([projectId, activities]) => ({ type: "project", projectId, workDate, activities }))
    .sort((a, b) => projectName(a.projectId).localeCompare(projectName(b.projectId)));
}
function renderCalendar(){
  const cal = byId("agendaTsCalendar");
  const label = byId("agendaTsMonth");
  if (label) label.textContent = monthLabel(_cursor);
  if (!cal) return;
  closeAgendaMorePopover();
  const start = firstDay(_cursor);
  const end = monthEnd(_cursor);
  const cells = [];
  const firstWeekday = start.getDay();
  for (let i = 0; i < firstWeekday; i++) cells.push({ muted: true, day: "" });
  for (let d = 1; d <= end.getDate(); d++) cells.push({ date: new Date(_cursor.getFullYear(), _cursor.getMonth(), d), day: String(d) });
  while (cells.length % 7) cells.push({ muted: true, day: "" });
  const grouped = new Map();
  monthActivities().forEach((activity) => {
    const key = String(activity.workDate || "").slice(0, 10);
    const arr = grouped.get(key) || [];
    arr.push(activity);
    grouped.set(key, arr);
  });
  const absenceByDay = new Map();
  _ctx.absences.filter((item) => item.active !== false).forEach((absence) => {
    datesBetween(absence.startDate, absence.endDate || absence.startDate).forEach((key) => {
      const arr = absenceByDay.get(key) || [];
      arr.push(absence);
      absenceByDay.set(key, arr);
    });
  });
  cal.innerHTML = cells.map((cell) => {
    if (cell.muted) return `<div class="agenda-ts-day is-muted"></div>`;
    const key = dateKey(cell.date);
    const items = grouped.get(key) || [];
    const dayEntries = calendarEntriesForDay(items, key);
    const visible = dayEntries.slice(0, 5);
    const absences = absenceByDay.get(key) || [];
    const absence = absences[0] || null;
    return `<div class="agenda-ts-day">
      <div class="agenda-ts-day-head"><strong>${escapeHtml(cell.day)}</strong>${absence ? `<button class="agenda-ts-absence-chip" data-agenda-absence="${escapeHtml(absence.id)}" type="button" title="Ver ausencia">${escapeHtml(absences.length > 1 ? `Ausencia +${absences.length - 1}` : "Ausencia")}</button>` : ""}</div>
      <div class="agenda-ts-chips">
        ${visible.map((entry) => {
          if (entry.type === "project") {
            const chipText = projectName(entry.projectId);
            return `<button class="agenda-ts-chip agenda-ts-chip--project" data-agenda-project-summary="${escapeHtml(entry.projectId)}" data-agenda-summary-date="${escapeHtml(key)}" type="button" title="${escapeHtml(projectChipTitle(entry.projectId, entry.activities))}">${clientAvatarHtml(entry.projectId)}<span class="agenda-ts-chip-label">${escapeHtml(chipText)}</span></button>`;
          }
          const activity = entry.activity;
          const chipText = activity.techNames?.[0] || resourceName(activity.techUids?.[0]);
          return `<button class="agenda-ts-chip" data-agenda-detail="${escapeHtml(activity.id)}" type="button" title="${escapeHtml(chipText)}">${escapeHtml(chipText)}</button>`;
        }).join("")}
        ${dayEntries.length > 5 ? `<button class="agenda-ts-more" data-agenda-more="${escapeHtml(key)}" type="button" aria-haspopup="dialog" aria-expanded="false" title="Ver ${escapeHtml(String(dayEntries.length - 5))} itens ocultos">+${escapeHtml(String(dayEntries.length - 5))}</button>` : ""}
      </div>
    </div>`;
  }).join("");
  cal.querySelectorAll("[data-agenda-detail]").forEach((btn) => btn.addEventListener("click", () => openDetailsModal(btn.dataset.agendaDetail || "")));
  cal.querySelectorAll("[data-agenda-project-summary]").forEach((btn) => btn.addEventListener("click", () => openProjectDaySummaryModal(btn.getAttribute("data-agenda-project-summary") || "", btn.getAttribute("data-agenda-summary-date") || "")));
  cal.querySelectorAll("[data-agenda-absence]").forEach((btn) => btn.addEventListener("click", () => openAbsenceDetailsModal(btn.dataset.agendaAbsence || "")));
  cal.querySelectorAll("[data-agenda-more]").forEach((btn) => btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const key = btn.getAttribute("data-agenda-more") || "";
    openAgendaMorePopover(btn, key);
  }));
}
function renderAll(){
  renderShell();
  renderSidebar();
  renderCalendar();
}
function activityDisplayName(activity){
  if (_mode === "projects") return `${projectName(activity.projectId)} / ${activity.clientName || ""}`.trim();
  return (activity.techNames?.[0] || resourceName(activity.techUids?.[0]));
}
function activityResourcesText(activity){
  return (activity.techNames || []).join(", ") || (activity.techUids || []).map(resourceName).join(", ") || "-";
}
function activityTimeText(activity){
  const start = activity.startTime || "";
  const end = activity.endTime || "";
  if (start && end) return `${start} - ${end}`;
  return formatHours(activity.hoursWorked);
}
function closeAgendaMorePopover(){
  byId("agendaTsMorePopover")?.remove();
  if (_agendaMoreAnchor) _agendaMoreAnchor.setAttribute("aria-expanded", "false");
  _agendaMoreAnchor = null;
}
function positionAgendaMorePopover(anchor, popover){
  const margin = 12;
  const gap = 8;
  const rect = anchor.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  let left = rect.left;
  let top = rect.bottom + gap;
  if (left + popRect.width + margin > vw) left = vw - popRect.width - margin;
  if (left < margin) left = margin;
  if (top + popRect.height + margin > vh) top = rect.top - popRect.height - gap;
  if (top < margin) top = margin;
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}
function openAgendaMorePopover(anchor, workDate){
  const dayActivities = monthActivities()
    .filter((activity) => String(activity.workDate || "").slice(0, 10) === workDate);
  const grouped = calendarEntriesForDay(dayActivities, workDate).slice(5);
  if (!grouped.length) return;
  if (_agendaMoreAnchor === anchor && byId("agendaTsMorePopover")) {
    closeAgendaMorePopover();
    return;
  }
  closeAgendaMorePopover();
  _agendaMoreAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  document.body.insertAdjacentHTML("beforeend", `
    <div class="agenda-ts-more-popover" id="agendaTsMorePopover" role="dialog" aria-label="Agendas ocultas de ${escapeHtml(fmtDate(workDate))}">
      <div class="agenda-ts-more-head">
        <div>
          <strong>${escapeHtml(fmtDate(workDate))}</strong>
          <span>${escapeHtml(String(grouped.length))} agendas ocultas</span>
        </div>
        <button class="agenda-ts-more-close" data-close-agenda-more="true" type="button" aria-label="Fechar agendas ocultas">x</button>
      </div>
      <div class="agenda-ts-more-list">
        ${grouped.map((entry) => {
          if (entry.type === "project") {
            const hours = entry.activities.reduce((sum, activity) => sum + asNumber(activity.hoursWorked), 0);
            const resources = new Set(entry.activities.flatMap((activity) => activity.techUids || []));
            return `
              <button class="agenda-ts-more-item" data-agenda-project-summary="${escapeHtml(entry.projectId)}" data-agenda-summary-date="${escapeHtml(workDate)}" type="button">
                <strong>${escapeHtml(projectChipTitle(entry.projectId, entry.activities))}</strong>
                <span>${escapeHtml(String(entry.activities.length))} atividades - ${escapeHtml(String(resources.size))} consultores</span>
                <small>${escapeHtml(formatHours(hours))} no dia</small>
              </button>
            `;
          }
          const activity = entry.activity;
          return `
            <button class="agenda-ts-more-item" data-agenda-detail="${escapeHtml(activity.id)}" type="button">
              <strong>${escapeHtml(activityDisplayName(activity))}</strong>
              <span>${escapeHtml(projectName(activity.projectId))} - ${escapeHtml(activity.name || taskName(activity.taskId))}</span>
              <small>${escapeHtml(activityResourcesText(activity))} - ${escapeHtml(activityTimeText(activity))}</small>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `);
  const popover = byId("agendaTsMorePopover");
  if (!popover) return;
  positionAgendaMorePopover(anchor, popover);
  popover.querySelector("[data-close-agenda-more]")?.addEventListener("click", closeAgendaMorePopover);
  popover.querySelectorAll("[data-agenda-detail]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-agenda-detail") || "";
    closeAgendaMorePopover();
    openDetailsModal(id);
  }));
  popover.querySelectorAll("[data-agenda-project-summary]").forEach((btn) => btn.addEventListener("click", () => {
    const projectId = btn.getAttribute("data-agenda-project-summary") || "";
    const date = btn.getAttribute("data-agenda-summary-date") || "";
    closeAgendaMorePopover();
    openProjectDaySummaryModal(projectId, date);
  }));
  requestAnimationFrame(() => popover.querySelector(".agenda-ts-more-item")?.focus({ preventScroll: true }));
}
async function reload(){
  _ctx = await loadAgendaContext(_deps.db, _deps.state.companyId);
  _deps.state._usersCache = _ctx.users;
}
export function openAgendaTimeSheetView(deps){
  _deps = deps;
  if (!canAccess(deps.state)){
    deps.navigateTo?.(deps.ROUTES?.dashboard || "/dashboard", { replace: true });
    return;
  }
  deps.setView("agendaTimeSheet");
  const root = byId("agendaTimeSheetRoot");
  if (root) root.innerHTML = `<div class="agenda-ts-skeleton"><div></div><div></div><div></div></div>`;
  bindGlobalOnce();
  reload().then(renderAll).catch((err) => {
    console.error("[agenda-timesheet]", err);
    if (root) root.innerHTML = `<div class="panel subtle"><p class="muted">Nao foi possivel carregar as agendas.</p></div>`;
  });
}
function bindGlobalOnce(){
  if (_bound) return;
  _bound = true;
  document.addEventListener("click", (ev) => {
    if (!ev.target?.closest?.("#agendaTsMorePopover, [data-agenda-more]")) closeAgendaMorePopover();
    const close = ev.target?.closest?.("[data-close-agenda-modal]");
    if (close) closeAgendaModal();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeAgendaMorePopover();
  });
}
function ensureModal(){
  let modal = byId("modalAgendaTimeSheet");
  if (modal) return modal;
  document.body.insertAdjacentHTML("beforeend", `<div class="modal" hidden id="modalAgendaTimeSheet"><div class="modal-backdrop" data-close-agenda-modal="true"></div><div class="modal-card modal-xl agenda-ts-modal-card" id="agendaTsModalCard"></div></div>`);
  return byId("modalAgendaTimeSheet");
}
function closeAgendaModal(){
  const modal = byId("modalAgendaTimeSheet");
  if (modal) modal.hidden = true;
  _selectedClearIds = new Set();
}
function absenceTypeLabel(type){
  const found = ABSENCE_TYPES.find(([value]) => value === type);
  return found?.[1] || type || "Ausencia";
}
function openAbsenceDetailsModal(absenceId){
  const absence = _ctx.absences.find((item) => item.id === absenceId);
  if (!absence) return;
  const modal = ensureModal();
  const card = byId("agendaTsModalCard");
  card.innerHTML = `
    <div class="modal-header"><div><h2>Detalhes da Ausencia</h2><p class="muted">${escapeHtml(absenceTypeLabel(absence.type))}</p></div><button class="btn ghost" data-close-agenda-modal="true" type="button">X</button></div>
    <div class="modal-body">
      <div class="agenda-ts-absence-hero"><span>Ausencia cadastrada</span><strong>${escapeHtml(absence.resourceName || resourceName(absence.resourceId))}</strong><small>${escapeHtml(fmtDate(absence.startDate))} ate ${escapeHtml(fmtDate(absence.endDate || absence.startDate))}</small></div>
      <div class="agenda-ts-detail-grid">
        ${detail("Recurso", absence.resourceName || resourceName(absence.resourceId))}
        ${detail("Tipo", absenceTypeLabel(absence.type))}
        ${detail("Data inicial", fmtDate(absence.startDate))}
        ${detail("Data final", fmtDate(absence.endDate || absence.startDate))}
        ${detail("Criado por", absence.createdByName || absence.createdBy || "-")}
      </div>
      <div class="agenda-ts-note"><strong>Motivo / observacao</strong><p>${escapeHtml(absence.observation || "Sem observacao registrada.")}</p></div>
    </div>
    <div class="modal-footer"><button class="btn primary" data-close-agenda-modal="true" type="button">Fechar</button></div>
  `;
  modal.hidden = false;
}
function projectDayConsultantsHtml(activities){
  const byResource = new Map();
  const addToResource = (key, label, activity) => {
    const current = byResource.get(key) || { label, hours: 0, count: 0, taskNames: new Set(), statusCounts: new Map() };
    const task = _ctx.tasks.find((item) => item.id === activity.taskId);
    current.hours += asNumber(activity.hoursWorked);
    current.count += 1;
    current.taskNames.add(task?.name || activity.taskName || "Tarefa");
    const tone = activityStatusTone(activity);
    current.statusCounts.set(tone, (current.statusCounts.get(tone) || 0) + 1);
    byResource.set(key, current);
  };
  activities.forEach((activity) => {
    const techUids = Array.isArray(activity.techUids) ? activity.techUids : [];
    const techNames = Array.isArray(activity.techNames) ? activity.techNames : [];
    if (!techUids.length && techNames.length) {
      techNames.forEach((name) => {
        const key = name || "Sem recurso";
        addToResource(key, key, activity);
      });
      return;
    }
    techUids.forEach((uid, idx) => {
      const label = techNames[idx] || resourceName(uid);
      addToResource(uid, label, activity);
    });
  });
  const statusLabels = {
    pending: "Sem OS",
    sent: "OS Env.",
    done: "OS Apr.",
    overdue: "Atr."
  };
  const metaHtml = (item) => {
    const taskChips = Array.from(item.taskNames)
      .sort()
      .map((name) => `<span class="agenda-ts-summary-mini agenda-ts-summary-mini--task">${escapeHtml(name)}</span>`)
      .join("");
    const statusChips = ["pending", "sent", "done", "overdue"]
      .filter((tone) => item.statusCounts.has(tone))
      .map((tone) => `<span class="agenda-ts-summary-mini agenda-ts-summary-mini--status agenda-ts-activity-status--${escapeHtml(tone)}">${statusIcon(tone)}${escapeHtml(statusLabels[tone])}: ${escapeHtml(String(item.statusCounts.get(tone)))}</span>`)
      .join("");
    return `${taskChips}${statusChips}`;
  };
  return Array.from(byResource.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((item) => `
      <div class="agenda-ts-summary-row">
        <div class="agenda-ts-summary-consultant">
          <strong>${escapeHtml(item.label)}</strong>
          <div class="agenda-ts-summary-meta">${metaHtml(item)}</div>
        </div>
        <span>${escapeHtml(formatHours(item.hours))} - ${escapeHtml(String(item.count))} atividade(s)</span>
      </div>
    `).join("") || `<p class="muted">Nenhum consultor alocado.</p>`;
}
function openProjectDaySummaryModal(projectId, workDate){
  const activities = monthActivities()
    .filter((activity) => activity.projectId === projectId && String(activity.workDate || "").slice(0, 10) === workDate);
  if (!activities.length) return;
  const project = _ctx.projects.find((item) => item.id === projectId) || {};
  const totalHours = activities.reduce((sum, activity) => sum + asNumber(activity.hoursWorked), 0);
  const modal = ensureModal();
  const card = byId("agendaTsModalCard");
  card.innerHTML = `
    <div class="modal-header"><div><h2>Resumo da Agenda</h2><p class="muted">${escapeHtml(fmtDate(workDate))}</p></div><button class="btn ghost" data-close-agenda-modal="true" type="button">X</button></div>
    <div class="modal-body">
      <div class="agenda-ts-detail-hero"><span>Projeto - Dia</span><strong>${escapeHtml(project.name || projectName(projectId))}</strong><small>Cliente: ${escapeHtml(project.clientName || activities[0]?.clientName || "-")}</small></div>
      <div class="agenda-ts-detail-grid agenda-ts-summary-grid">
        ${detail("Atividades no dia", String(activities.length))}
        ${detail("Horas planejadas", formatHours(totalHours))}
        ${detailHtml("Status Projeto", projectStatusBadge(project.status))}
        ${detailBlockHtml("Consultores e horas", `<div class="agenda-ts-summary-list">${projectDayConsultantsHtml(activities)}</div>`)}
      </div>
    </div>
    <div class="modal-footer"><button class="btn primary" data-close-agenda-modal="true" type="button">Fechar</button></div>
  `;
  modal.hidden = false;
}
function openDetailsModal(activityId){
  const activity = _ctx.activities.find((item) => item.id === activityId);
  if (!activity) return;
  const project = _ctx.projects.find((item) => item.id === activity.projectId) || {};
  const task = _ctx.tasks.find((item) => item.id === activity.taskId) || {};
  const readonly = _mode === "projects";
  const modal = ensureModal();
  const card = byId("agendaTsModalCard");
  card.innerHTML = `
    <div class="modal-header"><div><h2>Detalhes da Agenda</h2><p class="muted">${escapeHtml(fmtDate(activity.workDate))}</p></div><button class="btn ghost" data-close-agenda-modal="true" type="button">X</button></div>
    <div class="modal-body">
      <div class="agenda-ts-detail-hero"><span>Projeto - Tecnico</span><strong>${escapeHtml(project.name || activity.projectName || "Projeto")}</strong><small>Cliente: ${escapeHtml(project.clientName || activity.clientName || "-")}</small></div>
      <div class="agenda-ts-detail-grid">
        ${detail("Cliente", project.clientName || activity.clientName)}
        ${detail("Projeto", project.name || activity.projectName)}
        ${detailHtml("Status Projeto", projectStatusBadge(project.status))}
        ${detail("Tarefa", task.name || activity.taskName)}
        ${detail("Atividade", activity.name)}
        ${detailHtml("Status Atividade", activityStatusBadge(activity))}
        ${detail("Horas", formatHours(activity.hoursWorked))}
        ${detail("Recurso", (activity.techNames || []).join(", ") || (activity.techUids || []).map(resourceName).join(", "))}
        ${detail("Hora inicio", activity.startTime || "-")}
        ${detail("Hora fim", activity.endTime || "-")}
        ${detail("Hora almoco", activity.breakTime || "-")}
        ${detail("Criada em", activity.createdAt?.toDate ? activity.createdAt.toDate().toLocaleString("pt-BR") : "-")}
        ${detail("Usuario criador", activity.createdByName || activity.createdBy || "-")}
        ${detail("Datas", fmtDate(activity.workDate))}
      </div>
      <div class="agenda-ts-note"><strong>Observacoes</strong><p>${escapeHtml(activity.note || "Sem observacao.")}</p></div>
      <div class="alert" hidden id="agendaTsModalAlert"></div>
    </div>
    <div class="modal-footer">
      ${readonly ? "" : `<button class="btn danger" id="btnAgendaTsDeleteActivity" type="button">Excluir Alocacao</button>`}
      <button class="btn primary" data-close-agenda-modal="true" type="button">Fechar</button>
    </div>
  `;
  byId("btnAgendaTsDeleteActivity")?.addEventListener("click", async () => {
    if (!canAccess(_deps.state)) return setAlert(byId("agendaTsModalAlert"), "Voce nao tem permissao para excluir esta alocacao.", "error");
    if (!confirm("Deseja realmente excluir esta alocacao?")) return;
    try {
      await deleteAgendaActivity(_deps.db, _deps.state.companyId, activity.id);
      closeAgendaModal();
      await reload();
      renderAll();
    } catch (err) {
      setAlert(byId("agendaTsModalAlert"), err?.message || "Nao foi possivel excluir a alocacao.", "error");
    }
  });
  modal.hidden = false;
}
function detail(label, value){ return `<div class="agenda-ts-detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`; }
function detailHtml(label, html){ return `<div class="agenda-ts-detail-item"><span>${escapeHtml(label)}</span><strong>${html || "-"}</strong></div>`; }
function detailBlockHtml(label, html){ return `<div class="agenda-ts-detail-item"><span>${escapeHtml(label)}</span><div class="agenda-ts-detail-block">${html || "-"}</div></div>`; }
function openScheduleModal(){
  _scheduleCursor = firstDay(_cursor);
  _scheduleSelectedDates = new Set();
  setScheduleKeyUsers([]);
  setScheduleResources([]);
  const modal = ensureModal();
  const card = byId("agendaTsModalCard");
  card.innerHTML = `
    <div class="modal-header"><div><h2>Agendar Atividade</h2><p class="muted">Selecione dias do mes e informe as horas por dia.</p></div><button class="btn ghost" data-close-agenda-modal="true" type="button">X</button></div>
    <div class="modal-body">
      <div class="alert" hidden id="agendaScheduleAlert"></div>
      <div class="agenda-ts-form-grid">
        <label class="field"><span>Projeto *</span><select id="agendaScheduleProject">${projectOptionsHtml(_ctx.projects)}</select></label>
        <label class="field"><span>Tarefa *</span><select id="agendaScheduleTask"><option value="">Escolha o projeto primeiro</option></select></label>
        <label class="field span-2"><span>Nome da Atividade *</span><input id="agendaScheduleName" maxlength="100" /></label>
        <label class="field"><span>Horas por dia *</span><input id="agendaScheduleHours" type="number" min="0.5" max="12" step="0.5" value="8" /></label>
        <div class="field agenda-ts-keyuser-field span-2">
          <span>Recursos *</span>
          <select id="agendaScheduleResource">${resourceOptionsHtml(activeResources())}</select>
          <div class="help">Selecao multipla em chips coloridos.</div>
          <div id="agendaScheduleResourceChips" class="chips project-tech-chips activity-selection-chips agenda-ts-keyuser-chips"><span class="muted">Nenhum recurso selecionado.</span></div>
        </div>
        <div class="field agenda-ts-keyuser-field span-2">
          <span>Key users *</span>
          <select id="agendaScheduleKeyUser"><option value="">Escolha o projeto primeiro</option></select>
          <div class="help">Selecao multipla em chips coloridos.</div>
          <div id="agendaScheduleKeyUserChips" class="chips project-tech-chips activity-selection-chips agenda-ts-keyuser-chips"><span class="muted">Nenhum key user selecionado.</span></div>
        </div>
      </div>
      <div class="agenda-ts-task-summary" id="agendaScheduleTaskSummary">Selecione projeto e tarefa para consultar horas e saldo.</div>
      <div class="alert workspace-schedule-alert" hidden id="agendaScheduleInlineAlert"></div>
      <section class="agenda-ts-picker">
        <div class="agenda-ts-picker-head">
          <button class="btn ghost sm" id="btnAgendaSchedulePrevMonth" type="button" aria-label="Mes anterior">&lsaquo;</button>
          <strong id="agendaScheduleMonth"></strong>
          <button class="btn ghost sm" id="btnAgendaScheduleNextMonth" type="button" aria-label="Proximo mes">&rsaquo;</button>
        </div>
        <div class="agenda-ts-quick">
          <button class="btn ghost sm" data-schedule-quick="month" type="button">Este mes</button>
          <button class="btn ghost sm" data-schedule-quick="workdays" type="button">Dias uteis</button>
          <button class="btn ghost sm" data-schedule-quick="clear" type="button">Limpar</button>
        </div>
        <div class="agenda-ts-picker-weekdays">${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].map((d) => `<span>${d}</span>`).join("")}</div>
        <div class="agenda-ts-picker-grid" id="agendaScheduleCalendar"></div>
        <div class="agenda-ts-picker-legend">
          <span><i class="available"></i>Disponivel</span>
          <span><i class="selected"></i>Selecionado</span>
          <span><i class="occupied"></i>Ocupado</span>
          <span><i class="absence"></i>Ausencia</span>
          <span><i class="weekend"></i>Fim de semana</span>
        </div>
      </section>
      <label class="agenda-ts-weekend-toggle"><input id="agendaScheduleAllowWeekend" type="checkbox" /> Permitir sabado/domingo/feriado</label>
      <div class="agenda-ts-schedule-footer-note" id="agendaScheduleSelectedSummary">0 dias selecionados - 0h total</div>
    </div>
    <div class="modal-footer"><button class="btn ghost" data-close-agenda-modal="true" type="button">Cancelar</button><button class="btn primary" id="btnAgendaScheduleSave" type="button">Confirmar agendamento</button></div>
  `;
  const projectSelect = byId("agendaScheduleProject");
  const resourceSelect = byId("agendaScheduleResource");
  const syncProject = ({ preserveResource = false } = {}) => {
    const selectedProjectId = projectSelect?.value || "";
    const allowedResources = resourcesForProject(selectedProjectId);
    const allowedIds = new Set(allowedResources.map(resourceIdOf));
    if (resourceSelect) resourceSelect.innerHTML = resourceOptionsHtml(allowedResources);
    if (preserveResource) setScheduleResources(_scheduleResources.filter((item) => allowedIds.has(item.id)));
    else setScheduleResources([]);
    const project = _ctx.projects.find((p) => p.id === selectedProjectId) || null;
    byId("agendaScheduleTask").innerHTML = `<option value="">Selecione</option>${tasksForProject(project?.id || "").map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name || "Tarefa")}</option>`).join("")}`;
    byId("agendaScheduleKeyUser").innerHTML = `<option value="">Selecione</option>${keyUsersForProject(project).map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`;
    setScheduleKeyUsers([]);
    renderScheduleKeyUserChips();
    renderScheduleResourceChips();
    _scheduleSelectedDates = new Set();
    renderScheduleCalendar();
    updateScheduleTaskSummary();
  };
  projectSelect.addEventListener("change", () => {
    clearAgendaScheduleInlineAlert();
    syncProject({ preserveResource: true });
  });
  resourceSelect?.addEventListener("change", () => {
    const value = resourceSelect.value || "";
    const label = resourceSelect.options?.[resourceSelect.selectedIndex]?.textContent?.trim() || value;
    if (value) addScheduleResource(value, label);
    resourceSelect.value = "";
    clearAgendaScheduleInlineAlert();
  });
  byId("agendaScheduleResourceChips")?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("[data-remove-schedule-resource]");
    if (!btn) return;
    removeScheduleResource(btn.getAttribute("data-remove-schedule-resource") || "");
    clearAgendaScheduleInlineAlert();
  });
  byId("agendaScheduleKeyUser")?.addEventListener("change", () => {
    const select = byId("agendaScheduleKeyUser");
    const value = select?.value || "";
    if (value) addScheduleKeyUser(value);
    if (select) select.value = "";
    clearAgendaScheduleInlineAlert();
  });
  byId("agendaScheduleKeyUserChips")?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("[data-remove-schedule-keyuser]");
    if (!btn) return;
    removeScheduleKeyUser(btn.getAttribute("data-remove-schedule-keyuser") || "");
    clearAgendaScheduleInlineAlert();
  });
  byId("agendaScheduleTask")?.addEventListener("change", () => {
    _scheduleSelectedDates = new Set();
    clearAgendaScheduleInlineAlert();
    renderScheduleCalendar();
    updateScheduleTaskSummary();
  });
  byId("agendaScheduleHours")?.addEventListener("input", () => {
    clearAgendaScheduleInlineAlert();
    renderScheduleCalendar();
    updateScheduleTaskSummary();
  });
  byId("agendaScheduleAllowWeekend")?.addEventListener("change", () => {
    clearAgendaScheduleInlineAlert();
    renderScheduleCalendar();
  });
  byId("btnAgendaSchedulePrevMonth")?.addEventListener("click", () => {
    _scheduleCursor = new Date(_scheduleCursor.getFullYear(), _scheduleCursor.getMonth() - 1, 1);
    clearAgendaScheduleInlineAlert();
    renderScheduleCalendar();
  });
  byId("btnAgendaScheduleNextMonth")?.addEventListener("click", () => {
    _scheduleCursor = new Date(_scheduleCursor.getFullYear(), _scheduleCursor.getMonth() + 1, 1);
    clearAgendaScheduleInlineAlert();
    renderScheduleCalendar();
  });
  document.querySelectorAll("[data-schedule-quick]").forEach((btn) => {
    btn.addEventListener("click", () => applyScheduleQuick(btn.getAttribute("data-schedule-quick")));
  });
  byId("btnAgendaScheduleSave")?.addEventListener("click", saveSchedule);
  renderScheduleCalendar();
  renderScheduleKeyUserChips();
  renderScheduleResourceChips();
  updateScheduleTaskSummary();
  modal.hidden = false;
}
function updateScheduleTaskSummary(){
  const el = byId("agendaScheduleTaskSummary");
  const selectedEl = byId("agendaScheduleSelectedSummary");
  const taskId = byId("agendaScheduleTask")?.value || "";
  const hours = asNumber(byId("agendaScheduleHours")?.value || 0);
  const total = _scheduleSelectedDates.size * _scheduleResources.length * hours;
  if (selectedEl) selectedEl.textContent = `${_scheduleSelectedDates.size} dias selecionados - ${formatHours(total)} total`;
  if (!el) return;
  if (!taskId) {
    el.textContent = "Selecione projeto e tarefa para consultar horas e saldo.";
    return;
  }
  const info = taskHoursInfo(taskId);
  el.innerHTML = info.hasLimit
    ? `Tarefa: <strong>${escapeHtml(formatHours(info.plannedHours))}</strong> planejadas - <strong>${escapeHtml(formatHours(info.usedHours))}</strong> usadas - saldo <strong>${escapeHtml(formatHours(info.availableHours))}</strong>`
    : `Tarefa sem limite de horas definido - selecionado <strong>${escapeHtml(formatHours(total))}</strong>`;
}
function renderScheduleCalendar(){
  const grid = byId("agendaScheduleCalendar");
  const label = byId("agendaScheduleMonth");
  if (label) label.textContent = monthLabel(_scheduleCursor);
  if (!grid) return;
  const taskId = byId("agendaScheduleTask")?.value || "";
  const resourceIds = _scheduleResources.map((item) => item.id);
  const allowWeekend = !!byId("agendaScheduleAllowWeekend")?.checked;
  const task = _ctx.tasks.find((item) => item.id === taskId) || null;
  const first = firstDay(_scheduleCursor);
  const end = monthEnd(_scheduleCursor);
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push({ muted: true });
  for (let day = 1; day <= end.getDate(); day++) cells.push({ date: new Date(_scheduleCursor.getFullYear(), _scheduleCursor.getMonth(), day) });
  while (cells.length % 7) cells.push({ muted: true });
  grid.innerHTML = cells.map((cell) => {
    if (cell.muted) return `<button class="agenda-ts-pick-day is-muted" type="button" disabled></button>`;
    const key = dateKey(cell.date);
    const weekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;
    const outsideTask = task && (key < String(task.startDate || "").slice(0, 10) || key > String(task.endDate || "").slice(0, 10));
    const absent = resourceIds.length && resourceIds.some((resourceId) => absenceOverlaps(resourceId, key, key));
    const occupied = resourceIds.length && resourceIds.some((resourceId) => dailyResourceHours(resourceId, key) > 0);
    const disabled = outsideTask || absent || (weekend && !allowWeekend);
    const selected = _scheduleSelectedDates.has(key);
    const cls = [
      "agenda-ts-pick-day",
      selected ? "is-selected" : "",
      disabled ? "is-disabled" : "",
      weekend ? "is-weekend" : "",
      occupied ? "is-occupied" : "",
      absent ? "is-absence" : ""
    ].filter(Boolean).join(" ");
    const title = absent
      ? "Recurso selecionado com ausencia cadastrada"
      : occupied
        ? "Ja existe agenda para um recurso selecionado neste dia"
        : outsideTask
          ? "Fora do periodo da tarefa"
          : weekend && !allowWeekend
            ? "Fim de semana bloqueado"
            : "Selecionar dia";
    return `<button class="${cls}" data-schedule-date="${escapeHtml(key)}" type="button" ${disabled ? "disabled" : ""} title="${escapeHtml(title)}">${cell.date.getDate()}</button>`;
  }).join("");
  grid.querySelectorAll("[data-schedule-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-schedule-date") || "";
      if (_scheduleSelectedDates.has(key)) _scheduleSelectedDates.delete(key);
      else _scheduleSelectedDates.add(key);
      clearAgendaScheduleInlineAlert();
      renderScheduleCalendar();
      updateScheduleTaskSummary();
    });
  });
  updateScheduleTaskSummary();
}
function applyScheduleQuick(kind){
  if (kind === "clear") {
    _scheduleSelectedDates = new Set();
    clearAgendaScheduleInlineAlert();
    renderScheduleCalendar();
    updateScheduleTaskSummary();
    return;
  }
  const allowWeekend = kind === "month";
  const input = byId("agendaScheduleAllowWeekend");
  if (input && kind === "month") input.checked = true;
  const first = firstDay(_scheduleCursor);
  const end = monthEnd(_scheduleCursor);
  const dates = datesBetween(dateKey(first), dateKey(end));
  _scheduleSelectedDates = new Set();
  dates.forEach((key) => {
    const date = parseDate(key);
    const isWeekend = date && (date.getDay() === 0 || date.getDay() === 6);
    if (!allowWeekend && isWeekend) return;
    _scheduleSelectedDates.add(key);
  });
  renderScheduleCalendar();
  updateScheduleTaskSummary();
  clearAgendaScheduleInlineAlert();
}
async function saveSchedule(){
  const alertEl = byId("agendaScheduleAlert");
  const scheduleAlertEl = byId("agendaScheduleInlineAlert") || alertEl;
  clearAlert(alertEl);
  clearAlert(scheduleAlertEl);
  const projectId = byId("agendaScheduleProject")?.value || "";
  const taskId = byId("agendaScheduleTask")?.value || "";
  const resourceIds = _scheduleResources.map((item) => item.id);
  const keyUsers = _scheduleKeyUsers.slice();
  const name = String(byId("agendaScheduleName")?.value || "").trim();
  const hoursWorked = asNumber(byId("agendaScheduleHours")?.value || 0);
  const project = _ctx.projects.find((item) => item.id === projectId);
  const task = _ctx.tasks.find((item) => item.id === taskId);
  if (!projectId || !taskId || !resourceIds.length || !keyUsers.length || !name) return setAlert(scheduleAlertEl, "Preencha projeto, tarefa, recurso, key user e nome da atividade.", "error");
  if (resourceIds.some((resourceId) => !isResourceLinkedToProject(projectId, resourceId))) return setAlert(scheduleAlertEl, "Selecione apenas recursos vinculados ao projeto informado.", "error");
  const dates = Array.from(_scheduleSelectedDates).sort();
  if (!dates.length || hoursWorked <= 0) return setAlert(scheduleAlertEl, "Selecione ao menos um dia e informe horas validas.", "error");
  if (hoursWorked > 12) return setAlert(scheduleAlertEl, "A atividade aceita no maximo 12 horas por dia.", "error");
  if (project?.active === false || String(project?.status || "").toLowerCase() === "concluido") return setAlert(scheduleAlertEl, "Projeto inativo ou concluido nao permite nova agenda.", "error");
  if (String(task?.status || "").toLowerCase() === "concluido") return setAlert(scheduleAlertEl, "Tarefa encerrada nao permite nova agenda.", "error");
  const taskInfo = taskHoursInfo(taskId);
  const newHours = dates.length * resourceIds.length * hoursWorked;
  if (taskInfo.hasLimit && newHours > taskInfo.availableHours) return setAlert(scheduleAlertEl, `Horas insuficientes nesta tarefa. Saldo disponivel: ${formatHours(taskInfo.availableHours)}.`, "error");
  const allowWeekend = !!byId("agendaScheduleAllowWeekend")?.checked;
  for (const date of dates){
    const parsedDate = parseDate(date);
    if (!allowWeekend && parsedDate && (parsedDate.getDay() === 0 || parsedDate.getDay() === 6)) return setAlert(scheduleAlertEl, "Sabado/domingo/feriado so pode ser agendado com permissao marcada.", "error");
    if (task && (date < String(task.startDate || "").slice(0, 10) || date > String(task.endDate || "").slice(0, 10))) return setAlert(scheduleAlertEl, `A data ${fmtDate(date)} esta fora do periodo da tarefa.`, "error");
    if (resourceIds.some((resourceId) => absenceOverlaps(resourceId, date, date))) return setAlert(scheduleAlertEl, "Um dos recursos selecionados possui ausencia cadastrada para o periodo informado.", "error");
  }
  const overlappingDates = dates
    .filter((date) => resourceIds.some((resourceId) => dailyResourceHours(resourceId, date) > 0))
    .map((date) => fmtDate(date));
  if (overlappingDates.length) {
    const preview = overlappingDates.slice(0, 5).join(", ");
    const suffix = overlappingDates.length > 5 ? ` e mais ${overlappingDates.length - 5}` : "";
    const ok = confirm(`Um ou mais recursos ja possuem agenda em ${preview}${suffix}. O sistema permite mais de uma atividade no mesmo dia, seguindo o comportamento atual do projeto. Deseja confirmar mesmo assim?`);
    if (!ok) return;
  }
  try {
    const company = _deps.state.company || await getCompanySettings(_deps.db, _deps.state.companyId);
    if (company) _deps.state.company = company;
    const uid = _deps.auth?.currentUser?.uid || "";
    for (const date of dates){
      for (const resourceId of resourceIds){
        const resource = _ctx.users.find((item) => (item.uid || item.id) === resourceId);
        const actId = `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await createAgendaActivity(_deps.db, _deps.state.companyId, actId, {
          projectId,
          projectName: project?.name || "",
          clientId: project?.clientId || "",
          clientName: project?.clientName || clientForProject(project)?.name || "",
          managerUid: project?.managerUid || "",
          managerName: project?.managerName || "",
          coordinatorUid: project?.coordinatorUid || "",
          coordinatorName: project?.coordinatorName || "",
          taskId,
          taskName: task?.name || "",
          name,
          workDate: date,
          hoursWorked,
          techUids: [resourceId],
          techNames: [resource?.name || resource?.email || ""],
          keyUsers,
          note: "",
          status: "sem_os",
          source: "agenda-timesheet",
          createdBy: uid,
          createdByName: _deps.state.profile?.name || "",
          createdByRole: roleOf(_deps.state),
          updatedBy: uid
        });
      }
    }
    closeAgendaModal();
    await reload();
    renderAll();
  } catch (err) {
    setAlert(scheduleAlertEl, err?.message || "Nao foi possivel criar a agenda.", "error");
  }
}
function openClearModal(){
  _selectedClearIds = new Set();
  const modal = ensureModal();
  const card = byId("agendaTsModalCard");
  card.innerHTML = `
    <div class="modal-header"><div><h2>Limpar Agendas</h2><p class="muted">Filtre e remova agendas selecionadas.</p></div><button class="btn ghost" data-close-agenda-modal="true" type="button">X</button></div>
    <div class="modal-body">
      <div class="alert" hidden id="agendaClearAlert"></div>
      <div class="agenda-ts-form-grid">
        <label class="field"><span>Projeto</span><select id="agendaClearProject"><option value="">Todos</option>${_ctx.projects.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || "Projeto")}</option>`).join("")}</select></label>
        <label class="field"><span>Tarefa</span><select id="agendaClearTask"><option value="">Todas</option></select></label>
        <label class="field"><span>Recurso</span><select id="agendaClearResource"><option value="">Todos</option>${activeResources().map((u) => `<option value="${escapeHtml(u.uid || u.id)}">${escapeHtml(u.name || u.email || "Recurso")}</option>`).join("")}</select></label>
        <label class="field"><span>Inicio</span><input id="agendaClearStart" type="date" /></label>
        <label class="field"><span>Fim</span><input id="agendaClearEnd" type="date" /></label>
      </div>
      <div class="agenda-ts-clear-actions"><button class="btn ghost sm" id="btnAgendaClearSearch" type="button">Buscar</button><button class="btn ghost sm" id="btnAgendaClearSelectAll" type="button">Selecionar Todos</button></div>
      <div class="agenda-ts-clear-list" id="agendaClearList"><p class="muted">Use os filtros para buscar agendas.</p></div>
    </div>
    <div class="modal-footer"><button class="btn ghost" data-close-agenda-modal="true" type="button">Cancelar</button><button class="btn danger" id="btnAgendaClearDelete" type="button">Limpar Selecionados</button></div>
  `;
  byId("agendaClearProject")?.addEventListener("change", () => {
    const projectId = byId("agendaClearProject").value;
    byId("agendaClearTask").innerHTML = `<option value="">Todas</option>${tasksForProject(projectId).map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name || "Tarefa")}</option>`).join("")}`;
  });
  byId("btnAgendaClearSearch")?.addEventListener("click", searchClearItems);
  byId("btnAgendaClearSelectAll")?.addEventListener("click", () => {
    byId("agendaClearList")?.querySelectorAll("input[type=checkbox]").forEach((input) => { input.checked = true; _selectedClearIds.add(input.value); });
  });
  byId("btnAgendaClearDelete")?.addEventListener("click", deleteSelectedClearItems);
  modal.hidden = false;
}
async function searchClearItems(){
  const list = byId("agendaClearList");
  list.innerHTML = `<p class="muted">Buscando agendas...</p>`;
  try {
    const items = await findActivitiesByFilters(_deps.db, _deps.state.companyId, {
      projectId: byId("agendaClearProject")?.value || "",
      taskId: byId("agendaClearTask")?.value || "",
      resourceId: byId("agendaClearResource")?.value || "",
      startDate: byId("agendaClearStart")?.value || "",
      endDate: byId("agendaClearEnd")?.value || ""
    });
    _selectedClearIds = new Set();
    list.innerHTML = items.length ? items.map((item) => `<label class="agenda-ts-clear-row"><input type="checkbox" value="${escapeHtml(item.id)}" /> <span>${escapeHtml(fmtDate(item.workDate))} - ${escapeHtml(projectName(item.projectId))} - ${escapeHtml(item.name || "Atividade")} - ${escapeHtml((item.techNames || []).join(", ") || (item.techUids || []).map(resourceName).join(", "))}</span></label>`).join("") : `<p class="muted">Nenhuma agenda encontrada.</p>`;
    list.querySelectorAll("input[type=checkbox]").forEach((input) => input.addEventListener("change", () => input.checked ? _selectedClearIds.add(input.value) : _selectedClearIds.delete(input.value)));
  } catch (err) {
    list.innerHTML = `<p class="muted">Nao foi possivel buscar agendas.</p>`;
  }
}
async function deleteSelectedClearItems(){
  if (!_selectedClearIds.size) return setAlert(byId("agendaClearAlert"), "Selecione ao menos uma agenda.", "error");
  if (!confirm(`Deseja remover ${_selectedClearIds.size} agenda(s) selecionada(s)?`)) return;
  try {
    for (const id of _selectedClearIds) await deleteAgendaActivity(_deps.db, _deps.state.companyId, id);
    closeAgendaModal();
    await reload();
    renderAll();
  } catch (err) {
    setAlert(byId("agendaClearAlert"), err?.message || "Nao foi possivel limpar as agendas selecionadas.", "error");
  }
}
function openAbsenceModal(){
  const modal = ensureModal();
  const card = byId("agendaTsModalCard");
  card.innerHTML = `
    <div class="modal-header"><div><h2>Registrar Ausencia</h2><p class="muted">Bloqueia novas agendas no periodo informado.</p></div><button class="btn ghost" data-close-agenda-modal="true" type="button">X</button></div>
    <div class="modal-body">
      <div class="alert" hidden id="agendaAbsenceAlert"></div>
      <div class="agenda-ts-form-grid">
        <label class="field"><span>Recurso *</span><select id="agendaAbsenceResource"><option value="">Selecione</option>${activeResources().map((u) => `<option value="${escapeHtml(u.uid || u.id)}">${escapeHtml(u.name || u.email || "Recurso")}</option>`).join("")}</select></label>
        <label class="field"><span>Tipo *</span><select id="agendaAbsenceType">${ABSENCE_TYPES.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")}</select></label>
        <label class="field"><span>Data Inicial *</span><input id="agendaAbsenceStart" type="date" /></label>
        <label class="field"><span>Data Final *</span><input id="agendaAbsenceEnd" type="date" /></label>
        <label class="field span-2"><span>Observacao</span><textarea id="agendaAbsenceNote" rows="3"></textarea></label>
      </div>
    </div>
    <div class="modal-footer"><button class="btn ghost" data-close-agenda-modal="true" type="button">Cancelar</button><button class="btn primary" id="btnAgendaAbsenceSave" type="button">Registrar</button></div>
  `;
  byId("btnAgendaAbsenceSave")?.addEventListener("click", saveAbsence);
  modal.hidden = false;
}
async function saveAbsence(){
  const alertEl = byId("agendaAbsenceAlert");
  const resourceId = byId("agendaAbsenceResource")?.value || "";
  const type = byId("agendaAbsenceType")?.value || "";
  const startDate = byId("agendaAbsenceStart")?.value || "";
  const endDate = byId("agendaAbsenceEnd")?.value || "";
  const observation = String(byId("agendaAbsenceNote")?.value || "").trim();
  if (!resourceId || !type || !startDate || !endDate || endDate < startDate) return setAlert(alertEl, "Preencha recurso, tipo e periodo valido.", "error");
  try {
    const absenceId = `abs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await createAbsence(_deps.db, _deps.state.companyId, absenceId, {
      resourceId,
      resourceName: resourceName(resourceId),
      type,
      startDate,
      endDate,
      observation,
      createdBy: _deps.auth?.currentUser?.uid || "",
      createdByName: _deps.state.profile?.name || ""
    });
    closeAgendaModal();
    await reload();
    renderAll();
  } catch (err) {
    console.error("[agenda-timesheet:absence]", err);
    const code = String(err?.code || "").toLowerCase();
    const message = String(err?.message || "").toLowerCase();
    const permissionDenied = code.includes("permission-denied") || message.includes("missing or insufficient permissions");
    setAlert(
      alertEl,
      permissionDenied
        ? "Sem permissao para registrar ausencia. Publique as regras do Firestore atualizadas para liberar resourceAbsences para Admin, Gestor e Coordenador."
        : (err?.message || "Nao foi possivel registrar ausencia."),
      "error"
    );
  }
}

