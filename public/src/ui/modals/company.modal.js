import { clearInlineAlert, showInlineAlert } from "../alerts.js";
import { escapeHtml } from "../../utils/dom.js";
import { slugify } from "../../utils/format.js";
import { createCompany } from "../../domain/companies.domain.js";
import { listCompanyUsersDocs, getCompanyDoc } from "../../services/companies.service.js";

// ---------- DOM helpers ----------
function el(id){ return document.getElementById(id); }

// ---------- modal state ----------
let currentCompanyId = null;

export function bindCompaniesUi({ isSuperAdminFn, actorUidFn, refreshCompaniesFn }){
  // Botões / Modais
  const btnOpenCreate = el("btnOpenCreateCompany");
  const btnCreate = el("btnCreateCompany");
  const btnCloseCreate = el("btnCloseCreateCompany");
  const btnCancelCreate = el("btnCancelCreateCompany");

  const btnCloseDetail = el("btnCloseCompanyDetail");

  if (btnOpenCreate) btnOpenCreate.addEventListener("click", () => openCreateCompanyModal(isSuperAdminFn));
  if (btnCreate) btnCreate.addEventListener("click", async () => {
    await handleCreateCompany({
      isSuperAdminFn,
      actorUidFn,
      refreshCompaniesFn
    });
  });

  if (btnCloseCreate) btnCloseCreate.addEventListener("click", closeCreateCompanyModal);
  if (btnCancelCreate) btnCancelCreate.addEventListener("click", closeCreateCompanyModal);
  if (btnCloseDetail) btnCloseDetail.addEventListener("click", closeCompanyDetailModal);

  // Auto-preencher ID (se existir campo)
  const companyNameEl = el("companyName");
  const companyIdEl = el("companyId");
  if (companyNameEl && companyIdEl){
    companyNameEl.addEventListener("input", () => {
      const name = (companyNameEl.value || "").trim();
      if (!name) return;
      if (!companyIdEl.value) companyIdEl.value = slugify(name);
    });
  }
}

// Chamado pelo app.js quando clicar em um card da empresa
export async function openCompanyDetailModal(companyId, isSuperAdminFn){
  if (!isSuperAdminFn?.()) return;

  const modal = el("modalCompanyDetail") || el("companyDetailModal");
  if (!modal) return;

  currentCompanyId = companyId;

  // limpa UI
  const alertEl = el("companyDetailAlert");
  clearInlineAlert(alertEl);

  const tbody = el("companyUsersTbody");
  const empty = el("companyUsersEmpty");
  if (tbody) tbody.innerHTML = "";
  if (empty) empty.hidden = true;

  // abre
  modal.hidden = false;
  modal.classList.add("open");

  await loadCompanyDetail(companyId);
}

export function closeCompanyDetailModal(){
  const modal = el("modalCompanyDetail") || el("companyDetailModal");
  if (!modal) return;
  modal.hidden = true;
  modal.classList.remove("open");
  currentCompanyId = null;
}

export function openCreateCompanyModal(isSuperAdminFn){
  if (!isSuperAdminFn?.()) return;

  const modal = el("modalCreateCompany") || el("createCompanyModal");
  if (!modal) return;

  // limpa
  clearCompanyCreateSuccess();
  clearInlineAlert(el("createCompanyAlert"));

  // inputs
  ["companyName","companyCnpj","companyId","companyAdminName","companyAdminEmail","companyAdminPhone","adminActive"]
    .forEach(id => { const e = el(id); if (e) e.value = (id === "adminActive" ? "true" : ""); });

  modal.hidden = false;
  modal.classList.add("open");
}

export function closeCreateCompanyModal(){
  const modal = el("modalCreateCompany") || el("createCompanyModal");
  if (!modal) return;
  modal.hidden = true;
  modal.classList.remove("open");
}

export function clearCompanyCreateSuccess(){
  const ok = el("createCompanySuccess");
  if (!ok) return;
  ok.hidden = true;
  ok.textContent = "";
}

async function handleCreateCompany({ isSuperAdminFn, actorUidFn, refreshCompaniesFn }){
  if (!isSuperAdminFn?.()) return;

  const alertEl = el("createCompanyAlert");
  clearInlineAlert(alertEl);
  clearCompanyCreateSuccess();

  const btnCreate = el("btnCreateCompany");
  if (btnCreate) btnCreate.disabled = true;

  try{
    const name = el("companyName")?.value || "";
    const cnpj = el("companyCnpj")?.value || "";
    const adminName = el("companyAdminName")?.value || "";
    const adminEmail = el("companyAdminEmail")?.value || "";

    const companyId = await createCompany({ name, cnpj, adminName, adminEmail }, actorUidFn?.());

    const ok = el("createCompanySuccess");
    if (ok){
      ok.hidden = false;
      ok.textContent = "Empresa criada com sucesso ✅";
    }

    // fecha modal e atualiza lista
    closeCreateCompanyModal();
    if (typeof refreshCompaniesFn === "function") await refreshCompaniesFn(companyId);

  } catch(err){
    console.error("createCompany error", err);
    showInlineAlert(alertEl, err?.message || "Não foi possível criar a empresa.");
  } finally {
    if (btnCreate) btnCreate.disabled = false;
  }
}

async function loadCompanyDetail(companyId){
  const alertEl = el("companyDetailAlert");

  try{
    // header (se tiver)
    const company = await getCompanyDoc(companyId);
    const titleEl = el("companyDetailTitle");
    if (titleEl) titleEl.textContent = company?.name || "Empresa";

    const users = await listCompanyUsersDocs(companyId);
    renderCompanyUsers(users);

  } catch(err){
    console.error("loadCompanyDetail error", err);
    showInlineAlert(alertEl, "Não foi possível carregar detalhes/usuários da empresa.");
  }
}

function renderCompanyUsers(users){
  const tbody = el("companyUsersTbody");
  const empty = el("companyUsersEmpty");

  if (!tbody) return;

  if (!users?.length){
    tbody.innerHTML = "";
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;

  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${escapeHtml(u.name || "-")}</td>
      <td>${escapeHtml(u.email || "-")}</td>
      <td>${escapeHtml(u.role || "-")}</td>
      <td>${escapeHtml((u.active === false) ? "inativo" : "ativo")}</td>
    </tr>
  `).join("");
}
