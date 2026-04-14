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

function escapeXml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeXmlAttr(value){
  return escapeXml(value).replace(/\r?\n/g, " ");
}

function formatHours(value){
  const rounded = Math.round(asNumber(value) * 100) / 100;
  return `${Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",")}h`;
}

function formatPercent(value){
  return `${asNumber(value).toFixed(1).replace(".", ",")}%`;
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

function daysOverdue(activity, today){
  const workDate = String(activity?.workDate || "").slice(0, 10);
  if (!workDate) return 0;
  const parsed = new Date(`${workDate}T00:00:00`);
  if (!Number.isFinite(parsed.getTime()) || parsed >= today) return 0;
  return Math.max(0, Math.floor((today.getTime() - parsed.getTime()) / 86400000));
}

function buildExecutiveSummary(data){
  const { project, summary } = data;
  const parts = [
    `O projeto está em ${project.status.toLowerCase()}.`,
    `Foram executadas ${formatHours(summary.executedActivityHours)} de ${formatHours(project.billingHours)} previstas.`,
    `Ha ${formatHours(summary.plannedWithoutOsHours)} em atividades planejadas.`,
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
  const inProgressCount = sortedActivities.filter(activity => statusReportActivityLabel(activity, today) === "Em Andamento").length;
  const concludedCount = sortedActivities.filter(activity => statusReportActivityLabel(activity, today) === "Concluida").length;
  const delayedCount = sortedActivities.filter(activity => statusReportActivityLabel(activity, today) === "Atrasada").length;
  const teamName = teams.find(team => team.id === project?.teamId)?.name || "-";
  const managerUser = users.find(user => user.uid === project?.managerUid) || null;
  const managerName = managerUser?.name || "-";
  const managerEmail = managerUser?.email || "-";
  const managerPhone = managerUser?.phone || "-";
  const coordinatorName = users.find(user => user.uid === project?.coordinatorUid)?.name || "-";

  const getTechNames = (activity) => {
    if (Array.isArray(activity.techNames) && activity.techNames.length){
      return activity.techNames.filter(Boolean).join(", ");
    }
    const techIds = Array.isArray(activity.techUids) ? activity.techUids.filter(Boolean) : [];
    const names = techIds
      .map(uid => users.find(user => user.uid === uid))
      .filter(Boolean)
      .map(user => user.name || user.email || user.uid)
      .filter(Boolean);
    return names.length ? names.join(", ") : "-";
  };

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
      techNames: getTechNames(activity),
      keyUsers: Array.isArray(activity.keyUsers) && activity.keyUsers.length ? activity.keyUsers.join(", ") : "-",
      hours: asNumber(activity.hoursWorked),
      daysOverdue: daysOverdue(activity, today),
      status: statusReportActivityLabel(activity, today)
    };
  });

  const attentionRows = activityRows
    .filter(activity => activity.status === "Atrasada")
    .slice(0, 5);

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
      managerEmail,
      managerPhone,
      coordinatorName,
      taskCount: taskRows.length,
      activityCount: activityRows.length,
      plannedWithoutOsHours,
      executedActivityHours,
      totalActivityHours: executedActivityHours,
      completedCount,
      pendingCount,
      overdueCount,
      inProgressCount,
      concludedCount,
      delayedCount,
      projectConsumption: billingHours > 0 ? ((executedActivityHours / billingHours) * 100) : 0
    },
    taskRows,
    activityRows,
    attentionRows
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
      <td>${escapeHtml(formatHours(task.plannedHours))}</td>
      <td>${escapeHtml(formatHours(task.plannedWithoutOsHours))}</td>
      <td>${escapeHtml(formatHours(task.workedHours))}</td>
      <td>${escapeHtml(String(task.activityCount))}</td>
    </tr>
  `).join("");
  const activityRowsHtml = data.activityRows.map((activity) => `
    <tr>
      <td>${escapeHtml(activity.date)}</td>
      <td>#${escapeHtml(String(activity.taskNumber))} - ${escapeHtml(activity.taskName)}</td>
      <td>${escapeHtml(activity.activityName)}</td>
      <td>${escapeHtml(activity.techNames)}</td>
      <td>${escapeHtml(activity.keyUsers)}</td>
      <td>${escapeHtml(formatHours(activity.hours))}</td>
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
          .status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
          .status-card{border:1px solid #dce4f0;border-radius:16px;padding:12px 14px;background:#fff}
          .status-card .label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#7a8599;font-weight:800}
          .status-card .value{margin-top:6px;font-size:22px;font-weight:800}
          .status-card.in-progress .value{color:#1f5b99}
          .status-card.done .value{color:#0f7a4f}
          .status-card.late .value{color:#b42318}
          .excel-clean body{background:#fff;padding:0}
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
            <div class="card"><div class="label">Horas previstas</div><div class="value">${escapeHtml(formatHours(project.billingHours))}</div><div class="sub">Planejamento total do projeto</div></div>
            <div class="card"><div class="label">Horas planejadas</div><div class="value">${escapeHtml(formatHours(summary.plannedWithoutOsHours))}</div><div class="sub">Atividades planejadas</div></div>
            <div class="card"><div class="label">Horas executadas</div><div class="value">${escapeHtml(formatHours(summary.executedActivityHours))}</div><div class="sub">Consumo: ${escapeHtml(formatPercent(summary.projectConsumption))}</div></div>
            <div class="card"><div class="label">Atividades</div><div class="value">${escapeHtml(String(summary.activityCount))}</div><div class="sub">${escapeHtml(String(summary.pendingCount))} pendentes • ${escapeHtml(String(summary.completedCount))} concluídas</div></div>
          </div>
          <div class="executive-box">
            <div class="label">Resumo executivo</div>
            <div class="text">${escapeHtml(summary.executiveSummary)}</div>
          </div>
          <div class="section">
            <h2>Status das atividades</h2>
            <div class="status-grid">
              <div class="status-card in-progress"><div class="label">Em andamento</div><div class="value">${escapeHtml(String(summary.inProgressCount))}</div></div>
              <div class="status-card done"><div class="label">Concluidas</div><div class="value">${escapeHtml(String(summary.concludedCount))}</div></div>
              <div class="status-card late"><div class="label">Atrasadas</div><div class="value">${escapeHtml(String(summary.delayedCount))}</div></div>
            </div>
          </div>
          <div class="section">
            <h2>Pontos de atencao</h2>
            ${data.attentionRows.length ? `<table>
              <thead>
                <tr><th>Data</th><th>Dias em atraso</th><th>Tarefa</th><th>Atividade</th><th>Responsavel tecnico</th><th>Horas</th></tr>
              </thead>
              <tbody>${data.attentionRows.map((activity) => `<tr>
                <td>${escapeHtml(activity.date)}</td>
                <td>${escapeHtml(String(activity.daysOverdue))}</td>
                <td>#${escapeHtml(String(activity.taskNumber))}</td>
                <td>${escapeHtml(activity.activityName)}</td>
                <td>${escapeHtml(activity.techNames)}</td>
                <td>${escapeHtml(formatHours(activity.hours))}</td>
              </tr>`).join("")}</tbody>
            </table>` : `<p class="subtitle">Nenhum ponto critico identificado no momento.</p>`}
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
                  <th>Atividade</th>
                  <th>Tecnico</th>
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

function excelCell(value, type = "String"){
  const cellType = type === "Number" ? "Number" : "String";
  return `<Cell><Data ss:Type="${cellType}">${escapeXml(value)}</Data></Cell>`;
}

function excelRow(values, types = []){
  return `<Row>${values.map((value, index) => excelCell(value, types[index] || "String")).join("")}</Row>`;
}

function excelWorksheet(name, rows, options = {}){
  const autoFilter = options.autoFilterColumns
    ? `<AutoFilter x:Range="R1C1:R1C${options.autoFilterColumns}" xmlns="urn:schemas-microsoft-com:office:excel"></AutoFilter>`
    : "";
  const worksheetOptions = options.freezeTopRow
    ? `<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>`
    : "";
  return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${rows.join("")}</Table>${autoFilter}${worksheetOptions}</Worksheet>`;
}

function buildExcelWorkbook(data){
  const { project, client, summary } = data;
  const summaryRows = [
    excelRow(["Status Report do Projeto"]),
    excelRow(["Projeto", project.name]),
    excelRow(["Numero", project.number]),
    excelRow(["Cliente", client.name]),
    excelRow(["Status", project.status]),
    excelRow(["Prazo final", project.endDate]),
    excelRow(["Gerado em", data.generatedAt.toLocaleString("pt-BR")]),
    excelRow([""]),
    excelRow(["Indicador", "Valor"]),
    excelRow(["Horas previstas", formatHours(project.billingHours)]),
    excelRow(["Horas planejadas", formatHours(summary.plannedWithoutOsHours)]),
    excelRow(["Horas executadas", formatHours(summary.executedActivityHours)]),
    excelRow(["Consumo", formatPercent(summary.projectConsumption)]),
    excelRow(["Atividades em andamento", summary.inProgressCount], ["String", "Number"]),
    excelRow(["Atividades concluidas", summary.concludedCount], ["String", "Number"]),
    excelRow(["Atividades atrasadas", summary.delayedCount], ["String", "Number"]),
    excelRow([""]),
    excelRow(["Resumo executivo"]),
    excelRow([summary.executiveSummary]),
    excelRow([""]),
    excelRow(["Pontos de atencao"]),
    ...(data.attentionRows.length
      ? [
          excelRow(["Data", "Tarefa", "Atividade", "Responsavel", "Horas"]),
          ...data.attentionRows.map(activity => excelRow([
            activity.date,
            `#${activity.taskNumber}`,
            activity.activityName,
            activity.keyUsers,
            formatHours(activity.hours)
          ]))
        ]
      : [excelRow(["Nenhum ponto critico identificado no momento."])])
  ];

  const taskRows = [
    excelRow(["#", "Tarefa", "Periodo", "Horas previstas", "Horas planejadas", "Horas executadas", "Atividades"]),
    ...data.taskRows.map(task => excelRow([
      task.number,
      task.name,
      task.period,
      formatHours(task.plannedHours),
      formatHours(task.plannedWithoutOsHours),
      formatHours(task.workedHours),
      task.activityCount
    ], ["String", "String", "String", "String", "String", "String", "Number"])),
    excelRow([""]),
    excelRow([
      "Totais",
      "",
      "",
      formatHours(data.taskRows.reduce((acc, task) => acc + asNumber(task.plannedHours), 0)),
      formatHours(summary.plannedWithoutOsHours),
      formatHours(summary.executedActivityHours),
      summary.activityCount
    ], ["String", "String", "String", "String", "String", "String", "Number"])
  ];

  const activityRows = [
    excelRow(["Data", "Tarefa", "Atividade", "Responsavel", "Horas", "Status"]),
    ...data.activityRows.map(activity => excelRow([
      activity.date,
      `#${activity.taskNumber} - ${activity.taskName}`,
      activity.activityName,
      activity.keyUsers,
      formatHours(activity.hours),
      activity.status
    ])),
    excelRow([""]),
    excelRow(["Totais", "", "", "", formatHours(data.activityRows.reduce((acc, activity) => acc + asNumber(activity.hours), 0)), ""])
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${excelWorksheet("Resumo", summaryRows)}
${excelWorksheet("Tarefas", taskRows, { freezeTopRow: true, autoFilterColumns: 7 })}
${excelWorksheet("Atividades", activityRows, { freezeTopRow: true, autoFilterColumns: 6 })}
</Workbook>`;
}

function columnName(index){
  let name = "";
  let current = index;
  while (current > 0){
    const mod = (current - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    current = Math.floor((current - mod) / 26);
  }
  return name;
}

function buildXlsxSheet(rows, options = {}){
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const rowXml = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.map((cell, cellIndex) => {
      const value = cell?.value ?? cell ?? "";
      const type = cell?.type || "String";
      const style = cell?.style ? ` s="${cell.style}"` : "";
      const ref = `${columnName(cellIndex + 1)}${rowNumber}`;
      if (type === "Number" && value !== ""){
        return `<c r="${ref}"${style}><v>${asNumber(value)}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join("");
  const dimensionRef = `A1:${columnName(Math.max(1, colCount))}${Math.max(1, rows.length)}`;
  const freezePane = options.freezeTopRow
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const autoFilter = options.autoFilterColumns
    ? `<autoFilter ref="A1:${columnName(options.autoFilterColumns)}${Math.max(1, rows.length)}"/>`
    : "";
  const cols = colCount
    ? `<cols>${Array.from({ length: colCount }, (_, index) => `<col min="${index + 1}" max="${index + 1}" width="${options.widths?.[index] || 18}" customWidth="1"/>`).join("")}</cols>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="${dimensionRef}"/>
${freezePane}
${cols}
<sheetData>${rowXml}</sheetData>
${autoFilter}
</worksheet>`;
}

