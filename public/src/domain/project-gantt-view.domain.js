let _styleInjected = false;

function asNumber(value){
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function clamp(value, min, max){
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeFileName(value){
  return String(value || "gantt-projeto")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
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
      min-height:74px;
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
      min-height:74px;
    }
    .project-gantt-scale{
      display:flex;
      flex-direction:column;
      height:100%;
    }
    .project-gantt-months,
    .project-gantt-weeks,
    .project-gantt-days{
      display:grid;
    }
    .project-gantt-month,
    .project-gantt-week,
    .project-gantt-day{
      border-right:1px solid rgba(226,232,240,.9);
      text-align:center;
      color:#334155;
      white-space:nowrap;
    }
    .project-gantt-month{
      height:24px;
      padding-top:7px;
      font-size:10px;
      font-weight:900;
      text-transform:uppercase;
      color:#6d28d9;
      background:#f3e8ff;
      border-right:2px solid rgba(109,40,217,.38);
    }
    .project-gantt-week{
      height:28px;
      padding-top:5px;
      font-size:9.5px;
      line-height:1.15;
      background:#f1f5f9;
      color:#1e293b;
      font-weight:800;
    }
    .project-gantt-week.is-today{ background:rgba(99,102,241,.12); color:#4f46e5; font-weight:900; }
    .project-gantt-day{
      height:22px;
      padding-top:6px;
      font-size:9.5px;
      font-weight:700;
      background:#fff;
    }
    .project-gantt-day.is-weekend{ background:rgba(241,245,249,.72); }
    .project-gantt-day.is-today{ background:rgba(99,102,241,.12); color:#4f46e5; font-weight:900; }
    .project-gantt-timeline{
      background-image:linear-gradient(to right, rgba(226,232,240,.55) 1px, transparent 1px);
      background-size:var(--gantt-day-width, 10px) 100%;
    }
    .project-gantt-bar{
      position:absolute;
      top:16px;
      height:20px;
      border-radius:8px;
      box-shadow:0 8px 16px rgba(15,23,42,.12);
      min-width:18px;
    }
    .project-gantt-bar.is-planned{ background:#6366f1; }
    .project-gantt-bar.is-progress{ background:#14b8a6; }
    .project-gantt-bar.is-done{ background:#22c55e; }
    .project-gantt-bar.is-late{ background:#ef4444; }
    .project-gantt-bar.is-neutral{ background:#94a3b8; }
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
    .project-gantt-month-divider{
      position:absolute;
      top:0;
      bottom:0;
      width:2px;
      background:rgba(109,40,217,.28);
      z-index:1;
      pointer-events:none;
    }
    .project-gantt-activity-chips{
      position:absolute;
      inset:0;
      z-index:2;
    }
    .project-gantt-activity-chip{
      position:absolute;
      top:40px;
      transform:translateX(-50%);
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      gap:2px;
      width:20px;
      min-height:24px;
      padding:0;
      border-radius:0;
      background:transparent;
      color:#334155;
      font-size:9.5px;
      line-height:1;
      font-weight:800;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      cursor:help;
    }
    .project-gantt-activity-chip:hover{
      color:#111827;
      transform:translateX(-50%) translateY(-2px);
    }
    .project-gantt-activity-chip i{
      width:7px;
      height:7px;
      border-radius:999px;
      flex:0 0 auto;
      box-shadow:0 0 0 2px #fff, 0 2px 6px rgba(15,23,42,.18);
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
    .project-gantt-hint{
      display:flex;
      align-items:center;
      gap:6px;
      margin-top:8px;
      color:#64748b;
      font-size:11px;
      font-weight:700;
    }
    .project-gantt-hint svg{
      width:14px;
      height:14px;
      color:#4f46e5;
      flex:0 0 auto;
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

function weekDayLetter(date){
  return ["D", "S", "T", "Q", "Q", "S", "S"][date.getDay()];
}

function renderScale(slots, dayWidth, range){
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const months = [];
  const totalDays = Math.max(1, diffDays(range.start, range.end) + 1);
  for (let index = 0; index < totalDays; index += 1){
    const day = addDays(range.start, index);
    const label = formatMonth(day);
    const last = months[months.length - 1];
    if (last && last.label === label) {
      last.count += 1;
    } else {
      months.push({ label, count: 1 });
    }
  }
  const monthHtml = months.map(month => `<div class="project-gantt-month" style="grid-column:span ${month.count}">${escapeHtml(month.label)}</div>`).join("");
  const weekHtml = slots.map((slot, index) => {
    const hasToday = today >= slot.start && today <= slot.end;
    const spanDays = Math.max(1, diffDays(slot.start, slot.end) + 1);
    return `<div class="project-gantt-week ${hasToday ? "is-today" : ""}" style="grid-column:span ${spanDays}" title="${escapeHtml(`${formatDate(slot.start)} a ${formatDate(slot.end)}`)}">Semana ${index + 1}<br>(${escapeHtml(formatShortDate(slot.start))} - ${escapeHtml(formatShortDate(slot.end))})</div>`;
  }).join("");
  const dayHtml = Array.from({ length: totalDays }, (_, index) => {
    const day = addDays(range.start, index);
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    const isToday = day.toDateString() === today.toDateString();
    return `<div class="project-gantt-day ${isWeekend ? "is-weekend" : ""} ${isToday ? "is-today" : ""}" style="width:${dayWidth}px" title="${escapeHtml(formatDate(day))}">${escapeHtml(weekDayLetter(day))}</div>`;
  }).join("");
  return `
    <div class="project-gantt-months" style="grid-template-columns:repeat(${totalDays}, ${dayWidth}px)">${monthHtml}</div>
    <div class="project-gantt-weeks" style="grid-template-columns:repeat(${totalDays}, ${dayWidth}px)">${weekHtml}</div>
    <div class="project-gantt-days" style="grid-template-columns:repeat(${totalDays}, ${dayWidth}px)">${dayHtml}</div>
  `;
}

function getMonthDividerOffsets(range, dayWidth){
  const totalDays = Math.max(1, diffDays(range.start, range.end) + 1);
  const offsets = [];
  let previousMonth = range.start.getMonth();
  for (let index = 1; index < totalDays; index += 1){
    const day = addDays(range.start, index);
    if (day.getMonth() !== previousMonth){
      offsets.push(index * dayWidth);
      previousMonth = day.getMonth();
    }
  }
  return offsets;
}

function renderMonthDividers(range, dayWidth){
  return getMonthDividerOffsets(range, dayWidth)
    .map(offset => `<span class="project-gantt-month-divider" style="left:${offset}px"></span>`)
    .join("");
}

function renderRow(row, range, slots, dayWidth){
  const totalDays = Math.max(1, diffDays(range.start, range.end) + 1);
  const timelineWidth = Math.max(1, totalDays * dayWidth);
  const startOffset = Math.max(0, diffDays(range.start, row.start));
  const duration = Math.max(1, diffDays(row.start, row.end) + 1);
  const left = (startOffset / totalDays) * timelineWidth;
  const width = Math.max(18, Math.min(timelineWidth - left, (duration / totalDays) * timelineWidth));
  const doneCount = row.activities.filter(isCompletedStatus).length;
  const completion = row.activities.length ? Math.round((doneCount / row.activities.length) * 100) : 0;
  const chips = row.activities.filter(activity => activity.date).map((activity) => {
    const title = `${activity.name}\nData: ${formatDate(activity.date)}\nStatus: ${activity.status}\nResponsavel: ${activity.techNames}\nHoras: ${activity.hours || 0}h`;
    const activityOffset = clamp(diffDays(range.start, activity.date), 0, totalDays);
    const activityLeft = (activityOffset / totalDays) * timelineWidth;
    return `<span class="project-gantt-activity-chip is-${escapeHtml(activity.tone)}" style="left:${activityLeft}px" title="${escapeHtml(title)}"><i></i>${escapeHtml(String(activity.date.getDate()).padStart(2, "0"))}</span>`;
  }).join("");
  const title = `#${row.number} ${row.name}\nPeriodo: ${formatDate(row.start)} a ${formatDate(row.end)}\nHoras orcadas: ${row.plannedHours || 0}h\nAtividades: ${row.activities.length}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayOffset = today >= range.start && today <= range.end
    ? (diffDays(range.start, today) / totalDays) * timelineWidth
    : null;
  const monthDividers = renderMonthDividers(range, dayWidth);
  return `
    <div class="project-gantt-row">
      <div class="project-gantt-label">
        <strong>#${escapeHtml(String(row.number))} ${escapeHtml(row.name)}</strong>
        <span>${escapeHtml(formatDate(row.start))} a ${escapeHtml(formatDate(row.end))}</span>
        <span>${escapeHtml(String(completion))}% concluido | ${escapeHtml(String(row.activities.length))} atividade(s)</span>
      </div>
      <div class="project-gantt-timeline" style="width:${timelineWidth}px;--gantt-day-width:${dayWidth}px">
        ${monthDividers}
        ${todayOffset === null ? "" : `<span class="project-gantt-today" style="left:${todayOffset}px" title="Hoje"></span>`}
        <span class="project-gantt-bar is-${escapeHtml(row.tone)}" style="left:${left}px;width:${width}px" title="${escapeHtml(title)}"></span>
        <span class="project-gantt-progress" style="left:${left}px;width:${width * (completion / 100)}px"></span>
        <div class="project-gantt-activity-chips">${chips}</div>
      </div>
    </div>
  `;
}

function toneColor(tone){
  const colors = {
    planned: [99, 102, 241],
    progress: [20, 184, 166],
    done: [34, 197, 94],
    late: [239, 68, 68],
    neutral: [148, 163, 184]
  };
  return colors[tone] || colors.neutral;
}

function drawPdfText(doc, text, x, y, maxWidth, options = {}){
  const lines = doc.splitTextToSize(String(text || "-"), maxWidth).slice(0, options.maxLines || 1);
  doc.text(lines, x, y);
}

function drawPdfScale(doc, range, slots, x, y, width){
  const totalDays = Math.max(1, diffDays(range.start, range.end) + 1);
  const dayWidth = width / totalDays;
  const months = [];
  for (let index = 0; index < totalDays; index += 1){
    const day = addDays(range.start, index);
    const label = formatMonth(day).toUpperCase();
    const last = months[months.length - 1];
    if (last && last.label === label){
      last.count += 1;
    } else {
      months.push({ label, count: 1, start: index });
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.8);
  months.forEach((month) => {
    const left = x + (month.start * dayWidth);
    const monthWidth = month.count * dayWidth;
    doc.setFillColor(243, 232, 255);
    doc.setDrawColor(196, 181, 253);
    doc.rect(left, y, monthWidth, 6, "FD");
    doc.setTextColor(109, 40, 217);
    doc.text(month.label, left + (monthWidth / 2), y + 4, { align: "center" });
  });

  slots.forEach((slot, index) => {
    const left = x + (diffDays(range.start, slot.start) * dayWidth);
    const spanDays = Math.max(1, diffDays(slot.start, slot.end) + 1);
    const weekWidth = spanDays * dayWidth;
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(226, 232, 240);
    doc.rect(left, y + 6, weekWidth, 8, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(4.6);
    doc.setTextColor(30, 41, 59);
    doc.text(`S${index + 1}`, left + (weekWidth / 2), y + 9.2, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.text(`${formatShortDate(slot.start)}-${formatShortDate(slot.end)}`, left + (weekWidth / 2), y + 12.2, { align: "center" });
  });

  for (let index = 0; index < totalDays; index += 1){
    const day = addDays(range.start, index);
    const left = x + (index * dayWidth);
    doc.setFillColor(day.getDay() === 0 || day.getDay() === 6 ? 248 : 255, day.getDay() === 0 || day.getDay() === 6 ? 250 : 255, day.getDay() === 0 || day.getDay() === 6 ? 252 : 255);
    doc.setDrawColor(226, 232, 240);
    doc.rect(left, y + 14, dayWidth, 5, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(4.6);
    doc.setTextColor(51, 65, 85);
    doc.text(weekDayLetter(day), left + (dayWidth / 2), y + 17.5, { align: "center" });
  }
}

function drawPdfPageHeader(doc, project, range, page, totalPages){
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(17, 24, 39);
  doc.text(`Gantt do Projeto: ${project?.name || "Projeto"}`, 10, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Periodo: ${formatDate(range.start)} a ${formatDate(range.end)}`, 10, 18);
  doc.text(`Pagina ${page} de ${totalPages}`, pageWidth - 10, 12, { align: "right" });
}

function drawPdfLegend(doc, y){
  const items = [
    ["Planejado", "planned"],
    ["Em andamento", "progress"],
    ["Concluido", "done"],
    ["Atrasado", "late"],
    ["Sem atividades", "neutral"]
  ];
  let x = 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  items.forEach(([label, tone]) => {
    const color = toneColor(tone);
    doc.setFillColor(color[0], color[1], color[2]);
    doc.circle(x + 2, y - 1.5, 1.6, "F");
    doc.setTextColor(71, 85, 105);
    doc.text(label, x + 6, y);
    x += 36;
  });
}

async function printProjectGanttPdf({ project, rows, range, slots }){
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  const totalDays = Math.max(1, diffDays(range.start, range.end) + 1);
  const taskRowsPerPage = 14;
  const taskPages = Math.max(1, Math.ceil(rows.length / taskRowsPerPage));
  const activityRows = rows.flatMap((row) => row.activities.map(activity => ({ row, activity })));
  const detailRowsPerPage = 28;
  const detailPages = Math.max(1, Math.ceil(activityRows.length / detailRowsPerPage));
  const totalPages = taskPages + detailPages;
  let pageNumber = 1;

  for (let pageIndex = 0; pageIndex < taskPages; pageIndex += 1){
    if (pageIndex > 0) doc.addPage("a4", "landscape");
    const pageWidth = doc.internal.pageSize.getWidth();
    const timelineX = 76;
    const timelineWidth = pageWidth - timelineX - 10;
    const dayWidth = timelineWidth / totalDays;
    drawPdfPageHeader(doc, project, range, pageNumber, totalPages);
    pageNumber += 1;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(17, 24, 39);
    doc.text("Cronograma das tarefas", 10, 25);

    const headerY = 30;
    doc.setFillColor(0, 43, 92);
    doc.rect(10, headerY, 66, 19, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text("Tarefa", 13, headerY + 8);
    doc.text("Periodo / progresso", 13, headerY + 14);
    drawPdfScale(doc, range, slots, timelineX, headerY, timelineWidth);

    const pageRows = rows.slice(pageIndex * taskRowsPerPage, (pageIndex + 1) * taskRowsPerPage);
    let y = 54;
    pageRows.forEach((row) => {
      const color = toneColor(row.tone);
      const doneCount = row.activities.filter(isCompletedStatus).length;
      const completion = row.activities.length ? Math.round((doneCount / row.activities.length) * 100) : 0;
      const rowH = 9;
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(255, 255, 255);
      doc.rect(10, y - 6, pageWidth - 20, rowH, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.2);
      doc.setTextColor(17, 24, 39);
      drawPdfText(doc, `#${row.number} ${row.name}`, 13, y - 2, 56, { maxLines: 1 });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.5);
      doc.setTextColor(71, 85, 105);
      doc.text(`${formatDate(row.start)} a ${formatDate(row.end)} | ${completion}% | ${row.activities.length} ativ.`, 13, y + 2.3);

      const startOffset = clamp(diffDays(range.start, row.start), 0, totalDays);
      const duration = Math.max(1, diffDays(row.start, row.end) + 1);
      const left = timelineX + (startOffset * dayWidth);
      const width = Math.max(2, Math.min(timelineWidth - (left - timelineX), duration * dayWidth));
      doc.setFillColor(color[0], color[1], color[2]);
      doc.roundedRect(left, y - 3.7, width, 4.8, 1.8, 1.8, "F");
      y += rowH;
    });

    drawPdfLegend(doc, doc.internal.pageSize.getHeight() - 7);
  }

  for (let pageIndex = 0; pageIndex < detailPages; pageIndex += 1){
    doc.addPage("a4", "portrait");
    const pageWidth = doc.internal.pageSize.getWidth();
    drawPdfPageHeader(doc, project, range, pageNumber, totalPages);
    pageNumber += 1;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(17, 24, 39);
    doc.text("Detalhamento das atividades", 10, 25);

    const headerY = 31;
    const columns = [
      { label: "Tarefa", x: 10, w: 33 },
      { label: "Atividade", x: 45, w: 52 },
      { label: "Responsavel", x: 99, w: 39 },
      { label: "Data", x: 140, w: 20 },
      { label: "Status", x: 162, w: 28 },
      { label: "Horas", x: 192, w: 8 }
    ];
    doc.setFillColor(0, 43, 92);
    doc.rect(10, headerY, pageWidth - 20, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(255, 255, 255);
    columns.forEach(column => doc.text(column.label, column.x + 2, headerY + 5.2));

    const pageRows = activityRows.slice(pageIndex * detailRowsPerPage, (pageIndex + 1) * detailRowsPerPage);
    let y = headerY + 13;
    if (!pageRows.length){
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text("Nenhuma atividade vinculada ao projeto.", 12, y);
    }
    pageRows.forEach(({ row, activity }, index) => {
      const color = toneColor(activity.tone);
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(index % 2 === 0 ? 255 : 248, index % 2 === 0 ? 255 : 250, index % 2 === 0 ? 255 : 252);
      doc.rect(10, y - 5, pageWidth - 20, 8, "FD");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.8);
      doc.setTextColor(30, 41, 59);
      drawPdfText(doc, `#${row.number} ${row.name}`, 12, y, 30, { maxLines: 1 });
      drawPdfText(doc, activity.name, 47, y, 48, { maxLines: 1 });
      drawPdfText(doc, activity.techNames, 101, y, 35, { maxLines: 1 });
      doc.text(formatDate(activity.date), 142, y);
      doc.setFillColor(color[0], color[1], color[2]);
      doc.circle(165, y - 1.6, 1.5, "F");
      doc.setTextColor(30, 41, 59);
      drawPdfText(doc, activity.status, 169, y, 20, { maxLines: 1 });
      doc.text(`${activity.hours || 0}h`, 194, y);
      y += 8;
    });
  }

  doc.save(`${normalizeFileName(`gantt-${project?.projectNumber || ""}-${project?.name || "projeto"}`)}.pdf`);
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
  const dayWidth = 16;
  const totalDays = Math.max(1, diffDays(range.start, range.end) + 1);
  const timelineWidth = totalDays * dayWidth;
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
            <div class="project-gantt-timeline" style="width:${timelineWidth}px;--gantt-day-width:${dayWidth}px">
              <div class="project-gantt-scale">${renderScale(slots, dayWidth, range)}</div>
              ${renderMonthDividers(range, dayWidth)}
            </div>
          </div>
          ${rows.map(row => renderRow(row, range, slots, dayWidth)).join("")}
        </div>
      </div>
      <div class="project-gantt-legend">
        <span><i style="background:#6366f1"></i> Planejado</span>
        <span><i style="background:#14b8a6"></i> Em andamento</span>
        <span><i style="background:#22c55e"></i> Concluido</span>
        <span><i style="background:#ef4444"></i> Atrasado</span>
        <span><i style="background:#94a3b8"></i> Sem atividades</span>
      </div>
      <div class="project-gantt-hint">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
          <path d="M12 11v5M12 8h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
        <span>Passe o mouse sobre o dia da atividade para ver responsavel, status e horas.</span>
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
