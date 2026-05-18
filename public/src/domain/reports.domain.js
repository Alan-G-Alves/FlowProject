import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  downloadExecutiveReportExcel,
  downloadExecutiveReportPdf,
  downloadExpenseReceiptPdf,
  downloadReportExcel,
  downloadReportPdf
} from "./reports-export.domain.js?v=1778795000";

let _bound = false;
const REPORT_NOTE_PREVIEW_LIMIT = 140;
const ACTIVITY_TECH_PAGE_SIZE = 8;
const EXPENSE_REPORT_PAGE_SIZE = 8;

const REPORT_CARD_KEYS = [
  "overview",
  "metrics",
  "statuses",
  "execution",
  "clients",
  "schedule",
  "activityTech",
  "expenseReport"
];

const CARD_FILTER_CONFIG = {
  overview: ["period", "clientId", "teamId", "status", "projectId"],
  metrics: ["period", "clientId", "projectId"],
  statuses: ["period", "clientId", "teamId"],
  execution: ["period", "clientId", "teamId", "projectId"],
  clients: ["period", "teamId", "status"],
  schedule: ["period", "clientId", "projectId"],
  activityTech: ["period", "clientId", "projectId", "techId", "activityStatus"],
  expenseReport: ["period", "expenseUserId", "expenseApproverId", "expenseStatus"]
};

function normalizeReportPermissions(value){
  const source = value && typeof value === "object" ? value : {};
  const roles = ["admin", "gestor", "coordenador", "tecnico"];
  return Object.fromEntries(roles.map((role) => {
    const roleSource = source[role] && typeof source[role] === "object" ? source[role] : {};
    return [
      role,
      Object.fromEntries(REPORT_CARD_KEYS.map((key) => [key, roleSource[key] !== false]))
    ];
  }));
}

function getVisibleReportKeys(state){
  if (state?.isSuperAdmin) return REPORT_CARD_KEYS.slice();
  const role = String(state?.profile?.role || "").toLowerCase();
  const permissions = normalizeReportPermissions(state?.company?.reportPermissions);
  const rolePermissions = permissions[role] || {};
  return REPORT_CARD_KEYS.filter((key) => rolePermissions[key] !== false);
}

