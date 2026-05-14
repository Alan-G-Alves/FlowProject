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

function formatPercent(value, digits = 0){
  return `${asNumber(value).toFixed(digits).replace(".", ",")}%`;
}

function formatDecimal(value){
  return asNumber(value).toFixed(2).replace(".", ",");
}

function formatCurrency(value){
  return asNumber(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function normalizeFileName(value){
  return String(value || "status-report-executivo")
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

function getTechNames(activity, users){
  if (Array.isArray(activity?.techNames) && activity.techNames.length){
    return activity.techNames.filter(Boolean).join(", ");
  }
  const ids = Array.isArray(activity?.techUids) ? activity.techUids.filter(Boolean) : [];
  const names = ids.map(uid => getUserName(users, uid)).filter(Boolean);
  return names.length ? names.join(", ") : "-";
}

function buildExecutiveReportData({ project, tasks, activities, state, expenseSummary }){
  const users = Array.isArray(state?._usersCache) ? state._usersCache : [];
  const teams = Array.isArray(state?.teams) ? state.teams : [];
  const clients = Array.isArray(state?._clientsCache) ? state._clientsCache : [];
  const taskList = Array.isArray(tasks) ? tasks : [];
  const activityList = Array.isArray(activities) ? activities : [];
  const client = clients.find(item => item.id === project?.clientId) || null;
  const teamName = teams.find(team => team.id === project?.teamId)?.name || project?.teamName || "-";
  const managerName = getUserName(users, project?.managerUid);
  const coordinatorName = getUserName(users, project?.coordinatorUid);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const billingHours = asNumber(project?.billingHours);
  const billingValue = asNumber(project?.billingValue);
  const plannedActivityHours = activityList.reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const executedHours = activityList
    .filter(isCompletedStatus)
    .reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const completedActivities = activityList.filter(isCompletedStatus).length;
  const overdueActivities = activityList.filter(activity => isOverdueActivity(activity, today)).length;
  const pendingActivities = Math.max(0, activityList.length - completedActivities);
  const plannedPercentByHours = billingHours > 0 ? clamp((plannedActivityHours / billingHours) * 100, 0, 100) : 0;
  const realizedPercent = billingHours > 0
    ? clamp((executedHours / billingHours) * 100, 0, 100)
    : (activityList.length ? clamp((completedActivities / activityList.length) * 100, 0, 100) : 0);

  const startDate = parseDate(project?.startDate);
  const endDate = parseDate(project?.endDate);
  let plannedPercent = plannedPercentByHours;
  if (startDate && endDate && endDate > startDate){
    const elapsed = clamp(today.getTime() - startDate.getTime(), 0, endDate.getTime() - startDate.getTime());
    plannedPercent = clamp((elapsed / (endDate.getTime() - startDate.getTime())) * 100, 0, 100);
  }

  const approvedInternalExpenses = asNumber(expenseSummary?.approvedInternal);
  const pendingExpenses = asNumber(expenseSummary?.totalPending);
  const estimatedTechCost = activityList.reduce((acc, activity) => {
    const techIds = Array.isArray(activity.techUids) ? activity.techUids.filter(Boolean) : [];
    const hours = asNumber(activity.hoursWorked);
    if (!hours || !techIds.length) return acc;
    const rate = techIds.reduce((sum, uid) => {
      const tech = users.find(user => user.uid === uid || user.id === uid);
      return sum + asNumber(tech?.hourlyRate);
    }, 0);
    return acc + (rate * hours);
  }, 0);
  const actualCost = estimatedTechCost + approvedInternalExpenses;
  const earnedValue = billingValue > 0 ? billingValue * (realizedPercent / 100) : 0;
  const spi = plannedPercent > 0 ? clamp(realizedPercent / plannedPercent, 0, 2) : (realizedPercent > 0 ? 1 : 0);
  const cpi = actualCost > 0 && earnedValue > 0 ? clamp(earnedValue / actualCost, 0, 2) : (billingValue > 0 ? 1 : 0);
  const quality = activityList.length
    ? clamp(100 - ((overdueActivities / activityList.length) * 100), 0, 100)
    : 100;

  const overallTone = overdueActivities > 0 || spi < 0.9
    ? "attention"
    : (spi >= 0.98 && quality >= 95 ? "good" : "attention");
  const overallStatus = overallTone === "good" ? "NO PRAZO" : "ATENCAO";

  const taskMap = new Map(taskList.map(task => [task.id, task]));
  const deliverables = taskList.slice(0, 7).map((task) => {
    const taskActivities = activityList.filter(activity => activity.taskId === task.id);
    const done = taskActivities.filter(isCompletedStatus).length;
    const completion = taskActivities.length ? Math.round((done / taskActivities.length) * 100) : 0;
    const hasLate = taskActivities.some(activity => isOverdueActivity(activity, today));
    return {
      name: task.name || `Tarefa #${task.taskNumber || "-"}`,
      completion,
      forecast: formatDate(task.endDate),
      tone: completion >= 100 ? "good" : (hasLate ? "critical" : (completion > 0 ? "attention" : "neutral"))
    };
  });

  const upcomingActions = activityList
    .filter(activity => !isCompletedStatus(activity))
    .sort((a, b) => String(a.workDate || "").localeCompare(String(b.workDate || "")))
    .slice(0, 4)
    .map((activity) => {
      const task = taskMap.get(activity.taskId);
      return {
        text: activity.name || task?.name || "Atividade pendente",
        date: formatDate(activity.workDate),
        tone: isOverdueActivity(activity, today) ? "critical" : "attention"
      };
    });

  while (upcomingActions.length < 4 && upcomingActions.length < taskList.length){
    const task = taskList[upcomingActions.length];
    upcomingActions.push({ text: task?.name || "Proxima tarefa", date: formatDate(task?.endDate), tone: "neutral" });
  }

  const risks = [];
  if (overdueActivities > 0){
    risks.push({
      title: `${overdueActivities} atividade(s) atrasada(s)`,
      impact: "Alto",
      action: "Replanejar datas e priorizar responsaveis"
    });
  }
  if (pendingExpenses > 0){
    risks.push({
      title: "Despesas pendentes de aprovacao",
      impact: "Medio",
      action: "Concluir aprovacao financeira"
    });
  }
  if (spi < 0.98){
    risks.push({
      title: "Execucao abaixo do planejado",
      impact: spi < 0.85 ? "Alto" : "Medio",
      action: "Acompanhar entregas criticas"
    });
  }
  if (!risks.length){
    risks.push({ title: "Sem riscos criticos registrados", impact: "Baixo", action: "Manter acompanhamento semanal" });
  }

  const decisions = [];
  if (overdueActivities > 0) decisions.push("Validar novo plano de recuperacao do cronograma");
  if (pendingExpenses > 0) decisions.push("Definir aprovacao das despesas pendentes");
  if (pendingActivities > 0) decisions.push("Confirmar prioridade das proximas atividades");
  while (decisions.length < 3) decisions.push("Sem decisao critica pendente no momento");

  const comment = overallTone === "good"
    ? "O projeto segue dentro do esperado, com entregas controladas e sem desvios criticos identificados nos dados atuais."
    : "O projeto exige acompanhamento executivo por apresentar desvios em prazo, atividades pendentes ou pontos que precisam de acao para recuperar o plano.";

  return {
    generatedAt: new Date(),
    project: {
      number: project?.projectNumber || "-",
      name: project?.name || "Projeto",
      description: project?.description || "Projeto acompanhado pelo FlowProject.",
      status: statusLabel(project?.status),
      startDate: formatDate(project?.startDate),
      endDate: formatDate(project?.endDate),
      billingHours,
      billingValue
    },
    client: {
      name: client?.name || project?.clientName || "-"
    },
    company: {
      name: state?.company?.displayName || state?.company?.name || "FlowProject"
    },
    summary: {
      teamName,
      managerName,
      coordinatorName,
      plannedPercent,
      realizedPercent,
      plannedActivityHours,
      executedHours,
      pendingActivities,
      completedActivities,
      overdueActivities,
      pendingExpenses,
      actualCost,
      spi,
      cpi,
      quality,
      overallStatus,
      overallTone,
      comment
    },
    deliverables,
    upcomingActions,
    risks: risks.slice(0, 5),
    decisions: decisions.slice(0, 3)
  };
}

function setColor(doc, color){
  doc.setTextColor(color[0], color[1], color[2]);
}

function fillColor(doc, color){
  doc.setFillColor(color[0], color[1], color[2]);
}

function drawSection(doc, x, y, w, h, title){
  doc.setDrawColor(211, 218, 230);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, h, 2, 2, "FD");
  doc.setFillColor(0, 43, 92);
  doc.roundedRect(x, y, w, 7, 1.6, 1.6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.6);
  doc.setTextColor(255, 255, 255);
  doc.text(title, x + (w / 2), y + 4.8, { align: "center" });
}

function drawLabelValueRows(doc, x, y, w, rows){
  const rowH = 6.5;
  rows.forEach((row, index) => {
    const top = y + (index * rowH);
    doc.setDrawColor(223, 228, 236);
    doc.line(x, top + rowH, x + w, top + rowH);
    doc.line(x + 38, top, x + 38, top + rowH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.4);
    doc.setTextColor(22, 32, 51);
    doc.text(row.label, x + 3, top + 4.2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.4);
    const lines = doc.splitTextToSize(String(row.value || "-"), w - 44).slice(0, 2);
    doc.text(lines, x + 41, top + 4);
  });
}

function drawStatusDot(doc, x, y, tone, size = 6){
  const colors = {
    good: [40, 167, 69],
    attention: [255, 193, 7],
    critical: [239, 68, 68],
    neutral: [196, 199, 204]
  };
  fillColor(doc, colors[tone] || colors.neutral);
  doc.circle(x, y, size / 2, "F");
}

function drawMetric(doc, x, y, w, title, icon, value, note, tone){
  const colors = {
    good: [40, 167, 69],
    attention: [245, 158, 11],
    critical: [220, 38, 38],
    neutral: [90, 100, 120]
  };
  const color = colors[tone] || colors.good;
  doc.setDrawColor(221, 226, 236);
  doc.line(x, y + 3, x, y + 39);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.7);
  doc.setTextColor(18, 27, 43);
  doc.text(title, x + (w / 2), y + 7, { align: "center" });
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(0.8);
  doc.circle(x + (w / 2), y + 17, 5, "S");
  doc.setLineWidth(0.2);
  setColor(doc, color);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(icon, x + (w / 2), y + 19.5, { align: "center" });
  doc.setFontSize(15);
  doc.text(value, x + (w / 2), y + 30, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.3);
  doc.setTextColor(45, 55, 72);
  doc.text(note, x + (w / 2), y + 36, { align: "center" });
}

function drawProgressChart(doc, x, y, w, h, plannedPercent, realizedPercent){
  const chartX = x + 12;
  const chartY = y + 12;
  const chartW = w - 25;
  const chartH = h - 25;
  doc.setDrawColor(226, 232, 240);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  doc.setTextColor(70, 80, 95);
  for (let i = 0; i <= 5; i += 1){
    const yy = chartY + chartH - ((chartH / 5) * i);
    doc.line(chartX, yy, chartX + chartW, yy);
    doc.text(`${i * 20}%`, x + 2, yy + 1.5);
  }
  const points = 7;
  const drawLine = (percent, color) => {
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setFillColor(color[0], color[1], color[2]);
    let prev = null;
    for (let i = 0; i < points; i += 1){
      const xPoint = chartX + ((chartW / (points - 1)) * i);
      const p = percent * ((i + 1) / points);
      const yPoint = chartY + chartH - (chartH * clamp(p, 0, 100) / 100);
      if (prev) doc.line(prev.x, prev.y, xPoint, yPoint);
      doc.circle(xPoint, yPoint, 0.8, "F");
      prev = { x: xPoint, y: yPoint };
    }
  };
  drawLine(plannedPercent, [0, 43, 92]);
  drawLine(realizedPercent, [40, 167, 69]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(0, 43, 92);
  doc.text(`Planejado: ${formatPercent(plannedPercent)}`, x + w - 34, y + 30);
  doc.setTextColor(40, 167, 69);
  doc.text(`Realizado: ${formatPercent(realizedPercent)}`, x + w - 34, y + 36);
  doc.setTextColor(0, 43, 92);
  doc.text("Planejado", x + 35, y + h - 6);
  doc.setTextColor(40, 167, 69);
  doc.text("Realizado", x + 60, y + h - 6);
}

function drawMiniTable(doc, x, y, w, columns, rows, options = {}){
  const rowH = options.rowH || 6.8;
  const headerH = options.headerH || 7;
  const widths = columns.map(col => col.width);
  const total = widths.reduce((sum, value) => sum + value, 0);
  const scaled = widths.map(value => (value / total) * w);
  doc.setFillColor(242, 246, 252);
  doc.rect(x, y, w, headerH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.8);
  doc.setTextColor(25, 35, 55);
  let cx = x;
  columns.forEach((col, index) => {
    doc.text(col.label, cx + 2, y + 4.5);
    cx += scaled[index];
  });
  rows.forEach((row, rowIndex) => {
    const top = y + headerH + (rowIndex * rowH);
    doc.setDrawColor(226, 232, 240);
    doc.line(x, top + rowH, x + w, top + rowH);
    cx = x;
    columns.forEach((col, colIndex) => {
      const text = String(row[col.key] ?? "-");
      doc.setFont("helvetica", col.bold ? "bold" : "normal");
      doc.setFontSize(5.7);
      doc.setTextColor(30, 41, 59);
      const lines = doc.splitTextToSize(text, scaled[colIndex] - 4).slice(0, 2);
      doc.text(lines, cx + 2, top + 4);
      cx += scaled[colIndex];
    });
  });
}

function drawPill(doc, x, y, text, tone){
  const colors = {
    Alto: [239, 68, 68],
    Medio: [245, 158, 11],
    Baixo: [40, 167, 69]
  };
  const color = colors[text] || colors[tone] || [148, 163, 184];
  fillColor(doc, color);
  doc.roundedRect(x, y, 16, 5, 2.5, 2.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.setTextColor(255, 255, 255);
  doc.text(text, x + 8, y + 3.5, { align: "center" });
}

export async function downloadProjectExecutiveStatusReportPdf(payload){
  const data = buildExecutiveReportData(payload);
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, 210, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.setTextColor(0, 43, 92);
  doc.text("STATUS REPORT", 7, 12);
  doc.setFontSize(9);
  doc.setTextColor(22, 32, 51);
  doc.text(`Visao Geral do Projeto: ${data.project.name}`, 7, 19);

  const headerItems = [
    { label: "Data do Report:", value: data.generatedAt.toLocaleDateString("pt-BR") },
    { label: "Periodo do Report:", value: `${data.project.startDate} a ${data.project.endDate}` },
    { label: "Gerente do Projeto:", value: data.summary.managerName }
  ];
  let hx = 164;
  headerItems.forEach((item) => {
    doc.setDrawColor(190, 198, 210);
    doc.line(hx - 6, 5, hx - 6, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.6);
    doc.setTextColor(0, 43, 92);
    doc.text(item.label, hx, 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.6);
    doc.setTextColor(22, 32, 51);
    doc.text(item.value, hx, 15);
    hx += 46;
  });

  drawSection(doc, 5, 24, 110, 55, "INFORMACOES DO PROJETO");
  drawLabelValueRows(doc, 6, 32, 108, [
    { label: "Nome do Projeto:", value: data.project.name },
    { label: "Cliente / Patrocinador:", value: data.client.name },
    { label: "Objetivo:", value: data.project.description },
    { label: "Inicio do Projeto:", value: data.project.startDate },
    { label: "Termino Previsto:", value: data.project.endDate },
    { label: "% Conclusao Planejado:", value: formatPercent(data.summary.plannedPercent) },
    { label: "% Conclusao Realizado:", value: formatPercent(data.summary.realizedPercent) }
  ]);

  drawSection(doc, 117, 24, 67, 55, "STATUS GERAL DO PROJETO");
  drawStatusDot(doc, 130, 46, data.summary.overallTone, 16);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(data.summary.overallTone === "good" ? 40 : 245, data.summary.overallTone === "good" ? 167 : 158, data.summary.overallTone === "good" ? 69 : 11);
  doc.text(data.summary.overallStatus, 142, 49);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.setTextColor(22, 32, 51);
  const statusText = data.summary.overallTone === "good"
    ? "Projeto dentro do esperado com base nas entregas registradas."
    : "Projeto com desvios que exigem acompanhamento e acoes de recuperacao.";
  doc.text(doc.splitTextToSize(statusText, 54), 122, 61);

  drawSection(doc, 186, 24, 106, 55, "INDICADORES CHAVE");
  drawMetric(doc, 188, 33, 34, "PRAZO (SPI)", "T", formatDecimal(data.summary.spi), data.summary.spi >= 0.98 ? "Dentro do esperado" : "Abaixo do planejado", data.summary.spi >= 0.98 ? "good" : "attention");
  drawMetric(doc, 223, 33, 34, "CUSTO (CPI)", "$", formatDecimal(data.summary.cpi), data.summary.cpi >= 0.98 ? "Dentro do esperado" : "Abaixo do esperado", data.summary.cpi >= 0.98 ? "good" : "attention");
  drawMetric(doc, 258, 33, 32, "QUALIDADE", "*", formatPercent(data.summary.quality), data.summary.quality >= 95 ? "Dentro do esperado" : "Pontos de atencao", data.summary.quality >= 95 ? "good" : "attention");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  doc.setTextColor(50, 60, 75);
  doc.text("Formulas: SPI = Realizado / Planejado | CPI = Valor Agregado / Custo Real", 193, 76);

  drawSection(doc, 5, 82, 102, 65, "PROGRESSO DO PROJETO");
  drawProgressChart(doc, 7, 86, 98, 59, data.summary.plannedPercent, data.summary.realizedPercent);

  drawSection(doc, 109, 82, 86, 65, "ENTREGAS");
  drawMiniTable(doc, 111, 91, 82, [
    { key: "name", label: "Entregas Principais", width: 2.8, bold: true },
    { key: "status", label: "Status", width: .7 },
    { key: "completion", label: "Conclusao", width: .9 },
    { key: "forecast", label: "Prevista", width: 1 }
  ], data.deliverables.map(item => ({
    name: item.name,
    status: item.tone === "good" ? "OK" : (item.tone === "critical" ? "!" : "-"),
    completion: `${item.completion}%`,
    forecast: item.forecast
  })), { rowH: 6.9 });

  drawSection(doc, 197, 82, 95, 65, "RISCOS E PROBLEMAS");
  drawMiniTable(doc, 199, 91, 91, [
    { key: "title", label: "Principais Riscos", width: 2.5, bold: true },
    { key: "impact", label: "Impacto", width: .75 },
    { key: "action", label: "Acao", width: 1.85 }
  ], data.risks.map(item => ({ title: item.title, impact: item.impact, action: item.action })), { rowH: 8.5 });
  data.risks.slice(0, 5).forEach((item, index) => drawPill(doc, 244, 99.2 + (index * 8.5), item.impact));

  drawSection(doc, 5, 151, 100, 39, "PROXIMAS ACOES");
  data.upcomingActions.slice(0, 4).forEach((item, index) => {
    const y = 162 + (index * 7.5);
    drawStatusDot(doc, 12, y - 1.7, item.tone, 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(22, 32, 51);
    doc.text(doc.splitTextToSize(item.text, 68).slice(0, 1), 18, y);
    doc.setFont("helvetica", "bold");
    doc.text(item.date, 89, y, { align: "right" });
  });

  drawSection(doc, 107, 151, 87, 39, "DECISOES NECESSARIAS");
  data.decisions.forEach((item, index) => {
    const y = 163 + (index * 8.5);
    doc.setFillColor(0, 95, 180);
    doc.circle(114, y - 2, 2.3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.text("?", 114, y, { align: "center" });
    doc.setTextColor(22, 32, 51);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text(doc.splitTextToSize(item, 70).slice(0, 2), 121, y);
  });

  drawSection(doc, 196, 151, 96, 39, "COMENTARIOS");
  doc.setTextColor(0, 80, 150);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("\"", 202, 169);
  doc.text("\"", 282, 184);
  doc.setTextColor(22, 32, 51);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.3);
  doc.text(doc.splitTextToSize(data.summary.comment, 72), 211, 170);

  doc.setDrawColor(211, 218, 230);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(5, 193, 287, 10, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  doc.setTextColor(0, 43, 92);
  doc.text("LEGENDA DE STATUS", 20, 199.5);
  [
    ["good", "No Prazo / Dentro do Esperado"],
    ["attention", "Atencao / Pequeno Desvio"],
    ["critical", "Critico / Atraso ou Fora do Esperado"],
    ["neutral", "Nao Iniciado / Nao Aplicavel"]
  ].forEach((item, index) => {
    const x = 58 + (index * 57);
    drawStatusDot(doc, x, 198, item[0], 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    doc.setTextColor(22, 32, 51);
    doc.text(item[1], x + 5, 199.5);
  });

  const filename = `${normalizeFileName(`status-report-executivo-${data.project.number}-${data.project.name}`)}.pdf`;
  doc.save(filename);
}
