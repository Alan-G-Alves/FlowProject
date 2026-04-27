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

export async function downloadReportPdf(payload){
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
