import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  downloadExecutiveReportExcel,
  downloadExecutiveReportPdf
} from "./reports-export.domain.js";

let _bound = false;

const REPORT_CARD_KEYS = [
  "overview",
  "metrics",
  "statuses",
  "execution",
  "clients",
  "timeline"
];

const CARD_FILTER_CONFIG = {
  overview: ["period", "clientId", "teamId", "status", "projectId"],
  metrics: ["period", "clientId", "projectId"],
  statuses: ["period", "clientId", "teamId"],
  execution: ["period", "clientId", "teamId", "projectId"],
  clients: ["period", "teamId", "status"],
  timeline: ["period", "clientId", "projectId"]
};

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

function formatDateBr(value){
  const date = parseDateOnly(value);
  if (!date) return "-";
  return date.toLocaleDateString("pt-BR");
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

function isCompletedActivity(activity){
  return ["os_gerada", "os_aprovada"].includes(String(activity?.status || "").toLowerCase());
}

function isPendingOsActivity(activity){
  return !isCompletedActivity(activity);
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

async function ensureReportsCache(deps, { force = false } = {}){
  const { db, state } = deps;
  const companyId = state?.companyId;
  if (!db || !companyId) return null;
  if (!force && state._reportsCacheLoaded && state._reportsCache) return state._reportsCache;

  const [projectsSnap, tasksSnap, activitiesSnap, clientsSnap] = await Promise.all([
    getDocs(collection(db, `companies/${companyId}/projects`)),
    getDocs(collection(db, `companies/${companyId}/tasks`)),
    getDocs(collection(db, `companies/${companyId}/activities`)),
    getDocs(collection(db, `companies/${companyId}/clients`))
  ]);

  const cache = {
    projects: projectsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    tasks: tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    activities: activitiesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    clients: clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  };
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
    clients: cache.clients
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
    activityStatus: "all",
    startDate: startDate.toISOString().slice(0, 10),
    endDate
  };
}

function ensureWidgetFilters(state, baseData){
  if (!state._reportsWidgetFilters) state._reportsWidgetFilters = {};
  REPORT_CARD_KEYS.forEach((key) => {
    if (!state._reportsWidgetFilters[key]) state._reportsWidgetFilters[key] = defaultWidgetFilters(baseData);
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
    if (activityStatus !== "all" && String(activity.status || "") !== activityStatus) return false;
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
    projectId: projectOptions
  };

  const labelMap = {
    period: "Periodo",
    clientId: "Cliente",
    teamId: "Equipe",
    status: "Status",
    projectId: "Projeto"
  };

  const renderOptions = (options, selected) => options.map((opt) => `<option value="${escapeHtml(opt.value)}"${opt.value === selected ? " selected" : ""}>${escapeHtml(opt.label)}</option>`).join("");
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
    .map((filterKey) => renderField(filterKey))
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
    .sort((a, b) => String(b.workDate || "").localeCompare(String(a.workDate || "")))
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

  const baseData = getBaseFilteredData(cache, refs);
  ensureWidgetFilters(state, baseData);
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
  const timelineData = getScopedData(baseData, state._reportsWidgetFilters.timeline);
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

  const recentActivities = timelineData.activities.slice().sort((a, b) => String(b.workDate || "").localeCompare(String(a.workDate || ""))).slice(0, 8).map((activity) => {
    const project = timelineData.projects.find((item) => item.id === activity.projectId);
    const task = tasksById[activity.taskId];
    return {
      date: activity.workDate,
      title: activity.name || "Atividade",
      projectName: project?.name || "Projeto",
      taskName: task?.name || activity.taskName || "Tarefa",
      hours: asNumber(activity.hoursWorked),
      status: statusInfo(isCompletedActivity(activity) ? "go-live" : (activity.status || "em-andamento"))
    };
  });

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

  refs.reportsGrid.innerHTML = `
    <section class="reports-card reports-card--hero">
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
        <div class="reports-card-tools">
          <button class="btn ghost sm reports-card-filter-btn" data-export-report="excel" type="button" aria-label="Exportar relatorio executivo em Excel">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="m9 15 2-3 2 3m-4 0 2 3 2-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Excel</span>
          </button>
          <button class="btn ghost sm reports-card-filter-btn" data-export-report="pdf" type="button" aria-label="Exportar relatorio executivo em PDF">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 16h8M8 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span>PDF</span>
          </button>
        </div>
        ${buildCardFilterBar(baseData, state, "overview")}
      </div>
      <div class="reports-kpis">
        ${getKpiMetaCard("Projetos monitorados", String(overviewData.projects.length), "Com filtros ativos", "statuses", "neutral")}
        ${getKpiMetaCard("Horas previstas", formatHours(overviewPlannedHours), "Total de horas dos projetos", "execution", "planned")}
        ${getKpiMetaCard("Horas executadas", formatHours(overviewWorkedHours), `Somente atividades com OS gerada/aprovada • Media por tarefa: ${formatHours(overviewAvgHoursPerTask)}`, "timeline", "worked")}
        ${getKpiMetaCard("Atividades pendentes", String(overviewPending), `${String(overviewOverdue)} atrasadas`, "metrics", "danger")}
      </div>
    </section>

    <section class="reports-card reports-card--list" data-report-section="metrics">
      <div class="reports-card-head"><div><div class="reports-card-kicker">Principais indicadores</div><h3>Saude operacional do periodo</h3></div>${buildCardFilterBar(baseData, state, "metrics")}</div>
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
      <div class="reports-card-head"><div><div class="reports-card-kicker">Carteira</div><h3>Projetos por status</h3></div>${buildCardFilterBar(baseData, state, "statuses")}</div>
      <div class="reports-status-bars">
        ${statusCounts.map((item) => {
          const info = statusInfo(item.status);
          const width = item.count > 0 ? Math.max(10, (item.count / maxStatusCount) * 100) : 0;
          return `<div class="reports-status-row"><div class="reports-status-meta"><span class="reports-status-dot reports-status-dot--${escapeHtml(info.tone)}"></span><span>${escapeHtml(info.label)}</span></div><div class="reports-status-bar"><div class="reports-status-fill reports-status-fill--${escapeHtml(info.tone)}" style="width:${width}%"></div></div><b>${escapeHtml(String(item.count))}</b></div>`;
        }).join("")}
      </div>
    </section>

    <section class="reports-card reports-card--donut" data-report-section="execution">
      <div class="reports-card-head"><div><div class="reports-card-kicker">Execucao</div><h3>Horas previstas x executadas</h3></div>${buildCardFilterBar(baseData, state, "execution")}</div>
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
      <div class="reports-card-head"><div><div class="reports-card-kicker">Carga por cliente</div><h3>Clientes com maior volume executado</h3></div>${buildCardFilterBar(baseData, state, "clients")}</div>
      <div class="reports-ranking">
        ${topClients.length ? topClients.map((item) => `<div class="reports-ranking-row"><div><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(String(item.activities))} atividade(s)</span></div><div class="reports-ranking-bar"><div class="reports-ranking-fill" style="width:${Math.max(10, (item.hours / maxClientHours) * 100)}%"></div></div><b>${escapeHtml(formatHours(item.hours))}</b></div>`).join("") : `<p class="muted">Sem dados suficientes para este filtro.</p>`}
      </div>
    </section>

    <section class="reports-card reports-card--timeline" data-report-section="timeline">
      <div class="reports-card-head"><div><div class="reports-card-kicker">Movimentacao recente</div><h3>Ultimas atividades registradas</h3></div>${buildCardFilterBar(baseData, state, "timeline")}</div>
      <div class="reports-timeline">
        ${recentActivities.length ? recentActivities.map((activity) => `<div class="reports-timeline-item"><div class="reports-timeline-dot reports-timeline-dot--${escapeHtml(activity.status.tone)}"></div><div class="reports-timeline-body"><strong>${escapeHtml(activity.title)}</strong><span>${escapeHtml(activity.projectName)} • ${escapeHtml(activity.taskName)}</span></div><div class="reports-timeline-meta"><b>${escapeHtml(formatHours(activity.hours))}</b><span>${escapeHtml(activity.date || "-")}</span></div></div>`).join("") : `<p class="muted">Ainda nao ha atividades no periodo filtrado.</p>`}
      </div>
    </section>
  `;
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
    if (!deps.state._reportsWidgetFilters[cardKey]) deps.state._reportsWidgetFilters[cardKey] = defaultWidgetFilters({ period: refs.reportsPeriodFilter?.value || "30d" });
    deps.state._reportsWidgetFilters[cardKey][filterKey] = target.value || "all";
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
