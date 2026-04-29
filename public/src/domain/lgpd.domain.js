import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { escapeHtml } from "../utils/dom.js";

const DEFAULT_LGPD_VERSION = "2026.04";
let _bound = false;

function currentRole(state){
  if (state?.isSuperAdmin) return "superadmin";
  return String(state?.profile?.role || "").toLowerCase();
}

function isCompanyAdmin(state){
  return !state?.isSuperAdmin && currentRole(state) === "admin";
}

function formatDateTime(value){
  if (!value) return "-";
  try {
    if (value?.toDate) return value.toDate().toLocaleString("pt-BR");
  } catch (_) {}
  return String(value || "-");
}

function normalizeSettings(data = {}){
  return {
    version: String(data.version || DEFAULT_LGPD_VERSION),
    dpoName: String(data.dpoName || ""),
    dpoEmail: String(data.dpoEmail || ""),
    privacySummary: String(data.privacySummary || "Tratamos dados pessoais para operacao de projetos, usuarios, atividades, despesas, relatorios e seguranca do sistema."),
    termsSummary: String(data.termsSummary || "Ao usar o FlowProject, o usuario declara ciencia sobre o uso de seus dados conforme a politica de privacidade da empresa."),
    updatedAt: data.updatedAt || null,
    updatedBy: String(data.updatedBy || "")
  };
}

async function getSettings(db, companyId){
  if (!db || !companyId) return normalizeSettings();
  const snap = await getDoc(doc(db, "companies", companyId, "lgpd", "settings"));
  return normalizeSettings(snap.exists() ? snap.data() : {});
}

