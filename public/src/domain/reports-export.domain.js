function escapeHtml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function imageFormatForPdf(value){
  const raw = String(value || "").toLowerCase();
  if (raw.includes("image/jpeg") || raw.includes("image/jpg") || raw.includes(".jpg") || raw.includes(".jpeg")) return "JPEG";
  if (raw.includes("image/webp") || raw.includes(".webp")) return "WEBP";
  return "PNG";
}

async function fetchImageAsDataUrl(url){
  if (!url || String(url).startsWith("data:")) return String(url || "");
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

function normalizeFileName(value){
  return String(value || "relatorio-executivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function triggerDownload(blob, filename){
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildExecutiveHtml(data){
  const projectRows = data.projectRows.map((project) => `
    <tr>
      <td>${escapeHtml(project.number)}</td>
      <td>${escapeHtml(project.name)}</td>
      <td>${escapeHtml(project.client)}</td>
      <td>${escapeHtml(project.manager)}</td>
      <td>${escapeHtml(project.status)}</td>
      <td>${escapeHtml(formatHours(project.plannedHours))}</td>
      <td>${escapeHtml(formatHours(project.executedHours))}</td>
      <td>${escapeHtml(String(project.pendingActivities))}</td>
      <td>${escapeHtml(String(project.overdueActivities))}</td>
    </tr>
  `).join("");

  const statusRows = data.statusCounts.map((item) => `
    <tr>
      <td>${escapeHtml(item.label)}</td>
      <td>${escapeHtml(String(item.count))}</td>
    </tr>
  `).join("");

  const topClientRows = data.topClients.map((item) => `
    <tr>
      <td>${escapeHtml(item.clientName)}</td>
      <td>${escapeHtml(String(item.activities))}</td>
      <td>${escapeHtml(formatHours(item.hours))}</td>
    </tr>
  `).join("");

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #162033; padding: 24px; }
          h1, h2 { margin: 0 0 10px; }
          p { margin: 0 0 8px; }
          .summary { display: flex; gap: 12px; margin: 18px 0; flex-wrap: wrap; }
          .card { border: 1px solid #dbe3ef; border-radius: 12px; padding: 12px 14px; min-width: 180px; }
          .card-label { font-size: 11px; text-transform: uppercase; color: #66758f; font-weight: bold; }
          .card-value { font-size: 24px; font-weight: bold; margin-top: 6px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #dbe3ef; padding: 8px; text-align: left; font-size: 12px; }
          th { background: #f3f7ff; }
          .section { margin-top: 22px; }
        </style>
      </head>
      <body>
        <h1>Relatorio Executivo</h1>
        <p>${escapeHtml(data.periodLabel)}</p>
        <p>Gerado em ${escapeHtml(data.generatedAtLabel)}</p>
        <p>${escapeHtml(data.executiveSummary)}</p>

        <div class="summary">
          <div class="card"><div class="card-label">Projetos monitorados</div><div class="card-value">${escapeHtml(String(data.summary.projects))}</div></div>
          <div class="card"><div class="card-label">Horas previstas</div><div class="card-value">${escapeHtml(formatHours(data.summary.plannedHours))}</div></div>
          <div class="card"><div class="card-label">Horas executadas</div><div class="card-value">${escapeHtml(formatHours(data.summary.executedHours))}</div></div>
          <div class="card"><div class="card-label">Horas planejadas</div><div class="card-value">${escapeHtml(formatHours(data.summary.pendingPlannedHours))}</div></div>
          <div class="card"><div class="card-label">Entrega no prazo</div><div class="card-value">${escapeHtml(formatPercent(data.summary.deliveryOnTime))}</div></div>
        </div>

        <div class="section">
          <h2>Resumo por projeto</h2>
          <table>
            <thead>
              <tr>
                <th>#</th><th>Projeto</th><th>Cliente</th><th>Gestor</th><th>Status</th><th>Horas previstas</th><th>Horas executadas</th><th>Pendentes</th><th>Atrasadas</th>
              </tr>
            </thead>
            <tbody>${projectRows || `<tr><td colspan="9">Sem projetos com os filtros atuais.</td></tr>`}</tbody>
          </table>
        </div>

        <div class="section">
          <h2>Projetos por status</h2>
          <table>
            <thead><tr><th>Status</th><th>Quantidade</th></tr></thead>
            <tbody>${statusRows}</tbody>
          </table>
        </div>

        <div class="section">
          <h2>Clientes com maior volume executado</h2>
          <table>
            <thead><tr><th>Cliente</th><th>Atividades</th><th>Horas</th></tr></thead>
            <tbody>${topClientRows || `<tr><td colspan="3">Sem dados suficientes para este filtro.</td></tr>`}</tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

function buildGenericReportHtml(payload){
  const metaRows = (payload.meta || []).map((item) => `
    <tr>
      <th>${escapeHtml(item.label)}</th>
      <td>${escapeHtml(item.value)}</td>
    </tr>
  `).join("");

  const summaryCards = (payload.summary || []).map((item) => `
    <div class="card"><div class="card-label">${escapeHtml(item.label)}</div><div class="card-value">${escapeHtml(item.value)}</div></div>
  `).join("");

  const sections = (payload.tables || []).map((table) => {
    const columns = table.excelColumns || table.columns || [];
    const cellClass = (column) => {
      const classes = [];
      if (column.type) classes.push(`cell-${column.type}`);
      if (column.align) classes.push(`align-${column.align}`);
      return classes.length ? ` class="${escapeHtml(classes.join(" "))}"` : "";
    };
    const cellStyle = (column) => {
      if (column.type === "currency") return ` style="mso-number-format:'R\\$ #,##0.00';"`;
      if (column.type === "number") return ` style="mso-number-format:'0.00';"`;
      if (column.type === "date") return ` style="mso-number-format:'dd/mm/yyyy';"`;
      return "";
    };
    const renderCell = (row, column, tag = "td") => {
      const raw = row[column.key] ?? "";
      return `<${tag}${cellClass(column)}${cellStyle(column)}>${escapeHtml(raw)}</${tag}>`;
    };
    const header = columns.map((column) => `<th${cellClass(column)}>${escapeHtml(column.label)}</th>`).join("");
    const rows = (table.rows || []).map((row) => `
      <tr>
        ${columns.map((column) => renderCell(row, column)).join("")}
      </tr>
    `).join("");
    const footerRows = (table.footerRows || []).map((row) => `
      <tr class="total-row">
        ${columns.map((column, index) => renderCell(row, column, index === 0 ? "th" : "td")).join("")}
      </tr>
    `).join("");
    return `
      <div class="section">
        <h2>${escapeHtml(table.title)}</h2>
        ${table.subtitle ? `<p>${escapeHtml(table.subtitle)}</p>` : ""}
        <table>
          <thead><tr>${header}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${columns.length}">Sem dados para os filtros atuais.</td></tr>`}</tbody>
          ${footerRows ? `<tfoot>${footerRows}</tfoot>` : ""}
        </table>
      </div>
    `;
  }).join("");

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #162033; padding: 24px; }
          h1, h2 { margin: 0 0 10px; }
          p { margin: 0 0 8px; color: #5e687b; }
          .summary { display: flex; gap: 12px; margin: 18px 0; flex-wrap: wrap; }
          .card { border: 1px solid #dbe3ef; border-radius: 12px; padding: 12px 14px; min-width: 160px; }
          .card-label { font-size: 11px; text-transform: uppercase; color: #66758f; font-weight: bold; }
          .card-value { font-size: 20px; font-weight: bold; margin-top: 6px; color: #162033; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #dbe3ef; padding: 8px; text-align: left; font-size: 12px; vertical-align: top; }
          th { background: #f3f7ff; }
          tfoot th, tfoot td, .total-row th, .total-row td { background: #eaf2ff; font-weight: bold; }
          .meta { width: auto; min-width: 420px; margin-top: 12px; }
          .meta th { width: 150px; }
          .cell-currency, .cell-number, .align-right { text-align: right; }
          .align-center { text-align: center; }
          .section { margin-top: 22px; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(payload.title)}</h1>
        <p>${escapeHtml(payload.subtitle || "")}</p>
        <p>Gerado em ${escapeHtml(payload.generatedAtLabel || new Date().toLocaleString("pt-BR"))}</p>
        ${metaRows ? `<table class="meta"><tbody>${metaRows}</tbody></table>` : ""}
        ${summaryCards ? `<div class="summary">${summaryCards}</div>` : ""}
        ${sections}
      </body>
    </html>
  `;
}

function drawSimpleTable(doc, { startY, columns, rows, rowHeight = 8, headerHeight = 8, fontSize = 8 }){
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;
  const usableWidth = pageWidth - marginX * 2;
  const totalWeight = columns.reduce((acc, column) => acc + (column.width || 1), 0);
  const colWidths = columns.map((column) => usableWidth * ((column.width || 1) / totalWeight));
  let cursorY = startY;

  const ensurePage = (neededHeight) => {
    if ((cursorY + neededHeight) < (pageHeight - 10)) return;
    doc.addPage();
    cursorY = 12;
  };

  const drawRow = (cells, isHeader = false) => {
    const height = isHeader ? headerHeight : rowHeight;
    ensurePage(height);
    let x = marginX;
    for (let index = 0; index < columns.length; index += 1){
      const width = colWidths[index];
      doc.setDrawColor(226, 233, 242);
      doc.setFillColor(isHeader ? 244 : 255, isHeader ? 247 : 255, isHeader ? 252 : 255);
      doc.rect(x, cursorY, width, height, isHeader ? "FD" : "S");
      doc.setFont("helvetica", isHeader ? "bold" : "normal");
      doc.setFontSize(fontSize);
      doc.setTextColor(isHeader ? 86 : 22, isHeader ? 98 : 32, isHeader ? 122 : 51);
      const text = doc.splitTextToSize(String(cells[index] ?? ""), Math.max(8, width - 4));
      doc.text(text, x + 2, cursorY + 5);
      x += width;
    }
    cursorY += height;
  };

  drawRow(columns.map((column) => column.label || ""), true);
  rows.forEach((row) => {
    drawRow(columns.map((column) => row[column.key] ?? ""), false);
  });

  return cursorY;
}

function ensurePdfSpace(doc, cursorY, neededHeight = 18){
  const pageHeight = doc.internal.pageSize.getHeight();
  if ((cursorY + neededHeight) < (pageHeight - 10)) return cursorY;
  doc.addPage();
  return 12;
}

export async function downloadExecutiveReportExcel(payload){
  const html = buildExecutiveHtml(payload);
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  triggerDownload(blob, `${normalizeFileName(`relatorio-executivo-${payload.fileSuffix}`)}.xls`);
}

export async function downloadExecutiveReportPdf(payload){
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(243, 247, 255);
  doc.roundedRect(10, 10, pageWidth - 20, 34, 8, 8, "F");
  doc.setTextColor(101, 82, 219);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("RELATORIO EXECUTIVO", 14, 18);
  doc.setTextColor(22, 32, 51);
  doc.setFontSize(18);
  doc.text("Painel Consolidado de Projetos", 14, 27);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(94, 104, 123);
  doc.text(payload.periodLabel, 14, 34);
  doc.text(`Gerado em ${payload.generatedAtLabel}`, 14, 39);

  const cards = [
    { label: "Projetos", value: String(payload.summary.projects), sub: "Monitorados" },
    { label: "Horas previstas", value: formatHours(payload.summary.plannedHours), sub: "Projetos filtrados" },
    { label: "Horas executadas", value: formatHours(payload.summary.executedHours), sub: "Com OS" },
    { label: "Horas planejadas", value: formatHours(payload.summary.pendingPlannedHours), sub: "Atrasadas sem OS" }
  ];

  let x = 10;
  cards.forEach((card) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(220, 228, 240);
    doc.roundedRect(x, 50, 46, 22, 5, 5, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(122, 133, 153);
    doc.text(card.label.toUpperCase(), x + 4, 56);
    doc.setTextColor(22, 32, 51);
    doc.setFontSize(12);
    doc.text(card.value, x + 4, 63);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(94, 104, 123);
    doc.text(card.sub, x + 4, 68);
    x += 48;
  });

  doc.setFillColor(248, 250, 255);
  doc.setDrawColor(220, 228, 240);
  doc.roundedRect(10, 76, pageWidth - 20, 18, 5, 5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(122, 133, 153);
  doc.text("RESUMO EXECUTIVO", 14, 82);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(36, 50, 74);
  const executiveText = doc.splitTextToSize(payload.executiveSummary, pageWidth - 30);
  doc.text(executiveText, 14, 88);

  let nextY = 102;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(22, 32, 51);
  doc.text("Resumo por projeto", 10, nextY);

  nextY = drawSimpleTable(doc, {
    startY: nextY + 3,
    fontSize: 7.4,
    rowHeight: 10,
    columns: [
      { key: "number", label: "#", width: .5 },
      { key: "name", label: "Projeto", width: 1.8 },
      { key: "client", label: "Cliente", width: 1.2 },
      { key: "manager", label: "Gestor", width: 1.1 },
      { key: "status", label: "Status", width: .85 },
      { key: "planned", label: "Previstas", width: .8 },
      { key: "worked", label: "Executadas", width: .8 },
      { key: "pending", label: "Pend.", width: .55 },
      { key: "overdue", label: "Atr.", width: .45 }
    ],
    rows: payload.projectRows.map((project) => ({
      number: project.number,
      name: project.name,
      client: project.client,
      manager: project.manager,
      status: project.status,
      planned: formatHours(project.plannedHours),
      worked: formatHours(project.executedHours),
      pending: String(project.pendingActivities),
      overdue: String(project.overdueActivities)
    }))
  }) + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Projetos por status", 10, nextY);
  nextY = drawSimpleTable(doc, {
    startY: nextY + 3,
    fontSize: 8,
    columns: [
      { key: "label", label: "Status", width: 1.5 },
      { key: "count", label: "Quantidade", width: .8 }
    ],
    rows: payload.statusCounts.map((item) => ({ label: item.label, count: String(item.count) }))
  }) + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Clientes com maior volume executado", 10, nextY);
  drawSimpleTable(doc, {
    startY: nextY + 3,
    fontSize: 8,
    columns: [
      { key: "clientName", label: "Cliente", width: 1.8 },
      { key: "activities", label: "Atividades", width: .9 },
      { key: "hours", label: "Horas", width: .9 }
    ],
    rows: payload.topClients.map((item) => ({
      clientName: item.clientName,
      activities: String(item.activities),
      hours: formatHours(item.hours)
    }))
  });

  doc.save(`${normalizeFileName(`relatorio-executivo-${payload.fileSuffix}`)}.pdf`);
}

export async function downloadReportExcel(payload){
  const html = buildGenericReportHtml(payload);
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  triggerDownload(blob, `${normalizeFileName(payload.fileName || payload.title)}.xls`);
}

export async function downloadExpenseReceiptPdf(payload){
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const statusKey = String(payload.statusKey || "pending").toLowerCase();
  const statusColors = {
    approved: [22, 163, 74],
    rejected: [220, 38, 38],
    pending: [217, 119, 6]
  };
  const statusColor = statusColors[statusKey] || statusColors.pending;

  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, pageWidth, 297, "F");

  doc.setFillColor(15, 23, 42);
  doc.roundedRect(margin, 12, contentWidth, 32, 5, 5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("FLOWPROJECT", margin + 6, 22);
  doc.setFontSize(18);
  doc.text("Comprovante de despesa", margin + 6, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(`Gerado em ${String(payload.generatedAtLabel || new Date().toLocaleString("pt-BR"))}`, margin + 6, 40);

  doc.setFillColor(statusColor[0], statusColor[1], statusColor[2]);
  doc.roundedRect(pageWidth - margin - 45, 20, 39, 12, 4, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(String(payload.status || "Pendente").toUpperCase(), pageWidth - margin - 25.5, 28, { align: "center" });

  let y = 54;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, contentWidth, 30, 5, 5, "FD");
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("VALOR DA DESPESA", margin + 6, y + 9);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(20);
  doc.text(String(payload.amount || "R$ 0,00"), margin + 6, y + 23);
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("ID", pageWidth - margin - 44, y + 9);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "normal");
  doc.text(String(payload.id || "-").slice(0, 32), pageWidth - margin - 44, y + 18);

  const drawSection = (title, rows) => {
    y = ensurePdfSpace(doc, y + 10, 18 + rows.length * 11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.text(title, margin, y);
    y += 5;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, contentWidth, rows.length * 11 + 4, 4, 4, "FD");
    rows.forEach((row, index) => {
      const rowY = y + 8 + index * 11;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(String(row.label || "").toUpperCase(), margin + 5, rowY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      const value = doc.splitTextToSize(String(row.value || "-"), contentWidth - 56);
      doc.text(value.slice(0, 2), margin + 50, rowY);
    });
    y += rows.length * 11 + 6;
  };

  drawSection("Dados da despesa", [
    { label: "Responsavel", value: payload.responsible },
    { label: "Tipo", value: payload.type },
    { label: "Data", value: payload.expenseDate },
    { label: "Origem", value: payload.source }
  ]);

  drawSection("Contexto", [
    { label: "Projeto", value: payload.project },
    { label: "Cliente", value: payload.client },
    { label: "Tarefa", value: payload.task },
    { label: "Atividade", value: payload.activity }
  ]);

  drawSection("Aprovacao", [
    { label: "Status", value: payload.status },
    { label: "Aprovador", value: payload.approver },
    { label: "Data aprov.", value: payload.approvalDate },
    { label: "Criada em", value: payload.createdAt }
  ]);

  y = ensurePdfSpace(doc, y + 8, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("Observacao", margin, y);
  y += 5;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, contentWidth, 32, 4, 4, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(doc.splitTextToSize(String(payload.observation || "-"), contentWidth - 10).slice(0, 6), margin + 5, y + 8);
  y += 40;

  if (payload.rejectionReason) {
    drawSection("Motivo da reprovacao", [
      { label: "Motivo", value: payload.rejectionReason }
    ]);
  }

  drawSection("Comprovante anexado", [
    { label: "Arquivo", value: payload.receiptName || "-" },
    { label: "Referencia", value: payload.receiptPath || payload.receiptUrl || "-" }
  ]);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("Documento gerado automaticamente pelo FlowProject para conferencia interna de despesas.", margin, 286);
  doc.save(`${normalizeFileName(`comprovante-despesa-${payload.id || Date.now()}`)}.pdf`);
}

async function downloadClientClosurePdf(payload){
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const companyName = String(payload.companyName || "FlowProject");
  const logoDataUrl = String(payload.logoDataUrl || "") || await fetchImageAsDataUrl(payload.logoURL);

  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, pageWidth, pageHeight, "F");
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(margin, 10, contentWidth, 38, 6, 6, "F");

  if (logoDataUrl){
    try{
      doc.addImage(logoDataUrl, imageFormatForPdf(logoDataUrl), margin + 6, 16, 22, 22);
    }catch(_){}
  }
  if (!logoDataUrl){
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin + 6, 16, 22, 22, 5, 5, "F");
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(companyName.trim().slice(0, 1).toUpperCase(), margin + 17, 30, { align: "center" });
  }

  doc.setTextColor(226, 232, 240);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(companyName.toUpperCase().slice(0, 38), margin + 34, 19);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(17);
  doc.text(String(payload.title || "Relatorio de Cliente x Fechamento"), margin + 34, 29);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);
  doc.setTextColor(203, 213, 225);
  doc.text(String(payload.subtitle || ""), margin + 34, 36);
  doc.text(`Gerado em ${String(payload.generatedAtLabel || new Date().toLocaleString("pt-BR"))}`, margin + 34, 42);

  let y = 56;
  const summary = payload.summary || [];
  const cardWidth = Math.max(42, (contentWidth - 8) / Math.max(1, Math.min(3, summary.length || 1)));
  let x = margin;
  summary.slice(0, 3).forEach((item) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, cardWidth, 22, 5, 5, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(String(item.label || "").toUpperCase(), x + 4, y + 7);
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(13);
    doc.text(String(item.value || "-").slice(0, 24), x + 4, y + 16);
    x += cardWidth + 4;
  });

  y += 31;
  if (payload.meta?.length){
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, contentWidth, 18, 5, 5, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const metaText = payload.meta.map((item) => `${item.label}: ${item.value}`).join("  |  ");
    doc.text(doc.splitTextToSize(metaText, contentWidth - 10).slice(0, 2), margin + 5, y + 7);
    y += 26;
  }

  const table = (payload.tables || [])[0] || {};
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(String(table.title || "Fechamento de atividades"), margin, y);
  y = drawSimpleTable(doc, {
    startY: y + 4,
    fontSize: 6.4,
    rowHeight: table.rowHeight || 12,
    headerHeight: 8,
    columns: table.pdfColumns || table.columns || [],
    rows: table.rows || []
  }) + 12;

  y = ensurePdfSpace(doc, y, 32);
  const signatureY = Math.min(pageHeight - 24, y + 18);
  doc.setDrawColor(148, 163, 184);
  doc.line(pageWidth - margin - 74, signatureY, pageWidth - margin, signatureY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(String(payload.signatureName || "Gestor"), pageWidth - margin - 37, signatureY + 6, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("Assinatura do Gestor", pageWidth - margin - 37, signatureY + 11, { align: "center" });

  doc.save(`${normalizeFileName(payload.fileName || payload.title)}.pdf`);
}

export async function downloadReportPdf(payload){
  if (payload?.template === "clientClosure") {
    return downloadClientClosurePdf(payload);
  }
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(243, 247, 255);
  doc.roundedRect(10, 10, pageWidth - 20, 30, 8, 8, "F");
  doc.setTextColor(101, 82, 219);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("RELATORIO", 14, 18);
  doc.setTextColor(22, 32, 51);
  doc.setFontSize(16);
  doc.text(String(payload.title || "Relatorio"), 14, 27);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(94, 104, 123);
  doc.text(String(payload.generatedAtLabel || new Date().toLocaleString("pt-BR")), 14, 34);

  let nextY = 48;
  const summary = payload.summary || [];
  if (summary.length){
    const cardWidth = Math.max(38, (pageWidth - 20 - (Math.min(summary.length, 4) - 1) * 4) / Math.min(summary.length, 4));
    let x = 10;
    summary.slice(0, 8).forEach((item, index) => {
      if (index > 0 && index % 4 === 0) {
        x = 10;
        nextY += 24;
      }
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(220, 228, 240);
      doc.roundedRect(x, nextY, cardWidth, 20, 5, 5, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(122, 133, 153);
      doc.text(String(item.label || "").toUpperCase().slice(0, 24), x + 3, nextY + 6);
      doc.setTextColor(22, 32, 51);
      doc.setFontSize(10);
      doc.text(String(item.value || "-").slice(0, 24), x + 3, nextY + 14);
      x += cardWidth + 4;
    });
    nextY += 30;
  }

  (payload.tables || []).forEach((table) => {
    nextY = ensurePdfSpace(doc, nextY, 22);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(22, 32, 51);
    doc.text(String(table.title || "Dados"), 10, nextY);
    nextY = drawSimpleTable(doc, {
      startY: nextY + 3,
      fontSize: table.fontSize || 7,
      rowHeight: table.rowHeight || 9,
      columns: table.pdfColumns || table.columns,
      rows: table.rows || []
    }) + 8;
  });

  doc.save(`${normalizeFileName(payload.fileName || payload.title)}.pdf`);
}
