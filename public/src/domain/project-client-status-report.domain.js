function asNumber(value){
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function clamp(value, min, max){
  return Math.max(min, Math.min(max, value));
}

function parseDate(value){
  const raw = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function formatDate(value){
  const raw = String(value || "").slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "-";
}

function formatPercent(value){
  return `${Math.round(asNumber(value))}%`;
}

function normalizeFileName(value){
  return String(value || "status-report-cliente")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function statusLabel(status){
  const raw = String(status || "").trim().toLowerCase();
  const map = {
    "a-fazer": "A fazer",
    "em-andamento": "Em andamento",
    "go-live": "Go live",
    "concluido": "Concluido",
    "parado": "Parado",
    "backlog": "Backlog",
    "sem_os": "Sem OS",
    "os_gerada": "OS enviada",
    "os_aprovada": "OS aprovada"
  };
  return map[raw] || (status || "-");
}

function isCompletedStatus(activity){
  const status = String(activity?.status || "").toLowerCase();
  return status === "os_gerada" || status === "os_aprovada";
}

function isOverdueActivity(activity, today){
  const workDate = parseDate(activity?.workDate);
  return Boolean(workDate && workDate < today && !isCompletedStatus(activity));
}

function getUserName(users, uid){
  const user = (Array.isArray(users) ? users : []).find(item => item.uid === uid || item.id === uid);
  return user?.name || user?.email || uid || "-";
}

function firstName(value){
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0] || "";
}

function getParticipantFirstNames(project, activities, users){
  const uidSet = new Set();
  (Array.isArray(project?.techUids) ? project.techUids : [])
    .filter(Boolean)
    .forEach(uid => uidSet.add(uid));
  (Array.isArray(activities) ? activities : []).forEach((activity) => {
    (Array.isArray(activity?.techUids) ? activity.techUids : [])
      .filter(Boolean)
      .forEach(uid => uidSet.add(uid));
  });
  const names = Array.from(uidSet)
    .map(uid => firstName(getUserName(users, uid)))
    .filter(Boolean);
  return names.length ? names.join(", ") : "-";
}

function buildClientReportData({ project, tasks, activities, state }){
  const users = Array.isArray(state?._usersCache) ? state._usersCache : [];
  const teams = Array.isArray(state?.teams) ? state.teams : [];
  const clients = Array.isArray(state?._clientsCache) ? state._clientsCache : [];
  const taskList = Array.isArray(tasks) ? tasks : [];
  const activityList = Array.isArray(activities) ? activities : [];
  const client = clients.find(item => item.id === project?.clientId) || null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const completedActivities = activityList.filter(isCompletedStatus).length;
  const pendingActivities = Math.max(0, activityList.length - completedActivities);
  const overdueActivities = activityList.filter(activity => isOverdueActivity(activity, today)).length;
  const billingHours = asNumber(project?.billingHours);
  const plannedActivityHours = activityList.reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const executedHours = activityList
    .filter(isCompletedStatus)
    .reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const completionByHours = billingHours > 0
    ? clamp((executedHours / billingHours) * 100, 0, 100)
    : (activityList.length ? clamp((completedActivities / activityList.length) * 100, 0, 100) : 0);
  const plannedByHours = billingHours > 0 ? clamp((plannedActivityHours / billingHours) * 100, 0, 100) : completionByHours;

  const startDate = parseDate(project?.startDate);
  const endDate = parseDate(project?.endDate);
  let plannedPercent = plannedByHours;
  if (startDate && endDate && endDate > startDate){
    const elapsed = clamp(today.getTime() - startDate.getTime(), 0, endDate.getTime() - startDate.getTime());
    plannedPercent = clamp((elapsed / (endDate.getTime() - startDate.getTime())) * 100, 0, 100);
  }

  const statusTone = overdueActivities > 0
    ? "attention"
    : (completionByHours + 5 >= plannedPercent ? "good" : "attention");
  const statusText = statusTone === "good" ? "Dentro do esperado" : "Ponto de atencao";

  const deliverables = taskList.slice(0, 8).map((task) => {
    const taskActivities = activityList.filter(activity => activity.taskId === task.id);
    const done = taskActivities.filter(isCompletedStatus).length;
    const completion = taskActivities.length ? Math.round((done / taskActivities.length) * 100) : 0;
    const late = taskActivities.some(activity => isOverdueActivity(activity, today));
    return {
      name: task.name || `Tarefa #${task.taskNumber || "-"}`,
      period: `${formatDate(task.startDate)} a ${formatDate(task.endDate)}`,
      forecast: formatDate(task.endDate),
      completion,
      status: completion >= 100 ? "Concluida" : (late ? "Em atencao" : "Em andamento"),
      tone: completion >= 100 ? "good" : (late ? "attention" : "neutral")
    };
  });

  const taskMap = new Map(taskList.map(task => [task.id, task]));
  const nextActions = activityList
    .filter(activity => !isCompletedStatus(activity))
    .sort((a, b) => String(a.workDate || "").localeCompare(String(b.workDate || "")))
    .slice(0, 5)
    .map((activity) => {
      const task = taskMap.get(activity.taskId);
      return {
        text: activity.name || task?.name || "Atividade pendente",
        task: task?.name || activity.taskName || "-",
        date: formatDate(activity.workDate),
        tone: isOverdueActivity(activity, today) ? "attention" : "neutral"
      };
    });

  while (nextActions.length < 3 && nextActions.length < taskList.length){
    const task = taskList[nextActions.length];
    nextActions.push({
      text: task?.name || "Proxima entrega",
      task: "Tarefa do projeto",
      date: formatDate(task?.endDate),
      tone: "neutral"
    });
  }

  const attentionPoints = [];
  if (overdueActivities > 0){
    attentionPoints.push({
      point: `${overdueActivities} atividade(s) com prazo vencido`,
      action: "Replanejamento e acompanhamento com responsaveis"
    });
  }
  if (pendingActivities > 0){
    attentionPoints.push({
      point: `${pendingActivities} atividade(s) ainda em andamento`,
      action: "Manter acompanhamento das proximas entregas"
    });
  }
  if (!attentionPoints.length){
    attentionPoints.push({
      point: "Sem pontos criticos identificados",
      action: "Manter rotina de acompanhamento"
    });
  }

  const summaryText = statusTone === "good"
    ? "O projeto segue dentro do esperado, com acompanhamento das entregas previstas e evolucao registrada no periodo."
    : "O projeto possui pontos de atencao em prazo ou atividades pendentes. As acoes de acompanhamento estao indicadas para manter a visibilidade da evolucao.";

  return {
    generatedAt: new Date(),
    project: {
      number: project?.projectNumber || "-",
      name: project?.name || "Projeto",
      description: project?.description || "Acompanhamento do projeto.",
      status: statusLabel(project?.status),
      startDate: formatDate(project?.startDate),
      endDate: formatDate(project?.endDate)
    },
    client: {
      name: client?.name || project?.clientName || "-"
    },
    company: {
      name: state?.company?.displayName || state?.company?.name || "FlowProject"
    },
    contacts: {
      managerName: getUserName(users, project?.managerUid),
      coordinatorName: getUserName(users, project?.coordinatorUid),
      participantNames: getParticipantFirstNames(project, activityList, users),
      teamName: teams.find(team => team.id === project?.teamId)?.name || project?.teamName || "-"
    },
    summary: {
      completion: completionByHours,
      planned: plannedPercent,
      completedActivities,
      pendingActivities,
      overdueActivities,
      statusTone,
      statusText,
      summaryText
    },
    deliverables,
    nextActions,
    attentionPoints: attentionPoints.slice(0, 5)
  };
}

function setTextColor(doc, color){
  doc.setTextColor(color[0], color[1], color[2]);
}

function setFillColor(doc, color){
  doc.setFillColor(color[0], color[1], color[2]);
}

function drawSection(doc, x, y, w, h, title){
  doc.setDrawColor(215, 222, 235);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, h, 2, 2, "FD");
  doc.setFillColor(0, 72, 124);
  doc.roundedRect(x, y, w, 8, 1.8, 1.8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.8);
  doc.setTextColor(255, 255, 255);
  doc.text(title, x + (w / 2), y + 5.2, { align: "center" });
}

function drawStatusDot(doc, x, y, tone, size = 5){
  const colors = {
    good: [34, 149, 88],
    attention: [245, 158, 11],
    neutral: [148, 163, 184]
  };
  const color = colors[tone] || colors.neutral;
  setFillColor(doc, color);
  doc.circle(x, y, size / 2, "F");
}

function drawInfoRows(doc, x, y, w, rows){
  const rowH = 7;
  rows.forEach((row, index) => {
    const top = y + (index * rowH);
    doc.setDrawColor(225, 231, 240);
    doc.line(x, top + rowH, x + w, top + rowH);
    doc.line(x + 37, top, x + 37, top + rowH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.4);
    doc.setTextColor(22, 32, 51);
    doc.text(row.label, x + 3, top + 4.6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.4);
    const lines = doc.splitTextToSize(String(row.value || "-"), w - 43).slice(0, 2);
    doc.text(lines, x + 40, top + 4.3);
  });
}

function drawMiniTable(doc, x, y, w, columns, rows, options = {}){
  const rowH = options.rowH || 8;
  const headerH = 7;
  const total = columns.reduce((sum, col) => sum + col.width, 0);
  const widths = columns.map(col => (col.width / total) * w);
  doc.setFillColor(244, 247, 252);
  doc.rect(x, y, w, headerH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.9);
  doc.setTextColor(25, 35, 55);
  let cx = x;
  columns.forEach((col, index) => {
    doc.text(col.label, cx + 2, y + 4.6);
    cx += widths[index];
  });
  rows.forEach((row, rowIndex) => {
    const top = y + headerH + (rowIndex * rowH);
    doc.setDrawColor(226, 232, 240);
    doc.line(x, top + rowH, x + w, top + rowH);
    cx = x;
    columns.forEach((col, index) => {
      doc.setFont("helvetica", col.bold ? "bold" : "normal");
      doc.setFontSize(5.8);
      doc.setTextColor(30, 41, 59);
      const value = String(row[col.key] ?? "-");
      const lines = doc.splitTextToSize(value, widths[index] - 4).slice(0, 2);
      doc.text(lines, cx + 2, top + 4.1);
      cx += widths[index];
    });
  });
}

function drawSummaryCard(doc, x, y, w, label, value, tone){
  const colors = {
    good: [34, 149, 88],
    attention: [245, 158, 11],
    neutral: [0, 72, 124]
  };
  doc.setDrawColor(215, 222, 235);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, 22, 3, 3, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(w < 25 ? 5.6 : 6.5);
  doc.setTextColor(90, 100, 120);
  doc.text(label.toUpperCase(), x + 4, y + 7);
  setTextColor(doc, colors[tone] || colors.neutral);
  doc.setFontSize(w < 25 ? 12 : 14);
  doc.text(String(value), x + 4, y + 16);
}

export async function downloadProjectClientStatusReportPdf(payload){
  const data = buildClientReportData(payload);
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, 210, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(0, 72, 124);
  doc.text("STATUS REPORT DO PROJETO", 8, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(22, 32, 51);
  doc.text(`Acompanhamento para o cliente: ${data.project.name}`, 8, 19);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.7);
  doc.setTextColor(0, 72, 124);
  doc.text("Data do Report:", 174, 9);
  doc.text("Cliente:", 218, 9);
  doc.text("Gerente do Projeto:", 252, 9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(22, 32, 51);
  doc.text(data.generatedAt.toLocaleDateString("pt-BR"), 174, 15);
  doc.text(data.client.name, 218, 15);
  doc.text(data.contacts.managerName, 252, 15);

  drawSection(doc, 6, 25, 104, 52, "INFORMACOES DO PROJETO");
  drawInfoRows(doc, 7, 34, 102, [
    { label: "Projeto:", value: data.project.name },
    { label: "Cliente:", value: data.client.name },
    { label: "Objetivo:", value: data.project.description },
    { label: "Inicio:", value: data.project.startDate },
    { label: "Prazo previsto:", value: data.project.endDate },
    { label: "Status:", value: data.project.status }
  ]);

  drawSection(doc, 113, 25, 75, 52, "STATUS GERAL");
  drawStatusDot(doc, 127, 45, data.summary.statusTone, 15);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(data.summary.statusTone === "good" ? 34 : 245, data.summary.statusTone === "good" ? 149 : 158, data.summary.statusTone === "good" ? 88 : 11);
  doc.text(data.summary.statusText.toUpperCase(), 140, 47);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.1);
  doc.setTextColor(22, 32, 51);
  doc.text(doc.splitTextToSize(data.summary.summaryText, 62), 121, 59);

  drawSection(doc, 191, 25, 100, 52, "INDICADORES DE ACOMPANHAMENTO");
  drawSummaryCard(doc, 195, 38, 22, "Realizado", formatPercent(data.summary.completion), "good");
  drawSummaryCard(doc, 219, 38, 22, "Planejado", formatPercent(data.summary.planned), "neutral");
  drawSummaryCard(doc, 243, 38, 22, "Pendentes", String(data.summary.pendingActivities), data.summary.pendingActivities ? "attention" : "good");
  drawSummaryCard(doc, 267, 38, 20, "Atrasos", String(data.summary.overdueActivities), data.summary.overdueActivities ? "attention" : "good");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.4);
  doc.setTextColor(90, 100, 120);
  doc.text("Indicadores sem informacoes financeiras ou custos internos.", 197, 69);

  drawSection(doc, 6, 81, 136, 66, "ENTREGAS DO PROJETO");
  drawMiniTable(doc, 8, 91, 132, [
    { key: "name", label: "Entrega", width: 2.6, bold: true },
    { key: "period", label: "Periodo", width: 1.3 },
    { key: "status", label: "Status", width: 1 },
    { key: "completion", label: "Conclusao", width: .8 },
    { key: "forecast", label: "Prevista", width: .9 }
  ], data.deliverables.map(item => ({
    name: item.name,
    period: item.period,
    status: item.status,
    completion: `${item.completion}%`,
    forecast: item.forecast
  })), { rowH: 7 });

  drawSection(doc, 145, 81, 71, 66, "PROXIMAS ACOES");
  data.nextActions.slice(0, 5).forEach((item, index) => {
    const y = 94 + (index * 10);
    drawStatusDot(doc, 153, y - 1.5, item.tone, 5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.3);
    doc.setTextColor(22, 32, 51);
    doc.text(doc.splitTextToSize(item.text, 43).slice(0, 1), 158, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    doc.setTextColor(90, 100, 120);
    doc.text(doc.splitTextToSize(item.task, 43).slice(0, 1), 158, y + 4);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 72, 124);
    doc.text(item.date, 211, y, { align: "right" });
  });

  drawSection(doc, 219, 81, 72, 66, "PONTOS DE ATENCAO");
  drawMiniTable(doc, 221, 91, 68, [
    { key: "point", label: "Ponto", width: 1.6, bold: true },
    { key: "action", label: "Acao", width: 1.6 }
  ], data.attentionPoints.map(item => ({
    point: item.point,
    action: item.action
  })), { rowH: 10 });

  drawSection(doc, 6, 151, 136, 38, "COMENTARIOS");
  doc.setTextColor(0, 72, 124);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("\"", 13, 169);
  doc.text("\"", 133, 183);
  doc.setTextColor(22, 32, 51);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(doc.splitTextToSize(data.summary.summaryText, 104), 23, 166);

  drawSection(doc, 145, 151, 146, 38, "CONTATOS DO PROJETO");
  drawInfoRows(doc, 148, 162, 140, [
    { label: "Gestor:", value: data.contacts.managerName },
    { label: "Coordenador:", value: data.contacts.coordinatorName },
    { label: "Equipe:", value: data.contacts.participantNames }
  ]);

  doc.setDrawColor(211, 218, 230);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(6, 193, 285, 10, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  doc.setTextColor(0, 72, 124);
  doc.text("LEGENDA", 18, 199.5);
  [
    ["good", "Dentro do esperado"],
    ["attention", "Ponto de atencao"],
    ["neutral", "Em andamento / informativo"]
  ].forEach((item, index) => {
    const x = 52 + (index * 62);
    drawStatusDot(doc, x, 198, item[0], 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    doc.setTextColor(22, 32, 51);
    doc.text(item[1], x + 5, 199.5);
  });

  const filename = `${normalizeFileName(`status-report-cliente-${data.project.number}-${data.project.name}`)}.pdf`;
  doc.save(filename);
}