function asNumber(value){
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function formatHours(value){
  return `${asNumber(value).toLocaleString("pt-BR")}h`;
}

function formatPercent(value){
  return `${asNumber(value).toFixed(1).replace(".", ",")}%`;
}

function formatCurrency(value){
  return asNumber(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function formatDateBr(value){
  const date = parseDateOnly(value);
  if (!date) return "-";
  return date.toLocaleDateString("pt-BR");
}

function formatDateTimeBr(value){
  if (!value) return "-";
  try {
    if (value?.toDate) return value.toDate().toLocaleString("pt-BR");
  } catch (_) {}
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toLocaleString("pt-BR");
  return String(value || "-");
}

function formatExpenseDate(value){
  if (!value) return "-";
  try {
    if (value?.toDate) return value.toDate().toLocaleDateString("pt-BR");
  } catch (_) {}
  return formatDateBr(value);
}

function expenseTypeLabel(type){
  const map = {
    alimentacao: "Alimentacao",
    trajeto: "Trajeto",
    estadia: "Estadia",
    outras: "Outras"
  };
  return map[String(type || "").toLowerCase()] || "Despesa";
}

function expenseStatusLabel(status){
  const map = {
    all: "Todos",
    pending: "Pendente",
    approved: "Aprovada",
    rejected: "Reprovada"
  };
  return map[String(status || "").toLowerCase()] || "Pendente";
}

function getExpenseResponsibleName(item){
  return String(item?.techName || item?.createdByName || "Usuario").trim() || "Usuario";
}

function getExpenseApproverName(item){
  return String(item?.approvedByName || item?.rejectedByName || "").trim() || "-";
}

function getExpenseApprovalDateLabel(item){
  const status = String(item?.status || "").toLowerCase();
  if (status === "approved") return formatDateTimeBr(item?.approvedAt);
  if (status === "rejected") return formatDateTimeBr(item?.rejectedAt);
  return "-";
}

function expenseSourceLabel(source){
  return String(source || "").toLowerCase() === "activity" ? "Atividade" : "Manual";
}

function parseDateOnly(value){
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function inRange(date, start, end){
  if (!date) return false;
  return date >= start && date <= end;
}

function overlap(startA, endA, startB, endB){
  if (!startA || !endA || !startB || !endB) return false;
  return startA <= endB && startB <= endA;
}

function escapeHtml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateReportNote(value, limit = REPORT_NOTE_PREVIEW_LIMIT){
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}...`;
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
  return workedMinutes > 0 ? workedMinutes / 60 : 0;
}

function isCompletedActivity(activity){
  return ["os_gerada", "os_aprovada"].includes(String(activity?.status || "").toLowerCase());
}

function isPendingOsActivity(activity){
  return !isCompletedActivity(activity);
}

function activityStatusLabel(activity){
  const status = String(activity?.status || "").toLowerCase();
  if (status === "os_aprovada") return "OS aprovada";
  if (status === "os_gerada") return "OS enviada";
  return "Planejada";
}

function matchesActivityStatus(activity, statusFilter){
  const filters = Array.isArray(statusFilter)
    ? statusFilter.filter(Boolean).map((item) => String(item))
    : [String(statusFilter || "all")];
  if (!filters.length || filters.includes("all")) return true;
  return filters.some((filter) => matchesSingleActivityStatus(activity, filter));
}

function matchesSingleActivityStatus(activity, filter){
  if (filter === "all") return true;
  const status = String(activity?.status || "").toLowerCase();
  if (filter === "pending") return !isCompletedActivity(activity);
  if (filter === "overdue") {
    const date = parseDateOnly(activity?.workDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Boolean(date && date < today && !isCompletedActivity(activity));
  }
  return status === filter;
}

function getPointedHours(activity){
  const explicit = activity?.workedHours;
  if (explicit !== undefined && explicit !== null && explicit !== "") return asNumber(explicit);
  const fromTimes = diffHours(activity?.startTime, activity?.endTime, activity?.breakTime || "01:00");
  if (fromTimes > 0) return fromTimes;
  return isCompletedActivity(activity) ? asNumber(activity?.hoursWorked) : 0;
}

function getProjectPlannedHours(project){
  return asNumber(
    project?.billingHours ??
    project?.hours ??
    project?.billing?.hours ??
    project?.cobrancaHoras ??
    project?.totalHours ??
    project?.estimatedHours
  );
}

function getKpiMetaCard(label, value, sublabel, focusTarget, tone = "neutral"){
  return `
    <article class="reports-kpi reports-kpi--${escapeHtml(tone)}" data-report-focus="${escapeHtml(focusTarget)}" role="button" tabindex="0" aria-label="${escapeHtml(`${label}: ${value}. ${sublabel}. Clique para ver detalhes.`)}">
      <span class="reports-kpi-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <span class="reports-kpi-sub">${escapeHtml(sublabel)}</span>
      <span class="reports-kpi-cta">Ver detalhes</span>
    </article>
  `;
}

function getOperationalDrilldownMeta(state){
  return {
    cta: "Ver atividades",
    hint: "Clique em qualquer indicador para abrir a lista de atividades correspondente, sem sair do relatorio."
  };
}

function getMetricInsightCard(metricKey, label, value, sublabel, ctaLabel, tone = "neutral"){
  return `
    <button class="reports-metric-card reports-metric-card--${escapeHtml(tone)}" data-open-activities="true" data-report-metric="${escapeHtml(metricKey)}" type="button">
      <span class="reports-metric-card-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <span class="reports-metric-card-sub">${escapeHtml(sublabel)}</span>
      <span class="reports-metric-card-cta">${escapeHtml(ctaLabel)}</span>
    </button>
  `;
}

function getScheduleStatCard(metricKey, label, value, sublabel, tone = "neutral"){
  return `
    <button class="reports-schedule-stat reports-schedule-stat--${escapeHtml(tone)}" data-open-activities="true" data-report-metric="${escapeHtml(metricKey)}" type="button">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(sublabel)}</small>
    </button>
  `;
}

function getScheduleBar(metricKey, label, count, max, tone = "neutral"){
  const width = count > 0 ? Math.max(8, (count / Math.max(1, max)) * 100) : 0;
  return `
    <button class="reports-schedule-bar-row" data-open-activities="true" data-report-metric="${escapeHtml(metricKey)}" type="button">
      <span>${escapeHtml(label)}</span>
      <div class="reports-schedule-bar-track">
        <div class="reports-schedule-bar-fill reports-schedule-bar-fill--${escapeHtml(tone)}" style="width:${width}%"></div>
      </div>
      <b>${escapeHtml(String(count))}</b>
    </button>
  `;
}

function maximizeIcon(isMaximized = false){
  return isMaximized
    ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function enhanceReportCards(refs){
  refs.reportsGrid?.querySelectorAll(".reports-card").forEach((card, index) => {
    if (!(card instanceof HTMLElement)) return;
    const head = card.querySelector(".reports-card-head");
    if (!(head instanceof HTMLElement)) return;
    if (!card.dataset.reportSection) card.dataset.reportSection = index === 0 ? "overview" : `card-${index}`;
    if (head.querySelector("[data-report-maximize]")) return;

    const title = card.querySelector("h3")?.textContent?.trim() || "dashboard";
    const button = document.createElement("button");
    button.className = "reports-card-maximize-btn";
    button.type = "button";
    button.dataset.reportMaximize = "true";
    button.setAttribute("aria-label", `Maximizar ${title}`);
    button.setAttribute("aria-expanded", "false");
    button.title = "Maximizar";
    button.innerHTML = maximizeIcon(false);
    head.appendChild(button);
  });
}

function ensureMaximizeBackdrop(){
  let backdrop = document.querySelector("[data-report-maximize-backdrop]");
  if (backdrop instanceof HTMLElement) return backdrop;
  backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "reports-card-maximize-backdrop";
  backdrop.dataset.reportMaximizeBackdrop = "true";
  backdrop.setAttribute("aria-label", "Fechar dashboard maximizado");
  backdrop.addEventListener("click", () => closeReportCardMaximized());
  document.body.appendChild(backdrop);
  return backdrop;
}

function closeReportCardMaximized(){
  const active = document.querySelector(".reports-card.is-maximized");
  if (active instanceof HTMLElement) {
    const button = active.querySelector("[data-report-maximize]");
    active.classList.remove("is-maximized");
    if (button instanceof HTMLElement) {
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", "Maximizar dashboard");
      button.title = "Maximizar";
      button.innerHTML = maximizeIcon(false);
    }
  }
  document.body.classList.remove("reports-card-maximized");
  document.querySelector("[data-report-maximize-backdrop]")?.remove();
}

function toggleReportCardMaximized(card){
  if (!(card instanceof HTMLElement)) return;
  const isOpening = !card.classList.contains("is-maximized");
  closeReportCardMaximized();
  if (!isOpening) return;

  ensureMaximizeBackdrop();
  card.classList.add("is-maximized");
  document.body.classList.add("reports-card-maximized");

  const button = card.querySelector("[data-report-maximize]");
  if (button instanceof HTMLElement) {
    const title = card.querySelector("h3")?.textContent?.trim() || "dashboard";
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-label", `Restaurar ${title}`);
    button.title = "Restaurar";
    button.innerHTML = maximizeIcon(true);
    button.focus({ preventScroll: true });
  }
}

function toggleReportNote(button){
  const cell = button.closest(".reports-activity-tech-note");
  const note = cell?.querySelector("[data-report-note]");
  if (!(note instanceof HTMLElement)) return;
  const expanded = button.getAttribute("aria-expanded") === "true";
  note.textContent = expanded ? note.dataset.preview || "" : note.dataset.full || "";
  cell.classList.toggle("is-expanded", !expanded);
  button.setAttribute("aria-expanded", expanded ? "false" : "true");
  button.textContent = expanded ? "Ver mais" : "Ver menos";
}

function getPeriodRange(period){
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  const start = new Date(today);
  if (period === "30d") start.setDate(start.getDate() - 29);
  else if (period === "90d") start.setDate(start.getDate() - 89);
  else if (period === "year") start.setMonth(start.getMonth() - 11, 1);
  else start.setFullYear(start.getFullYear() - 10);
  return { start, end };
}

function refsFrom(deps){
  const byId = (id) => document.getElementById(id);
  const r = deps?.refs || {};
  return {
    viewReports: r.viewReports || byId("viewReports"),
    reportsPeriodFilter: r.reportsPeriodFilter || byId("reportsPeriodFilter"),
    reportsClientFilter: r.reportsClientFilter || byId("reportsClientFilter"),
    reportsTeamFilter: r.reportsTeamFilter || byId("reportsTeamFilter"),
    reportsStatusFilter: r.reportsStatusFilter || byId("reportsStatusFilter"),
    btnReloadReports: r.btnReloadReports || byId("btnReloadReports"),
    reportsGrid: r.reportsGrid || byId("reportsGrid"),
    modalReportTechFilters: r.modalReportTechFilters || byId("modalReportTechFilters"),
    btnCloseReportTechFilters: r.btnCloseReportTechFilters || byId("btnCloseReportTechFilters"),
    btnApplyReportTechFilters: r.btnApplyReportTechFilters || byId("btnApplyReportTechFilters"),
    btnResetReportTechFilters: r.btnResetReportTechFilters || byId("btnResetReportTechFilters"),
    reportTechFilterPeriod: r.reportTechFilterPeriod || byId("reportTechFilterPeriod"),
    reportTechFilterStartDate: r.reportTechFilterStartDate || byId("reportTechFilterStartDate"),
    reportTechFilterEndDate: r.reportTechFilterEndDate || byId("reportTechFilterEndDate"),
    reportTechFilterClient: r.reportTechFilterClient || byId("reportTechFilterClient"),
    reportTechFilterProject: r.reportTechFilterProject || byId("reportTechFilterProject"),
    reportTechFilterActivityStatus: r.reportTechFilterActivityStatus || byId("reportTechFilterActivityStatus"),
    reportTechFilterTech: r.reportTechFilterTech || byId("reportTechFilterTech"),
    modalReportActivities: r.modalReportActivities || byId("modalReportActivities"),
    btnCloseReportActivities: r.btnCloseReportActivities || byId("btnCloseReportActivities"),
    reportActivitiesModalTitle: r.reportActivitiesModalTitle || byId("reportActivitiesModalTitle"),
    reportActivitiesModalSubtitle: r.reportActivitiesModalSubtitle || byId("reportActivitiesModalSubtitle"),
    reportActivitiesSummary: r.reportActivitiesSummary || byId("reportActivitiesSummary"),
    reportActivitiesList: r.reportActivitiesList || byId("reportActivitiesList")
  };
}

function userRoleByUid(users, uid){
  const user = users.find((entry) => String(entry.uid || entry.id || "") === String(uid || ""));
  return String(user?.role || "").toLowerCase();
}

function canViewExpenseForReports(item, role, currentUid, users){
  const normalizedRole = String(role || "").toLowerCase();
  const ownerUids = [item.createdBy, item.techUid].map((value) => String(value || "")).filter(Boolean);
  const isOwnExpense = ownerUids.includes(String(currentUid || ""));
  if (normalizedRole === "admin") return true;
  if (normalizedRole === "gestor" || normalizedRole === "coordenador") {
    const ownerRole = userRoleByUid(users, item.createdBy || item.techUid);
    return isOwnExpense || ownerRole === "tecnico" || String(item.createdByRole || "").toLowerCase() === "tecnico";
  }
  return isOwnExpense;
}

async function fetchExpensesForReports(db, companyId, role, currentUid){
  const expensesPath = `companies/${companyId}/expenses`;
  if (role === "admin") return getDocs(collection(db, expensesPath));
  if (role === "gestor" || role === "coordenador") {
    const snaps = await Promise.all([
      getDocs(query(collection(db, expensesPath), where("createdBy", "==", currentUid))),
      getDocs(query(collection(db, expensesPath), where("createdByRole", "==", "tecnico")))
    ]);
    const docsById = new Map();
    snaps.forEach((snap) => snap.docs.forEach((docSnap) => docsById.set(docSnap.id, docSnap)));
    return { docs: Array.from(docsById.values()) };
  }
  return getDocs(query(collection(db, expensesPath), where("createdBy", "==", currentUid)));
}

async function ensureReportsCache(deps, { force = false } = {}){
  const { db, state, auth } = deps;
  const companyId = state?.companyId;
  if (!db || !companyId) return null;
  if (!force && state._reportsCacheLoaded && state._reportsCache) return state._reportsCache;
  const currentUid = auth?.currentUser?.uid || "";
  const role = String(state?.profile?.role || "").toLowerCase();
  state._reportsCurrentUid = currentUid;
  state._reportsRole = role;

  const usersPromise = role === "tecnico"
    ? Promise.resolve({
        docs: [{
          id: currentUid,
          data: () => ({ ...(state.profile || {}), role: "tecnico" })
        }]
      })
    : getDocs(collection(db, `companies/${companyId}/users`));

  const [projectsSnap, tasksSnap, activitiesSnap, clientsSnap, usersSnap, expensesSnap] = await Promise.all([
    getDocs(collection(db, `companies/${companyId}/projects`)),
    getDocs(collection(db, `companies/${companyId}/tasks`)),
    getDocs(collection(db, `companies/${companyId}/activities`)),
    getDocs(collection(db, `companies/${companyId}/clients`)),
    usersPromise,
    fetchExpensesForReports(db, companyId, role, currentUid)
  ]);

  const users = usersSnap.docs.map((d) => ({ uid: d.id, id: d.id, ...d.data() }));

  const cache = {
    projects: projectsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    tasks: tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    activities: activitiesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((activity) => {
        if (role !== "tecnico") return true;
        const techUids = Array.isArray(activity.techUids) ? activity.techUids : [];
        return techUids.includes(currentUid) || String(activity.techUid || "") === currentUid || String(activity.createdBy || "") === currentUid;
      }),
    clients: clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    users,
    expenses: expensesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => canViewExpenseForReports(item, role, currentUid, users))
  };
  state._usersCache = cache.users;
  state._reportsCache = cache;
  state._reportsCacheLoaded = true;
  return cache;
}

function buildFilters(cache, refs, state){
  const currentClient = refs.reportsClientFilter?.value || "all";
  const currentTeam = refs.reportsTeamFilter?.value || "all";
  const currentStatus = refs.reportsStatusFilter?.value || "all";

  const clientOptions = [{ value: "all", label: "Todos os clientes" }].concat(
    cache.clients
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .map((client) => ({ value: client.id, label: client.name || client.id }))
  );
  const teamOptions = [{ value: "all", label: "Todas as equipes" }].concat(
    (Array.isArray(state?.teams) ? state.teams : [])
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .map((team) => ({ value: team.id, label: team.name || team.id }))
  );
  const statusOptions = [
    { value: "all", label: "Todos os status" },
    { value: "a-fazer", label: "A fazer" },
    { value: "em-andamento", label: "Em andamento" },
    { value: "go-live", label: "Go live" },
    { value: "concluido", label: "Concluido" },
    { value: "parado", label: "Parado" },
    { value: "backlog", label: "Backlog" }
  ];

  refs.reportsClientFilter.innerHTML = clientOptions.map((opt) => `<option value="${escapeHtml(opt.value)}"${opt.value === currentClient ? " selected" : ""}>${escapeHtml(opt.label)}</option>`).join("");
  refs.reportsTeamFilter.innerHTML = teamOptions.map((opt) => `<option value="${escapeHtml(opt.value)}"${opt.value === currentTeam ? " selected" : ""}>${escapeHtml(opt.label)}</option>`).join("");
  refs.reportsStatusFilter.innerHTML = statusOptions.map((opt) => `<option value="${escapeHtml(opt.value)}"${opt.value === currentStatus ? " selected" : ""}>${escapeHtml(opt.label)}</option>`).join("");
}

function getBaseFilteredData(cache, refs){
  return {
    projects: cache.projects.slice(),
    tasks: cache.tasks.slice(),
    activities: cache.activities.slice(),
    period: refs.reportsPeriodFilter?.value || "30d",
    clients: cache.clients,
    expenses: Array.isArray(cache.expenses) ? cache.expenses.slice() : []
  };
}

function statusInfo(status){
  const key = String(status || "a-fazer");
  const map = {
    "a-fazer": { label: "A fazer", tone: "blue" },
    "em-andamento": { label: "Em andamento", tone: "orange" },
    "go-live": { label: "Go live", tone: "green" },
    "concluido": { label: "Concluido", tone: "slate" },
    "parado": { label: "Parado", tone: "red" },
    "backlog": { label: "Backlog", tone: "violet" }
  };
  return map[key] || { label: status || "-", tone: "slate" };
}

function statusOptions(){
  return [
    { value: "all", label: "Todos os status" },
    { value: "a-fazer", label: "A fazer" },
    { value: "em-andamento", label: "Em andamento" },
    { value: "go-live", label: "Go live" },
    { value: "concluido", label: "Concluido" },
    { value: "parado", label: "Parado" },
    { value: "backlog", label: "Backlog" }
  ];
}

function teamOptions(state){
  return [{ value: "all", label: "Todas as equipes" }].concat(
    (Array.isArray(state?.teams) ? state.teams : [])
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .map((team) => ({ value: team.id, label: team.name || team.id }))
  );
}

function defaultWidgetFilters(baseData){
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 29);
  return {
    period: baseData?.period || "30d",
    clientId: "all",
    teamId: "all",
    status: "all",
    projectId: "all",
    techId: "all",
    expenseUserId: "all",
    expenseApproverId: "all",
    expenseStatus: "all",
    activityStatus: "all",
    startDate: startDate.toISOString().slice(0, 10),
    endDate
  };
}

function getDefaultWidgetFilters(cardKey, baseData){
  const defaults = defaultWidgetFilters(baseData);
  if (cardKey === "activityTech") {
    return {
      ...defaults,
      period: "all",
      clientId: "all",
      projectId: "all",
      techId: "all",
      activityStatus: "all"
    };
  }
  if (cardKey === "expenseReport") {
    return {
      ...defaults,
      period: "all",
      expenseUserId: "all",
      expenseApproverId: "all",
      expenseStatus: "all"
    };
  }
  return defaults;
}

function ensureWidgetFilters(state, baseData){
  if (!state._reportsWidgetFilters) state._reportsWidgetFilters = {};
  REPORT_CARD_KEYS.forEach((key) => {
    if (!state._reportsWidgetFilters[key]) state._reportsWidgetFilters[key] = getDefaultWidgetFilters(key, baseData);
  });
  return state._reportsWidgetFilters;
}

function syncWidgetFiltersFromGlobals(state, refs, { reset = false } = {}){
  if (!state._reportsWidgetFilters) state._reportsWidgetFilters = {};
  REPORT_CARD_KEYS.forEach((key) => {
    if (!state._reportsWidgetFilters[key] || reset) state._reportsWidgetFilters[key] = {};
    if (reset || !("period" in state._reportsWidgetFilters[key])) state._reportsWidgetFilters[key].period = refs.reportsPeriodFilter?.value || "30d";
    if (reset || !("clientId" in state._reportsWidgetFilters[key])) state._reportsWidgetFilters[key].clientId = refs.reportsClientFilter?.value || "all";
    if (reset || !("teamId" in state._reportsWidgetFilters[key])) state._reportsWidgetFilters[key].teamId = refs.reportsTeamFilter?.value || "all";
    if (reset || !("status" in state._reportsWidgetFilters[key])) state._reportsWidgetFilters[key].status = refs.reportsStatusFilter?.value || "all";
    if (reset || !("projectId" in state._reportsWidgetFilters[key])) state._reportsWidgetFilters[key].projectId = "all";
  });
}

function getCardProjectOptions(baseData, filters){
  return [{ value: "all", label: "Todos os projetos" }].concat(
    baseData.projects
      .filter((project) => {
        if (filters?.clientId && filters.clientId !== "all" && project.clientId !== filters.clientId) return false;
        if (filters?.teamId && filters.teamId !== "all" && project.teamId !== filters.teamId) return false;
        if (filters?.status && filters.status !== "all" && String(project.status || "") !== filters.status) return false;
        return true;
      })
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .map((project) => ({
        value: project.id,
        label: `${project.projectNumber ? `#${project.projectNumber} ` : ""}${project.name || "Projeto"}`
      }))
  );
}

function getTechFilterOptions(baseData, state){
  const role = String(state?.profile?.role || state?._reportsRole || "").toLowerCase();
  const currentUid = state?._reportsCurrentUid || "";
  if (role === "tecnico" && currentUid) {
    const user = (Array.isArray(state?._usersCache) ? state._usersCache : []).find((entry) => (entry.uid || entry.id) === currentUid);
    return [{ value: currentUid, label: user?.name || user?.email || "Meus dados" }];
  }
  const fromUsers = Array.isArray(state?._usersCache) ? state._usersCache : [];
  const idsFromActivities = new Set();
  baseData.activities.forEach((activity) => {
    (Array.isArray(activity.techUids) ? activity.techUids : []).forEach((uid) => {
      if (uid) idsFromActivities.add(uid);
    });
  });
  const options = fromUsers
    .filter((user) => {
      const role = String(user.role || "").toLowerCase();
      return role === "tecnico" || idsFromActivities.has(user.uid || user.id);
    })
    .map((user) => ({
      value: user.uid || user.id,
      label: user.name || user.email || user.uid || user.id
    }))
    .filter((item) => item.value);

  idsFromActivities.forEach((uid) => {
    if (!options.some((item) => item.value === uid)) options.push({ value: uid, label: uid });
  });

  return [{ value: "all", label: "Todos os tecnicos" }].concat(
    options.sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")))
  );
}

function getExpenseUserOptions(baseData){
  const usersMap = new Map();
  (baseData.expenses || []).forEach((item) => {
    const key = String(item.createdBy || item.techUid || "").trim();
    const label = getExpenseResponsibleName(item);
    if (key && !usersMap.has(key)) usersMap.set(key, label);
  });
  return [{ value: "all", label: "Todos os usuarios" }].concat(
    Array.from(usersMap.entries())
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
      .map(([value, label]) => ({ value, label }))
  );
}

function getExpenseApproverOptions(baseData){
  const approversMap = new Map();
  (baseData.expenses || []).forEach((item) => {
    const key = String(item.approvedBy || item.rejectedBy || "").trim();
    const label = getExpenseApproverName(item);
    if (key && label && label !== "-" && !approversMap.has(key)) approversMap.set(key, label);
  });
  return [{ value: "all", label: "Todos os aprovadores" }].concat(
    Array.from(approversMap.entries())
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
      .map(([value, label]) => ({ value, label }))
  );
}

function getOptionLabel(options, value, fallback = "Todos"){
  const raw = String(value || "all");
  if (raw === "all") return fallback;
  return options.find((item) => String(item.value) === raw)?.label || raw;
}

function getScopedData(baseData, filters){
  const period = filters?.period || baseData.period || "30d";
  const clientId = filters?.clientId || "all";
  const teamId = filters?.teamId || "all";
  const status = filters?.status || "all";
  const projectId = filters?.projectId || "all";
  const techId = filters?.techId || "all";
  const activityStatus = filters?.activityStatus || "all";
  const fallbackRange = getPeriodRange(baseData.period || "30d");
  const customStart = parseDateOnly(filters?.startDate);
  const customEnd = parseDateOnly(filters?.endDate);
  const { start, end } = period === "custom"
    ? {
      start: customStart || fallbackRange.start,
      end: customEnd || fallbackRange.end
    }
    : getPeriodRange(period);

  const projects = baseData.projects.filter((project) => {
    if (clientId !== "all" && project.clientId !== clientId) return false;
    if (teamId !== "all" && project.teamId !== teamId) return false;
    if (status !== "all" && String(project.status || "") !== status) return false;
    if (projectId !== "all" && project.id !== projectId) return false;
    return true;
  });
  const projectIds = new Set(projects.map((project) => project.id));

  const tasks = baseData.tasks.filter((task) => {
    if (!projectIds.has(task.projectId)) return false;
    if (period === "all") return true;
    return overlap(parseDateOnly(task.startDate), parseDateOnly(task.endDate), start, end);
  });

  const activities = baseData.activities.filter((activity) => {
    if (!projectIds.has(activity.projectId)) return false;
    if (period === "all") return true;
    return inRange(parseDateOnly(activity.workDate), start, end);
  }).filter((activity) => {
    if (!matchesActivityStatus(activity, activityStatus)) return false;
    if (techId === "all") return true;
    return Array.isArray(activity.techUids) && activity.techUids.includes(techId);
  });

  return {
    period,
    projects,
    tasks,
    activities,
    techId,
    activityStatus,
    startDate: period === "custom" ? (filters?.startDate || "") : "",
    endDate: period === "custom" ? (filters?.endDate || "") : ""
  };
}

function getExpenseReportRows(baseData, filters){
  const period = filters?.period || "all";
  const fallbackRange = getPeriodRange(baseData.period || "30d");
  const customStart = parseDateOnly(filters?.startDate);
  const customEnd = parseDateOnly(filters?.endDate);
  const { start, end } = period === "custom"
    ? {
      start: customStart || fallbackRange.start,
      end: customEnd || fallbackRange.end
    }
    : getPeriodRange(period);
  const expenseUserId = filters?.expenseUserId || "all";
  const expenseApproverId = filters?.expenseApproverId || "all";
  const expenseStatus = filters?.expenseStatus || "all";

  return (baseData.expenses || [])
    .filter((item) => {
      const workDate = parseDateOnly(item.workDate);
      if (period !== "all" && !inRange(workDate, start, end)) return false;
      if (expenseUserId !== "all" && ![item.createdBy, item.techUid].includes(expenseUserId)) return false;
      if (expenseApproverId !== "all" && ![item.approvedBy, item.rejectedBy].includes(expenseApproverId)) return false;
      if (expenseStatus !== "all" && String(item.status || "pending").toLowerCase() !== expenseStatus) return false;
      return true;
    })
    .sort((a, b) => {
      const aDate = String(a.workDate || "");
      const bDate = String(b.workDate || "");
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      const aCreated = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bCreated = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bCreated - aCreated;
    });
}

function buildExpenseExportRows(rows){
  return rows.map((item) => ({
    responsible: getExpenseResponsibleName(item),
    approver: getExpenseApproverName(item),
    type: expenseTypeLabel(item.type),
    amount: formatCurrency(item.amount),
    amountValue: asNumber(item.amount),
    expenseDate: formatExpenseDate(item.workDate),
    approvalDate: getExpenseApprovalDateLabel(item),
    status: expenseStatusLabel(item.status),
    project: item.projectName || "-",
    task: item.taskName || "-",
    source: expenseSourceLabel(item.source)
  }));
}

function buildCardFilterBar(baseData, state, cardKey){
  const filters = ensureWidgetFilters(state, baseData)[cardKey] || defaultWidgetFilters(baseData);
  const config = CARD_FILTER_CONFIG[cardKey] || ["period", "clientId", "projectId"];
  const projectOptions = getCardProjectOptions(baseData, filters);
  const projectValues = new Set(projectOptions.map((opt) => opt.value));
  if (!projectValues.has(filters.projectId)) filters.projectId = "all";

  const optionsMap = {
    period: [
      { value: "30d", label: "30 dias" },
      { value: "90d", label: "90 dias" },
      { value: "year", label: "12 meses" },
      { value: "custom", label: "Periodo especifico" },
      { value: "all", label: "Historico" }
    ],
    clientId: [{ value: "all", label: "Todos os clientes" }].concat(
      baseData.clients
        .slice()
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        .map((client) => ({ value: client.id, label: client.name || client.id }))
    ),
    teamId: teamOptions(state),
    status: statusOptions(),
    projectId: projectOptions,
    techId: getTechFilterOptions(baseData, state),
    expenseUserId: getExpenseUserOptions(baseData),
    expenseApproverId: getExpenseApproverOptions(baseData),
    expenseStatus: [
      { value: "all", label: "Todos os status" },
      { value: "pending", label: "Pendentes" },
      { value: "approved", label: "Aprovadas" },
      { value: "rejected", label: "Reprovadas" }
    ],
    activityStatus: [
      { value: "all", label: "Todos os status" },
      { value: "pending", label: "Planejada / sem OS" },
      { value: "os_gerada", label: "OS enviada" },
      { value: "os_aprovada", label: "OS aprovada" },
      { value: "overdue", label: "Atrasada" }
    ]
  };

  const labelMap = {
    period: "Periodo",
    clientId: "Cliente",
    teamId: "Equipe",
    status: "Status",
    projectId: "Projeto",
    techId: "Tecnico",
    expenseUserId: "Usuario",
    expenseApproverId: "Aprovador",
    expenseStatus: "Status",
    activityStatus: "Status da atividade"
  };

  const renderOptions = (options, selected) => options.map((opt) => `<option value="${escapeHtml(opt.value)}"${opt.value === selected ? " selected" : ""}>${escapeHtml(opt.label)}</option>`).join("");
  const renderActivityStatusField = () => {
    const selectedStatuses = Array.isArray(filters.activityStatus)
      ? filters.activityStatus.map((item) => String(item))
      : [String(filters.activityStatus || "all")];
    const normalized = selectedStatuses.length ? selectedStatuses : ["all"];
    return `
      <fieldset class="reports-inline-field reports-inline-field--multi">
        <legend>${escapeHtml(labelMap.activityStatus)}</legend>
        <div class="reports-multi-checks" data-report-card="${escapeHtml(cardKey)}" data-report-filter="activityStatus">
          ${(optionsMap.activityStatus || []).map((opt) => `
            <label>
              <input
                type="checkbox"
                value="${escapeHtml(opt.value)}"
                data-report-card="${escapeHtml(cardKey)}"
                data-report-filter="activityStatus"
                data-report-filter-multi="true"
                ${normalized.includes(opt.value) ? "checked" : ""}
              />
              <span>${escapeHtml(opt.label)}</span>
            </label>
          `).join("")}
        </div>
      </fieldset>
    `;
  };
  const renderField = (filterKey) => `
    <label class="reports-inline-field${filterKey === "projectId" ? " reports-inline-field--project" : ""}">
      <span>${escapeHtml(labelMap[filterKey] || filterKey)}</span>
      <select data-report-card="${escapeHtml(cardKey)}" data-report-filter="${escapeHtml(filterKey)}">
        ${renderOptions(optionsMap[filterKey] || [], filters[filterKey] || "all")}
      </select>
    </label>
  `;
  const periodField = config.includes("period") ? renderField("period") : "";
  const otherFields = config
    .filter((filterKey) => filterKey !== "period")
    .map((filterKey) => filterKey === "activityStatus" ? renderActivityStatusField() : renderField(filterKey))
    .join("");

  return `
    <div class="reports-card-controls reports-card-controls--${escapeHtml(config.length)}" data-report-card="${escapeHtml(cardKey)}">
      ${periodField}
      ${config.includes("period") && filters.period === "custom" ? `
        <label class="reports-inline-field reports-inline-field--date">
          <span>De</span>
          <input type="date" value="${escapeHtml(filters.startDate || "")}" data-report-card="${escapeHtml(cardKey)}" data-report-filter="startDate" />
        </label>
        <label class="reports-inline-field reports-inline-field--date">
          <span>Ate</span>
          <input type="date" value="${escapeHtml(filters.endDate || "")}" data-report-card="${escapeHtml(cardKey)}" data-report-filter="endDate" />
        </label>
      ` : ""}
      ${otherFields}
    </div>
  `;
}

function buildReportExportTools(reportKey){
  return `
    <div class="reports-card-tools reports-card-tools--export">
      <button class="btn ghost sm reports-card-filter-btn" data-export-card="${escapeHtml(reportKey)}" data-export-type="excel" type="button" aria-label="Exportar este relatorio em Excel">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="m9 15 2-3 2 3m-4 0 2 3 2-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Excel</span>
      </button>
      <button class="btn ghost sm reports-card-filter-btn" data-export-card="${escapeHtml(reportKey)}" data-export-type="pdf" type="button" aria-label="Exportar este relatorio em PDF">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M8 16h8M8 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span>PDF</span>
      </button>
    </div>
  `;
}

function openReportActivitiesModal(refs){
  if (!refs.modalReportActivities) return;
  refs.modalReportActivities.hidden = false;
}

function closeReportActivitiesModal(refs){
  if (!refs.modalReportActivities) return;
  refs.modalReportActivities.hidden = true;
}

function renderReportActivitiesModal(metricKey, refs, state, cache){
  if (!refs.reportActivitiesList || !refs.reportActivitiesSummary) return;
  const modalData = state?._reportsMetricActivityMap?.[metricKey];
  const activities = Array.isArray(modalData?.activities) ? modalData.activities : [];
  const tasksById = Object.fromEntries((cache?.tasks || []).map((task) => [task.id, task]));
  const projectsById = Object.fromEntries((cache?.projects || []).map((project) => [project.id, project]));
  const usersByUid = new Map((state?._usersCache || []).map((user) => [user.uid, user]));
  const completedCount = activities.filter((activity) => isCompletedActivity(activity)).length;
  const pendingCount = activities.length - completedCount;
  const totalHours = activities.reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);

  if (refs.reportActivitiesModalTitle) refs.reportActivitiesModalTitle.textContent = modalData?.title || "Atividades do indicador";
  if (refs.reportActivitiesModalSubtitle) refs.reportActivitiesModalSubtitle.textContent = modalData?.subtitle || "Lista detalhada das atividades encontradas com os filtros atuais.";
  refs.reportActivitiesSummary.innerHTML = `
    <article class="reports-activities-stat">
      <span class="reports-activities-stat-label">Atividades</span>
      <strong>${escapeHtml(String(activities.length))}</strong>
    </article>
    <article class="reports-activities-stat">
      <span class="reports-activities-stat-label">Horas</span>
      <strong>${escapeHtml(formatHours(totalHours))}</strong>
    </article>
    <article class="reports-activities-stat">
      <span class="reports-activities-stat-label">Pendentes</span>
      <strong>${escapeHtml(String(pendingCount))}</strong>
    </article>
  `;

  if (!activities.length){
    refs.reportActivitiesList.innerHTML = `<div class="panel subtle"><p class="muted">Nenhuma atividade encontrada para este indicador com os filtros atuais.</p></div>`;
    return;
  }

  refs.reportActivitiesList.innerHTML = activities
    .slice()
    .sort((a, b) => {
      const direction = String(metricKey || "").startsWith("schedule-") ? 1 : -1;
      return direction * String(a.workDate || "").localeCompare(String(b.workDate || ""));
    })
    .map((activity) => {
      const project = projectsById[activity.projectId];
      const task = tasksById[activity.taskId];
      const manager = usersByUid.get(project?.managerUid) || {};
      const date = parseDateOnly(activity.workDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isOverdue = Boolean(date && date < today && isPendingOsActivity(activity));
      const tone = isOverdue ? "red" : (isCompletedActivity(activity) ? "green" : "orange");
      const statusLabel = isOverdue ? "Atrasada" : (isCompletedActivity(activity) ? "OS Gerada/Aprovada" : "Sem OS");
      const techNames = Array.isArray(activity.techNames) && activity.techNames.length ? activity.techNames.join(", ") : "Sem tecnico";
      const clientName = project?.clientName || project?.client?.name || activity.clientName || "Sem cliente";
      const managerName = manager.name || manager.email || project?.managerName || project?.manager?.name || "Sem gestor";
      return `
        <article class="reports-activity-item">
          <div class="reports-activity-item-top">
            <div>
              <strong>${escapeHtml(activity.name || "Atividade")}</strong>
              <span>${escapeHtml(project?.name || "Projeto")} • ${escapeHtml(task?.name || activity.taskName || "Tarefa")}</span>
            </div>
            <span class="reports-pill reports-pill--${escapeHtml(tone)}">${escapeHtml(statusLabel)}</span>
          </div>
          <div class="reports-activity-item-meta">
            <span>Data: ${escapeHtml(formatDateBr(activity.workDate))}</span>
            <span>Horas: ${escapeHtml(formatHours(activity.hoursWorked))}</span>
            <span>Tecnico: ${escapeHtml(techNames)}</span>
            <span>Cliente: ${escapeHtml(clientName)}</span>
            <span>Gestor: ${escapeHtml(managerName)}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function buildActivityTechRows(activityTechData, cache, state){
  const isTech = String(state?.profile?.role || state?._reportsRole || "").toLowerCase() === "tecnico";
  const currentUid = state?._reportsCurrentUid || "";
  const usersByUid = new Map(((cache?.users || state?._usersCache || [])).map((user) => [user.uid || user.id, user]));
  const tasksById = Object.fromEntries((cache?.tasks || []).map((task) => [task.id, task]));
  const projectsById = Object.fromEntries((cache?.projects || []).map((project) => [project.id, project]));
  const clientsById = Object.fromEntries((cache?.clients || []).map((client) => [client.id, client]));

  return activityTechData.activities.flatMap((activity) => {
    const allTechIds = Array.isArray(activity.techUids) && activity.techUids.length ? activity.techUids : [activity.techUid || ""];
    const techIds = isTech && currentUid ? allTechIds.filter((uid) => uid === currentUid) : allTechIds;
    if (!techIds.length) return [];
    const techNames = Array.isArray(activity.techNames) ? activity.techNames : [];
    return techIds.map((techUid, index) => {
      const user = usersByUid.get(techUid) || {};
      const project = projectsById[activity.projectId] || {};
      const task = tasksById[activity.taskId] || {};
      const plannedHours = asNumber(activity.hoursWorked);
      const pointedHours = getPointedHours(activity);
      const hourlyRate = asNumber(user.hourlyRate);
      const amount = hourlyRate * pointedHours;
      return {
        id: `${activity.id}-${techUid || index}`,
        date: activity.workDate || "",
        techUid,
        techName: user.name || user.email || techNames[index] || techNames[0] || "Sem tecnico",
        hourlyRate,
        projectName: project.name || activity.projectName || "Projeto",
        clientName: clientsById[project.clientId]?.name || project.clientName || activity.clientName || "Sem cliente",
        taskName: task.name || activity.taskName || "Tarefa",
        activityName: activity.name || "Atividade",
        status: activityStatusLabel(activity),
        plannedHours,
        pointedHours,
        amount,
        note: activity.note || activity.observation || activity.obs || "-"
      };
    });
  }).sort((a, b) => String(a.techName || "").localeCompare(String(b.techName || "")) || String(a.date || "").localeCompare(String(b.date || "")));
}

function getPeriodExportLabel(data, periodLabelMap){
  if (data.period === "custom") return `${formatDateBr(data.startDate)} a ${formatDateBr(data.endDate)}`;
  return periodLabelMap[data.period] || data.period || "Periodo";
}

function buildActivityExportRows(activities, scopedData, cache, state){
  const tasksById = Object.fromEntries((cache?.tasks || []).map((task) => [task.id, task]));
  const projectsById = Object.fromEntries((scopedData?.projects || cache?.projects || []).map((project) => [project.id, project]));
  const usersByUid = new Map(((cache?.users || state?._usersCache || [])).map((user) => [user.uid || user.id, user]));
  return (activities || []).map((activity) => {
    const project = projectsById[activity.projectId] || {};
    const task = tasksById[activity.taskId] || {};
    const techNames = Array.isArray(activity.techUids) && activity.techUids.length
      ? activity.techUids.map((uid) => usersByUid.get(uid)?.name || usersByUid.get(uid)?.email || uid).join(", ")
      : (Array.isArray(activity.techNames) && activity.techNames.length ? activity.techNames.join(", ") : "Sem tecnico");
    return {
      date: formatDateBr(activity.workDate),
      project: project.name || activity.projectName || "Projeto",
      task: task.name || activity.taskName || "Tarefa",
      activity: activity.name || "Atividade",
      tech: techNames,
      status: activityStatusLabel(activity),
      hours: formatHours(activity.hoursWorked)
    };
  });
}

function buildReportsExportPayloads({
  cache,
  state,
  clientsById,
  periodLabelMap,
  overviewData,
  overviewPlannedHours,
  overviewWorkedHours,
  overviewPending,
  metricsData,
  metricsCompleted,
  metricsPending,
  metricsOverdue,
  deliveryOnTime,
  statusCounts,
  executionPlannedHours,
  executionWorkedHours,
  executionOverdue,
  executionProgress,
  topClients,
  scheduleData,
  scheduleProjectHours,
  schedulePlannedHours,
  scheduleExecutedHours,
  scheduleProgress,
  schedulePlannedActivities,
  scheduleExecutedActivities,
  scheduleOverdueActivities,
  scheduleUpcomingActivities,
  activityTechRows,
  activityTechTotals,
  activityTechHeaderName,
  activityTechHeaderRate,
  expenseRows,
  expenseFilters,
  expenseUserLabel,
  expenseApproverLabel
}){
  const generatedAtLabel = new Date().toLocaleString("pt-BR");
  const suffix = new Date().toISOString().slice(0, 10);
  const activityColumns = [
    { key: "date", label: "Data", width: .7 },
    { key: "project", label: "Projeto", width: 1.4 },
    { key: "task", label: "Tarefa", width: 1.1 },
    { key: "activity", label: "Atividade", width: 1.5 },
    { key: "tech", label: "Tecnico", width: 1.1 },
    { key: "status", label: "Status", width: .8 },
    { key: "hours", label: "Horas", width: .55 }
  ];
  return {
    overview: {
      title: "Painel consolidado de projetos",
      subtitle: `Periodo analisado: ${getPeriodExportLabel(overviewData, periodLabelMap)}`,
      generatedAtLabel,
      fileName: `painel-consolidado-${suffix}`,
      summary: [
        { label: "Projetos monitorados", value: String(overviewData.projects.length) },
        { label: "Horas previstas", value: formatHours(overviewPlannedHours) },
        { label: "Horas executadas", value: formatHours(overviewWorkedHours) },
        { label: "Atividades pendentes", value: String(overviewPending) }
      ],
      tables: [{
        title: "Projetos",
        columns: [
          { key: "project", label: "Projeto", width: 1.6 },
          { key: "client", label: "Cliente", width: 1.2 },
          { key: "status", label: "Status", width: .8 },
          { key: "hours", label: "Horas do projeto", width: .8 }
        ],
        rows: overviewData.projects.map((project) => ({
          project: project.name || "Projeto",
          client: clientsById?.[project.clientId]?.name || project.clientName || "Sem cliente",
          status: statusInfo(project.status).label,
          hours: formatHours(getProjectPlannedHours(project))
        }))
      }]
    },
    metrics: {
      title: "Saude operacional do periodo",
      subtitle: `Periodo analisado: ${getPeriodExportLabel(metricsData, periodLabelMap)}`,
      generatedAtLabel,
      fileName: `saude-operacional-${suffix}`,
      summary: [
        { label: "Atividades concluidas", value: String(metricsCompleted) },
        { label: "Atividades pendentes", value: String(metricsPending) },
        { label: "Atividades atrasadas", value: String(metricsOverdue) },
        { label: "Entrega no prazo", value: formatPercent(deliveryOnTime) }
      ],
      tables: [{
        title: "Atividades do periodo",
        columns: activityColumns,
        rows: buildActivityExportRows(metricsData.activities, metricsData, cache, state)
      }]
    },
    statuses: {
      title: "Projetos por status",
      subtitle: "Distribuicao da carteira de projetos",
      generatedAtLabel,
      fileName: `projetos-por-status-${suffix}`,
      summary: [{ label: "Projetos", value: String(statusCounts.reduce((acc, item) => acc + item.count, 0)) }],
      tables: [{
        title: "Status",
        columns: [
          { key: "status", label: "Status", width: 1.4 },
          { key: "count", label: "Quantidade", width: .7 }
        ],
        rows: statusCounts.map((item) => ({ status: statusInfo(item.status).label, count: String(item.count) }))
      }]
    },
    execution: {
      title: "Horas previstas x executadas",
      subtitle: "Comparativo de consumo de horas por periodo",
      generatedAtLabel,
      fileName: `horas-previstas-executadas-${suffix}`,
      summary: [
        { label: "Horas previstas", value: formatHours(executionPlannedHours) },
        { label: "Horas executadas", value: formatHours(executionWorkedHours) },
        { label: "Consumo", value: formatPercent(executionProgress) },
        { label: "Atrasadas sem OS", value: String(executionOverdue) }
      ],
      tables: [{
        title: "Resumo",
        columns: [
          { key: "metric", label: "Indicador", width: 1.5 },
          { key: "value", label: "Valor", width: 1 }
        ],
        rows: [
          { metric: "Horas previstas dos projetos", value: formatHours(executionPlannedHours) },
          { metric: "Horas executadas com OS", value: formatHours(executionWorkedHours) },
          { metric: "Atividades atrasadas sem OS", value: String(executionOverdue) },
          { metric: "Percentual de consumo", value: formatPercent(executionProgress) }
        ]
      }]
    },
    clients: {
      title: "Clientes com maior volume executado",
      subtitle: "Ranking de carga por cliente",
      generatedAtLabel,
      fileName: `clientes-volume-executado-${suffix}`,
      summary: [{ label: "Clientes listados", value: String(topClients.length) }],
      tables: [{
        title: "Clientes",
        columns: [
          { key: "client", label: "Cliente", width: 1.6 },
          { key: "activities", label: "Atividades", width: .8 },
          { key: "hours", label: "Horas", width: .8 }
        ],
        rows: topClients.map((item) => ({
          client: item.clientName,
          activities: String(item.activities),
          hours: formatHours(item.hours)
        }))
      }]
    },
    schedule: {
      title: "Cronograma de projeto por periodo",
      subtitle: `Periodo analisado: ${getPeriodExportLabel(scheduleData, periodLabelMap)}`,
      generatedAtLabel,
      fileName: `cronograma-projeto-periodo-${suffix}`,
      summary: [
        { label: "Horas do projeto", value: formatHours(scheduleProjectHours) },
        { label: "Horas planejadas", value: formatHours(schedulePlannedHours) },
        { label: "Horas executadas", value: formatHours(scheduleExecutedHours) },
        { label: "Progresso", value: formatPercent(scheduleProgress) }
      ],
      tables: [{
        title: "Atividades do cronograma",
        columns: activityColumns,
        rows: buildActivityExportRows(schedulePlannedActivities, scheduleData, cache, state)
      }, {
        title: "Resumo por status do cronograma",
        columns: [
          { key: "status", label: "Status", width: 1.3 },
          { key: "count", label: "Quantidade", width: .8 }
        ],
        rows: [
          { status: "Planejadas", count: String(schedulePlannedActivities.length) },
          { status: "Executadas", count: String(scheduleExecutedActivities.length) },
          { status: "Atrasadas", count: String(scheduleOverdueActivities.length) },
          { status: "Proximas", count: String(scheduleUpcomingActivities.length) }
        ]
      }]
    },
    activityTech: {
      title: "Relatorio de Atividade x Tecnico",
      subtitle: `Tecnico: ${activityTechHeaderName} | Valor hora: ${activityTechHeaderRate}`,
      generatedAtLabel,
      fileName: `atividade-x-tecnico-${suffix}`,
      summary: [
        { label: "Registros", value: String(activityTechRows.length) },
        { label: "Horas atividade", value: formatHours(activityTechTotals.plannedHours) },
        { label: "Horas apontadas", value: formatHours(activityTechTotals.pointedHours) },
        { label: "Valor", value: formatCurrency(activityTechTotals.amount) }
      ],
      tables: [{
        title: "Atividades",
        rowHeight: 11,
        pdfColumns: [
          { key: "tech", label: "Tecnico", width: 1 },
          { key: "project", label: "Projeto", width: 1.25 },
          { key: "task", label: "Tarefa", width: 1.05 },
          { key: "activity", label: "Atividade", width: 1.25 },
          { key: "status", label: "Status", width: .85 },
          { key: "planned", label: "H. atividade", width: .75 },
          { key: "pointed", label: "H. apontadas", width: .8 },
          { key: "amount", label: "Valor", width: .85 }
        ],
        columns: [
          { key: "tech", label: "Tecnico", width: .9 },
          { key: "project", label: "Projeto", width: 1.1 },
          { key: "task", label: "Tarefa", width: 1 },
          { key: "activity", label: "Atividade", width: 1.1 },
          { key: "status", label: "Status", width: .75 },
          { key: "planned", label: "H. atividade", width: .65 },
          { key: "pointed", label: "H. apontadas", width: .75 },
          { key: "amount", label: "Valor", width: .75 },
          { key: "note", label: "Observacao", width: 1.4 }
        ],
        rows: activityTechRows.map((row) => ({
          tech: row.techName,
          project: row.projectName,
          task: row.taskName,
          activity: `${row.activityName} (${formatDateBr(row.date)})`,
          status: row.status,
          planned: formatHours(row.plannedHours),
          pointed: formatHours(row.pointedHours),
          amount: formatCurrency(row.amount),
          note: row.note || "-"
        }))
      }]
    },
    expenseReport: {
      title: "Relatorio de Despesas",
      subtitle: `Periodo analisado: ${getPeriodExportLabel(expenseFilters || { period: "all" }, periodLabelMap)}`,
      generatedAtLabel,
      fileName: `relatorio-despesas-${suffix}`,
      meta: [
        { label: "Periodo", value: getPeriodExportLabel(expenseFilters || { period: "all" }, periodLabelMap) },
        { label: "Usuario", value: expenseUserLabel || "Todos os usuarios" },
        { label: "Aprovador", value: expenseApproverLabel || "Todos os aprovadores" },
        { label: "Status", value: expenseStatusLabel(expenseFilters?.expenseStatus || "all") },
        { label: "Observacao", value: "Valores exportados como numero para permitir soma, filtro e tabela dinamica no Excel." }
      ],
      summary: [
        { label: "Registros", value: String(expenseRows.length) },
        { label: "Valor total", value: formatCurrency(expenseRows.reduce((sum, item) => sum + asNumber(item.amount), 0)) },
        { label: "Valor aprovado", value: formatCurrency(expenseRows.filter((item) => String(item.status || "").toLowerCase() === "approved").reduce((sum, item) => sum + asNumber(item.amount), 0)) }
      ],
      tables: [{
        title: "Despesas",
        rowHeight: 10,
        pdfColumns: [
          { key: "responsible", label: "Responsavel", width: 1.25 },
          { key: "approver", label: "Aprovador", width: 1.05 },
          { key: "type", label: "Tipo", width: .8 },
          { key: "amount", label: "Valor", width: .85 },
          { key: "expenseDate", label: "Data desp.", width: .8 },
          { key: "approvalDate", label: "Data aprov.", width: .8 },
          { key: "status", label: "Status", width: .85 }
        ],
        excelColumns: [
          { key: "responsible", label: "Responsavel", width: 1.2 },
          { key: "approver", label: "Aprovador", width: 1 },
          { key: "type", label: "Tipo da despesa", width: .9 },
          { key: "amountValue", label: "Valor da despesa", width: .9, type: "currency", align: "right" },
          { key: "expenseDate", label: "Data da despesa", width: .85, type: "date" },
          { key: "approvalDate", label: "Data da aprovacao", width: .85 },
          { key: "status", label: "Status", width: .8 },
          { key: "project", label: "Projeto", width: 1.25 },
          { key: "task", label: "Tarefa", width: 1 },
          { key: "source", label: "Origem", width: .75 }
        ],
        columns: [
          { key: "responsible", label: "Responsavel", width: 1.2 },
          { key: "approver", label: "Aprovador", width: 1 },
          { key: "type", label: "Tipo da despesa", width: .9 },
          { key: "amount", label: "Valor da despesa", width: .9 },
          { key: "expenseDate", label: "Data da despesa", width: .85 },
          { key: "approvalDate", label: "Data da aprovacao", width: .85 },
          { key: "status", label: "Status", width: .8 },
          { key: "project", label: "Projeto", width: 1.25 }
        ],
        rows: buildExpenseExportRows(expenseRows),
        footerRows: [{
          responsible: "Total",
          amountValue: expenseRows.reduce((sum, item) => sum + asNumber(item.amount), 0)
        }]
      }]
    }
  };
}

function buildExecutiveExportPayload({
  state,
  overviewData,
  overviewPlannedHours,
  overviewWorkedHours,
  overviewPlannedPendingHours,
  deliveryOnTime,
  statusCounts,
  topClients,
  clientsById,
  today
}){
  const usersByUid = new Map((state?._usersCache || []).map((user) => [user.uid, user]));
  const tasksByProject = new Map();
  overviewData.tasks.forEach((task) => {
    const list = tasksByProject.get(task.projectId) || [];
    list.push(task);
    tasksByProject.set(task.projectId, list);
  });
  const activitiesByProject = new Map();
  overviewData.activities.forEach((activity) => {
    const list = activitiesByProject.get(activity.projectId) || [];
    list.push(activity);
    activitiesByProject.set(activity.projectId, list);
  });

  const projectRows = overviewData.projects.map((project) => {
    const projectActivities = activitiesByProject.get(project.id) || [];
    const clientName = clientsById[project.clientId]?.name || project.clientName || "Sem cliente";
    const manager = usersByUid.get(project.managerUid) || {};
    const managerName = manager.name || manager.email || project.managerName || project.manager?.name || "Sem gestor";
    const executedHours = projectActivities
      .filter((activity) => isCompletedActivity(activity))
      .reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
    const pendingActivities = projectActivities.filter((activity) => isPendingOsActivity(activity)).length;
    const overdueActivities = projectActivities.filter((activity) => {
      const date = parseDateOnly(activity.workDate);
      return date && date < today && isPendingOsActivity(activity);
    }).length;
    return {
      number: project.projectNumber ? `#${project.projectNumber}` : "-",
      name: project.name || "Projeto",
      client: clientName,
      manager: managerName,
      status: statusInfo(project.status).label,
      plannedHours: getProjectPlannedHours(project),
      executedHours,
      pendingActivities,
      overdueActivities,
      taskCount: (tasksByProject.get(project.id) || []).length
    };
  }).sort((a, b) => b.overdueActivities - a.overdueActivities || b.pendingActivities - a.pendingActivities || b.executedHours - a.executedHours);

  const periodLabel = overviewData.period === "custom"
    ? `${formatDateBr(overviewData.startDate)} a ${formatDateBr(overviewData.endDate)}`
    : ({
      "30d": "Ultimos 30 dias",
      "90d": "Ultimos 90 dias",
      year: "Ultimos 12 meses",
      all: "Historico completo"
    }[overviewData.period] || overviewData.period);

  return {
    fileSuffix: `${overviewData.period || "relatorio"}-${new Date().toISOString().slice(0, 10)}`,
    generatedAtLabel: new Date().toLocaleString("pt-BR"),
    periodLabel: `Periodo analisado: ${periodLabel}`,
    executiveSummary: `${overviewData.projects.length} projeto(s) monitorado(s), ${formatHours(overviewPlannedHours)} previstas, ${formatHours(overviewWorkedHours)} executadas com OS e ${formatHours(overviewPlannedPendingHours)} em atividades atrasadas sem OS.`,
    summary: {
      projects: overviewData.projects.length,
      plannedHours: overviewPlannedHours,
      executedHours: overviewWorkedHours,
      pendingPlannedHours: overviewPlannedPendingHours,
      deliveryOnTime
    },
    projectRows,
    statusCounts: statusCounts.map((item) => ({
      label: statusInfo(item.status).label,
      count: item.count
    })),
    topClients: topClients.slice(0, 5)
  };
}

function renderReports(cache, refs, state){
  if (!refs.reportsGrid) return;

  const visibleReports = new Set(getVisibleReportKeys(state));
  if (!visibleReports.size) {
    refs.reportsGrid.innerHTML = `<section class="reports-card reports-card--loading"><p class="muted">Nenhum relatorio esta habilitado para o seu perfil. Fale com o admin da empresa.</p></section>`;
    return;
  }

  const baseData = getBaseFilteredData(cache, refs);
  ensureWidgetFilters(state, baseData);
  if (String(state?.profile?.role || state?._reportsRole || "").toLowerCase() === "tecnico" && state?._reportsCurrentUid) {
    state._reportsWidgetFilters.activityTech.techId = state._reportsCurrentUid;
    state._reportsWidgetFilters.expenseReport.expenseUserId = state._reportsCurrentUid;
  }
  const clientsById = Object.fromEntries(cache.clients.map((client) => [client.id, client]));
  const tasksById = Object.fromEntries(baseData.tasks.map((task) => [task.id, task]));
  const periodLabelMap = {
    "30d": "Ultimos 30 dias",
    "90d": "Ultimos 90 dias",
    year: "Ultimos 12 meses",
    custom: "Periodo especifico",
    all: "Historico completo"
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overviewData = getScopedData(baseData, state._reportsWidgetFilters.overview);
  const metricsData = getScopedData(baseData, state._reportsWidgetFilters.metrics);
  const statusesData = getScopedData(baseData, state._reportsWidgetFilters.statuses);
  const executionData = getScopedData(baseData, state._reportsWidgetFilters.execution);
  const clientsData = getScopedData(baseData, state._reportsWidgetFilters.clients);
  const scheduleData = getScopedData(baseData, state._reportsWidgetFilters.schedule);
  const activityTechData = getScopedData(baseData, state._reportsWidgetFilters.activityTech);
  const operationalDrilldown = getOperationalDrilldownMeta(state);

  const overviewPlannedHours = overviewData.projects.reduce((acc, project) => acc + getProjectPlannedHours(project), 0);
  const overviewWorkedHours = overviewData.activities
    .filter((activity) => isCompletedActivity(activity))
    .reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const overviewCompleted = overviewData.activities.filter((activity) => isCompletedActivity(activity)).length;
  const overviewPending = overviewData.activities.length - overviewCompleted;
  const overviewOverdueActivities = overviewData.activities.filter((activity) => {
    const date = parseDateOnly(activity.workDate);
    return date && date < today && isPendingOsActivity(activity);
  });
  const overviewOverdue = overviewOverdueActivities.length;
  const overviewPlannedPendingHours = overviewOverdueActivities.reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const overviewAvgHoursPerTask = overviewData.tasks.length ? (overviewWorkedHours / overviewData.tasks.length) : 0;

  const metricsCompleted = metricsData.activities.filter((activity) => isCompletedActivity(activity)).length;
  const metricsPending = metricsData.activities.length - metricsCompleted;
  const metricsOverdueActivities = metricsData.activities.filter((activity) => {
    const date = parseDateOnly(activity.workDate);
    return date && date < today && !isCompletedActivity(activity);
  });
  const metricsOverdue = metricsOverdueActivities.length;
  const deliveryOnTime = metricsData.activities.length ? Math.max(0, ((metricsData.activities.length - metricsOverdue) / metricsData.activities.length) * 100) : 0;
  const metricsCompletedActivities = metricsData.activities.filter((activity) => isCompletedActivity(activity));
  const metricsPendingActivities = metricsData.activities.filter((activity) => !isCompletedActivity(activity));
  const metricsOnTimeActivities = metricsData.activities.filter((activity) => !metricsOverdueActivities.includes(activity));

  const scheduleProjectHours = scheduleData.projects.reduce((acc, project) => acc + getProjectPlannedHours(project), 0);
  const schedulePlannedActivities = scheduleData.activities.slice().sort((a, b) => String(a.workDate || "").localeCompare(String(b.workDate || "")));
  const scheduleExecutedActivities = schedulePlannedActivities.filter((activity) => isCompletedActivity(activity));
  const scheduleOverdueActivities = schedulePlannedActivities.filter((activity) => {
    const date = parseDateOnly(activity.workDate);
    return date && date < today && isPendingOsActivity(activity);
  });
  const scheduleUpcomingActivities = schedulePlannedActivities.filter((activity) => {
    const date = parseDateOnly(activity.workDate);
    return date && date >= today && isPendingOsActivity(activity);
  });
  const schedulePlannedHours = schedulePlannedActivities.reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const scheduleExecutedHours = scheduleExecutedActivities.reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const scheduleProgress = Math.min(100, schedulePlannedHours > 0 ? (scheduleExecutedHours / schedulePlannedHours) * 100 : 0);
  const scheduleMaxCount = Math.max(
    1,
    schedulePlannedActivities.length,
    scheduleExecutedActivities.length,
    scheduleOverdueActivities.length,
    scheduleUpcomingActivities.length
  );
  const activityTechRows = buildActivityTechRows(activityTechData, cache, state);
  const activityTechTotals = activityTechRows.reduce((acc, row) => {
    acc.plannedHours += row.plannedHours;
    acc.pointedHours += row.pointedHours;
    acc.amount += row.amount;
    return acc;
  }, { plannedHours: 0, pointedHours: 0, amount: 0 });
  const activityTechFilters = state._reportsWidgetFilters.activityTech || {};
  const activityTechSelected = activityTechFilters.techId && activityTechFilters.techId !== "all"
    ? (cache.users || []).find((user) => (user.uid || user.id) === activityTechFilters.techId)
    : null;
  const activityTechSelf = String(state?.profile?.role || state?._reportsRole || "").toLowerCase() === "tecnico"
    ? (cache.users || []).find((user) => (user.uid || user.id) === state?._reportsCurrentUid)
    : null;
  const activityTechHeaderName = activityTechSelf?.name || activityTechSelf?.email || activityTechSelected?.name || activityTechSelected?.email || "Todos os tecnicos";
  const activityTechHeaderRate = activityTechSelected
    ? formatCurrency(activityTechSelected.hourlyRate)
    : "Valores por tecnico na lista";
  const activityTechTotalPages = Math.max(1, Math.ceil(activityTechRows.length / ACTIVITY_TECH_PAGE_SIZE));
  const activityTechCurrentPage = Math.min(
    Math.max(1, Number(state._activityTechPage || 1)),
    activityTechTotalPages
  );
  state._activityTechPage = activityTechCurrentPage;
  const activityTechPageRows = activityTechRows.slice(
    (activityTechCurrentPage - 1) * ACTIVITY_TECH_PAGE_SIZE,
    activityTechCurrentPage * ACTIVITY_TECH_PAGE_SIZE
  );
  const activityTechStartRow = activityTechRows.length ? ((activityTechCurrentPage - 1) * ACTIVITY_TECH_PAGE_SIZE) + 1 : 0;
  const activityTechEndRow = Math.min(activityTechRows.length, activityTechCurrentPage * ACTIVITY_TECH_PAGE_SIZE);
  const expenseFilters = state._reportsWidgetFilters.expenseReport || getDefaultWidgetFilters("expenseReport", baseData);
  const expenseRows = getExpenseReportRows(baseData, expenseFilters);
  state._expenseReportRows = expenseRows;
  const expenseTotals = expenseRows.reduce((acc, item) => {
    acc.total += asNumber(item.amount);
    if (String(item.status || "").toLowerCase() === "approved") acc.approved += asNumber(item.amount);
    if (String(item.status || "").toLowerCase() === "pending") acc.pending += asNumber(item.amount);
    return acc;
  }, { total: 0, approved: 0, pending: 0 });
  const expenseTotalPages = Math.max(1, Math.ceil(expenseRows.length / EXPENSE_REPORT_PAGE_SIZE));
  const expenseCurrentPage = Math.min(
    Math.max(1, Number(state._expenseReportPage || 1)),
    expenseTotalPages
  );
  state._expenseReportPage = expenseCurrentPage;
  const expensePageRows = expenseRows.slice(
    (expenseCurrentPage - 1) * EXPENSE_REPORT_PAGE_SIZE,
    expenseCurrentPage * EXPENSE_REPORT_PAGE_SIZE
  );
  const expenseStartRow = expenseRows.length ? ((expenseCurrentPage - 1) * EXPENSE_REPORT_PAGE_SIZE) + 1 : 0;
  const expenseEndRow = Math.min(expenseRows.length, expenseCurrentPage * EXPENSE_REPORT_PAGE_SIZE);

  state._reportsMetricActivityMap = {
    completed: {
      title: "Atividades concluidas",
      subtitle: "Atividades com OS gerada ou aprovada dentro do recorte atual.",
      activities: metricsCompletedActivities
    },
    pending: {
      title: "Atividades pendentes",
      subtitle: "Atividades que ainda exigem andamento ou emissao de OS.",
      activities: metricsPendingActivities
    },
    overdue: {
      title: "Atividades atrasadas",
      subtitle: "Atividades vencidas e ainda sem conclusao no periodo filtrado.",
      activities: metricsOverdueActivities
    },
    ontime: {
      title: "Entrega no prazo",
      subtitle: "Atividades dentro do prazo no recorte atual.",
      activities: metricsOnTimeActivities
    },
    "schedule-project": {
      title: "Atividades do projeto no cronograma",
      subtitle: "Atividades relacionadas aos projetos filtrados no periodo selecionado.",
      activities: schedulePlannedActivities
    },
    "schedule-planned": {
      title: "Atividades planejadas",
      subtitle: "Todas as atividades planejadas dentro do periodo, cliente e projeto filtrados.",
      activities: schedulePlannedActivities
    },
    "schedule-executed": {
      title: "Atividades executadas",
      subtitle: "Atividades do cronograma com OS gerada ou aprovada.",
      activities: scheduleExecutedActivities
    },
    "schedule-overdue": {
      title: "Atividades atrasadas",
      subtitle: "Atividades planejadas com data anterior a hoje e ainda sem conclusao.",
      activities: scheduleOverdueActivities
    },
    "schedule-upcoming": {
      title: "Proximas atividades planejadas",
      subtitle: "Atividades futuras ou de hoje que ainda devem ser executadas.",
      activities: scheduleUpcomingActivities
    }
  };

  const statusCounts = ["a-fazer", "em-andamento", "go-live", "concluido", "parado", "backlog"].map((status) => ({
    status,
    count: statusesData.projects.filter((project) => String(project.status || "") === status).length
  }));
  const maxStatusCount = Math.max(1, ...statusCounts.map((item) => item.count));

  const executionPlannedHours = executionData.projects.reduce((acc, project) => acc + getProjectPlannedHours(project), 0);
  const executionWorkedHours = executionData.activities
    .filter((activity) => isCompletedActivity(activity))
    .reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const executionOverdue = executionData.activities.filter((activity) => {
    const date = parseDateOnly(activity.workDate);
    return date && date < today && isPendingOsActivity(activity);
  }).length;
  const executionProgress = Math.min(100, executionPlannedHours > 0 ? (executionWorkedHours / executionPlannedHours) * 100 : 0);

  const topClients = Object.values(clientsData.activities.reduce((acc, activity) => {
    const project = clientsData.projects.find((item) => item.id === activity.projectId);
    const clientId = project?.clientId || "sem-cliente";
    if (!acc[clientId]) acc[clientId] = { clientId, clientName: clientsById[clientId]?.name || project?.clientName || "Sem cliente", hours: 0, activities: 0 };
    acc[clientId].hours += asNumber(activity.hoursWorked);
    acc[clientId].activities += 1;
    return acc;
  }, {})).sort((a, b) => b.hours - a.hours).slice(0, 5);
  const maxClientHours = Math.max(1, ...topClients.map((item) => item.hours));

  state._reportsExecutiveExportPayload = buildExecutiveExportPayload({
    state,
    overviewData,
    overviewPlannedHours,
    overviewWorkedHours,
    overviewPlannedPendingHours,
    deliveryOnTime,
    statusCounts,
    topClients,
    clientsById,
    today
  });
  state._reportsExportPayloads = buildReportsExportPayloads({
    cache,
    state,
    clientsById,
    periodLabelMap,
    overviewData,
    overviewPlannedHours,
    overviewWorkedHours,
    overviewPending,
    metricsData,
    metricsCompleted,
    metricsPending,
    metricsOverdue,
    deliveryOnTime,
    statusCounts,
    executionPlannedHours,
    executionWorkedHours,
    executionOverdue,
    executionProgress,
    topClients,
    scheduleData,
    scheduleProjectHours,
    schedulePlannedHours,
    scheduleExecutedHours,
    scheduleProgress,
    schedulePlannedActivities,
    scheduleExecutedActivities,
    scheduleOverdueActivities,
    scheduleUpcomingActivities,
    activityTechRows,
    activityTechTotals,
    activityTechHeaderName,
    activityTechHeaderRate,
    expenseRows,
    expenseFilters,
    expenseUserLabel: getOptionLabel(getExpenseUserOptions(baseData), expenseFilters.expenseUserId, "Todos os usuarios"),
    expenseApproverLabel: getOptionLabel(getExpenseApproverOptions(baseData), expenseFilters.expenseApproverId, "Todos os aprovadores")
  });

  refs.reportsGrid.innerHTML = `
    <section class="reports-card reports-card--hero" data-report-section="overview">
      <div class="reports-card-head">
        <div>
          <div class="reports-card-kicker">Visao executiva</div>
          <h3>Painel consolidado de projetos</h3>
          <p class="muted">Acompanhe andamento, carga operacional e gargalos do portfolio em ${escapeHtml(
            overviewData.period === "custom"
              ? `${formatDateBr(overviewData.startDate)} a ${formatDateBr(overviewData.endDate)}`
              : (periodLabelMap[overviewData.period] || overviewData.period)
          )}.</p>
        </div>
        ${buildReportExportTools("overview")}
        ${buildCardFilterBar(baseData, state, "overview")}
      </div>
      <div class="reports-kpis">
        ${getKpiMetaCard("Projetos monitorados", String(overviewData.projects.length), "Com filtros ativos", "statuses", "neutral")}
        ${getKpiMetaCard("Horas previstas", formatHours(overviewPlannedHours), "Total de horas dos projetos", "execution", "planned")}
        ${getKpiMetaCard("Horas executadas", formatHours(overviewWorkedHours), `Somente atividades com OS gerada/aprovada • Media por tarefa: ${formatHours(overviewAvgHoursPerTask)}`, "execution", "worked")}
        ${getKpiMetaCard("Atividades pendentes", String(overviewPending), `${String(overviewOverdue)} atrasadas`, "metrics", "danger")}
      </div>
    </section>

    <section class="reports-card reports-card--list" data-report-section="metrics">
      <div class="reports-card-head"><div><div class="reports-card-kicker">Principais indicadores</div><h3>Saude operacional do periodo</h3></div>${buildReportExportTools("metrics")}${buildCardFilterBar(baseData, state, "metrics")}</div>
      <div class="reports-metric-summary">
        <p class="muted">${escapeHtml(operationalDrilldown.hint)}</p>
      </div>
      <div class="reports-metric-grid">
        ${getMetricInsightCard("completed", "Atividades concluidas", String(metricsCompleted), `${String(metricsCompleted)} com status finalizado no periodo.`, operationalDrilldown.cta, "success")}
        ${getMetricInsightCard("pending", "Atividades pendentes", String(metricsPending), `${String(metricsPending)} ainda exigem andamento.`, operationalDrilldown.cta, "neutral")}
        ${getMetricInsightCard("overdue", "Atividades atrasadas", String(metricsOverdue), `${String(metricsOverdue)} ultrapassaram a data prevista.`, operationalDrilldown.cta, "danger")}
        ${getMetricInsightCard("ontime", "Entrega no prazo", formatPercent(deliveryOnTime), "Percentual estimado das atividades sem atraso.", operationalDrilldown.cta, "info")}
      </div>
    </section>

    <section class="reports-card reports-card--status" data-report-section="statuses">
      <div class="reports-card-head"><div><div class="reports-card-kicker">Carteira</div><h3>Projetos por status</h3></div>${buildReportExportTools("statuses")}${buildCardFilterBar(baseData, state, "statuses")}</div>
      <div class="reports-status-bars">
        ${statusCounts.map((item) => {
          const info = statusInfo(item.status);
          const width = item.count > 0 ? Math.max(10, (item.count / maxStatusCount) * 100) : 0;
          return `<div class="reports-status-row"><div class="reports-status-meta"><span class="reports-status-dot reports-status-dot--${escapeHtml(info.tone)}"></span><span>${escapeHtml(info.label)}</span></div><div class="reports-status-bar"><div class="reports-status-fill reports-status-fill--${escapeHtml(info.tone)}" style="width:${width}%"></div></div><b>${escapeHtml(String(item.count))}</b></div>`;
        }).join("")}
      </div>
    </section>

    <section class="reports-card reports-card--donut" data-report-section="execution">
      <div class="reports-card-head"><div><div class="reports-card-kicker">Execucao</div><h3>Horas previstas x executadas</h3></div>${buildReportExportTools("execution")}${buildCardFilterBar(baseData, state, "execution")}</div>
      <div class="reports-donut-wrap">
        <div class="reports-donut" style="--progress:${executionProgress}"><div class="reports-donut-center"><strong>${escapeHtml(formatPercent(executionProgress))}</strong><span>consumo</span></div></div>
        <div class="reports-legend">
          <div><span class="reports-legend-dot reports-legend-dot--planned"></span>Horas previstas dos projetos: <b>${escapeHtml(formatHours(executionPlannedHours))}</b></div>
          <div><span class="reports-legend-dot reports-legend-dot--worked"></span>Horas executadas com OS: <b>${escapeHtml(formatHours(executionWorkedHours))}</b></div>
          <div><span class="reports-legend-dot reports-legend-dot--late"></span>Atividades atrasadas sem OS: <b>${escapeHtml(String(executionOverdue))}</b></div>
        </div>
      </div>
    </section>

    <section class="reports-card reports-card--clients" data-report-section="clients">
      <div class="reports-card-head"><div><div class="reports-card-kicker">Carga por cliente</div><h3>Clientes com maior volume executado</h3></div>${buildReportExportTools("clients")}${buildCardFilterBar(baseData, state, "clients")}</div>
      <div class="reports-ranking">
        ${topClients.length ? topClients.map((item) => `<div class="reports-ranking-row"><div><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(String(item.activities))} atividade(s)</span></div><div class="reports-ranking-bar"><div class="reports-ranking-fill" style="width:${Math.max(10, (item.hours / maxClientHours) * 100)}%"></div></div><b>${escapeHtml(formatHours(item.hours))}</b></div>`).join("") : `<p class="muted">Sem dados suficientes para este filtro.</p>`}
      </div>
    </section>

    <section class="reports-card reports-card--schedule" data-report-section="schedule">
      <div class="reports-card-head">
        <div>
          <div class="reports-card-kicker">Cronograma</div>
          <h3>Cronograma de projeto por periodo</h3>
          <p class="muted">Acompanhe horas do projeto, horas planejadas, executadas e o fluxo das atividades por data.</p>
        </div>
        ${buildReportExportTools("schedule")}
        ${buildCardFilterBar(baseData, state, "schedule")}
      </div>
      <div class="reports-schedule-layout">
        <div class="reports-schedule-stats">
          ${getScheduleStatCard("schedule-project", "Horas do projeto", formatHours(scheduleProjectHours), `${scheduleData.projects.length} projeto(s) no filtro`, "project")}
          ${getScheduleStatCard("schedule-planned", "Horas planejadas", formatHours(schedulePlannedHours), `${schedulePlannedActivities.length} atividade(s) planejada(s)`, "planned")}
          ${getScheduleStatCard("schedule-executed", "Horas executadas", formatHours(scheduleExecutedHours), `${scheduleExecutedActivities.length} atividade(s) • ${formatPercent(scheduleProgress)} do planejado`, "executed")}
        </div>
        <div class="reports-schedule-chart" aria-label="Grafico de atividades por status do cronograma">
          ${getScheduleBar("schedule-planned", "Planejadas", schedulePlannedActivities.length, scheduleMaxCount, "planned")}
          ${getScheduleBar("schedule-executed", "Executadas", scheduleExecutedActivities.length, scheduleMaxCount, "executed")}
          ${getScheduleBar("schedule-overdue", "Atrasadas", scheduleOverdueActivities.length, scheduleMaxCount, "overdue")}
          ${getScheduleBar("schedule-upcoming", "Proximas", scheduleUpcomingActivities.length, scheduleMaxCount, "upcoming")}
        </div>
      </div>
      <div class="reports-schedule-next">
        <div class="reports-schedule-next-head">
          <strong>Proximas planejadas</strong>
          <button type="button" data-open-activities="true" data-report-metric="schedule-upcoming">Ver lista completa</button>
        </div>
        ${scheduleUpcomingActivities.length ? scheduleUpcomingActivities.slice(0, 4).map((activity) => {
          const project = scheduleData.projects.find((item) => item.id === activity.projectId);
          const task = tasksById[activity.taskId];
          const techNames = Array.isArray(activity.techNames) && activity.techNames.length ? activity.techNames.join(", ") : "Sem tecnico";
          return `<div class="reports-schedule-next-item"><div><strong>${escapeHtml(activity.name || "Atividade")}</strong><span>${escapeHtml(project?.name || "Projeto")} • ${escapeHtml(task?.name || activity.taskName || "Tarefa")}</span></div><div><b>${escapeHtml(formatDateBr(activity.workDate))}</b><span>${escapeHtml(formatHours(activity.hoursWorked))} • ${escapeHtml(techNames)}</span></div></div>`;
        }).join("") : `<p class="muted">Nenhuma proxima atividade planejada para este filtro.</p>`}
      </div>
    </section>

    <section class="reports-card reports-card--activity-tech" data-report-section="activityTech">
      <div class="reports-card-head">
        <div>
          <div class="reports-card-kicker">Atividade x tecnico</div>
          <h3>Relatorio de Atividade x Tecnico</h3>
          <p class="muted">Analise horas planejadas, apontadas e valor calculado por tecnico, projeto e periodo.</p>
        </div>
        ${buildReportExportTools("activityTech")}
        ${buildCardFilterBar(baseData, state, "activityTech")}
      </div>
      <div class="reports-activity-tech-summary">
        <article>
          <span>Tecnico</span>
          <strong>${escapeHtml(activityTechHeaderName)}</strong>
        </article>
        <article>
          <span>Valor hora</span>
          <strong>${escapeHtml(activityTechHeaderRate)}</strong>
        </article>
        <article>
          <span>Registros</span>
          <strong>${escapeHtml(String(activityTechRows.length))}</strong>
        </article>
      </div>
      <div class="reports-activity-tech-table-wrap">
        <table class="reports-activity-tech-table">
          <thead>
            <tr>
              <th>Tecnico</th>
              <th>Projeto</th>
              <th>Tarefa</th>
              <th>Atividade</th>
              <th>Status</th>
              <th>Horas atividade</th>
              <th>Horas apontadas</th>
              <th>Valor</th>
              <th>Observacao/apontamento</th>
            </tr>
          </thead>
          <tbody>
            ${activityTechPageRows.length ? activityTechPageRows.map((row) => {
              const note = String(row.note || "-");
              const hasNote = note.trim() && note.trim() !== "-";
              const hasLongNote = hasNote && note.trim().length > REPORT_NOTE_PREVIEW_LIMIT;
              const preview = hasLongNote ? truncateReportNote(note) : note;
              return `
                <tr>
                  <td><strong>${escapeHtml(row.techName)}</strong></td>
                  <td><strong>${escapeHtml(row.projectName)}</strong><span>${escapeHtml(row.clientName)}</span></td>
                  <td>${escapeHtml(row.taskName)}</td>
                  <td><strong>${escapeHtml(row.activityName)}</strong><span>${escapeHtml(formatDateBr(row.date))}</span></td>
                  <td>${escapeHtml(row.status)}</td>
                  <td>${escapeHtml(formatHours(row.plannedHours))}</td>
                  <td>${escapeHtml(formatHours(row.pointedHours))}</td>
                  <td>${escapeHtml(formatCurrency(row.amount))}</td>
                  <td class="reports-activity-tech-note${hasNote ? "" : " reports-activity-tech-note--empty"}">
                    ${hasNote
                      ? `<span data-report-note data-preview="${escapeHtml(preview)}" data-full="${escapeHtml(note)}">${escapeHtml(preview)}</span>${hasLongNote ? `<button class="reports-activity-tech-note-more" type="button" data-report-note-toggle aria-expanded="false">Ver mais</button>` : ""}`
                      : `<span>-</span>`}
                  </td>
                </tr>
              `;
            }).join("") : `
              <tr>
                <td colspan="9" class="reports-activity-tech-empty">Nenhuma atividade encontrada com os filtros atuais.</td>
              </tr>
            `}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="5">Totais</th>
              <th>${escapeHtml(formatHours(activityTechTotals.plannedHours))}</th>
              <th>${escapeHtml(formatHours(activityTechTotals.pointedHours))}</th>
              <th>${escapeHtml(formatCurrency(activityTechTotals.amount))}</th>
              <th></th>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="reports-activity-tech-pagination">
        <span>${escapeHtml(String(activityTechStartRow))}-${escapeHtml(String(activityTechEndRow))} de ${escapeHtml(String(activityTechRows.length))} atividades</span>
        <div>
          <button type="button" data-activity-tech-page="prev" ${activityTechCurrentPage <= 1 ? "disabled" : ""}>Anterior</button>
          <strong>Pagina ${escapeHtml(String(activityTechCurrentPage))} de ${escapeHtml(String(activityTechTotalPages))}</strong>
          <button type="button" data-activity-tech-page="next" ${activityTechCurrentPage >= activityTechTotalPages ? "disabled" : ""}>Proxima</button>
        </div>
      </div>
    </section>

    <section class="reports-card reports-card--expense-report" data-report-section="expenseReport">
      <div class="reports-card-head">
        <div>
          <div class="reports-card-kicker">Financeiro</div>
          <h3>Relatorio de Despesas</h3>
          <p class="muted">Responsavel, aprovador, tipo, valor, data da despesa e data da aprovacao.</p>
        </div>
        ${buildReportExportTools("expenseReport")}
        ${buildCardFilterBar(baseData, state, "expenseReport")}
      </div>
      <div class="reports-activity-tech-summary reports-expense-summary">
        <article>
          <span>Registros</span>
          <strong>${escapeHtml(String(expenseRows.length))}</strong>
        </article>
        <article>
          <span>Valor total</span>
          <strong>${escapeHtml(formatCurrency(expenseTotals.total))}</strong>
        </article>
        <article>
          <span>Valor aprovado</span>
          <strong>${escapeHtml(formatCurrency(expenseTotals.approved))}</strong>
        </article>
        <article>
          <span>Valor pendente</span>
          <strong>${escapeHtml(formatCurrency(expenseTotals.pending))}</strong>
        </article>
      </div>
      <div class="expense-report-table-wrap">
        <table class="expense-report-table">
          <thead>
            <tr>
              <th>Responsavel</th>
              <th>Aprovador</th>
              <th>Tipo da despesa</th>
              <th>Valor da despesa</th>
              <th>Data da despesa</th>
              <th>Data da aprovacao</th>
              <th>Status</th>
              <th>Comprovante</th>
            </tr>
          </thead>
          <tbody>
            ${expensePageRows.length ? expensePageRows.map((item) => `
              <tr>
                <td><strong>${escapeHtml(getExpenseResponsibleName(item))}</strong><span>${escapeHtml(item.projectName || "Projeto")}</span></td>
                <td>${escapeHtml(getExpenseApproverName(item))}</td>
                <td>${escapeHtml(expenseTypeLabel(item.type))}</td>
                <td><strong>${escapeHtml(formatCurrency(item.amount))}</strong></td>
                <td>${escapeHtml(formatExpenseDate(item.workDate))}</td>
                <td>${escapeHtml(getExpenseApprovalDateLabel(item))}</td>
                <td><span class="expense-status-pill ${escapeHtml(String(item.status || "pending").toLowerCase())}">${escapeHtml(expenseStatusLabel(item.status))}</span></td>
                <td>
                  <button class="btn ghost sm expense-report-print-btn" type="button" data-print-expense="${escapeHtml(item.id || "")}" aria-label="Imprimir comprovante da despesa">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                      <path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>Imprimir</span>
                  </button>
                </td>
              </tr>
            `).join("") : `
              <tr>
                <td colspan="8" class="expense-report-empty-cell">Nenhuma despesa encontrada com os filtros atuais.</td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
      <div class="reports-activity-tech-pagination">
        <span>${escapeHtml(String(expenseStartRow))}-${escapeHtml(String(expenseEndRow))} de ${escapeHtml(String(expenseRows.length))} despesas</span>
        <div>
          <button type="button" data-expense-report-page="prev" ${expenseCurrentPage <= 1 ? "disabled" : ""}>Anterior</button>
          <strong>Pagina ${escapeHtml(String(expenseCurrentPage))} de ${escapeHtml(String(expenseTotalPages))}</strong>
          <button type="button" data-expense-report-page="next" ${expenseCurrentPage >= expenseTotalPages ? "disabled" : ""}>Proxima</button>
        </div>
      </div>
    </section>
  `;
  refs.reportsGrid.querySelectorAll("[data-report-section]").forEach((card) => {
    const key = card.getAttribute("data-report-section");
    if (key && !visibleReports.has(key)) card.remove();
  });
  enhanceReportCards(refs);
}

function bindOnce(deps){
  if (_bound) return;
  _bound = true;
  const refs = refsFrom(deps);
  const rerender = async (force = false) => {
    const cache = await ensureReportsCache(deps, { force });
    if (!cache) return;
    buildFilters(cache, refs, deps.state);
    renderReports(cache, refs, deps.state);
  };

  const handleGlobalChange = () => {
    syncWidgetFiltersFromGlobals(deps.state, refs, { reset: true });
    rerender(false);
  };

  refs.reportsPeriodFilter?.addEventListener("change", handleGlobalChange);
  refs.reportsClientFilter?.addEventListener("change", handleGlobalChange);
  refs.reportsTeamFilter?.addEventListener("change", handleGlobalChange);
  refs.reportsStatusFilter?.addEventListener("change", handleGlobalChange);
  refs.btnReloadReports?.addEventListener("click", () => rerender(true));
  refs.btnCloseReportActivities?.addEventListener("click", () => closeReportActivitiesModal(refs));
  refs.modalReportActivities?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.closeReportActivities === "true"){
      closeReportActivitiesModal(refs);
    }
  });

  refs.reportsGrid?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) && !(target instanceof HTMLInputElement)) return;
    const cardKey = target.dataset.reportCard;
    const filterKey = target.dataset.reportFilter;
    if (!cardKey || !filterKey) return;
    if (!deps.state._reportsWidgetFilters) deps.state._reportsWidgetFilters = {};
    if (!deps.state._reportsWidgetFilters[cardKey]) deps.state._reportsWidgetFilters[cardKey] = getDefaultWidgetFilters(cardKey, { period: refs.reportsPeriodFilter?.value || "30d" });
    if (target instanceof HTMLInputElement && target.dataset.reportFilterMulti === "true"){
      const group = target.closest(".reports-multi-checks");
      let selected = Array.from(group?.querySelectorAll("input[type='checkbox']:checked") || [])
        .map((input) => input instanceof HTMLInputElement ? input.value : "")
        .filter(Boolean);
      if (target.value === "all" && target.checked) selected = ["all"];
      if (target.value !== "all") selected = selected.filter((value) => value !== "all");
      if (!selected.length) selected = ["all"];
      deps.state._reportsWidgetFilters[cardKey][filterKey] = selected;
    } else {
      deps.state._reportsWidgetFilters[cardKey][filterKey] = target.value || "all";
    }
    if (cardKey === "activityTech") deps.state._activityTechPage = 1;
    if (cardKey === "expenseReport") deps.state._expenseReportPage = 1;
    if (["clientId", "teamId", "status"].includes(filterKey)) deps.state._reportsWidgetFilters[cardKey].projectId = "all";
    if (filterKey === "period" && target.value !== "custom"){
      const defaults = defaultWidgetFilters({ period: target.value || "30d" });
      deps.state._reportsWidgetFilters[cardKey].startDate = defaults.startDate;
      deps.state._reportsWidgetFilters[cardKey].endDate = defaults.endDate;
    }
    renderReports(deps.state._reportsCache, refs, deps.state);
  });
  refs.reportsGrid?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const maximizeTrigger = target.closest("[data-report-maximize]");
    if (maximizeTrigger){
      event.preventDefault();
      event.stopPropagation();
      toggleReportCardMaximized(maximizeTrigger.closest(".reports-card"));
      return;
    }
    const noteToggle = target.closest("[data-report-note-toggle]");
    if (noteToggle){
      event.preventDefault();
      event.stopPropagation();
      toggleReportNote(noteToggle);
      return;
    }
    const pageTrigger = target.closest("[data-activity-tech-page]");
    if (pageTrigger){
      event.preventDefault();
      event.stopPropagation();
      const direction = pageTrigger.getAttribute("data-activity-tech-page");
      const current = Number(deps.state._activityTechPage || 1);
      deps.state._activityTechPage = direction === "prev" ? Math.max(1, current - 1) : current + 1;
      renderReports(deps.state._reportsCache, refs, deps.state);
      return;
    }
    const expensePageTrigger = target.closest("[data-expense-report-page]");
    if (expensePageTrigger){
      event.preventDefault();
      event.stopPropagation();
      const direction = expensePageTrigger.getAttribute("data-expense-report-page");
      const current = Number(deps.state._expenseReportPage || 1);
      deps.state._expenseReportPage = direction === "prev" ? Math.max(1, current - 1) : current + 1;
      renderReports(deps.state._reportsCache, refs, deps.state);
      return;
    }
    const expensePrintTrigger = target.closest("[data-print-expense]");
    if (expensePrintTrigger){
      event.preventDefault();
      event.stopPropagation();
      const expenseId = expensePrintTrigger.getAttribute("data-print-expense") || "";
      const item = (deps.state._expenseReportRows || []).find((entry) => String(entry.id || "") === expenseId);
      if (!item) return;
      downloadExpenseReceiptPdf({
        id: item.id || "",
        generatedAtLabel: new Date().toLocaleString("pt-BR"),
        responsible: getExpenseResponsibleName(item),
        approver: getExpenseApproverName(item),
        type: expenseTypeLabel(item.type),
        amount: formatCurrency(item.amount),
        expenseDate: formatExpenseDate(item.workDate),
        approvalDate: getExpenseApprovalDateLabel(item),
        status: expenseStatusLabel(item.status),
        statusKey: String(item.status || "pending").toLowerCase(),
        project: item.projectName || "-",
        client: item.clientName || "-",
        task: item.taskName || "-",
        activity: item.activityName || "-",
        source: expenseSourceLabel(item.source),
        observation: item.observation || "-",
        rejectionReason: item.rejectionReason || "",
        receiptName: item.receipt?.name || "-",
        receiptUrl: item.receipt?.url || "",
        receiptPath: item.receipt?.path || "",
        createdAt: formatDateTimeBr(item.createdAt),
        approvedByName: item.approvedByName || "",
        rejectedByName: item.rejectedByName || ""
      }).catch((err) => {
        console.error("[reports:expense:receipt-pdf]", err);
        alert("Nao foi possivel gerar o comprovante da despesa.");
      });
      return;
    }
    const cardExportTrigger = target.closest("[data-export-card]");
    if (cardExportTrigger){
      event.preventDefault();
      event.stopPropagation();
      const reportKey = cardExportTrigger.getAttribute("data-export-card");
      const exportType = cardExportTrigger.getAttribute("data-export-type") || "pdf";
      const payload = deps.state._reportsExportPayloads?.[reportKey];
      if (!payload) return;
      if (exportType === "pdf") {
        downloadReportPdf(payload).catch((err) => {
          console.error("[reports:card:pdf]", err);
          alert("Nao foi possivel exportar este relatorio em PDF.");
        });
      } else {
        downloadReportExcel(payload).catch((err) => {
          console.error("[reports:card:excel]", err);
          alert("Nao foi possivel exportar este relatorio em Excel.");
        });
      }
      return;
    }
    const exportTrigger = target.closest("[data-export-report]");
    if (exportTrigger){
      const exportType = exportTrigger.getAttribute("data-export-report");
      const payload = deps.state._reportsExecutiveExportPayload;
      if (!payload) return;
      if (exportType === "pdf") {
        downloadExecutiveReportPdf(payload).catch((err) => {
          console.error("[reports:executive:pdf]", err);
          alert("Nao foi possivel exportar o relatorio executivo em PDF.");
        });
      } else {
        downloadExecutiveReportExcel(payload).catch((err) => {
          console.error("[reports:executive:excel]", err);
          alert("Nao foi possivel exportar o relatorio executivo em Excel.");
        });
      }
      return;
    }
    const activitiesTrigger = target.closest("[data-open-activities='true']");
    if (activitiesTrigger){
      const metricKey = activitiesTrigger.getAttribute("data-report-metric") || "pending";
      renderReportActivitiesModal(metricKey, refs, deps.state, deps.state._reportsCache);
      openReportActivitiesModal(refs);
      return;
    }
    const kpiCard = target.closest("[data-report-focus]");
    if (!kpiCard) return;
    const focusTarget = kpiCard.getAttribute("data-report-focus");
    if (!focusTarget) return;
    const section = refs.reportsGrid?.querySelector(`[data-report-section="${focusTarget}"]`);
    if (!(section instanceof HTMLElement)) return;
    refs.reportsGrid.querySelectorAll(".reports-card.is-spotlight").forEach((node) => node.classList.remove("is-spotlight"));
    section.classList.add("is-spotlight");
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => section.classList.remove("is-spotlight"), 1800);
  });
  refs.reportsGrid?.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const kpiCard = target.closest("[data-report-focus]");
    if (!kpiCard) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    kpiCard.click();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeReportCardMaximized();
  });
}

export async function openReportsView(deps){
  bindOnce(deps);
  deps.setView?.("reports");
  await loadReports(deps);
}

export async function loadReports(deps, opts = {}){
  const refs = refsFrom(deps);
  if (!refs.reportsGrid) return;
  refs.reportsGrid.innerHTML = `<section class="reports-card reports-card--loading"><p class="muted">Carregando relatorios e indicadores...</p></section>`;
  const cache = await ensureReportsCache(deps, { force: !!opts.force });
  if (!cache) return;
  buildFilters(cache, refs, deps.state);
  syncWidgetFiltersFromGlobals(deps.state, refs, { reset: !deps.state._reportsWidgetFilters || !!opts.force });
  renderReports(cache, refs, deps.state);
}