async function getMyConsent(db, companyId, uid){
  if (!db || !companyId || !uid) return null;
  const snap = await getDoc(doc(db, "companies", companyId, "lgpdConsents", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function listUsers(db, companyId){
  const snap = await getDocs(collection(db, "companies", companyId, "users"));
  return snap.docs.map((item) => ({ id: item.id, uid: item.id, ...item.data() }));
}

async function listConsents(db, companyId){
  const snap = await getDocs(collection(db, "companies", companyId, "lgpdConsents"));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function listRequests(db, companyId, createdBy = ""){
  const requestsRef = collection(db, "companies", companyId, "lgpdRequests");
  const snap = createdBy
    ? await getDocs(query(requestsRef, where("createdBy", "==", createdBy), limit(40)))
    : await getDocs(query(requestsRef, orderBy("createdAt", "desc"), limit(40)));
  return snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => {
      const aTime = typeof a.createdAt?.toMillis === "function" ? a.createdAt.toMillis() : 0;
      const bTime = typeof b.createdAt?.toMillis === "function" ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    });
}

async function listVersions(db, companyId){
  const versionsRef = collection(db, "companies", companyId, "lgpdVersions");
  const snap = await getDocs(query(versionsRef, orderBy("publishedAt", "desc"), limit(12)));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function getCompanySummary(db, company){
  const companyId = company.id;
  const [settings, users, consents, requests, versions] = await Promise.all([
    getSettings(db, companyId),
    listUsers(db, companyId).catch(() => []),
    listConsents(db, companyId).catch(() => []),
    listRequests(db, companyId).catch(() => []),
    listVersions(db, companyId).catch(() => [])
  ]);
  const activeUsers = users.filter((user) => user.active !== false);
  const consentByUid = new Map(consents.map((item) => [item.uid || item.id, item]));
  const consented = activeUsers.filter((user) => {
    const consent = consentByUid.get(user.uid || user.id);
    return consent?.accepted === true && consent?.version === settings.version;
  }).length;
  const pending = Math.max(0, activeUsers.length - consented);
  const openRequests = requests.filter((item) => String(item.status || "open") !== "closed").length;
  return {
    company,
    settings,
    totalUsers: activeUsers.length,
    consented,
    pending,
    openRequests,
    versionsCount: versions.length,
    lastPublishedAt: versions[0]?.publishedAt || settings.updatedAt || null,
    consentRate: activeUsers.length ? Math.round((consented / activeUsers.length) * 100) : 100
  };
}

function refsFrom(refs){
  return {
    modalLgpdConsent: refs.modalLgpdConsent || document.getElementById("modalLgpdConsent"),
    lgpdConsentVersion: refs.lgpdConsentVersion || document.getElementById("lgpdConsentVersion"),
    lgpdConsentSummary: refs.lgpdConsentSummary || document.getElementById("lgpdConsentSummary"),
    btnAcceptLgpd: refs.btnAcceptLgpd || document.getElementById("btnAcceptLgpd"),
    lgpdConsentCheck: refs.lgpdConsentCheck || document.getElementById("lgpdConsentCheck"),
    lgpdConsentAlert: refs.lgpdConsentAlert || document.getElementById("lgpdConsentAlert"),
    modalLgpdCenter: refs.modalLgpdCenter || document.getElementById("modalLgpdCenter"),
    btnCloseLgpdCenter: refs.btnCloseLgpdCenter || document.getElementById("btnCloseLgpdCenter"),
    btnCancelLgpdCenter: refs.btnCancelLgpdCenter || document.getElementById("btnCancelLgpdCenter"),
    lgpdCenterTitle: refs.lgpdCenterTitle || document.getElementById("lgpdCenterTitle"),
    lgpdCenterSubtitle: refs.lgpdCenterSubtitle || document.getElementById("lgpdCenterSubtitle"),
    lgpdCenterBody: refs.lgpdCenterBody || document.getElementById("lgpdCenterBody")
  };
}

function setInlineAlert(el, message, type = "error"){
  if (!el) return;
  el.hidden = false;
  el.className = `alert ${type}`;
  el.textContent = message;
}

function renderStats({ users = [], consents = [], requests = [], settings }){
  const activeUsers = users.filter((item) => item.active !== false);
  const consentByUid = new Map(consents.map((item) => [item.uid || item.id, item]));
  const accepted = activeUsers.filter((user) => {
    const consent = consentByUid.get(user.uid || user.id);
    return consent?.accepted === true && consent?.version === settings.version;
  });
  const openRequests = requests.filter((item) => String(item.status || "open") !== "closed");
  return `
    <div class="lgpd-stats-grid">
      <article><span>Versao vigente</span><strong>${escapeHtml(settings.version)}</strong></article>
      <article><span>Aceites</span><strong>${escapeHtml(String(accepted.length))}/${escapeHtml(String(activeUsers.length))}</strong></article>
      <article><span>Pendentes</span><strong>${escapeHtml(String(Math.max(0, activeUsers.length - accepted.length)))}</strong></article>
      <article><span>Solicitacoes abertas</span><strong>${escapeHtml(String(openRequests.length))}</strong></article>
    </div>
  `;
}

function requestStatusLabel(status){
  const key = String(status || "open");
  const map = {
    open: "Aberta",
    reviewing: "Em analise",
    closed: "Concluida"
  };
  return map[key] || "Aberta";
}

function escapeCsvCell(value){
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows){
  const content = rows.map((row) => row.map(escapeCsvCell).join(";")).join("\r\n");
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

function renderRequestsTable(requests, canManage){
  if (!requests.length) {
    return `<div class="panel subtle lgpd-empty">Nenhuma solicitacao LGPD registrada.</div>`;
  }
  return `
    <div class="table lgpd-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Solicitante</th>
            <th>Tipo</th>
            <th>Status</th>
            <th>Criada em</th>
            ${canManage ? "<th>Acoes</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${requests.map((item) => `
            <tr>
              <td><strong>${escapeHtml(item.createdByName || item.createdByEmail || item.createdBy || "-")}</strong><div class="cell-sub">${escapeHtml(item.createdByEmail || "")}</div></td>
              <td>${escapeHtml(item.typeLabel || item.type || "Solicitacao")}</td>
              <td><span class="lgpd-status-pill lgpd-status-pill--${escapeHtml(String(item.status || "open"))}">${escapeHtml(requestStatusLabel(item.status))}</span></td>
              <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
              ${canManage ? `
                <td class="actions">
                  <button class="btn sm" data-lgpd-request-status="reviewing" data-lgpd-request-id="${escapeHtml(item.id)}" type="button">Em analise</button>
                  <button class="btn sm primary" data-lgpd-request-status="closed" data-lgpd-request-id="${escapeHtml(item.id)}" type="button">Concluir</button>
                </td>
              ` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderVersionsTable(versions){
  if (!versions.length) {
    return `<div class="panel subtle lgpd-empty">Nenhuma versao anterior registrada ainda. O historico sera criado ao salvar uma alteracao nos termos.</div>`;
  }
  return `
    <div class="table lgpd-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Versao</th>
            <th>Publicado em</th>
            <th>Publicado por</th>
            <th>Resumo</th>
          </tr>
        </thead>
        <tbody>
          ${versions.map((item) => `
            <tr>
              <td><strong>${escapeHtml(item.version || "-")}</strong><div class="cell-sub">Anterior: ${escapeHtml(item.previousVersion || "-")}</div></td>
              <td>${escapeHtml(formatDateTime(item.publishedAt))}</td>
              <td>${escapeHtml(item.publishedByEmail || item.publishedBy || "-")}</td>
              <td>${escapeHtml(String(item.termsSummary || item.privacySummary || "").slice(0, 120))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function renderCompanyLgpdCenter(deps, refs){
  const { db, state } = deps;
  const canManage = isCompanyAdmin(state);
  const settings = await getSettings(db, state.companyId);
  const userOnly = canManage ? "" : deps.auth?.currentUser?.uid || "";
  const [users, consents, requests, versions, myConsent] = await Promise.all([
    canManage ? listUsers(db, state.companyId).catch(() => []) : Promise.resolve([]),
    canManage ? listConsents(db, state.companyId).catch(() => []) : Promise.resolve([]),
    listRequests(db, state.companyId, userOnly).catch(() => []),
    canManage ? listVersions(db, state.companyId).catch(() => []) : Promise.resolve([]),
    !canManage && deps.auth?.currentUser?.uid ? getMyConsent(db, state.companyId, deps.auth.currentUser.uid).catch(() => null) : Promise.resolve(null)
  ]);

  refs.lgpdCenterTitle.textContent = canManage ? "Privacidade e LGPD" : "Meus direitos LGPD";
  refs.lgpdCenterSubtitle.textContent = canManage
    ? "Acompanhe aceites, solicitacoes e dados de contato da empresa."
    : "Consulte seu aceite e registre solicitacoes sobre seus dados pessoais.";

  refs.lgpdCenterBody.innerHTML = `
    ${canManage ? renderStats({ users, consents, requests, settings }) : `
      <div class="lgpd-stats-grid lgpd-stats-grid--user">
        <article><span>Versao vigente</span><strong>${escapeHtml(settings.version)}</strong></article>
        <article><span>Meu aceite</span><strong>${myConsent?.version === settings.version && myConsent?.accepted === true ? "Registrado" : "Pendente"}</strong></article>
        <article><span>Solicitacoes</span><strong>${escapeHtml(String(requests.length))}</strong></article>
      </div>
    `}
    <section class="lgpd-section">
      <div class="lgpd-section-head">
        <h3>Politica e termos vigentes</h3>
        <p>Resumo simplificado exibido aos usuarios no aceite.</p>
      </div>
      ${canManage ? `
        <div class="lgpd-form-grid">
          <label class="field"><span>Versao</span><input id="lgpdSettingsVersion" value="${escapeHtml(settings.version)}" /></label>
          <label class="field"><span>Encarregado/DPO</span><input id="lgpdSettingsDpoName" value="${escapeHtml(settings.dpoName)}" placeholder="Nome do responsavel" /></label>
          <label class="field"><span>E-mail LGPD</span><input id="lgpdSettingsDpoEmail" value="${escapeHtml(settings.dpoEmail)}" placeholder="lgpd@empresa.com" /></label>
          <label class="field span-2"><span>Resumo da privacidade</span><textarea id="lgpdSettingsPrivacy" rows="4">${escapeHtml(settings.privacySummary)}</textarea></label>
          <label class="field span-2"><span>Resumo dos termos</span><textarea id="lgpdSettingsTerms" rows="4">${escapeHtml(settings.termsSummary)}</textarea></label>
        </div>
        <div class="lgpd-actions-row">
          <button class="btn" id="btnExportLgpdEvidence" type="button">Exportar evidencias CSV</button>
          <button class="btn primary" id="btnSaveLgpdSettings" type="button">Salvar configuracoes LGPD</button>
        </div>
      ` : `
        <div class="lgpd-readonly-box">
          <strong>Versao ${escapeHtml(settings.version)}</strong>
          <p>${escapeHtml(settings.privacySummary)}</p>
          <p>${escapeHtml(settings.termsSummary)}</p>
          <span>Contato LGPD: ${escapeHtml(settings.dpoEmail || "Solicite ao Admin da empresa")}</span>
        </div>
      `}
    </section>
    ${canManage ? `
      <section class="lgpd-section">
        <div class="lgpd-section-head">
          <h3>Historico de versoes</h3>
          <p>Registro das publicacoes dos termos para auditoria e rastreabilidade.</p>
        </div>
        ${renderVersionsTable(versions)}
      </section>
    ` : ""}
    <section class="lgpd-section">
      <div class="lgpd-section-head">
        <h3>${canManage ? "Solicitacoes LGPD da empresa" : "Nova solicitacao LGPD"}</h3>
        <p>${canManage ? "Acompanhe pedidos de acesso, correcao, exportacao ou exclusao." : "Registre uma solicitacao para o Admin da empresa analisar."}</p>
      </div>
      ${canManage ? renderRequestsTable(requests, true) : `
        <div class="lgpd-form-grid">
          <label class="field"><span>Tipo</span><select id="lgpdRequestType">
            <option value="access">Acesso aos meus dados</option>
            <option value="correction">Correcao de dados</option>
            <option value="export">Exportacao de dados</option>
            <option value="deletion">Exclusao/anonimizacao</option>
          </select></label>
          <label class="field span-2"><span>Descricao</span><textarea id="lgpdRequestDescription" rows="4" placeholder="Descreva sua solicitacao com clareza."></textarea></label>
        </div>
        <div class="lgpd-actions-row">
          <button class="btn primary" id="btnCreateLgpdRequest" type="button">Enviar solicitacao</button>
        </div>
        ${renderRequestsTable(requests.filter((item) => item.createdBy === deps.auth?.currentUser?.uid), false)}
      `}
    </section>
  `;
}

async function renderMasterLgpdCenter(deps, refs){
  const { db } = deps;
  refs.lgpdCenterTitle.textContent = "LGPD por empresa";
  refs.lgpdCenterSubtitle.textContent = "Visao de governanca da plataforma, sem abrir dados pessoais operacionais.";
  refs.lgpdCenterBody.innerHTML = `<div class="panel subtle">Carregando empresas e indicadores LGPD...</div>`;

  const companiesSnap = await getDocs(collection(db, "companies"));
  const companies = companiesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const summaries = await Promise.all(companies.map((company) => getCompanySummary(db, company).catch(() => ({
    company,
    settings: normalizeSettings(),
    totalUsers: 0,
    consented: 0,
    pending: 0,
    openRequests: 0,
    versionsCount: 0,
    lastPublishedAt: null,
    consentRate: 0
  }))));
  const ordered = summaries.sort((a, b) => String(a.company.name || a.company.id).localeCompare(String(b.company.name || b.company.id)));
  const totals = ordered.reduce((acc, item) => {
    acc.users += item.totalUsers;
    acc.consented += item.consented;
    acc.pending += item.pending;
    acc.openRequests += item.openRequests;
    return acc;
  }, { users: 0, consented: 0, pending: 0, openRequests: 0 });

  refs.lgpdCenterBody.innerHTML = `
    <div class="lgpd-stats-grid">
      <article><span>Empresas</span><strong>${escapeHtml(String(ordered.length))}</strong></article>
      <article><span>Aceites</span><strong>${escapeHtml(String(totals.consented))}/${escapeHtml(String(totals.users))}</strong></article>
      <article><span>Pendentes</span><strong>${escapeHtml(String(totals.pending))}</strong></article>
      <article><span>Solicitacoes abertas</span><strong>${escapeHtml(String(totals.openRequests))}</strong></article>
    </div>
    <section class="lgpd-section">
      <div class="lgpd-section-head lgpd-section-head--actions">
        <div>
          <h3>Governanca por empresa</h3>
          <p>Resumo de conformidade, versao vigente e pendencias de aceite.</p>
        </div>
        <button class="btn" id="btnExportLgpdMaster" type="button">Exportar resumo CSV</button>
      </div>
      ${ordered.length ? `
        <div class="table lgpd-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Status</th>
                <th>Versao</th>
                <th>Aceites</th>
                <th>Pendentes</th>
                <th>Solicitacoes</th>
                <th>Historico</th>
                <th>Ultima publicacao</th>
              </tr>
            </thead>
            <tbody>
              ${ordered.map((item) => {
                const status = item.pending > 0 || item.openRequests > 0 ? "Atencao" : "Conforme";
                return `
                  <tr>
                    <td><strong>${escapeHtml(item.company.name || item.company.id)}</strong><div class="cell-sub">CNPJ: ${escapeHtml(item.company.cnpj || "-")}</div></td>
                    <td><span class="lgpd-status-pill ${status === "Conforme" ? "lgpd-status-pill--closed" : "lgpd-status-pill--reviewing"}">${escapeHtml(status)}</span></td>
                    <td>${escapeHtml(item.settings.version)}</td>
                    <td>${escapeHtml(String(item.consented))}/${escapeHtml(String(item.totalUsers))}<div class="cell-sub">${escapeHtml(String(item.consentRate))}%</div></td>
                    <td>${escapeHtml(String(item.pending))}</td>
                    <td>${escapeHtml(String(item.openRequests))}</td>
                    <td>${escapeHtml(String(item.versionsCount))}</td>
                    <td>${escapeHtml(formatDateTime(item.lastPublishedAt))}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      ` : `<div class="panel subtle">Nenhuma empresa cadastrada.</div>`}
    </section>
  `;
}

async function saveSettings(deps){
  const { db, state, auth } = deps;
  const body = refsFrom(deps.refs).lgpdCenterBody;
  const previous = await getSettings(db, state.companyId);
  const payload = {
    version: String(body.querySelector("#lgpdSettingsVersion")?.value || DEFAULT_LGPD_VERSION).trim() || DEFAULT_LGPD_VERSION,
    dpoName: String(body.querySelector("#lgpdSettingsDpoName")?.value || "").trim(),
    dpoEmail: String(body.querySelector("#lgpdSettingsDpoEmail")?.value || "").trim(),
    privacySummary: String(body.querySelector("#lgpdSettingsPrivacy")?.value || "").trim(),
    termsSummary: String(body.querySelector("#lgpdSettingsTerms")?.value || "").trim(),
    updatedAt: serverTimestamp(),
    updatedBy: auth?.currentUser?.uid || ""
  };
  await setDoc(doc(db, "companies", state.companyId, "lgpd", "settings"), payload, { merge: true });
  const changed = ["version", "dpoName", "dpoEmail", "privacySummary", "termsSummary"]
    .some((key) => String(previous[key] || "") !== String(payload[key] || ""));
  if (changed) {
    await addDoc(collection(db, "companies", state.companyId, "lgpdVersions"), {
      version: payload.version,
      previousVersion: previous.version || "",
      dpoName: payload.dpoName,
      dpoEmail: payload.dpoEmail,
      privacySummary: payload.privacySummary,
      termsSummary: payload.termsSummary,
      publishedAt: serverTimestamp(),
      publishedBy: auth?.currentUser?.uid || "",
      publishedByEmail: auth?.currentUser?.email || ""
    });
  }
  await openLgpdCenter(deps);
}

async function exportCompanyEvidence(deps){
  const { db, state } = deps;
  const [settings, users, consents] = await Promise.all([
    getSettings(db, state.companyId),
    listUsers(db, state.companyId),
    listConsents(db, state.companyId)
  ]);
  const consentByUid = new Map(consents.map((item) => [item.uid || item.id, item]));
  const rows = [[
    "Empresa", "Usuario", "Email", "Perfil", "Status", "Versao vigente",
    "Versao aceita", "Data do aceite", "Navegador"
  ]];
  users.filter((user) => user.active !== false).forEach((user) => {
    const consent = consentByUid.get(user.uid || user.id);
    const accepted = consent?.accepted === true && consent?.version === settings.version;
    rows.push([
      state.companyId || "",
      user.name || consent?.name || "",
      user.email || consent?.email || "",
      user.role || consent?.role || "",
      accepted ? "Aceito" : "Pendente",
      settings.version,
      consent?.version || "",
      formatDateTime(consent?.acceptedAt),
      consent?.userAgent || ""
    ]);
  });
  downloadCsv(`evidencias-lgpd-${state.companyId || "empresa"}.csv`, rows);
}

async function exportMasterSummary(deps){
  const { db } = deps;
  const companiesSnap = await getDocs(collection(db, "companies"));
  const companies = companiesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const summaries = await Promise.all(companies.map((company) => getCompanySummary(db, company).catch(() => null)));
  const rows = [[
    "Empresa", "CNPJ", "Versao vigente", "Usuarios ativos", "Aceites",
    "Pendentes", "Solicitacoes abertas", "Historico", "Taxa de aceite", "Ultima publicacao"
  ]];
  summaries.filter(Boolean).forEach((item) => {
    rows.push([
      item.company.name || item.company.id,
      item.company.cnpj || "",
      item.settings.version,
      item.totalUsers,
      item.consented,
      item.pending,
      item.openRequests,
      item.versionsCount,
      `${item.consentRate}%`,
      formatDateTime(item.lastPublishedAt)
    ]);
  });
  downloadCsv("resumo-lgpd-empresas.csv", rows);
}

async function createRequest(deps){
  const { db, state, auth } = deps;
  const body = refsFrom(deps.refs).lgpdCenterBody;
  const type = String(body.querySelector("#lgpdRequestType")?.value || "access");
  const description = String(body.querySelector("#lgpdRequestDescription")?.value || "").trim();
  if (description.length < 10) {
    alert("Descreva a solicitacao com pelo menos 10 caracteres.");
    return;
  }
  const labels = {
    access: "Acesso aos dados",
    correction: "Correcao de dados",
    export: "Exportacao de dados",
    deletion: "Exclusao/anonimizacao"
  };
  await addDoc(collection(db, "companies", state.companyId, "lgpdRequests"), {
    type,
    typeLabel: labels[type] || "Solicitacao",
    description,
    status: "open",
    createdBy: auth?.currentUser?.uid || "",
    createdByName: state.profile?.name || auth?.currentUser?.email || "Usuario",
    createdByEmail: auth?.currentUser?.email || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: auth?.currentUser?.uid || ""
  });
  await openLgpdCenter(deps);
}

async function updateRequestStatus(deps, requestId, status){
  const { db, state, auth } = deps;
  await updateDoc(doc(db, "companies", state.companyId, "lgpdRequests", requestId), {
    status,
    updatedAt: serverTimestamp(),
    updatedBy: auth?.currentUser?.uid || "",
    closedAt: status === "closed" ? serverTimestamp() : null
  });
  await openLgpdCenter(deps);
}

export async function openLgpdCenter(deps){
  const refs = refsFrom(deps.refs);
  if (!refs.modalLgpdCenter || !refs.lgpdCenterBody) return;
  refs.modalLgpdCenter.hidden = false;
  refs.lgpdCenterBody.innerHTML = `<div class="panel subtle">Carregando LGPD...</div>`;
  try {
    if (deps.state?.isSuperAdmin) await renderMasterLgpdCenter(deps, refs);
    else await renderCompanyLgpdCenter(deps, refs);
  } catch (err) {
    console.error("[lgpd:center]", err);
    refs.lgpdCenterBody.innerHTML = `
      <div class="alert error lgpd-load-error">
        Nao foi possivel carregar a Central LGPD. Verifique se as regras do Firestore foram publicadas e tente novamente.
      </div>
    `;
  }
}

export function closeLgpdCenter(refsSource){
  const refs = refsFrom(refsSource);
  if (refs.modalLgpdCenter) refs.modalLgpdCenter.hidden = true;
}

export async function ensureLgpdConsent(deps){
  const { db, state, auth } = deps;
  if (!state?.companyId || state?.isSuperAdmin || !auth?.currentUser) return;
  const refs = refsFrom(deps.refs);
  const settings = await getSettings(db, state.companyId);
  const consent = await getMyConsent(db, state.companyId, auth.currentUser.uid);
  if (consent?.version === settings.version && consent?.accepted === true) return;
  if (!refs.modalLgpdConsent) return;

  if (refs.lgpdConsentVersion) refs.lgpdConsentVersion.textContent = `Versao ${settings.version}`;
  if (refs.lgpdConsentSummary) refs.lgpdConsentSummary.textContent = `${settings.privacySummary} ${settings.termsSummary}`;
  if (refs.lgpdConsentCheck) refs.lgpdConsentCheck.checked = false;
  if (refs.btnAcceptLgpd) refs.btnAcceptLgpd.disabled = true;
  if (refs.lgpdConsentAlert) refs.lgpdConsentAlert.hidden = true;
  refs.modalLgpdConsent.hidden = false;
}

async function acceptLgpd(deps){
  const { db, state, auth } = deps;
  const refs = refsFrom(deps.refs);
  if (!refs.lgpdConsentCheck?.checked) {
    setInlineAlert(refs.lgpdConsentAlert, "Marque a confirmacao para continuar.");
    return;
  }
  const user = auth?.currentUser;
  if (!user || !state.companyId) return;
  const settings = await getSettings(db, state.companyId);
  await setDoc(doc(db, "companies", state.companyId, "lgpdConsents", user.uid), {
    uid: user.uid,
    email: user.email || "",
    name: state.profile?.name || user.email || "Usuario",
    role: state.profile?.role || "",
    version: settings.version,
    accepted: true,
    acceptedAt: serverTimestamp(),
    userAgent: navigator.userAgent || ""
  }, { merge: true });
  refs.modalLgpdConsent.hidden = true;
}

export function initLgpd(deps){
  const refs = refsFrom(deps.refs);
  if (_bound) return;
  _bound = true;

  refs.lgpdConsentCheck?.addEventListener("change", () => {
    if (refs.btnAcceptLgpd) refs.btnAcceptLgpd.disabled = !refs.lgpdConsentCheck.checked;
  });
  refs.btnAcceptLgpd?.addEventListener("click", () => {
    acceptLgpd(deps).catch((err) => {
      console.error("[lgpd:accept]", err);
      setInlineAlert(refs.lgpdConsentAlert, "Nao foi possivel registrar o aceite. Tente novamente.");
    });
  });
  refs.btnCloseLgpdCenter?.addEventListener("click", () => closeLgpdCenter(deps.refs));
  refs.btnCancelLgpdCenter?.addEventListener("click", () => closeLgpdCenter(deps.refs));
  refs.modalLgpdCenter?.addEventListener("click", (event) => {
    if (event.target?.dataset?.closeLgpdCenter === "true") closeLgpdCenter(deps.refs);
  });
  refs.lgpdCenterBody?.addEventListener("click", (event) => {
    const target = event.target;
    const saveBtn = target?.closest?.("#btnSaveLgpdSettings");
    if (saveBtn) {
      saveSettings(deps).catch((err) => {
        console.error("[lgpd:settings]", err);
        alert("Nao foi possivel salvar as configuracoes LGPD.");
      });
      return;
    }
    const exportEvidenceBtn = target?.closest?.("#btnExportLgpdEvidence");
    if (exportEvidenceBtn) {
      exportCompanyEvidence(deps).catch((err) => {
        console.error("[lgpd:export-evidence]", err);
        alert("Nao foi possivel exportar as evidencias LGPD.");
      });
      return;
    }
    const exportMasterBtn = target?.closest?.("#btnExportLgpdMaster");
    if (exportMasterBtn) {
      exportMasterSummary(deps).catch((err) => {
        console.error("[lgpd:export-master]", err);
        alert("Nao foi possivel exportar o resumo LGPD.");
      });
      return;
    }
    const createBtn = target?.closest?.("#btnCreateLgpdRequest");
    if (createBtn) {
      createRequest(deps).catch((err) => {
        console.error("[lgpd:request]", err);
        alert("Nao foi possivel enviar a solicitacao LGPD.");
      });
      return;
    }
    const statusBtn = target?.closest?.("[data-lgpd-request-id][data-lgpd-request-status]");
    if (statusBtn) {
      updateRequestStatus(deps, statusBtn.getAttribute("data-lgpd-request-id"), statusBtn.getAttribute("data-lgpd-request-status")).catch((err) => {
        console.error("[lgpd:request-status]", err);
        alert("Nao foi possivel atualizar a solicitacao.");
      });
    }
  });
}