function xlsxText(value, style = ""){
  return { value, type: "String", style };
}

function xlsxNumber(value, style = ""){
  return { value: asNumber(value), type: "Number", style };
}

function xlsxHeader(value){
  return xlsxText(value, "2");
}

function xlsxTotalText(value){
  return xlsxText(value, "3");
}

function xlsxTotalNumber(value){
  return xlsxNumber(value, "3");
}

function buildTechSummaryRows(activityRows){
  const map = new Map();
  (Array.isArray(activityRows) ? activityRows : []).forEach((activity) => {
    const techs = String(activity.techNames || "Sem tecnico")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
    const names = techs.length ? techs : ["Sem tecnico"];
    const sharedHours = asNumber(activity.hours) / names.length;
    names.forEach((name) => {
      if (!map.has(name)){
        map.set(name, {
          name,
          plannedHours: 0,
          executedHours: 0,
          inProgress: 0,
          concluded: 0,
          delayed: 0,
          activities: 0
        });
      }
      const item = map.get(name);
      item.activities += 1;
      if (activity.status === "Concluida"){
        item.executedHours += sharedHours;
        item.concluded += 1;
      } else {
        item.plannedHours += sharedHours;
        if (activity.status === "Atrasada") item.delayed += 1;
        else item.inProgress += 1;
      }
    });
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function buildXlsxWorkbookFiles(data){
  const { project, client, summary } = data;
  const techSummary = buildTechSummaryRows(data.activityRows);
  const summaryRows = [
    [xlsxText("Status Report do Projeto", "1")],
    [xlsxText("Projeto", "1"), xlsxText(project.name)],
    [xlsxText("Numero", "1"), xlsxText(project.number)],
    [xlsxText("Cliente", "1"), xlsxText(client.name)],
    [xlsxText("Status", "1"), xlsxText(project.status)],
    [xlsxText("Prazo final", "1"), xlsxText(project.endDate)],
    [xlsxText("Gerado em", "1"), xlsxText(data.generatedAt.toLocaleString("pt-BR"))],
    [],
    [xlsxHeader("Indicador"), xlsxHeader("Valor")],
    [xlsxText("Horas previstas"), xlsxNumber(project.billingHours)],
    [xlsxText("Horas planejadas"), xlsxNumber(summary.plannedWithoutOsHours)],
    [xlsxText("Horas executadas"), xlsxNumber(summary.executedActivityHours)],
    [xlsxText("Consumo (%)"), xlsxNumber(summary.projectConsumption)],
    [xlsxText("Atividades em andamento"), xlsxNumber(summary.inProgressCount)],
    [xlsxText("Atividades concluidas"), xlsxNumber(summary.concludedCount)],
    [xlsxText("Atividades atrasadas"), xlsxNumber(summary.delayedCount)],
    [],
    [xlsxText("Resumo executivo", "1")],
    [xlsxText(summary.executiveSummary)]
  ];

  const taskRows = [
    [xlsxHeader("#"), xlsxHeader("Tarefa"), xlsxHeader("Periodo"), xlsxHeader("Horas previstas"), xlsxHeader("Horas planejadas"), xlsxHeader("Horas executadas"), xlsxHeader("Atividades")],
    ...data.taskRows.map(task => [
      xlsxText(task.number),
      xlsxText(task.name),
      xlsxText(task.period),
      xlsxNumber(task.plannedHours),
      xlsxNumber(task.plannedWithoutOsHours),
      xlsxNumber(task.workedHours),
      xlsxNumber(task.activityCount)
    ]),
    [],
    [
      xlsxTotalText("Totais"),
      xlsxText(""),
      xlsxText(""),
      xlsxTotalNumber(data.taskRows.reduce((acc, task) => acc + asNumber(task.plannedHours), 0)),
      xlsxTotalNumber(summary.plannedWithoutOsHours),
      xlsxTotalNumber(summary.executedActivityHours),
      xlsxTotalNumber(summary.activityCount)
    ]
  ];

  const activityRows = [
    [xlsxHeader("Data"), xlsxHeader("Tarefa"), xlsxHeader("Atividade"), xlsxHeader("Tecnico"), xlsxHeader("Responsavel"), xlsxHeader("Horas"), xlsxHeader("Status")],
    ...data.activityRows.map(activity => [
      xlsxText(activity.date),
      xlsxText(`#${activity.taskNumber} - ${activity.taskName}`),
      xlsxText(activity.activityName),
      xlsxText(activity.techNames),
      xlsxText(activity.keyUsers),
      xlsxNumber(activity.hours),
      xlsxText(activity.status)
    ]),
    [],
    [xlsxTotalText("Totais"), xlsxText(""), xlsxText(""), xlsxText(""), xlsxText(""), xlsxTotalNumber(data.activityRows.reduce((acc, activity) => acc + asNumber(activity.hours), 0)), xlsxText("")]
  ];

  const attentionRows = data.attentionRows.length
    ? [
        [xlsxHeader("Data"), xlsxHeader("Dias em atraso"), xlsxHeader("Tarefa"), xlsxHeader("Atividade"), xlsxHeader("Responsavel tecnico"), xlsxHeader("Horas")],
        ...data.attentionRows.map(activity => [
          xlsxText(activity.date),
          xlsxNumber(activity.daysOverdue),
          xlsxText(`#${activity.taskNumber}`),
          xlsxText(activity.activityName),
          xlsxText(activity.techNames),
          xlsxNumber(activity.hours)
        ]),
        [],
        [xlsxTotalText("Totais"), xlsxText(""), xlsxText(""), xlsxText(""), xlsxText(""), xlsxTotalNumber(data.attentionRows.reduce((acc, activity) => acc + asNumber(activity.hours), 0))]
      ]
    : [[xlsxText("Nenhum ponto critico identificado no momento.")]];

  const techRows = [
    [xlsxHeader("Tecnico"), xlsxHeader("Horas planejadas"), xlsxHeader("Horas executadas"), xlsxHeader("Em andamento"), xlsxHeader("Concluidas"), xlsxHeader("Atrasadas"), xlsxHeader("Atividades")],
    ...techSummary.map(item => [
      xlsxText(item.name),
      xlsxNumber(item.plannedHours),
      xlsxNumber(item.executedHours),
      xlsxNumber(item.inProgress),
      xlsxNumber(item.concluded),
      xlsxNumber(item.delayed),
      xlsxNumber(item.activities)
    ]),
    [],
    [
      xlsxTotalText("Totais"),
      xlsxTotalNumber(techSummary.reduce((acc, item) => acc + asNumber(item.plannedHours), 0)),
      xlsxTotalNumber(techSummary.reduce((acc, item) => acc + asNumber(item.executedHours), 0)),
      xlsxTotalNumber(techSummary.reduce((acc, item) => acc + asNumber(item.inProgress), 0)),
      xlsxTotalNumber(techSummary.reduce((acc, item) => acc + asNumber(item.concluded), 0)),
      xlsxTotalNumber(techSummary.reduce((acc, item) => acc + asNumber(item.delayed), 0)),
      xlsxTotalNumber(techSummary.reduce((acc, item) => acc + asNumber(item.activities), 0))
    ]
  ];

  const sheets = [
    { name: "Resumo", file: "sheet1.xml", xml: buildXlsxSheet(summaryRows, { freezeTopRow: true, widths: [28, 54, 24, 24, 16] }) },
    { name: "Tarefas", file: "sheet2.xml", xml: buildXlsxSheet(taskRows, { freezeTopRow: true, autoFilterColumns: 7, widths: [10, 34, 24, 18, 18, 18, 12] }) },
    { name: "Atividades", file: "sheet3.xml", xml: buildXlsxSheet(activityRows, { freezeTopRow: true, autoFilterColumns: 7, widths: [14, 34, 42, 28, 28, 12, 16] }) },
    { name: "Pontos Atencao", file: "sheet4.xml", xml: buildXlsxSheet(attentionRows, { freezeTopRow: true, autoFilterColumns: data.attentionRows.length ? 6 : 0, widths: [14, 16, 14, 42, 28, 12] }) },
    { name: "Resumo Tecnico", file: "sheet5.xml", xml: buildXlsxSheet(techRows, { freezeTopRow: true, autoFilterColumns: 7, widths: [30, 18, 18, 16, 14, 14, 12] }) }
  ];

  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${escapeXmlAttr(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const workbookRels = sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${sheet.file}"/>`).join("");
  const overrides = sheets.map((sheet) => `<Override PartName="/xl/worksheets/${sheet.file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");

  return {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
${overrides}
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${workbookSheets}</sheets>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${workbookRels}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F5B99"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF6"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD9E2EF"/></left><right style="thin"><color rgb="FFD9E2EF"/></right><top style="thin"><color rgb="FFD9E2EF"/></top><bottom style="thin"><color rgb="FFD9E2EF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
</cellXfs>
</styleSheet>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>Status Report - ${escapeXml(project.name)}</dc:title>
<dc:creator>FlowProject</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`,
    "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>FlowProject</Application>
</Properties>`,
    ...Object.fromEntries(sheets.map(sheet => [`xl/worksheets/${sheet.file}`, sheet.xml]))
  };
}

function makeCrcTable(){
  const table = [];
  for (let n = 0; n < 256; n += 1){
    let c = n;
    for (let k = 0; k < 8; k += 1){
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(bytes){
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1){
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pushUint16(bytes, value){
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUint32(bytes, value){
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function pushBytes(bytes, values){
  for (let i = 0; i < values.length; i += 1) bytes.push(values[i]);
}

function createZip(files){
  const encoder = new TextEncoder();
  const bytes = [];
  const centralDirectory = [];
  const entries = Object.entries(files);

  entries.forEach(([name, content]) => {
    const nameBytes = encoder.encode(name.replace(/\\/g, "/"));
    const fileBytes = encoder.encode(content);
    const crc = crc32(fileBytes);
    const offset = bytes.length;

    pushUint32(bytes, 0x04034b50);
    pushUint16(bytes, 20);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint32(bytes, crc);
    pushUint32(bytes, fileBytes.length);
    pushUint32(bytes, fileBytes.length);
    pushUint16(bytes, nameBytes.length);
    pushUint16(bytes, 0);
    pushBytes(bytes, nameBytes);
    pushBytes(bytes, fileBytes);

    centralDirectory.push({ nameBytes, crc, size: fileBytes.length, offset });
  });

  const centralOffset = bytes.length;
  centralDirectory.forEach((entry) => {
    pushUint32(bytes, 0x02014b50);
    pushUint16(bytes, 20);
    pushUint16(bytes, 20);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint32(bytes, entry.crc);
    pushUint32(bytes, entry.size);
    pushUint32(bytes, entry.size);
    pushUint16(bytes, entry.nameBytes.length);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint32(bytes, 0);
    pushUint32(bytes, entry.offset);
    pushBytes(bytes, entry.nameBytes);
  });
  const centralSize = bytes.length - centralOffset;

  pushUint32(bytes, 0x06054b50);
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  pushUint16(bytes, centralDirectory.length);
  pushUint16(bytes, centralDirectory.length);
  pushUint32(bytes, centralSize);
  pushUint32(bytes, centralOffset);
  pushUint16(bytes, 0);

  return new Uint8Array(bytes);
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
    const wrappedCells = cells.map((cell, index) => {
      const width = colWidths[index];
      return doc.splitTextToSize(String(cell ?? ""), Math.max(8, width - 4));
    });
    const maxLines = wrappedCells.reduce((max, text) => Math.max(max, Array.isArray(text) ? text.length : 1), 1);
    const height = isHeader ? headerHeight : Math.max(rowHeight, 4 + (maxLines * 4));
    ensurePage(height);
    let x = marginX;
    for (let i = 0; i < columns.length; i += 1){
      const width = colWidths[i];
      doc.setDrawColor(232, 238, 246);
      doc.setFillColor(isHeader ? 245 : 255, isHeader ? 248 : 255, isHeader ? 253 : 255);
      doc.rect(x, cursorY, width, height, isHeader ? "FD" : "S");
      doc.setTextColor(isHeader ? 93 : 22, isHeader ? 104 : 32, isHeader ? 123 : 51);
      if (!isHeader && columns[i]?.key === "status"){
        const status = String(cells[i] || "");
        doc.setFillColor(102, 113, 133);
        if (status === "Concluida") doc.setFillColor(15, 122, 79);
        if (status === "Atrasada") doc.setFillColor(180, 35, 24);
        if (status === "Em Andamento") doc.setFillColor(31, 91, 153);
        doc.roundedRect(x + 2, cursorY + 2, Math.max(10, width - 4), Math.min(6, height - 4), 2, 2, "F");
        doc.setTextColor(255, 255, 255);
      }
      doc.setFont("helvetica", isHeader ? "bold" : "normal");
      doc.setFontSize(fontSize);
      const text = wrappedCells[i];
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

function addPdfPageChrome(doc, data){
  const pageCount = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pageCount; page += 1){
    doc.setPage(page);
    doc.setDrawColor(225, 232, 242);
    doc.line(10, pageHeight - 10, pageWidth - 10, pageHeight - 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(102, 113, 133);
    doc.text(`${data.project.name} | ${data.client.name}`, 10, pageHeight - 5);
    doc.text(`Pagina ${page} de ${pageCount}`, pageWidth - 10, pageHeight - 5, { align: "right" });
    if (page > 1){
      doc.setDrawColor(225, 232, 242);
      doc.line(10, 10, pageWidth - 10, 10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(40, 54, 80);
      doc.text(`Status Report | ${data.project.name}`, 10, 7);
    }
  }
}

function drawProjectSummaryChart(doc, data, startY){
  const pageWidth = doc.internal.pageSize.getWidth();
  const { project, summary } = data;
  const rows = [
    { label: "Horas previstas", value: asNumber(project.billingHours), color: [31, 91, 153] },
    { label: "Horas planejadas", value: asNumber(summary.plannedWithoutOsHours), color: [245, 158, 11] },
    { label: "Horas executadas", value: asNumber(summary.executedActivityHours), color: [15, 122, 79] }
  ];
  const maxValue = Math.max(1, ...rows.map(row => row.value));
  const barX = 58;
  const barWidth = pageWidth - barX - 34;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(22, 32, 51);
  doc.text("Resumo visual do projeto", 10, startY);

  let y = startY + 9;
  rows.forEach((row) => {
    const filled = Math.max(2, barWidth * (row.value / maxValue));
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(40, 54, 80);
    doc.text(row.label, 10, y + 4);
    doc.setFillColor(232, 238, 246);
    doc.roundedRect(barX, y, barWidth, 5, 2, 2, "F");
    doc.setFillColor(row.color[0], row.color[1], row.color[2]);
    doc.roundedRect(barX, y, filled, 5, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setTextColor(22, 32, 51);
    doc.text(formatHours(row.value), barX + barWidth + 4, y + 4);
    y += 11;
  });

  y += 4;
  const statusRows = [
    { label: "Em andamento", value: summary.inProgressCount, color: [31, 91, 153] },
    { label: "Concluidas", value: summary.concludedCount, color: [15, 122, 79] },
    { label: "Atrasadas", value: summary.delayedCount, color: [180, 35, 24] }
  ];
  let x = 10;
  statusRows.forEach((item) => {
    doc.setFillColor(item.color[0], item.color[1], item.color[2]);
    doc.roundedRect(x, y, 4, 4, 1.5, 1.5, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(40, 54, 80);
    doc.text(`${item.label}: ${item.value}`, x + 6, y + 4);
    x += 48;
  });

  return y + 14;
}

export async function downloadProjectStatusReportExcel(payload){
  const data = buildStatusReportData(payload);
  const workbook = createZip(buildXlsxWorkbookFiles(data));
  const blob = new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const filename = `${normalizeFileName(`status-report-${data.project.number}-${data.project.name}`)}.xlsx`;
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
  doc.text(`Cliente: ${data.client.name} | Status: ${data.project.status} | Prazo final: ${data.project.endDate}`, 44, 34);
  doc.text(`Gestor: ${summary.managerName}`, 44, 40);

  const summaryCards = [
    { label: "Horas previstas", value: formatHours(data.project.billingHours), sub: "Planejamento total" },
    { label: "Horas planejadas", value: formatHours(summary.plannedWithoutOsHours), sub: "Atividades planejadas" },
    { label: "Horas executadas", value: formatHours(summary.executedActivityHours), sub: `Consumo: ${formatPercent(summary.projectConsumption)}` },
    { label: "Atividades", value: String(summary.activityCount), sub: `${summary.pendingCount} pendentes • ${summary.completedCount} concluidas` },
  ];

  let nextY = 58;

  let x = 10;
  summaryCards.forEach((card) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(220, 228, 240);
    doc.roundedRect(x, nextY, 46, 24, 5, 5, "FD");
    doc.setTextColor(122, 133, 153);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text(card.label.toUpperCase(), x + 4, nextY + 6);
    doc.setTextColor(22, 32, 51);
    doc.setFontSize(12.5);
    doc.text(card.value, x + 4, nextY + 13);
    doc.setTextColor(94, 104, 123);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(card.sub, x + 4, nextY + 19);
    x += 48;
  });

  nextY += 32;
  const progressWidth = pageWidth - 28;
  const progress = Math.max(0, Math.min(100, summary.projectConsumption));
  doc.setTextColor(22, 32, 51);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Consumo das horas: ${formatPercent(progress)}`, 14, nextY);
  doc.setFillColor(232, 238, 246);
  doc.roundedRect(14, nextY + 4, progressWidth, 5, 2, 2, "F");
  doc.setFillColor(31, 91, 153);
  doc.roundedRect(14, nextY + 4, progressWidth * (progress / 100), 5, 2, 2, "F");
  nextY += 18;

  const executiveText = doc.splitTextToSize(summary.executiveSummary, pageWidth - 30);
  const executiveBoxHeight = Math.max(20, 12 + (executiveText.length * 4));
  doc.setFillColor(248, 250, 255);
  doc.setDrawColor(220, 228, 240);
  doc.roundedRect(10, nextY, pageWidth - 20, executiveBoxHeight, 5, 5, "FD");
  doc.setTextColor(122, 133, 153);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("RESUMO EXECUTIVO", 14, nextY + 6);
  doc.setTextColor(36, 50, 74);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.2);
  doc.text(executiveText, 14, nextY + 12);

  const statusTitleY = nextY + executiveBoxHeight + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(22, 32, 51);
  doc.text("Status das atividades", 10, statusTitleY);

  const statusCards = [
    { label: "Em andamento", value: summary.inProgressCount, color: [31, 91, 153] },
    { label: "Concluidas", value: summary.concludedCount, color: [15, 122, 79] },
    { label: "Atrasadas", value: summary.delayedCount, color: [180, 35, 24] }
  ];
  let statusX = 10;
  statusCards.forEach((card) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(220, 228, 240);
    doc.roundedRect(statusX, statusTitleY + 4, 61, 20, 4, 4, "FD");
    doc.setTextColor(122, 133, 153);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(card.label.toUpperCase(), statusX + 4, statusTitleY + 11);
    doc.setTextColor(card.color[0], card.color[1], card.color[2]);
    doc.setFontSize(13);
    doc.text(String(card.value), statusX + 4, statusTitleY + 18);
    statusX += 64;
  });

  let attentionY = statusTitleY + 35;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(22, 32, 51);
  doc.text("Pontos de atencao", 10, attentionY);
  if (summary.delayedCount > 0){
    const hiddenDelayed = Math.max(0, summary.delayedCount - data.attentionRows.length);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(180, 35, 24);
    doc.text(`${summary.delayedCount} atividade(s) atrasada(s)${hiddenDelayed ? ` | + ${hiddenDelayed} nao listada(s)` : ""}`, 10, attentionY + 6);
    attentionY += 6;
  }

  if (data.attentionRows.length){
    attentionY = drawSimpleTable(doc, {
      startY: attentionY + 3,
      rowHeight: 9,
      headerHeight: 8,
      fontSize: 7.5,
      columns: [
        { key: "date", label: "Data", width: .7 },
        { key: "days", label: "Dias atraso", width: .65 },
        { key: "task", label: "Tarefa", width: .75 },
        { key: "activity", label: "Atividade", width: 2.05 },
        { key: "techNames", label: "Responsavel tecnico", width: 1.35 },
        { key: "hours", label: "Horas", width: .55 }
      ],
      rows: data.attentionRows.map((activity) => ({
        date: activity.date,
        days: String(activity.daysOverdue),
        task: `#${activity.taskNumber}`,
        activity: activity.activityName,
        techNames: activity.techNames,
        hours: formatHours(activity.hours)
      }))
    }) + 8;
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(94, 104, 123);
    doc.text("Nenhum ponto critico identificado no momento.", 10, attentionY + 7);
    attentionY += 15;
  }


  doc.addPage();
  nextY = 20;

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
      planned: formatHours(task.plannedHours),
      plannedNoOs: formatHours(task.plannedWithoutOsHours),
      worked: formatHours(task.workedHours),
      count: String(task.activityCount)
    }))
  }) + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Detalhamento das atividades", 10, nextY);

  nextY = drawSimpleTable(doc, {
    startY: nextY + 3,
    rowHeight: 10,
    headerHeight: 8,
    fontSize: 7.2,
    columns: [
      { key: "date", label: "Data", width: .7 },
      { key: "task", label: "Tarefa", width: 1.25 },
      { key: "activityName", label: "Atividade", width: 1.55 },
      { key: "techNames", label: "Tecnico", width: 1.15 },
      { key: "keyUsers", label: "Key user", width: 1.05 },
      { key: "hours", label: "Horas", width: .5 },
      { key: "status", label: "Status", width: .9 }
    ],
    rows: data.activityRows.map((activity) => ({
      date: activity.date,
      task: `#${activity.taskNumber} - ${activity.taskName}`,
      activityName: activity.activityName,
      techNames: activity.techNames,
      keyUsers: activity.keyUsers,
      hours: formatHours(activity.hours),
      status: activity.status
    }))
  }) + 12;

  const pageHeight = doc.internal.pageSize.getHeight();
  if (nextY > pageHeight - 82){
    doc.addPage();
    nextY = 24;
  }
  nextY = drawProjectSummaryChart(doc, data, nextY);
  if (nextY > pageHeight - 45){
    doc.addPage();
    nextY = 24;
    nextY = drawProjectSummaryChart(doc, data, nextY);
  }
  doc.setDrawColor(180, 190, 205);
  doc.line(10, nextY + 12, 82, nextY + 12);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(22, 32, 51);
  doc.text(summary.managerName, 10, nextY + 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(94, 104, 123);
  doc.text("Gerente de projetos", 10, nextY + 23);
  doc.text(`Telefone: ${summary.managerPhone}`, 10, nextY + 28);
  doc.text(`Email: ${summary.managerEmail}`, 10, nextY + 33);

  addPdfPageChrome(doc, data);

  const filename = `${normalizeFileName(`status-report-${data.project.number}-${data.project.name}`)}.pdf`;
  doc.save(filename);
}
