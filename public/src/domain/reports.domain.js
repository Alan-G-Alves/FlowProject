import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let _bound = false;

const REPORT_CARD_KEYS = [
  "overview",
  "metrics",
  "statuses",
  "execution",
  "clients",
  "techs",
  "attention",
  "timeline"
];

const CARD_FILTER_CONFIG = {
  overview: ["period", "clientId", "teamId", "status", "projectId"],
  metrics: ["period", "clientId", "projectId"],
  statuses: ["period", "clientId", "teamId"],
  execution: ["period", "clientId", "teamId", "projectId"],
  clients: ["period", "teamId", "status"],
  techs: [],
  attention: ["period", "clientId", "teamId", "status", "projectId"],
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
    reportTechFilterTech: r.reportTechFilterTech || byId("reportTechFilterTech")
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

function getTechOptions(baseData, filters){
  const scopedProjects = baseData.projects.filter((project) => {
    if (filters?.clientId !== "all" && project.clientId !== filters?.clientId) return false;
    if (filters?.projectId !== "all" && project.id !== filters?.projectId) return false;
    return true;
  });
  const projectIds = new Set(scopedProjects.map((project) => project.id));
  const map = new Map();
  baseData.activities.forEach((activity) => {
    if (!projectIds.has(activity.projectId)) return;
    const ids = Array.isArray(activity.techUids) ? activity.techUids : [];
    const names = Array.isArray(activity.techNames) ? activity.techNames : [];
    ids.forEach((techId, index) => {
      if (!techId) return;
      if (!map.has(techId)){
        map.set(techId, {
          value: techId,
          label: names[index] || names[0] || techId
        });
      }
    });
  });
  return [{ value: "all", label: "Todos os tecnicos" }].concat(
    Array.from(map.values()).sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")))
  );
}

function setSelectOptions(element, options, selected){
  if (!element) return;
  element.innerHTML = options.map((opt) => (
    `<option value="${escapeHtml(opt.value)}"${opt.value === selected ? " selected" : ""}>${escapeHtml(opt.label)}</option>`
  )).join("");
}

function syncTechFilterDateFields(refs){
  const showCustom = refs.reportTechFilterPeriod?.value === "custom";
  const wrappers = Array.from(document.querySelectorAll(".report-tech-filter-date"));
  wrappers.forEach((node) => {
    node.hidden = !showCustom;
  });
}

function syncTechFilterProjectOptions(baseData, refs, state){
  const filters = ensureWidgetFilters(state, baseData).techs;
  const tempFilters = {
    clientId: refs.reportTechFilterClient?.value || filters.clientId || "all",
    teamId: "all",
    status: "all",
    projectId: refs.reportTechFilterProject?.value || filters.projectId || "all"
  };
  const projectOptions = getCardProjectOptions(baseData, tempFilters);
  const currentProject = refs.reportTechFilterProject?.value || filters.projectId || "all";
  const validProject = projectOptions.some((opt) => opt.value === currentProject) ? currentProject : "all";
  setSelectOptions(refs.reportTechFilterProject, projectOptions, validProject);
  return validProject;
}

function syncTechFilterTechOptions(baseData, refs, state){
  const filters = ensureWidgetFilters(state, baseData).techs;
  const techOptions = getTechOptions(baseData, {
    clientId: refs.reportTechFilterClient?.value || filters.clientId || "all",
    projectId: refs.reportTechFilterProject?.value || filters.projectId || "all"
  });
  const currentTech = refs.reportTechFilterTech?.value || filters.techId || "all";
  const validTech = techOptions.some((opt) => opt.value === currentTech) ? currentTech : "all";
  setSelectOptions(refs.reportTechFilterTech, techOptions, validTech);
}

function populateTechFilterModal(baseData, refs, state){
  const filters = ensureWidgetFilters(state, baseData).techs;
  refs.reportTechFilterPeriod.value = filters.period || "30d";
  refs.reportTechFilterStartDate.value = filters.startDate || "";
  refs.reportTechFilterEndDate.value = filters.endDate || "";
  setSelectOptions(refs.reportTechFilterClient, [{ value: "all", label: "Todos os clientes" }].concat(
    baseData.clients
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .map((client) => ({ value: client.id, label: client.name || client.id }))
  ), filters.clientId || "all");
  if (refs.reportTechFilterActivityStatus){
    refs.reportTechFilterActivityStatus.value = filters.activityStatus || "all";
  }
  syncTechFilterProjectOptions(baseData, refs, state);
  syncTechFilterTechOptions(baseData, refs, state);
  syncTechFilterDateFields(refs);
}

function openTechFilterModal(refs){
  if (!refs.modalReportTechFilters) return;
  refs.modalReportTechFilters.hidden = false;
}

function closeTechFilterModal(refs){
  if (!refs.modalReportTechFilters) return;
  refs.modalReportTechFilters.hidden = true;
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
  const techsData = getScopedData(baseData, state._reportsWidgetFilters.techs);
  const attentionData = getScopedData(baseData, state._reportsWidgetFilters.attention);
  const timelineData = getScopedData(baseData, state._reportsWidgetFilters.timeline);

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
  const metricsOverdue = metricsData.activities.filter((activity) => {
    const date = parseDateOnly(activity.workDate);
    return date && date < today && !isCompletedActivity(activity);
  }).length;
  const deliveryOnTime = metricsData.activities.length ? Math.max(0, ((metricsData.activities.length - metricsOverdue) / metricsData.activities.length) * 100) : 0;

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

  const topTechs = Object.values(techsData.activities.reduce((acc, activity) => {
    const techIds = Array.isArray(activity.techUids) && activity.techUids.length ? activity.techUids : ["sem-tecnico"];
    const techNames = Array.isArray(activity.techNames) && activity.techNames.length ? activity.techNames : ["Sem tecnico"];
    techIds.forEach((techId, index) => {
      const key = techId || `sem-tecnico-${index}`;
      if (!acc[key]) acc[key] = { techId: techId || "-", techName: techNames[index] || techNames[0] || "Sem tecnico", hours: 0, activities: 0 };
      acc[key].hours += asNumber(activity.hoursWorked);
      acc[key].activities += 1;
    });
    return acc;
  }, {})).sort((a, b) => (b.activities - a.activities) || (b.hours - a.hours)).slice(0, 6);
  const maxTechActivities = Math.max(1, ...topTechs.map((item) => item.activities));

  const attentionTasksByProject = new Map();
  attentionData.tasks.forEach((task) => {
    const list = attentionTasksByProject.get(task.projectId) || [];
    list.push(task);
    attentionTasksByProject.set(task.projectId, list);
  });
  const attentionActivitiesByProject = new Map();
  attentionData.activities.forEach((activity) => {
    const list = attentionActivitiesByProject.get(activity.projectId) || [];
    list.push(activity);
    attentionActivitiesByProject.set(activity.projectId, list);
  });
  const attentionProjects = attentionData.projects.map((project) => {
    const projectTasks = attentionTasksByProject.get(project.id) || [];
    const projectActivities = attentionActivitiesByProject.get(project.id) || [];
    const planned = projectTasks.reduce((acc, task) => acc + asNumber(task.plannedHours), 0);
    const worked = projectActivities.reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
    const pending = projectActivities.filter((activity) => !isCompletedActivity(activity)).length;
    const overdue = projectActivities.filter((activity) => {
      const date = parseDateOnly(activity.workDate);
      return date && date < today && !isCompletedActivity(activity);
    }).length;
    return {
      id: project.id,
      name: project.name || "Projeto",
      projectNumber: project.projectNumber || "-",
      status: statusInfo(project.status),
      pending,
      overdue,
      progress: planned > 0 ? Math.min(100, (worked / planned) * 100) : 0
    };
  }).sort((a, b) => (b.overdue - a.overdue) || (b.pending - a.pending) || (b.progress - a.progress)).slice(0, 5);

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
        ${buildCardFilterBar(baseData, state, "overview")}
      </div>
      <div class="reports-kpis">
        ${getKpiMetaCard("Projetos monitorados", String(overviewData.projects.length), "Com filtros ativos", "statuses", "neutral")}
        ${getKpiMetaCard("Horas previstas", formatHours(overviewPlannedHours), "Total de horas dos projetos", "execution", "planned")}
        ${getKpiMetaCard("Horas executadas", formatHours(overviewWorkedHours), `Somente atividades com OS gerada/aprovada • Media por tarefa: ${formatHours(overviewAvgHoursPerTask)}`, "timeline", "worked")}
        ${getKpiMetaCard("Horas planejadas", formatHours(overviewPlannedPendingHours), "Atividades atrasadas e sem OS", "attention", "warning")}
        ${getKpiMetaCard("Atividades pendentes", String(overviewPending), `${String(overviewOverdue)} atrasadas`, "metrics", "danger")}
      </div>
    </section>

    <section class="reports-card reports-card--list" data-report-section="metrics">
      <div class="reports-card-head"><div><div class="reports-card-kicker">Principais indicadores</div><h3>Saude operacional do periodo</h3></div>${buildCardFilterBar(baseData, state, "metrics")}</div>
      <div class="reports-metric-list">
        <div class="reports-metric-row"><div><strong>Atividades concluidas</strong><span>${escapeHtml(String(metricsCompleted))} com status finalizado no periodo.</span></div><b>${escapeHtml(String(metricsCompleted))}</b></div>
        <div class="reports-metric-row"><div><strong>Atividades pendentes</strong><span>${escapeHtml(String(metricsPending))} ainda exigem andamento.</span></div><b>${escapeHtml(String(metricsPending))}</b></div>
        <div class="reports-metric-row"><div><strong>Atividades atrasadas</strong><span>${escapeHtml(String(metricsOverdue))} ultrapassaram a data prevista.</span></div><b class="tone-danger">${escapeHtml(String(metricsOverdue))}</b></div>
        <div class="reports-metric-row"><div><strong>Entrega no prazo</strong><span>Percentual estimado das atividades sem atraso.</span></div><b class="tone-success">${escapeHtml(formatPercent(deliveryOnTime))}</b></div>
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

    <section class="reports-card reports-card--techs" data-report-section="techs">
      <div class="reports-card-head">
        <div>
          <div class="reports-card-kicker">Atividade x tecnico</div>
          <h3>Distribuicao operacional por tecnico</h3>
          <p class="muted">Use o filtro avancado para refinar por periodo, cliente, projeto e tecnico.</p>
        </div>
        <div class="reports-card-tools">
          <button class="btn ghost sm reports-card-filter-btn" data-open-report-tech-filters="true" type="button" aria-label="Abrir filtros do indicador Atividade x tecnico">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span>Filtros</span>
          </button>
        </div>
      </div>
      <div class="reports-ranking">
        ${topTechs.length ? topTechs.map((item) => `<div class="reports-ranking-row"><div><strong>${escapeHtml(item.techName)}</strong><span>ID: ${escapeHtml(String(item.techId || "-"))}</span></div><div class="reports-ranking-bar"><div class="reports-ranking-fill reports-ranking-fill--tech" style="width:${Math.max(10, (item.activities / maxTechActivities) * 100)}%"></div></div><b>${escapeHtml(String(item.activities))} / ${escapeHtml(formatHours(item.hours))}</b></div>`).join("") : `<p class="muted">Sem atividades vinculadas a tecnicos com os filtros atuais.</p>`}
      </div>
    </section>

    <section class="reports-card reports-card--attention" data-report-section="attention">
      <div class="reports-card-head"><div><div class="reports-card-kicker">Acompanhamento</div><h3>Projetos que exigem atencao</h3></div>${buildCardFilterBar(baseData, state, "attention")}</div>
      <div class="reports-attention-list">
        ${attentionProjects.length ? attentionProjects.map((project) => `<article class="reports-attention-item"><div class="reports-attention-top"><div><strong>#${escapeHtml(String(project.projectNumber))} ${escapeHtml(project.name)}</strong><span class="reports-pill reports-pill--${escapeHtml(project.status.tone)}">${escapeHtml(project.status.label)}</span></div><b>${escapeHtml(formatPercent(project.progress))}</b></div><div class="reports-attention-sub"><span>${escapeHtml(String(project.pending))} pendente(s)</span><span>${escapeHtml(String(project.overdue))} atrasada(s)</span></div></article>`).join("") : `<p class="muted">Nenhum projeto critico com os filtros atuais.</p>`}
      </div>
    </section>

    <section class="reports-card reports-card--timeline" data-report-section="timeline">
      <div class="reports-card-head"><div><div class="reports-card-kicker">Movimentacao recente</div><h3>Ultimas atividades registradas</h3></div>${buildCardFilterBar(baseData, state, "timeline")}</div>
      <div class="reports-timeline">
        ${recentActivities.length ? recentActivities.map((activity) => `<div class="reports-timeline-item"><div class="reports-timeline-dot reports-timeline-dot--${escapeHtml(activity.status.tone)}"></div><div class="reports-timeline-body"><strong>${escapeHtml(activity.title)}</strong><span>${escapeHtml(activity.projectName)} • ${escapeHtml(activity.taskName)}</span></div><div class="reports-timeline-meta"><b>${escapeHtml(formatHours(activity.hours))}</b><span>${escapeHtml(activity.date || "-")}</span></div></div>`).join("") : `<p class="muted">Ainda nao ha atividades no periodo filtrado.</p>`}
      </div>
    </section>
  `;
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
  refs.btnCloseReportTechFilters?.addEventListener("click", () => closeTechFilterModal(refs));
  refs.modalReportTechFilters?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.closeReportTechFilters === "true"){
      closeTechFilterModal(refs);
    }
  });
  refs.reportTechFilterPeriod?.addEventListener("change", () => {
    syncTechFilterDateFields(refs);
  });
  refs.reportTechFilterClient?.addEventListener("change", () => {
    syncTechFilterProjectOptions(deps.state._reportsCache, refs, deps.state);
    syncTechFilterTechOptions(deps.state._reportsCache, refs, deps.state);
  });
  refs.reportTechFilterProject?.addEventListener("change", () => {
    syncTechFilterTechOptions(deps.state._reportsCache, refs, deps.state);
  });
  refs.btnResetReportTechFilters?.addEventListener("click", () => {
    deps.state._reportsWidgetFilters.techs = defaultWidgetFilters({ period: "30d" });
    populateTechFilterModal(deps.state._reportsCache, refs, deps.state);
  });
  refs.btnApplyReportTechFilters?.addEventListener("click", () => {
    if (!deps.state._reportsWidgetFilters) deps.state._reportsWidgetFilters = {};
    deps.state._reportsWidgetFilters.techs = {
      ...defaultWidgetFilters({ period: refs.reportTechFilterPeriod?.value || "30d" }),
      period: refs.reportTechFilterPeriod?.value || "30d",
      clientId: refs.reportTechFilterClient?.value || "all",
      projectId: refs.reportTechFilterProject?.value || "all",
      activityStatus: refs.reportTechFilterActivityStatus?.value || "all",
      techId: refs.reportTechFilterTech?.value || "all",
      startDate: refs.reportTechFilterStartDate?.value || "",
      endDate: refs.reportTechFilterEndDate?.value || ""
    };
    closeTechFilterModal(refs);
    renderReports(deps.state._reportsCache, refs, deps.state);
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
    const trigger = target.closest("[data-open-report-tech-filters='true']");
    if (trigger){
      populateTechFilterModal(deps.state._reportsCache, refs, deps.state);
      openTechFilterModal(refs);
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
