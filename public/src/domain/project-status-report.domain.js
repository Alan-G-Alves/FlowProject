function asNumber(value){
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function formatDate(value){
  if (!value) return "-";
  const raw = String(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return String(value);
}

function normalizeFileName(value){
  return String(value || "status-report")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function escapeHtml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function isPlannedWithoutOs(activity){
  return !isCompletedStatus(activity);
}

function isOverdueActivity(activity, today){
  const workDate = String(activity?.workDate || "").slice(0, 10);
  if (!workDate) return false;
  const parsed = new Date(`${workDate}T00:00:00`);
  return parsed < today && !isCompletedStatus(activity);
}

function statusReportActivityLabel(activity, today){
  const raw = String(activity?.status || "").trim().toLowerCase();
  if (raw === "atrasada" || isOverdueActivity(activity, today)) return "Atrasada";
  if (isCompletedStatus(activity)) return "Concluida";
  return "Em Andamento";
}

function buildExecutiveSummary(data){
  const { project, summary } = data;
  const parts = [
    `O projeto está em ${project.status.toLowerCase()}.`,
    `Foram executadas ${summary.executedActivityHours}h de ${project.billingHours}h previstas.`,
    `Ha ${summary.plannedWithoutOsHours}h em atividades planejadas.`,
    `Há ${summary.activityCount} atividade(s) registradas em ${summary.taskCount} tarefa(s).`,
    `${summary.completedCount} atividade(s) estão concluídas e ${summary.pendingCount} seguem pendentes.`
  ];
  if (summary.overdueCount > 0){
    parts.push(`${summary.overdueCount} atividade(s) estão atrasadas e exigem acompanhamento.`);
  } else {
    parts.push("Não há atividades atrasadas no momento.");
  }
  return parts.join(" ");
}

function buildStatusReportData({ project, tasks, activities, state }){
  const users = Array.isArray(state?._usersCache) ? state._usersCache : [];
  const teams = Array.isArray(state?.teams) ? state.teams : [];
  const clients = Array.isArray(state?._clientsCache) ? state._clientsCache : [];
  const client = clients.find(item => item.id === project?.clientId) || null;
  const taskMap = new Map((Array.isArray(tasks) ? tasks : []).map(task => [task.id, task]));
  const sortedActivities = Array.isArray(activities)
    ? [...activities].sort((a, b) => String(a.workDate || "").localeCompare(String(b.workDate || "")))
    : [];
  const billingHours = asNumber(project?.billingHours);
  const plannedWithoutOsHours = sortedActivities
    .filter(activity => isPlannedWithoutOs(activity))
    .reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const executedActivityHours = sortedActivities
    .filter(activity => isCompletedStatus(activity))
    .reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  const completedCount = sortedActivities.filter(activity => isCompletedStatus(activity)).length;
  const pendingCount = sortedActivities.length - completedCount;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueCount = sortedActivities.filter((activity) => {
    return isOverdueActivity(activity, today);
  }).length;
  const teamName = teams.find(team => team.id === project?.teamId)?.name || "-";
  const managerName = users.find(user => user.uid === project?.managerUid)?.name || "-";
  const coordinatorName = users.find(user => user.uid === project?.coordinatorUid)?.name || "-";

  const taskRows = (Array.isArray(tasks) ? tasks : []).map((task) => {
    const taskActivities = sortedActivities.filter(activity => activity.taskId === task.id);
    const plannedWithoutOs = taskActivities
      .filter(activity => isPlannedWithoutOs(activity))
      .reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
    const hoursWorked = taskActivities
      .filter(activity => isCompletedStatus(activity))
      .reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
    return {
      number: task.taskNumber || "-",
      name: task.name || "-",
      period: `${formatDate(task.startDate)} a ${formatDate(task.endDate)}`,
      plannedHours: asNumber(task.plannedHours),
      plannedWithoutOsHours: plannedWithoutOs,
      workedHours: hoursWorked,
      activityCount: taskActivities.length
    };
  });

  const activityRows = sortedActivities.map((activity) => {
    const task = taskMap.get(activity.taskId);
    return {
      date: formatDate(activity.workDate),
      taskNumber: task?.taskNumber || "-",
      taskName: task?.name || activity.taskName || "-",
      activityName: activity.name || "-",
      keyUsers: Array.isArray(activity.keyUsers) && activity.keyUsers.length ? activity.keyUsers.join(", ") : "-",
      hours: asNumber(activity.hoursWorked),
      status: statusReportActivityLabel(activity, today)
    };
  });

  const data = {
    generatedAt: new Date(),
    project: {
      id: project?.id || "",
      number: project?.projectNumber || "-",
      name: project?.name || "Projeto",
      status: statusLabel(project?.status),
      endDate: formatDate(project?.endDate),
      billingHours
    },
    client: {
      id: client?.id || project?.clientId || "",
      name: client?.name || project?.clientName || "-",
      document: client?.cpfCnpj || "-",
      email: client?.email || "-",
      phone: client?.phone || "-",
      photoURL: client?.photoURL || "",
      reportPhotoDataUrl: client?.reportPhotoDataUrl || ""
    },
    summary: {
      teamName,
      managerName,
      coordinatorName,
      taskCount: taskRows.length,
      activityCount: activityRows.length,
      plannedWithoutOsHours,
      executedActivityHours,
      totalActivityHours: executedActivityHours,
      completedCount,
      pendingCount,
      overdueCount,
      projectConsumption: billingHours > 0 ? ((executedActivityHours / billingHours) * 100) : 0
    },
    taskRows,
    activityRows
  };

  data.summary.executiveSummary = buildExecutiveSummary(data);
  return data;
}

async function fetchImageAsDataUrl(url){
  if (!url) return "";
  if (/^https?:\/\//i.test(url)){
    try{
      const parsed = new URL(url, window.location.href);
      if (parsed.origin !== window.location.origin){
        return "";
      }
    }catch(_){
      return "";
    }
  }
  try{
    const res = await fetch(url);
    if (!res.ok) return "";
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }catch(_){
    return "";
  }
}

function buildReportHtml(data, options = {}){
  const { project, client, summary } = data;
  const includeClientImage = options.includeClientImage !== false;
  const includeClientContactInfo = options.includeClientContactInfo !== false;
  const bodyAttrs = includeClientContactInfo ? "" : ' class="hide-client-contact"';
  const taskRowsHtml = data.taskRows.map((task) => `
    <tr>
      <td>${escapeHtml(String(task.number))}</td>
      <td>${escapeHtml(task.name)}</td>
      <td>${escapeHtml(task.period)}</td>
      <td>${escapeHtml(`${task.plannedHours}h`)}</td>
      <td>${escapeHtml(`${task.plannedWithoutOsHours}h`)}</td>
      <td>${escapeHtml(`${task.workedHours}h`)}</td>
      <td>${escapeHtml(String(task.activityCount))}</td>
    </tr>
  `).join("");
  const activityRowsHtml = data.activityRows.map((activity) => `
    <tr>
      <td>${escapeHtml(activity.date)}</td>
      <td>#${escapeHtml(String(activity.taskNumber))}</td>
      <td>${escapeHtml(activity.taskName)}</td>
      <td>${escapeHtml(activity.activityName)}</td>
      <td>${escapeHtml(activity.keyUsers)}</td>
      <td>${escapeHtml(`${activity.hours}h`)}</td>
      <td>${escapeHtml(activity.status)}</td>
    </tr>
  `).join("");

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Status Report - ${escapeHtml(project.name)}</title>
        <style>
          body{font-family:Segoe UI,Arial,sans-serif;background:#eef3fb;color:#162033;margin:0;padding:24px}
          .report{max-width:1120px;margin:0 auto;background:#fff;border:1px solid #dbe5f1;border-radius:24px;overflow:hidden}
          .hero{padding:28px 30px;background:linear-gradient(135deg,#edf4ff,#ffffff 58%);border-bottom:1px solid #e5edf7}
          .hero-top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}
          .client-logo{width:82px;height:82px;border-radius:22px;object-fit:cover;border:1px solid #d8e3f2;background:#fff}
          .client-logo-fallback{width:82px;height:82px;border-radius:22px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#dfeaff,#f7faff);border:1px solid #d8e3f2;color:#4b5a74;font-size:26px;font-weight:800}
          .eyebrow{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:#6d58e4;font-weight:800}
          h1{margin:8px 0 8px;font-size:34px;line-height:1.04}
          .subtitle{margin:0;color:#5e687b;font-size:15px}
          .project-meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
          .pill{display:inline-flex;align-items:center;padding:10px 14px;border-radius:16px;border:1px solid #dce4f0;background:#fff;font-size:13px;font-weight:700;color:#22304b}
          .pill strong{margin-left:6px}
          .summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:24px 30px}
          .card{border:1px solid #dce4f0;border-radius:18px;padding:14px 16px;background:linear-gradient(180deg,#fff,#f9fbff)}
          .card .label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7a8599;font-weight:800}
          .card .value{font-size:24px;font-weight:800;color:#162033;margin-top:8px}
          .card .sub{font-size:12px;color:#5e687b;margin-top:4px}
          .executive-box{margin:0 30px 24px;padding:16px 18px;border-radius:18px;border:1px solid #dce4f0;background:linear-gradient(135deg,#f7faff,#ffffff)}
          .executive-box .label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7a8599;font-weight:800}
          .executive-box .text{margin-top:8px;font-size:14px;line-height:1.65;color:#24324a}
          .section{padding:0 30px 26px}
          .section h2{margin:0 0 14px;font-size:18px}
          .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
          .info{border:1px solid #dce4f0;border-radius:16px;padding:12px 14px;background:#fff}
          .info .label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#7a8599;font-weight:800}
          .info .value{margin-top:6px;font-size:17px;font-weight:700;color:#162033}
          .hide-client-contact .project-info-grid .info:nth-last-child(-n+2){display:none}
          table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dce4f0;border-radius:16px;overflow:hidden}
          th,td{padding:10px 12px;border-bottom:1px solid #e8eef6;text-align:left;font-size:12px;vertical-align:top}
          th{background:#f5f8fd;color:#5d687b;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
          .footer{padding:0 30px 28px;color:#6a7588;font-size:12px}
        </style>
      </head>
      <body${bodyAttrs}>
        <div class="report">
          <div class="hero">
            <div class="hero-top">
              <div>
                <div class="eyebrow">Status Report do Projeto</div>
                <h1>${escapeHtml(project.name)}</h1>
                <p class="subtitle">Relatorio executivo voltado ao cliente com o panorama atual do andamento do projeto.</p>
                <div class="project-meta">
                  <span class="pill">Projeto <strong>#${escapeHtml(String(project.number))}</strong></span>
                  <span class="pill">Status <strong>${escapeHtml(project.status)}</strong></span>
                  <span class="pill">Prazo final <strong>${escapeHtml(project.endDate)}</strong></span>
                </div>
              </div>
              ${includeClientImage ? (client.photoURL ? `<img class="client-logo" src="${escapeHtml(client.photoURL)}" alt="Logo do cliente" />` : `<div class="client-logo-fallback">${escapeHtml((client.name || "C").trim().slice(0, 1).toUpperCase())}</div>`) : ""}
            </div>
          </div>
          <div class="summary">
            <div class="card"><div class="label">Horas previstas</div><div class="value">${escapeHtml(`${project.billingHours}h`)}</div><div class="sub">Planejamento total do projeto</div></div>
            <div class="card"><div class="label">Horas planejadas</div><div class="value">${escapeHtml(`${summary.plannedWithoutOsHours}h`)}</div><div class="sub">Atividades planejadas</div></div>
            <div class="card"><div class="label">Horas executadas</div><div class="value">${escapeHtml(`${summary.executedActivityHours}h`)}</div><div class="sub">Consumo: ${escapeHtml(summary.projectConsumption.toFixed(1).replace(".", ","))}%</div></div>
            <div class="card"><div class="label">Atividades</div><div class="value">${escapeHtml(String(summary.activityCount))}</div><div class="sub">${escapeHtml(String(summary.pendingCount))} pendentes • ${escapeHtml(String(summary.completedCount))} concluídas</div></div>
          </div>
          <div class="executive-box">
            <div class="label">Resumo executivo</div>
            <div class="text">${escapeHtml(summary.executiveSummary)}</div>
          </div>
          <div class="section">
            <h2>Informacoes do projeto</h2>
            <div class="grid project-info-grid">
              <div class="info"><div class="label">Cliente</div><div class="value">${escapeHtml(client.name)}</div></div>
              <div class="info"><div class="label">Equipe</div><div class="value">${escapeHtml(summary.teamName)}</div></div>
              <div class="info"><div class="label">Gestor</div><div class="value">${escapeHtml(summary.managerName)}</div></div>
              <div class="info"><div class="label">Coordenador</div><div class="value">${escapeHtml(summary.coordinatorName)}</div></div>
              ${includeClientContactInfo ? "" : "<!--"}
              <div class="info"><div class="label">Documento do cliente</div><div class="value">${escapeHtml(client.document)}</div></div>
              <div class="info"><div class="label">Contato do cliente</div><div class="value">${escapeHtml(client.email)}${client.phone && client.phone !== "-" ? ` • ${escapeHtml(client.phone)}` : ""}</div></div>
              ${includeClientContactInfo ? "" : "-->"}
            </div>
          </div>
          <div class="section">
            <h2>Resumo das tarefas</h2>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tarefa</th>
                  <th>Periodo</th>
                  <th>Horas previstas</th>
                  <th>Horas planejadas</th>
                  <th>Horas executadas</th>
                  <th>Atividades</th>
                </tr>
              </thead>
              <tbody>${taskRowsHtml}</tbody>
            </table>
          </div>
          <div class="section">
            <h2>Detalhamento das atividades</h2>
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tarefa</th>
                  <th>Nome da tarefa</th>
                  <th>Atividade</th>
                  <th>Key user</th>
                  <th>Horas</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${activityRowsHtml}</tbody>
            </table>
          </div>
          <div class="footer">
            Gerado em ${escapeHtml(data.generatedAt.toLocaleString("pt-BR"))}.
          </div>
        </div>
      </body>
    </html>
  `;
}

function triggerDownload(blob, filename){
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function drawSimpleTable(doc, config){
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = config.marginX ?? 10;
  const startY = config.startY ?? 20;
  const rowHeight = config.rowHeight ?? 8;
  const headerHeight = config.headerHeight ?? 8;
  const fontSize = config.fontSize ?? 8;
  const columns = Array.isArray(config.columns) ? config.columns : [];
  const rows = Array.isArray(config.rows) ? config.rows : [];
  const usableWidth = pageWidth - (marginX * 2);
  const totalUnits = columns.reduce((sum, col) => sum + (col.width || 1), 0) || 1;
  const colWidths = columns.map((col) => usableWidth * ((col.width || 1) / totalUnits));
  let cursorY = startY;

  const ensurePage = (neededHeight = rowHeight) => {
    if ((cursorY + neededHeight) <= (pageHeight - 12)) return;
    doc.addPage();
    cursorY = 14;
  };

  const drawRow = (cells, isHeader = false) => {
    const height = isHeader ? headerHeight : rowHeight;
    ensurePage(height);
    let x = marginX;
    for (let i = 0; i < columns.length; i += 1){
      const width = colWidths[i];
      doc.setDrawColor(232, 238, 246);
      doc.setFillColor(isHeader ? 245 : 255, isHeader ? 248 : 255, isHeader ? 253 : 255);
      doc.rect(x, cursorY, width, height, isHeader ? "FD" : "S");
      doc.setTextColor(isHeader ? 93 : 22, isHeader ? 104 : 32, isHeader ? 123 : 51);
      doc.setFont("helvetica", isHeader ? "bold" : "normal");
      doc.setFontSize(fontSize);
      const text = doc.splitTextToSize(String(cells[i] ?? ""), Math.max(8, width - 4));
      doc.text(text, x + 2, cursorY + 5);
      x += width;
    }
    cursorY += height;
  };

  drawRow(columns.map(col => col.label || ""), true);
  rows.forEach((row) => {
    drawRow(columns.map(col => row[col.key] ?? ""), false);
  });

  return cursorY;
}

export async function downloadProjectStatusReportExcel(payload){
  const data = buildStatusReportData(payload);
  const html = buildReportHtml(data, { includeClientImage: false, includeClientContactInfo: false });
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const filename = `${normalizeFileName(`status-report-${data.project.number}-${data.project.name}`)}.xls`;
  triggerDownload(blob, filename);
}

export async function downloadProjectStatusReportPdf(payload){
  const data = buildStatusReportData(payload);
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const logoDataUrl = data.client.reportPhotoDataUrl || await fetchImageAsDataUrl(data.client.photoURL);
  const pageWidth = doc.internal.pageSize.getWidth();
  const summary = data.summary;

  doc.setFillColor(243, 247, 255);
  doc.roundedRect(10, 10, pageWidth - 20, 40, 8, 8, "F");

  if (logoDataUrl){
    doc.addImage(logoDataUrl, "PNG", 14, 15, 24, 24);
  } else {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(14, 15, 24, 24, 5, 5, "F");
    doc.setTextColor(86, 99, 130);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(String((data.client.name || "C").trim().slice(0, 1).toUpperCase()), 26, 30, { align: "center" });
  }

  doc.setTextColor(101, 82, 219);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("STATUS REPORT DO PROJETO", 44, 18);

  doc.setTextColor(22, 32, 51);
  doc.setFontSize(20);
  doc.text(data.project.name, 44, 27);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.3);
  doc.setTextColor(94, 104, 123);
  doc.text(`Cliente: ${data.client.name}  •  Status: ${data.project.status}  •  Prazo final: ${data.project.endDate}`, 44, 34);
  doc.text(`Gerado em ${data.generatedAt.toLocaleString("pt-BR")}`, 44, 40);

  const summaryCards = [
    { label: "Horas previstas", value: `${data.project.billingHours}h`, sub: "Planejamento total" },
    { label: "Horas planejadas", value: `${summary.plannedWithoutOsHours}h`, sub: "Atividades planejadas" },
    { label: "Horas executadas", value: `${summary.executedActivityHours}h`, sub: `Consumo: ${summary.projectConsumption.toFixed(1).replace(".", ",")}%` },
    { label: "Atividades", value: String(summary.activityCount), sub: `${summary.pendingCount} pendentes • ${summary.completedCount} concluidas` },
  ];

  let x = 10;
  summaryCards.forEach((card) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(220, 228, 240);
    doc.roundedRect(x, 56, 46, 24, 5, 5, "FD");
    doc.setTextColor(122, 133, 153);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text(card.label.toUpperCase(), x + 4, 62);
    doc.setTextColor(22, 32, 51);
    doc.setFontSize(12.5);
    doc.text(card.value, x + 4, 69);
    doc.setTextColor(94, 104, 123);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(card.sub, x + 4, 75);
    x += 48;
  });

  const executiveText = doc.splitTextToSize(summary.executiveSummary, pageWidth - 30);
  const executiveBoxHeight = Math.max(20, 12 + (executiveText.length * 4));
  doc.setFillColor(248, 250, 255);
  doc.setDrawColor(220, 228, 240);
  doc.roundedRect(10, 84, pageWidth - 20, executiveBoxHeight, 5, 5, "FD");
  doc.setTextColor(122, 133, 153);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("RESUMO EXECUTIVO", 14, 90);
  doc.setTextColor(36, 50, 74);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.2);
  doc.text(executiveText, 14, 96);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(22, 32, 51);
  const infoTitleY = 84 + executiveBoxHeight + 10;
  doc.text("Informacoes do projeto", 10, infoTitleY);

  let nextY = drawSimpleTable(doc, {
    startY: infoTitleY + 3,
    fontSize: 8.4,
    columns: [
      { key: "client", label: "Cliente", width: 1.2 },
      { key: "team", label: "Equipe", width: 1 },
      { key: "manager", label: "Gestor", width: 1 },
      { key: "coordinator", label: "Coordenador", width: 1.05 },
      { key: "hours", label: "Horas previstas", width: .75 },
      { key: "planned", label: "Horas planejadas", width: .85 },
      { key: "worked", label: "Horas executadas", width: .85 }
    ],
    rows: [{
      client: data.client.name,
      team: summary.teamName,
      manager: summary.managerName,
      coordinator: summary.coordinatorName,
      hours: `${data.project.billingHours}h`,
      planned: `${summary.plannedWithoutOsHours}h`,
      worked: `${summary.executedActivityHours}h`
    }]
  }) + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Resumo das tarefas", 10, nextY);

  nextY = drawSimpleTable(doc, {
    startY: nextY + 3,
    fontSize: 8,
    columns: [
      { key: "number", label: "#", width: .45 },
      { key: "name", label: "Tarefa", width: 2.1 },
      { key: "period", label: "Periodo", width: 1.4 },
      { key: "planned", label: "Horas previstas", width: .95 },
      { key: "plannedNoOs", label: "Horas planejadas", width: .95 },
      { key: "worked", label: "Horas executadas", width: .98 },
      { key: "count", label: "Atividades", width: .72 }
    ],
    rows: data.taskRows.map((task) => ({
      number: String(task.number),
      name: task.name,
      period: task.period,
      planned: `${task.plannedHours}h`,
      plannedNoOs: `${task.plannedWithoutOsHours}h`,
      worked: `${task.workedHours}h`,
      count: String(task.activityCount)
    }))
  }) + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Detalhamento das atividades", 10, nextY);

  drawSimpleTable(doc, {
    startY: nextY + 3,
    rowHeight: 10,
    headerHeight: 8,
    fontSize: 7.2,
    columns: [
      { key: "date", label: "Data", width: .7 },
      { key: "taskNumber", label: "Tarefa", width: .55 },
      { key: "taskName", label: "Nome da tarefa", width: 1.6 },
      { key: "activityName", label: "Atividade", width: 1.6 },
      { key: "keyUsers", label: "Key user", width: 1.4 },
      { key: "hours", label: "Horas", width: .5 },
      { key: "status", label: "Status", width: .9 }
    ],
    rows: data.activityRows.map((activity) => ({
      date: activity.date,
      taskNumber: `#${activity.taskNumber}`,
      taskName: activity.taskName,
      activityName: activity.activityName,
      keyUsers: activity.keyUsers,
      hours: `${activity.hours}h`,
      status: activity.status
    }))
  });

  const filename = `${normalizeFileName(`status-report-${data.project.number}-${data.project.name}`)}.pdf`;
  doc.save(filename);
}
