import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let _bound = false;

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

function normalizeText(value){
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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

function getPeriodRange(period){
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  const start = new Date(today);
  if (period === "30d") start.setDate(start.getDate() - 29);
  else if (period === "90d") start.setDate(start.getDate() - 89);
  else if (period === "year") start.setMonth(start.getMonth() - 11, 1);
  else {
    start.setFullYear(start.getFullYear() - 10);
  }
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
    reportsGrid: r.reportsGrid || byId("reportsGrid")
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

function getFilteredData(cache, refs){
  const period = refs.reportsPeriodFilter?.value || "30d";
  const clientId = refs.reportsClientFilter?.value || "all";
  const teamId = refs.reportsTeamFilter?.value || "all";
  const status = refs.reportsStatusFilter?.value || "all";
  const { start, end } = getPeriodRange(period);

  const projects = cache.projects.filter((project) => {
    if (clientId !== "all" && project.clientId !== clientId) return false;
    if (teamId !== "all" && project.teamId !== teamId) return false;
    if (status !== "all" && String(project.status || "") !== status) return false;
    return true;
  });

  const projectIds = new Set(projects.map((project) => project.id));
  const tasks = cache.tasks.filter((task) => {
    if (!projectIds.has(task.projectId)) return false;
    const startDate = parseDateOnly(task.startDate);
    const endDate = parseDateOnly(task.endDate);
    if (period === "all") return true;
    return overlap(startDate, endDate, start, end);
  });
  const activities = cache.activities.filter((activity) => {
    if (!projectIds.has(activity.projectId)) return false;
    if (period === "all") return true;
    return inRange(parseDateOnly(activity.workDate), start, end);
  });

  return { projects, tasks, activities, period };
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

function renderReports(cache, refs, state){
  if (!refs.reportsGrid) return;
  const { projects, tasks, activities, period } = getFilteredData(cache, refs);
  const tasksByProject = new Map();
  tasks.forEach((task) => {
    const list = tasksByProject.get(task.projectId) || [];
    list.push(task);
    tasksByProject.set(task.projectId, list);
  });
  const activitiesByProject = new Map();
  activities.forEach((activity) => {
    const list = activitiesByProject.get(activity.projectId) || [];
    list.push(activity);
    activitiesByProject.set(activity.projectId, list);
  });

  const totalPlannedHours = tasks.reduce((acc, task) => acc + asNumber(task.plannedHours), 0);
  const totalWorkedHours = activities.reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const completedActivities = activities.filter((activity) => String(activity.status || "").toLowerCase() === "os_gerada").length;
  const pendingActivities = activities.length - completedActivities;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueActivities = activities.filter((activity) => {
    const date = parseDateOnly(activity.workDate);
    return date && date < today && String(activity.status || "").toLowerCase() !== "os_gerada";
  }).length;
  const avgHoursPerTask = tasks.length ? (totalWorkedHours / tasks.length) : 0;
  const statusCounts = ["a-fazer", "em-andamento", "go-live", "concluido", "parado", "backlog"].map((status) => {
    const count = projects.filter((project) => String(project.status || "") === status).length;
    return { status, count };
  });
  const maxStatusCount = Math.max(1, ...statusCounts.map((item) => item.count));

  const clientsById = Object.fromEntries(cache.clients.map((client) => [client.id, client]));
  const topClients = Object.values(activities.reduce((acc, activity) => {
    const project = projects.find((item) => item.id === activity.projectId);
    const clientId = project?.clientId || "sem-cliente";
    if (!acc[clientId]){
      acc[clientId] = {
        clientId,
        clientName: clientsById[clientId]?.name || project?.clientName || "Sem cliente",
        hours: 0,
        activities: 0
      };
    }
    acc[clientId].hours += asNumber(activity.hoursWorked);
    acc[clientId].activities += 1;
    return acc;
  }, {}))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);
  const maxClientHours = Math.max(1, ...topClients.map((item) => item.hours));

  const attentionProjects = projects.map((project) => {
    const projectTasks = tasksByProject.get(project.id) || [];
    const projectActivities = activitiesByProject.get(project.id) || [];
    const planned = projectTasks.reduce((acc, task) => acc + asNumber(task.plannedHours), 0);
    const worked = projectActivities.reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
    const pending = projectActivities.filter((activity) => String(activity.status || "").toLowerCase() !== "os_gerada").length;
    const overdue = projectActivities.filter((activity) => {
      const date = parseDateOnly(activity.workDate);
      return date && date < today && String(activity.status || "").toLowerCase() !== "os_gerada";
    }).length;
    const progress = planned > 0 ? Math.min(100, (worked / planned) * 100) : 0;
    return {
      id: project.id,
      name: project.name || "Projeto",
      projectNumber: project.projectNumber || "-",
      status: statusInfo(project.status),
      pending,
      overdue,
      progress
    };
  })
    .sort((a, b) => (b.overdue - a.overdue) || (b.pending - a.pending) || (b.progress - a.progress))
    .slice(0, 5);

  const recentActivities = activities
    .slice()
    .sort((a, b) => String(b.workDate || "").localeCompare(String(a.workDate || "")))
    .slice(0, 8)
    .map((activity) => {
      const project = projects.find((item) => item.id === activity.projectId);
      const task = tasks.find((item) => item.id === activity.taskId);
      return {
        date: activity.workDate,
        title: activity.name || "Atividade",
        projectName: project?.name || "Projeto",
        taskName: task?.name || activity.taskName || "Tarefa",
        hours: asNumber(activity.hoursWorked),
        status: statusInfo(activity.status === "os_gerada" ? "go-live" : (activity.status || "em-andamento"))
      };
    });

  const deliveryOnTime = activities.length ? Math.max(0, ((activities.length - overdueActivities) / activities.length) * 100) : 0;
  const periodLabelMap = { "30d": "Últimos 30 dias", "90d": "Últimos 90 dias", year: "Últimos 12 meses", all: "Histórico completo" };

  refs.reportsGrid.innerHTML = `
    <section class="reports-card reports-card--hero">
      <div class="reports-card-head">
        <div>
          <div class="reports-card-kicker">Visão executiva</div>
          <h3>Painel consolidado de projetos</h3>
          <p class="muted">Acompanhe andamento, carga operacional e gargalos do portfólio em ${escapeHtml(periodLabelMap[period] || period)}.</p>
        </div>
      </div>
      <div class="reports-kpis">
        <article class="reports-kpi">
          <span class="reports-kpi-label">Projetos monitorados</span>
          <strong>${escapeHtml(String(projects.length))}</strong>
          <span class="reports-kpi-sub">Com filtros ativos</span>
        </article>
        <article class="reports-kpi">
          <span class="reports-kpi-label">Horas previstas</span>
          <strong>${escapeHtml(formatHours(totalPlannedHours))}</strong>
          <span class="reports-kpi-sub">Planejamento agregado</span>
        </article>
        <article class="reports-kpi">
          <span class="reports-kpi-label">Horas executadas</span>
          <strong>${escapeHtml(formatHours(totalWorkedHours))}</strong>
          <span class="reports-kpi-sub">Média por tarefa: ${escapeHtml(formatHours(avgHoursPerTask))}</span>
        </article>
        <article class="reports-kpi">
          <span class="reports-kpi-label">Atividades pendentes</span>
          <strong>${escapeHtml(String(pendingActivities))}</strong>
          <span class="reports-kpi-sub">${escapeHtml(String(overdueActivities))} atrasadas</span>
        </article>
      </div>
    </section>

    <section class="reports-card reports-card--list">
      <div class="reports-card-head">
        <div>
          <div class="reports-card-kicker">Principais indicadores</div>
          <h3>Saúde operacional do período</h3>
        </div>
      </div>
      <div class="reports-metric-list">
        <div class="reports-metric-row">
          <div>
            <strong>Atividades concluídas</strong>
            <span>${escapeHtml(String(completedActivities))} com status finalizado no período.</span>
          </div>
          <b>${escapeHtml(String(completedActivities))}</b>
        </div>
        <div class="reports-metric-row">
          <div>
            <strong>Atividades pendentes</strong>
            <span>${escapeHtml(String(pendingActivities))} ainda exigem andamento.</span>
          </div>
          <b>${escapeHtml(String(pendingActivities))}</b>
        </div>
        <div class="reports-metric-row">
          <div>
            <strong>Atividades atrasadas</strong>
            <span>${escapeHtml(String(overdueActivities))} ultrapassaram a data prevista.</span>
          </div>
          <b class="tone-danger">${escapeHtml(String(overdueActivities))}</b>
        </div>
        <div class="reports-metric-row">
          <div>
            <strong>Entrega no prazo</strong>
            <span>Percentual estimado das atividades sem atraso.</span>
          </div>
          <b class="tone-success">${escapeHtml(formatPercent(deliveryOnTime))}</b>
        </div>
      </div>
    </section>

    <section class="reports-card reports-card--status">
      <div class="reports-card-head">
        <div>
          <div class="reports-card-kicker">Carteira</div>
          <h3>Projetos por status</h3>
        </div>
      </div>
      <div class="reports-status-bars">
        ${statusCounts.map((item) => {
          const info = statusInfo(item.status);
          const width = Math.max(8, (item.count / maxStatusCount) * 100);
          return `
            <div class="reports-status-row">
              <div class="reports-status-meta">
                <span class="reports-status-dot reports-status-dot--${escapeHtml(info.tone)}"></span>
                <span>${escapeHtml(info.label)}</span>
              </div>
              <div class="reports-status-bar">
                <div class="reports-status-fill reports-status-fill--${escapeHtml(info.tone)}" style="width:${width}%"></div>
              </div>
              <b>${escapeHtml(String(item.count))}</b>
            </div>
          `;
        }).join("")}
      </div>
    </section>

    <section class="reports-card reports-card--donut">
      <div class="reports-card-head">
        <div>
          <div class="reports-card-kicker">Execução</div>
          <h3>Horas previstas x executadas</h3>
        </div>
      </div>
      <div class="reports-donut-wrap">
        <div class="reports-donut" style="--progress:${Math.min(100, totalPlannedHours > 0 ? (totalWorkedHours / totalPlannedHours) * 100 : 0)}">
          <div class="reports-donut-center">
            <strong>${escapeHtml(formatPercent(totalPlannedHours > 0 ? (totalWorkedHours / totalPlannedHours) * 100 : 0))}</strong>
            <span>consumo</span>
          </div>
        </div>
        <div class="reports-legend">
          <div><span class="reports-legend-dot reports-legend-dot--planned"></span>Horas previstas: <b>${escapeHtml(formatHours(totalPlannedHours))}</b></div>
          <div><span class="reports-legend-dot reports-legend-dot--worked"></span>Horas executadas: <b>${escapeHtml(formatHours(totalWorkedHours))}</b></div>
          <div><span class="reports-legend-dot reports-legend-dot--late"></span>Atividades atrasadas: <b>${escapeHtml(String(overdueActivities))}</b></div>
        </div>
      </div>
    </section>

    <section class="reports-card reports-card--clients">
      <div class="reports-card-head">
        <div>
          <div class="reports-card-kicker">Carga por cliente</div>
          <h3>Clientes com maior volume executado</h3>
        </div>
      </div>
      <div class="reports-ranking">
        ${topClients.length ? topClients.map((item) => `
          <div class="reports-ranking-row">
            <div>
              <strong>${escapeHtml(item.clientName)}</strong>
              <span>${escapeHtml(String(item.activities))} atividade(s)</span>
            </div>
            <div class="reports-ranking-bar">
              <div class="reports-ranking-fill" style="width:${Math.max(10, (item.hours / maxClientHours) * 100)}%"></div>
            </div>
            <b>${escapeHtml(formatHours(item.hours))}</b>
          </div>
        `).join("") : `<p class="muted">Sem dados suficientes para este filtro.</p>`}
      </div>
    </section>

    <section class="reports-card reports-card--attention">
      <div class="reports-card-head">
        <div>
          <div class="reports-card-kicker">Acompanhamento</div>
          <h3>Projetos que exigem atenção</h3>
        </div>
      </div>
      <div class="reports-attention-list">
        ${attentionProjects.length ? attentionProjects.map((project) => `
          <article class="reports-attention-item">
            <div class="reports-attention-top">
              <div>
                <strong>#${escapeHtml(String(project.projectNumber))} ${escapeHtml(project.name)}</strong>
                <span class="reports-pill reports-pill--${escapeHtml(project.status.tone)}">${escapeHtml(project.status.label)}</span>
              </div>
              <b>${escapeHtml(formatPercent(project.progress))}</b>
            </div>
            <div class="reports-attention-sub">
              <span>${escapeHtml(String(project.pending))} pendente(s)</span>
              <span>${escapeHtml(String(project.overdue))} atrasada(s)</span>
            </div>
          </article>
        `).join("") : `<p class="muted">Nenhum projeto crítico com os filtros atuais.</p>`}
      </div>
    </section>

    <section class="reports-card reports-card--timeline">
      <div class="reports-card-head">
        <div>
          <div class="reports-card-kicker">Movimentação recente</div>
          <h3>Últimas atividades registradas</h3>
        </div>
      </div>
      <div class="reports-timeline">
        ${recentActivities.length ? recentActivities.map((activity) => `
          <div class="reports-timeline-item">
            <div class="reports-timeline-dot reports-timeline-dot--${escapeHtml(activity.status.tone)}"></div>
            <div class="reports-timeline-body">
              <strong>${escapeHtml(activity.title)}</strong>
              <span>${escapeHtml(activity.projectName)} • ${escapeHtml(activity.taskName)}</span>
            </div>
            <div class="reports-timeline-meta">
              <b>${escapeHtml(formatHours(activity.hours))}</b>
              <span>${escapeHtml(activity.date || "-")}</span>
            </div>
          </div>
        `).join("") : `<p class="muted">Ainda não há atividades no período filtrado.</p>`}
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

  refs.reportsPeriodFilter?.addEventListener("change", () => rerender(false));
  refs.reportsClientFilter?.addEventListener("change", () => rerender(false));
  refs.reportsTeamFilter?.addEventListener("change", () => rerender(false));
  refs.reportsStatusFilter?.addEventListener("change", () => rerender(false));
  refs.btnReloadReports?.addEventListener("click", () => rerender(true));
}

export async function openReportsView(deps){
  bindOnce(deps);
  deps.setView?.("reports");
  await loadReports(deps);
}

export async function loadReports(deps, opts = {}){
  const refs = refsFrom(deps);
  if (!refs.reportsGrid) return;
  refs.reportsGrid.innerHTML = `<section class="reports-card reports-card--loading"><p class="muted">Carregando relatórios e indicadores...</p></section>`;
  const cache = await ensureReportsCache(deps, { force: !!opts.force });
  if (!cache) return;
  buildFilters(cache, refs, deps.state);
  renderReports(cache, refs, deps.state);
}
