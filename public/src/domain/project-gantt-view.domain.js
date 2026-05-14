let _styleInjected = false;

function asNumber(value){
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function escapeHtml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseDate(value){
  const raw = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function addDays(date, days){
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function diffDays(a, b){
  const oneDay = 86400000;
  const start = new Date(a);
  const end = new Date(b);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - start.getTime()) / oneDay);
}

function formatDate(date){
  if (!date) return "-";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatShortDate(date){
  if (!date) return "-";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatMonth(date){
  if (!date) return "-";
  return date.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
}

function isCompletedStatus(activity){
  const status = String(activity?.status || "").toLowerCase();
  return status === "os_gerada" || status === "os_aprovada";
}

function isOverdueActivity(activity, today){
  const workDate = parseDate(activity?.workDate);
  return Boolean(workDate && workDate < today && !isCompletedStatus(activity));
}

function getTaskTone(taskActivities, today){
  if (!taskActivities.length) return "neutral";
  if (taskActivities.some(activity => isOverdueActivity(activity, today))) return "late";
  if (taskActivities.every(isCompletedStatus)) return "done";
  if (taskActivities.some(isCompletedStatus)) return "progress";
  return "planned";
}

function getActivityTone(activity, today){
  if (isOverdueActivity(activity, today)) return "late";
  if (isCompletedStatus(activity)) return "done";
  return "planned";
}

function getTechNames(activity, users){
  if (Array.isArray(activity?.techNames) && activity.techNames.length){
    return activity.techNames.filter(Boolean).join(", ");
  }
  const ids = Array.isArray(activity?.techUids) ? activity.techUids.filter(Boolean) : [];
  const names = ids
    .map(uid => users.find(user => user.uid === uid || user.id === uid))
    .filter(Boolean)
    .map(user => user.name || user.email || user.uid)
    .filter(Boolean);
  return names.length ? names.join(", ") : "-";
}

function injectStyles(){
  if (_styleInjected || typeof document === "undefined") return;
  _styleInjected = true;
  const style = document.createElement("style");
  style.id = "project-gantt-view-styles";
  style.textContent = `
    .project-gantt-view{
      border:1px solid rgba(103,80,255,.14);
      border-radius:18px;
      background:linear-gradient(180deg, rgba(255,255,255,.96), rgba(248,250,255,.98));
      box-shadow:0 18px 42px rgba(15,23,42,.08);
      padding:14px;
    }
    .project-gantt-head{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:12px;
      margin-bottom:14px;
    }
    .project-gantt-title{
      margin:0;
      font-size:20px;
      line-height:1.15;
      color:#111827;
    }
    .project-gantt-subtitle{
      margin:5px 0 0;
      font-size:12px;
      color:#64748b;
    }
    .project-gantt-actions{
      display:flex;
      align-items:center;
      gap:8px;
      flex-wrap:wrap;
      justify-content:flex-end;
    }
    .project-gantt-kpis{
      display:grid;
      grid-template-columns:repeat(4,minmax(0,1fr));
      gap:8px;
      margin-bottom:12px;
    }
    .project-gantt-kpi{
      border:1px solid rgba(15,23,42,.08);
      border-radius:12px;
      background:#fff;
      padding:9px 11px;
    }
    .project-gantt-kpi span{
      display:block;
      color:#64748b;
      font-size:10px;
      font-weight:800;
      letter-spacing:.08em;
      text-transform:uppercase;
    }
    .project-gantt-kpi strong{
      display:block;
      margin-top:5px;
      color:#111827;
      font-size:17px;
      line-height:1.1;
    }
    .project-gantt-scroll{
      overflow:auto;
      border:1px solid rgba(15,23,42,.08);
      border-radius:14px;
      background:#fff;
    }
    .project-gantt-grid{ min-width:980px; }
    .project-gantt-row{
      display:grid;
      grid-template-columns:300px 1fr;
      min-height:64px;
      border-bottom:1px solid rgba(226,232,240,.95);
    }
    .project-gantt-row:last-child{ border-bottom:0; }
    .project-gantt-label,
    .project-gantt-timeline{
      position:relative;
    }
    .project-gantt-label{
      padding:12px 14px;
      border-right:1px solid rgba(226,232,240,.95);
      background:#fff;
      z-index:2;
      position:sticky;
      left:0;
    }
    .project-gantt-label strong{
      display:block;
      font-size:13px;
      color:#111827;
      line-height:1.25;
    }
    .project-gantt-label span{
      display:block;
      margin-top:5px;
      font-size:10px;
      color:#64748b;
      line-height:1.3;
    }
    .project-gantt-header .project-gantt-label,
    .project-gantt-header .project-gantt-timeline{
      background:#f8fafc;
      min-height:50px;
    }
    .project-gantt-scale{
      display:flex;
      flex-direction:column;
      height:100%;
    }
    .project-gantt-months,
    .project-gantt-weeks{
      display:grid;
    }
    .project-gantt-month,
    .project-gantt-week{
      border-right:1px solid rgba(226,232,240,.9);
      text-align:center;
      color:#64748b;
      white-space:nowrap;
    }
    .project-gantt-month{
      height:24px;
      padding-top:7px;
      font-size:10px;
      font-weight:900;
      text-transform:uppercase;
      background:#eef4ff;
    }
    .project-gantt-week{
      height:26px;
      padding-top:7px;
      font-size:9px;
      background:#f8fafc;
    }
    .project-gantt-week.is-today{ background:rgba(99,102,241,.12); color:#4f46e5; font-weight:900; }
    .project-gantt-bar{
      position:absolute;
      top:16px;
      height:20px;
      border-radius:8px;
      box-shadow:0 8px 16px rgba(15,23,42,.12);
      min-width:18px;
    }
    .project-gantt-bar.is-planned{ background:linear-gradient(135deg,#3b82f6,#6366f1); }
    .project-gantt-bar.is-progress{ background:linear-gradient(135deg,#14b8a6,#2563eb); }
    .project-gantt-bar.is-done{ background:linear-gradient(135deg,#22c55e,#16a34a); }
    .project-gantt-bar.is-late{ background:linear-gradient(135deg,#f97316,#ef4444); }
    .project-gantt-bar.is-neutral{ background:linear-gradient(135deg,#94a3b8,#64748b); }
    .project-gantt-progress{
      position:absolute;
      inset:0 auto 0 0;
      border-radius:8px;
      background:rgba(255,255,255,.34);
      min-width:3px;
    }
    .project-gantt-today{
      position:absolute;
      top:0;
      bottom:0;
      width:2px;
      background:#4f46e5;
      opacity:.7;
      z-index:1;
    }
    .project-gantt-activity-chips{
      position:absolute;
      left:10px;
      right:10px;
      bottom:6px;
      display:flex;
      gap:5px;
      flex-wrap:wrap;
      z-index:2;
    }
    .project-gantt-activity-chip{
      display:inline-flex;
      align-items:center;
      gap:4px;
      max-width:140px;
      padding:2px 6px;
      border-radius:999px;
      background:#eef2ff;
      color:#334155;
      font-size:9px;
      font-weight:800;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    .project-gantt-activity-chip i{
      width:6px;
      height:6px;
      border-radius:999px;
      flex:0 0 auto;
    }
    .project-gantt-activity-chip.is-planned i{ background:#6366f1; }
    .project-gantt-activity-chip.is-done i{ background:#22c55e; }
    .project-gantt-activity-chip.is-late i{ background:#ef4444; }
    .project-gantt-activity-chip.is-progress i{ background:#14b8a6; }
    .project-gantt-activity-chip.is-neutral i{ background:#94a3b8; }
    .project-gantt-legend{
      display:flex;
      flex-wrap:wrap;
      gap:10px;
      margin-top:10px;
      color:#475569;
      font-size:11px;
    }
    .project-gantt-legend span{
      display:inline-flex;
      align-items:center;
      gap:5px;
    }
    .project-gantt-legend i{
      width:10px;
      height:10px;
      border-radius:999px;
      display:inline-block;
    }
    .project-gantt-empty{
      padding:24px;
      text-align:center;
      color:#64748b;
    }
    @media (max-width: 820px){
      .project-gantt-head{ flex-direction:column; }
      .project-gantt-actions{ justify-content:flex-start; }
      .project-gantt-kpis{ grid-template-columns:1fr 1fr; }
      .project-gantt-row{ grid-template-columns:220px 1fr; }
    }
  `;
  document.head.appendChild(style);
}

function buildGanttRows(project, tasks, activities, state){
  const users = Array.isArray(state?._usersCache) ? state._usersCache : [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (Array.isArray(tasks) ? tasks : []).map((task) => {
    const taskActivities = (Array.isArray(activities) ? activities : [])
      .filter(activity => activity.taskId === task.id)
      .sort((a, b) => String(a.workDate || "").localeCompare(String(b.workDate || "")));
    return {
      id: task.id,
      number: task.taskNumber || "-",
      name: task.name || "Tarefa",
      start: parseDate(task.startDate) || parseDate(project?.startDate) || today,
      end: parseDate(task.endDate) || parseDate(project?.endDate) || today,
      plannedHours: asNumber(task.plannedHours),
      activities: taskActivities.map(activity => ({
        id: activity.id,
        name: activity.name || "Atividade",
        date: parseDate(activity.workDate),
        status: activity.status || "-",
        hours: asNumber(activity.hoursWorked),
        techNames: getTechNames(activity, users),
        tone: getActivityTone(activity, today)
      })),
      tone: getTaskTone(taskActivities, today)
    };
  });
}

function getRange(project, rows){
  const dates = [];
  const projectStart = parseDate(project?.startDate);
  const projectEnd = parseDate(project?.endDate);
  if (projectStart) dates.push(projectStart);
  if (projectEnd) dates.push(projectEnd);
  rows.forEach((row) => {
    if (row.start) dates.push(row.start);
    if (row.end) dates.push(row.end);
    row.activities.forEach((activity) => {
      if (activity.date) dates.push(activity.date);
    });
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!dates.length) dates.push(addDays(today, -7), addDays(today, 30));
  let start = new Date(Math.min(...dates.map(date => date.getTime())));
  let end = new Date(Math.max(...dates.map(date => date.getTime())));
  start = addDays(start, -3);
  end = addDays(end, 5);
  return { start, end };
}

function getWeekSlots(range){
  const slots = [];
  let cursor = new Date(range.start);
  while (cursor <= range.end){
    const end = addDays(cursor, 6);
    slots.push({ start: new Date(cursor), end: end > range.end ? new Date(range.end) : end });
    cursor = addDays(cursor, 7);
  }
  return slots.length ? slots : [{ start: new Date(range.start), end: new Date(range.end) }];
}

function renderScale(slots){
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const months = [];
  slots.forEach((slot) => {
    const label = formatMonth(slot.start);
    const last = months[months.length - 1];
    if (last && last.label === label) {
      last.count += 1;
    } else {
      months.push({ label, count: 1 });
    }
  });
  const monthHtml = months.map(month => `<div class="project-gantt-month" style="grid-column:span ${month.count}">${escapeHtml(month.label)}</div>`).join("");
  const weekHtml = slots.map((slot) => {
    const hasToday = today >= slot.start && today <= slot.end;
    return `<div class="project-gantt-week ${hasToday ? "is-today" : ""}" title="${escapeHtml(`${formatDate(slot.start)} a ${formatDate(slot.end)}`)}">${escapeHtml(formatShortDate(slot.start))}</div>`;
  }).join("");
  return `
    <div class="project-gantt-months" style="grid-template-columns:repeat(${slots.length}, 1fr)">${monthHtml}</div>
    <div class="project-gantt-weeks" style="grid-template-columns:repeat(${slots.length}, 1fr)">${weekHtml}</div>
  `;
}

function renderRow(row, range, slots, columnWidth){
  const totalDays = Math.max(1, diffDays(range.start, range.end) + 1);
  const timelineWidth = Math.max(1, slots.length * columnWidth);
  const startOffset = Math.max(0, diffDays(range.start, row.start));
  const duration = Math.max(1, diffDays(row.start, row.end) + 1);
  const left = (startOffset / totalDays) * timelineWidth;
  const width = Math.max(18, Math.min(timelineWidth - left, (duration / totalDays) * timelineWidth));
  const doneCount = row.activities.filter(isCompletedStatus).length;
  const completion = row.activities.length ? Math.round((doneCount / row.activities.length) * 100) : 0;
  const chips = row.activities.slice(0, 4).map((activity) => {
    const title = `${activity.name}\nData: ${formatDate(activity.date)}\nStatus: ${activity.status}\nResponsavel: ${activity.techNames}\nHoras: ${activity.hours || 0}h`;
    return `<span class="project-gantt-activity-chip is-${escapeHtml(activity.tone)}" title="${escapeHtml(title)}"><i></i>${escapeHtml(formatShortDate(activity.date))}</span>`;
  }).join("");
  const extra = row.activities.length > 4
    ? `<span class="project-gantt-activity-chip" title="${escapeHtml(`${row.activities.length - 4} atividade(s) adicional(is)`)}">+${escapeHtml(String(row.activities.length - 4))}</span>`
    : "";
  const title = `#${row.number} ${row.name}\nPeriodo: ${formatDate(row.start)} a ${formatDate(row.end)}\nHoras orcadas: ${row.plannedHours || 0}h\nAtividades: ${row.activities.length}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayOffset = today >= range.start && today <= range.end
    ? (diffDays(range.start, today) / totalDays) * timelineWidth
    : null;
  return `
    <div class="project-gantt-row">
      <div class="project-gantt-label">
        <strong>#${escapeHtml(String(row.number))} ${escapeHtml(row.name)}</strong>
        <span>${escapeHtml(formatDate(row.start))} a ${escapeHtml(formatDate(row.end))}</span>
        <span>${escapeHtml(String(completion))}% concluido | ${escapeHtml(String(row.activities.length))} atividade(s)</span>
      </div>
      <div class="project-gantt-timeline" style="width:${timelineWidth}px">
        ${todayOffset === null ? "" : `<span class="project-gantt-today" style="left:${todayOffset}px" title="Hoje"></span>`}
        <span class="project-gantt-bar is-${escapeHtml(row.tone)}" style="left:${left}px;width:${width}px" title="${escapeHtml(title)}"></span>
        <span class="project-gantt-progress" style="left:${left}px;width:${width * (completion / 100)}px"></span>
        <div class="project-gantt-activity-chips">${chips}${extra}</div>
      </div>
    </div>
  `;
}

export function openProjectGanttView({ refs, project, tasks, activities, state }){
  injectStyles();
  const panel = refs?.projectWorkspacePanel;
  const body = panel?.querySelector?.(".project-workspace-body");
  if (!body) return;

  const cover = refs?.projectWorkspaceCover;
  const taskBlock = panel.querySelector(".project-block");
  const existing = body.querySelector("[data-project-gantt-view]");
  if (existing) existing.remove();

  if (cover) cover.hidden = true;
  if (taskBlock) taskBlock.hidden = true;

  const rows = buildGanttRows(project, tasks, activities, state);
  const range = getRange(project, rows);
  const slots = getWeekSlots(range);
  const columnWidth = 72;
  const timelineWidth = slots.length * columnWidth;
  const completedTasks = rows.filter(row => row.tone === "done").length;
  const lateTasks = rows.filter(row => row.tone === "late").length;
  const activityCount = rows.reduce((acc, row) => acc + row.activities.length, 0);

  const view = document.createElement("section");
  view.className = "project-gantt-view";
  view.setAttribute("data-project-gantt-view", "true");
  view.innerHTML = `
    <div class="project-gantt-head">
      <div>
        <h3 class="project-gantt-title">Gantt do Projeto: ${escapeHtml(project?.name || "Projeto")}</h3>
        <p class="project-gantt-subtitle">Periodo exibido: ${escapeHtml(formatDate(range.start))} a ${escapeHtml(formatDate(range.end))}</p>
      </div>
      <div class="project-gantt-actions">
        <button class="btn ghost sm" type="button" data-close-project-gantt>Voltar ao workspace</button>
      </div>
    </div>
    <div class="project-gantt-kpis">
      <div class="project-gantt-kpi"><span>Tarefas</span><strong>${escapeHtml(String(rows.length))}</strong></div>
      <div class="project-gantt-kpi"><span>Concluidas</span><strong>${escapeHtml(String(completedTasks))}</strong></div>
      <div class="project-gantt-kpi"><span>Atrasadas</span><strong>${escapeHtml(String(lateTasks))}</strong></div>
      <div class="project-gantt-kpi"><span>Atividades</span><strong>${escapeHtml(String(activityCount))}</strong></div>
    </div>
    ${rows.length ? `
      <div class="project-gantt-scroll">
        <div class="project-gantt-grid" style="grid-template-columns:300px ${timelineWidth}px">
          <div class="project-gantt-row project-gantt-header">
            <div class="project-gantt-label"><strong>Tarefas</strong><span>Linha do tempo</span></div>
            <div class="project-gantt-timeline" style="width:${timelineWidth}px">
              <div class="project-gantt-scale">${renderScale(slots)}</div>
            </div>
          </div>
          ${rows.map(row => renderRow(row, range, slots, columnWidth)).join("")}
        </div>
      </div>
      <div class="project-gantt-legend">
        <span><i style="background:#6366f1"></i> Planejado</span>
        <span><i style="background:#14b8a6"></i> Em andamento</span>
        <span><i style="background:#22c55e"></i> Concluido</span>
        <span><i style="background:#ef4444"></i> Atrasado</span>
        <span><i style="background:#94a3b8"></i> Sem atividades</span>
      </div>
    ` : `<div class="project-gantt-empty">Nenhuma tarefa cadastrada para exibir no Gantt.</div>`}
  `;

  body.prepend(view);
  view.querySelector("[data-close-project-gantt]")?.addEventListener("click", () => {
    view.remove();
    if (cover) cover.hidden = false;
    if (taskBlock) taskBlock.hidden = false;
  });
}
