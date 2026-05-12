// public/src/domain/companies.domain.js
// Lógica de negócio para gerenciamento de empresas (Master Admin)

import { doc, getDoc, collection, getDocs, setDoc, updateDoc, writeBatch, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { show, hide, escapeHtml } from "../utils/dom.js";
import { setAlert, clearAlert, showInlineAlert, clearInlineAlert } from "../ui/alerts.js";
import { setView } from "../ui/router.js";
import { listCompaniesDocs } from "../services/companies.service.js";
import { isEmailValidBasic, isCnpjValidBasic } from "../utils/validators.js";
import { normalizePhone, normalizeCnpj } from "../utils/format.js";
import { DEFAULT_COMPANY_BILLING_CYCLE, DEFAULT_COMPANY_PLAN_ID, getCompanyPlan, normalizeCompanyPlan, formatCompanyPlanPrice } from "../utils/plans.js?v=1778178016";

/** =========================
 *  COMPANIES DOMAIN
 *  ========================= */

let activeCompanyDetailId = "";
let activeCompanyDetailUsers = [];
let activeCompanyDetailData = null;
let activeCompanyDetailPlan = null;
let activeCompanyBillings = [];
let activeViewedBillingId = "";

function formatDateBR(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (raw || "-");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDateISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateISO(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function addMonths(date, months) {
  const next = new Date(date.getFullYear(), date.getMonth() + Number(months || 0), 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(date.getDate(), lastDay));
  return next;
}

function normalizeDateString(value, fallbackDate = new Date()) {
  const parsed = parseDateISO(value);
  return formatDateISO(parsed || fallbackDate);
}

function todayISO() {
  return formatDateISO(new Date());
}

function getDueDay(value) {
  const parsed = parseDateISO(value);
  return parsed ? parsed.getDate() : 1;
}

function dateWithDueDay(baseDateString, dueDay) {
  const base = parseDateISO(baseDateString) || new Date();
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const day = Math.min(Math.max(1, Number(dueDay || 1)), lastDay);
  return formatDateISO(new Date(base.getFullYear(), base.getMonth(), day));
}

function normalizeBillingCycle(value) {
  return value === "annual" ? "annual" : DEFAULT_COMPANY_BILLING_CYCLE;
}

function getBillingCycleLabel(value) {
  return normalizeBillingCycle(value) === "annual" ? "anual" : "mensal";
}

function normalizePlanInstallments(value, billingCycle = DEFAULT_COMPANY_BILLING_CYCLE) {
  if (normalizeBillingCycle(billingCycle) !== "annual") return 1;
  const n = Number(value || 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, Math.trunc(n)));
}

function normalizeInstallmentPayments(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    p1: source.p1 === true,
    p2: source.p2 === true,
    p3: source.p3 === true,
    p4: source.p4 === true,
    p5: source.p5 === true
  };
}

function getInstallmentPaidCount(payments, installments) {
  const total = normalizePlanInstallments(installments, "annual");
  const normalized = normalizeInstallmentPayments(payments);
  let paid = 0;
  for (let i = 1; i <= total; i += 1) {
    if (normalized[`p${i}`] === true) paid += 1;
  }
  return paid;
}

function getInstallmentsPaidCount(installments = []) {
  return (Array.isArray(installments) ? installments : []).filter(item => item?.paid === true).length;
}

function getBillingStatus(installments = []) {
  const list = Array.isArray(installments) ? installments : [];
  if (!list.length) return "pending";
  const paid = getInstallmentsPaidCount(list);
  if (paid >= list.length) return "paid";
  if (paid > 0) return "partial";
  const today = todayISO();
  return list.some(item => String(item?.dueDate || "") < today) ? "overdue" : "pending";
}

function getBillingStatusLabel(status) {
  if (status === "paid") return "Pago";
  if (status === "partial") return "Parcial";
  if (status === "overdue") return "Atrasado";
  return "Pendente";
}

function getBillingStatusClass(status) {
  if (status === "paid") return "badge-success";
  if (status === "overdue") return "badge-danger";
  return "";
}

function buildBillingRecord({ billingId, companyId, plan, cycle, startDate, dueDate, installmentCount, source = "plan-change", createdBy = "" }) {
  const billingCycle = normalizeBillingCycle(cycle);
  const start = normalizeDateString(startDate);
  const startDateObj = parseDateISO(start) || new Date();
  const end = formatDateISO(addDays(addMonths(startDateObj, billingCycle === "annual" ? 12 : 1), -1));
  const due = normalizeDateString(dueDate || start, startDateObj);
  const installments = normalizePlanInstallments(installmentCount, billingCycle);
  const totalValue = billingCycle === "annual" ? plan.annualPrice : plan.price;
  const installmentValue = billingCycle === "annual" ? totalValue / installments : totalValue;
  const dueBase = parseDateISO(due) || startDateObj;
  const installmentItems = [];

  for (let i = 1; i <= installments; i += 1) {
    installmentItems.push({
      number: i,
      dueDate: formatDateISO(addMonths(dueBase, i - 1)),
      value: installmentValue,
      paid: false,
      paidAt: null,
      status: "pending"
    });
  }

  const billing = {
    id: billingId,
    companyId,
    planId: plan.id,
    planName: plan.label,
    planUserLimit: plan.userLimit,
    cycle: billingCycle,
    startDate: start,
    endDate: end,
    dueDate: due,
    dueDay: getDueDay(due),
    totalValue,
    installmentCount: installments,
    installmentValue,
    paidInstallments: 0,
    status: "pending",
    source,
    installments: installmentItems,
    createdAt: serverTimestamp(),
    createdBy
  };

  return billing;
}

function buildBillingSummary(billing = {}) {
  const installments = Array.isArray(billing.installments) ? billing.installments : [];
  const paidInstallments = getInstallmentsPaidCount(installments);
  return {
    currentBillingId: billing.id || "",
    planId: billing.planId || "",
    planName: billing.planName || "",
    cycle: normalizeBillingCycle(billing.cycle),
    status: getBillingStatus(installments),
    startDate: billing.startDate || "",
    endDate: billing.endDate || "",
    dueDate: billing.dueDate || "",
    dueDay: Number(billing.dueDay || getDueDay(billing.dueDate)),
    totalValue: Number(billing.totalValue || 0),
    installmentCount: Number(billing.installmentCount || installments.length || 1),
    installmentValue: Number(billing.installmentValue || 0),
    paidInstallments
  };
}

function getCurrentBilling(companyData = {}, billings = [], plan = normalizeCompanyPlan(companyData)) {
  const billingId = companyData.billing?.currentBillingId;
  const found = billings.find(item => item.id === billingId) || billings[0];
  if (found) return found;

  const startDate = companyData.billing?.startDate || companyData.billingStartDate || todayISO();
  const dueDate = companyData.billing?.dueDate || companyData.billingDueDate || startDate;
  return buildBillingRecord({
    billingId: "legacy-current",
    companyId: activeCompanyDetailId,
    plan: getCompanyPlan(plan.id),
    cycle: plan.billingCycle,
    startDate,
    dueDate,
    installmentCount: plan.installments || 1,
    source: "legacy"
  });
}

function sortBillings(billings = []) {
  return [...billings].sort((a, b) => String(b.startDate || "").localeCompare(String(a.startDate || "")));
}

function setCompanyDetailTab(refs, tab = "company") {
  const nextTab = ["company", "financial", "users"].includes(tab) ? tab : "company";
  const root = refs.modalCompanyDetail || document;
  root.querySelectorAll?.("[data-company-detail-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.companyDetailTab === nextTab);
  });
  root.querySelectorAll?.("[data-company-detail-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.companyDetailPanel !== nextTab;
  });
}

function bindCompanyDetailTabs(refs) {
  const root = refs.modalCompanyDetail || document;
  root.querySelectorAll?.("[data-company-detail-tab]").forEach((btn) => {
    if (btn.dataset.boundCompanyDetailTab === "true") return;
    btn.dataset.boundCompanyDetailTab = "true";
    btn.addEventListener("click", () => setCompanyDetailTab(refs, btn.dataset.companyDetailTab));
  });
}

function updateCompanyPlanDetailControls(refs) {
  const billingCycle = normalizeBillingCycle(refs.companyPlanBillingCycleDetail?.value);
  const installmentsWrap = refs.companyPlanInstallmentsDetail?.closest?.(".field");
  if (installmentsWrap) installmentsWrap.hidden = billingCycle !== "annual";
  if (refs.companyPlanInstallmentsDetail && billingCycle !== "annual") refs.companyPlanInstallmentsDetail.value = "1";
}

function updateCompanyRenewalControls(refs) {
  const plan = getCompanyPlan(refs.companyRenewalPlan?.value || activeCompanyDetailPlan?.id || DEFAULT_COMPANY_PLAN_ID);
  const cycle = normalizeBillingCycle(refs.companyRenewalCycle?.value || activeCompanyDetailPlan?.billingCycle);
  const installments = normalizePlanInstallments(refs.companyRenewalInstallments?.value, cycle);
  const installmentsWrap = refs.companyRenewalInstallments?.closest?.(".field");
  if (installmentsWrap) installmentsWrap.hidden = cycle !== "annual";
  if (refs.companyRenewalInstallments && cycle !== "annual") refs.companyRenewalInstallments.value = "1";

  const startDate = normalizeDateString(refs.companyRenewalStartDate?.value || getSuggestedRenewalStartDate());
  const start = parseDateISO(startDate) || new Date();
  const endDate = formatDateISO(addDays(addMonths(start, cycle === "annual" ? 12 : 1), -1));
  if (refs.companyRenewalStartDate && !refs.companyRenewalStartDate.value) refs.companyRenewalStartDate.value = startDate;
  if (refs.companyRenewalEndDate) refs.companyRenewalEndDate.value = endDate;
  if (refs.companyRenewalDueDate && !refs.companyRenewalDueDate.value) refs.companyRenewalDueDate.value = dateWithDueDay(startDate, getCurrentBillingDueDay());

  if (refs.companyRenewalSummary) {
    const total = cycle === "annual" ? plan.annualPrice : plan.price;
    const parcelText = cycle === "annual" ? ` em ${installments}x de ${formatCompanyPlanPrice(total / installments)}` : "";
    refs.companyRenewalSummary.textContent = `${plan.label} - ${getBillingCycleLabel(cycle)} ${formatCompanyPlanPrice(total)}${parcelText}.`;
  }
}

function getSuggestedRenewalStartDate() {
  const currentBilling = getCurrentBilling(activeCompanyDetailData || {}, activeCompanyBillings, activeCompanyDetailPlan || normalizeCompanyPlan(activeCompanyDetailData || {}));
  const end = parseDateISO(currentBilling.endDate);
  return formatDateISO(end ? addDays(end, 1) : new Date());
}

function getCurrentBillingDueDay() {
  const currentBilling = getCurrentBilling(activeCompanyDetailData || {}, activeCompanyBillings, activeCompanyDetailPlan || normalizeCompanyPlan(activeCompanyDetailData || {}));
  return currentBilling.dueDay || getDueDay(currentBilling.dueDate);
}

function setupCompanyRenewalDefaults(refs, currentBilling, plan) {
  if (refs.companyRenewalPlan) refs.companyRenewalPlan.value = plan.id || DEFAULT_COMPANY_PLAN_ID;
  if (refs.companyRenewalCycle) refs.companyRenewalCycle.value = plan.billingCycle || DEFAULT_COMPANY_BILLING_CYCLE;
  if (refs.companyRenewalInstallments) refs.companyRenewalInstallments.value = String(plan.installments || 1);
  const currentEnd = parseDateISO(currentBilling?.endDate);
  const nextStart = formatDateISO(currentEnd ? addDays(currentEnd, 1) : new Date());
  if (refs.companyRenewalStartDate) refs.companyRenewalStartDate.value = nextStart;
  if (refs.companyRenewalDueDate) refs.companyRenewalDueDate.value = dateWithDueDay(nextStart, currentBilling?.dueDay || getDueDay(currentBilling?.dueDate));
  updateCompanyRenewalControls(refs);
}

function updateCompanyPlanSelectedPrice(refs) {
  if (!refs.companyPlanSelectedPriceEl) return;
  const plan = getCompanyPlan(refs.companyPlanEl?.value || DEFAULT_COMPANY_PLAN_ID);
  const billingCycle = normalizeBillingCycle(refs.companyPlanBillingCycleEl?.value);
  const price = billingCycle === "annual" ? plan.annualPrice : plan.price;
  const installments = normalizePlanInstallments(refs.companyPlanInstallmentsEl?.value, billingCycle);
  const installmentsWrap = refs.companyPlanInstallmentsEl?.closest?.(".field");
  if (installmentsWrap) installmentsWrap.hidden = billingCycle !== "annual";
  if (refs.companyPlanInstallmentsEl && billingCycle !== "annual") refs.companyPlanInstallmentsEl.value = "1";
  if (billingCycle === "annual") {
    const installmentValue = price / installments;
    refs.companyPlanSelectedPriceEl.textContent = `Plano anual ${formatCompanyPlanPrice(price)}/ano em ${installments}x de ${formatCompanyPlanPrice(installmentValue)}.`;
    return;
  }
  refs.companyPlanSelectedPriceEl.textContent = `Plano mensal ${formatCompanyPlanPrice(price)}/mes.`;
}

export function openCompaniesView(deps) {
  const { loadCompanies } = deps;
  setView("companies");
  loadCompanies().catch(err => {
    console.error(err);
    alert("Erro ao carregar empresas: " + (err?.message || err));
  });
}

export async function loadCompanies(deps) {
  const { refs, openCompanyDetailModal } = deps;
  
  if (!refs.companiesGrid) return;
  refs.companiesGrid.innerHTML = "";
  hide(refs.companiesEmpty);

  const all = await listCompaniesDocs();

  const qtxt = (refs.companySearch?.value || "").toLowerCase().trim();
  const filtered = !qtxt ? all : all.filter(c =>
    (c.name || "").toLowerCase().includes(qtxt) ||
    (c.cnpj || "").toLowerCase().includes(qtxt) ||
    (c.id || "").toLowerCase().includes(qtxt)
  );

  if (filtered.length === 0) {
    show(refs.companiesEmpty);
    return;
  }

  for (const c of filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""))) {
    const plan = normalizeCompanyPlan(c);
    const canDeleteTest = c.accountType === "individual" || c.createdBy === "stripe" || !!c.stripeCustomerId || String(c.id || "").startsWith("cpf-");
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <h3 class="title">${c.name || c.id}</h3>
      <p class="desc">CNPJ: <b>${c.cnpj || "-"}</b></p>
      <div class="meta">
        <span class="badge">ID: ${c.id}</span>
        <span class="badge">${c.active === false ? "Inativa" : "Ativa"}</span>
        <span class="badge">${escapeHtml(plan.label)}</span>
      </div>
      ${canDeleteTest ? `<div class="company-card-actions"><button class="btn danger sm" data-delete-test-company="${escapeHtml(c.id)}" type="button">Excluir teste</button></div>` : ""}
    `;
    el.style.cursor = "pointer";
    el.addEventListener("click", (event) => {
      const deleteButton = event.target?.closest?.("[data-delete-test-company]");
      if (deleteButton) {
        event.preventDefault();
        event.stopPropagation();
        deleteTestCompanySignup(deleteButton.getAttribute("data-delete-test-company"), c.name || c.id, deps);
        return;
      }
      openCompanyDetailModal(c.id);
    });
    refs.companiesGrid.appendChild(el);
  }
}

export async function deleteTestCompanySignup(companyId, companyName, deps) {
  const { state, refs, callHttpFunctionWithAuth, loadCompanies } = deps;
  if (!state.isSuperAdmin || !companyId || typeof callHttpFunctionWithAuth !== "function") return;

  const typed = prompt(`Digite o ID da empresa para excluir este cadastro de teste:\n${companyId}`);
  if (typed !== companyId) return;

  try {
    clearInlineAlert(refs.companyUsersAlert);
    await callHttpFunctionWithAuth("deleteTestCompanySignup", {
      companyId,
      confirmCompanyId: typed
    });
    await loadCompanies?.();
    alert(`Cadastro de teste excluido: ${companyName || companyId}`);
  } catch (err) {
    console.error("[delete-test-company]", err);
    alert(err?.message || "Nao foi possivel excluir o cadastro de teste.");
  }
}

export function clearCompanyCreateSuccess() {
  const el = document.getElementById("createCompanySuccess");
  if (!el) return;
  el.hidden = true;
  el.innerHTML = "";
}

export function showCompanyCreateSuccess({ adminEmail, uid, resetLink } = {}) {
  const el = document.getElementById("createCompanySuccess");
  if (!el) return;

  const email = (adminEmail || "").trim();
  const safeEmail = (typeof escapeHtml === "function") ? escapeHtml(email) : email;

  let html = `<div><strong>Empresa criada com sucesso ✅</strong></div>`;
  if (safeEmail) html += `<div style="margin-top:6px">Admin: <strong>${safeEmail}</strong></div>`;

  if (resetLink) {
    const safeLink = (typeof escapeHtml === "function") ? escapeHtml(resetLink) : resetLink;
    html += `<div style="margin-top:6px"><a href="${safeLink}" target="_blank" rel="noopener">Definir senha do Admin</a></div>`;
  } else if (uid) {
    const safeUid = (typeof escapeHtml === "function") ? escapeHtml(uid) : uid;
    html += `<div style="margin-top:6px; opacity:.8">UID do Admin: ${safeUid}</div>`;
  }

  el.hidden = false;
  el.innerHTML = html;
}

export function closeCreateCompanyModal(refs) {
  if (refs.modalCreateCompany) refs.modalCreateCompany.hidden = true;
}

export function closeCompanyDetailModal(deps) {
  const { refs, currentCompanyDetailId } = deps;
  if (!refs.modalCompanyDetail) return;
  refs.modalCompanyDetail.hidden = true;
  deps.currentCompanyDetailId = null;
  deps.companyDetailUsersCache = [];
  activeCompanyDetailId = "";
  activeCompanyDetailUsers = [];
  activeCompanyDetailData = null;
  activeCompanyDetailPlan = null;
  activeCompanyBillings = [];
  activeViewedBillingId = "";
  if (refs.companyUsersSearch) refs.companyUsersSearch.value = "";
  if (refs.companyUsersTbody) refs.companyUsersTbody.innerHTML = "";
}

export function openCreateCompanyModal(deps) {
  const { state, refs } = deps;
  if (!state.isSuperAdmin) return;
  if (!refs.modalCreateCompany) return;

  clearAlert(refs.createCompanyAlert);
  clearCompanyCreateSuccess();

  if (refs.companyNameEl) refs.companyNameEl.value = "";
  if (refs.companyCnpjEl) refs.companyCnpjEl.value = "";
  if (refs.companyIdEl) refs.companyIdEl.value = "";
  if (refs.adminNameEl) refs.adminNameEl.value = "";
  if (refs.adminEmailEl) refs.adminEmailEl.value = "";
  if (refs.adminPhoneEl) refs.adminPhoneEl.value = "";
  if (refs.adminActiveEl) refs.adminActiveEl.value = "true";
  if (refs.companyPlanEl) refs.companyPlanEl.value = DEFAULT_COMPANY_PLAN_ID;
  if (refs.companyPlanBillingCycleEl) refs.companyPlanBillingCycleEl.value = DEFAULT_COMPANY_BILLING_CYCLE;
  if (refs.companyPlanInstallmentsEl) refs.companyPlanInstallmentsEl.value = "1";
  if (refs.companyPlanEl) refs.companyPlanEl.onchange = () => updateCompanyPlanSelectedPrice(refs);
  if (refs.companyPlanBillingCycleEl) refs.companyPlanBillingCycleEl.onchange = () => updateCompanyPlanSelectedPrice(refs);
  if (refs.companyPlanInstallmentsEl) refs.companyPlanInstallmentsEl.onchange = () => updateCompanyPlanSelectedPrice(refs);
  updateCompanyPlanSelectedPrice(refs);
  if (refs.companyFinancialNameEl) refs.companyFinancialNameEl.value = "";
  if (refs.companyFinancialEmailEl) refs.companyFinancialEmailEl.value = "";
  if (refs.companyFinancialPhoneEl) refs.companyFinancialPhoneEl.value = "";
  if (refs.companyBillingStartDateEl) refs.companyBillingStartDateEl.value = todayISO();
  if (refs.companyBillingDueDateEl) refs.companyBillingDueDateEl.value = todayISO();

  refs.modalCreateCompany.hidden = false;
}

export async function openCompanyDetailModal(companyId, deps) {
  const { state, refs, loadCompanyDetail } = deps;
  if (!state.isSuperAdmin) return;
  if (!refs.modalCompanyDetail) return;

  clearInlineAlert(refs.companyUsersAlert);
  bindCompanyDetailTabs(refs);
  setCompanyDetailTab(refs, "company");
  if (refs.companyUsersSearch) refs.companyUsersSearch.value = "";
  if (refs.companyUsersTbody) refs.companyUsersTbody.innerHTML = "";
  if (refs.companyUsersEmpty) refs.companyUsersEmpty.hidden = true;

  refs.modalCompanyDetail.hidden = false;
  deps.currentCompanyDetailId = companyId;
  activeCompanyDetailId = companyId;
  await loadCompanyDetail(companyId);
}

export async function loadCompanyDetail(companyId, deps) {
  const { state, refs, db, renderCompanyUsersTable, toggleCompanyBlock } = deps;
  if (!state.isSuperAdmin) return;

  try {
    const cRef = doc(db, "companies", companyId);
    const cSnap = await getDoc(cRef);
    if (!cSnap.exists()) {
      showInlineAlert(refs.companyUsersAlert, "Empresa não encontrada.", "error");
      return;
    }
    const cData = cSnap.data();
    const active = cData.active === true;
    const plan = normalizeCompanyPlan(cData);
    const bSnap = await getDocs(collection(db, "companies", companyId, "billings"));
    const billings = [];
    bSnap.forEach(d => billings.push({ id: d.id, ...d.data() }));
    activeCompanyBillings = sortBillings(billings);
    const currentBilling = getCurrentBilling(cData, activeCompanyBillings, plan);
    activeViewedBillingId = currentBilling.id || "";
    const currentSummary = buildBillingSummary(currentBilling);
    activeCompanyDetailId = companyId;
    activeCompanyDetailData = cData;
    activeCompanyDetailPlan = plan;

    if (refs.companyDetailTitle) refs.companyDetailTitle.textContent = cData.name || companyId;
    if (refs.companyPlanDetail) refs.companyPlanDetail.value = plan.id;
    if (refs.companyPlanBillingCycleDetail) refs.companyPlanBillingCycleDetail.value = plan.billingCycle;
    if (refs.companyPlanInstallmentsDetail) refs.companyPlanInstallmentsDetail.value = String(plan.installments || 1);
    updateCompanyPlanDetailControls(refs);
    if (refs.companyPlanSummary) {
      const suffix = plan.billingCycle === "annual" ? "/ano" : "/mes";
      const installmentText = plan.billingCycle === "annual"
        ? ` em ${plan.installments || 1}x de ${formatCompanyPlanPrice(plan.installmentValue || plan.billingPrice)}`
        : "";
      refs.companyPlanSummary.textContent = `${plan.label} - plano ${getBillingCycleLabel(plan.billingCycle)} ${formatCompanyPlanPrice(plan.billingPrice)}${suffix}${installmentText}. Limite de ${plan.userLimit} usuarios ativos.`;
    }
    if (refs.companyDetailCompanySummary) refs.companyDetailCompanySummary.textContent = `${plan.label} - limite de ${plan.userLimit} usuarios ativos.`;
    if (refs.companyDetailCompanyCardInfo) refs.companyDetailCompanyCardInfo.textContent = `${plan.label} (${getBillingCycleLabel(plan.billingCycle)})`;
    if (refs.companyInfoName) refs.companyInfoName.textContent = cData.name || "-";
    if (refs.companyInfoCnpj) refs.companyInfoCnpj.textContent = cData.cnpj || "-";
    if (refs.companyInfoId) refs.companyInfoId.textContent = companyId;
    if (refs.companyInfoStatus) refs.companyInfoStatus.textContent = active ? "Ativa" : "Bloqueada";
    if (refs.companyFinancialNameDetail) refs.companyFinancialNameDetail.value = cData.financialContactName || "";
    if (refs.companyFinancialEmailDetail) refs.companyFinancialEmailDetail.value = cData.financialContactEmail || "";
    if (refs.companyFinancialPhoneDetail) refs.companyFinancialPhoneDetail.value = cData.financialContactPhone || "";
    if (refs.companyBillingStartDateDetail) refs.companyBillingStartDateDetail.value = currentBilling.startDate || "";
    if (refs.companyBillingEndDateDetail) refs.companyBillingEndDateDetail.value = currentBilling.endDate || "";
    if (refs.companyBillingDueDateDetail) refs.companyBillingDueDateDetail.value = currentBilling.dueDate || cData.billingDueDate || "";
    if (refs.companyFinancialSummary) {
      const name = cData.financialContactName || "Responsavel nao informado";
      refs.companyFinancialSummary.textContent = `${name} - periodo ${formatDateBR(currentBilling.startDate)} a ${formatDateBR(currentBilling.endDate)} - vencimento ${formatDateBR(currentBilling.dueDate)}.`;
    }
    if (refs.companyDetailFinancialCardInfo) {
      refs.companyDetailFinancialCardInfo.textContent = `${currentSummary.paidInstallments}/${currentSummary.installmentCount} parcelas pagas`;
    }
    if (refs.companyDetailMeta) refs.companyDetailMeta.textContent = `CNPJ: ${cData.cnpj || "-"} • ID: ${companyId}`;
    if (refs.companyDetailStatus) {
      refs.companyDetailStatus.textContent = active ? "ATIVA" : "BLOQUEADA";
      refs.companyDetailStatus.className = `badge ${active ? "badge-success" : "badge-danger"}`;
    }
    if (refs.btnToggleCompanyBlock) {
      refs.btnToggleCompanyBlock.textContent = active ? "Bloquear empresa" : "Desbloquear empresa";
      refs.btnToggleCompanyBlock.className = active ? "btn btn-danger" : "btn btn-secondary";
      refs.btnToggleCompanyBlock.onclick = () => toggleCompanyBlock(companyId, active);
    }
    if (refs.btnSaveCompanyPlan) {
      refs.btnSaveCompanyPlan.onclick = () => saveCompanyPlan(companyId, deps);
    }
    if (refs.companyPlanBillingCycleDetail) {
      refs.companyPlanBillingCycleDetail.onchange = () => updateCompanyPlanDetailControls(refs);
    }
    if (refs.companyPlanInstallmentsDetail) {
      refs.companyPlanInstallmentsDetail.onchange = () => updateCompanyPlanDetailControls(refs);
    }
    if (refs.btnSaveCompanyFinancial) {
      refs.btnSaveCompanyFinancial.onclick = () => saveCompanyFinancial(companyId, deps);
    }
    setupCompanyRenewalDefaults(refs, currentBilling, plan);
    if (refs.companyRenewalPlan) refs.companyRenewalPlan.onchange = () => updateCompanyRenewalControls(refs);
    if (refs.companyRenewalCycle) refs.companyRenewalCycle.onchange = () => updateCompanyRenewalControls(refs);
    if (refs.companyRenewalInstallments) refs.companyRenewalInstallments.onchange = () => updateCompanyRenewalControls(refs);
    if (refs.companyRenewalStartDate) {
      refs.companyRenewalStartDate.onchange = () => {
        if (refs.companyRenewalDueDate) refs.companyRenewalDueDate.value = dateWithDueDay(refs.companyRenewalStartDate.value, getCurrentBillingDueDay());
        updateCompanyRenewalControls(refs);
      };
    }
    if (refs.companyRenewalDueDate) refs.companyRenewalDueDate.onchange = () => updateCompanyRenewalControls(refs);
    if (refs.btnCreateCompanyRenewal) refs.btnCreateCompanyRenewal.onclick = () => createCompanyRenewal(companyId, deps);
    renderCompanyInstallments(companyId, cData, plan, currentBilling, deps);
    renderCompanyBillingHistory(companyId, activeCompanyBillings.length ? activeCompanyBillings : [currentBilling], deps);

    const uCol = collection(db, "companies", companyId, "users");
    const uSnap = await getDocs(uCol);
    const users = [];
    uSnap.forEach(d => users.push({ id: d.id, ...d.data() }));
    users.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    deps.companyDetailUsersCache = users;
    activeCompanyDetailUsers = users;
    if (refs.companyUsersPlanLimitCount) refs.companyUsersPlanLimitCount.textContent = String(plan.userLimit);
    if (refs.companyDetailUsersCardInfo) refs.companyDetailUsersCardInfo.textContent = String(users.length);
    renderCompanyUsersTable(companyId, users);
  } catch (err) {
    console.error("Erro ao carregar detalhes da empresa:", err);
    showInlineAlert(refs.companyUsersAlert, "Erro ao carregar detalhes da empresa.", "error");
  }
}

function updateCompanyUsersCounters(users, refs) {
  const total = Array.isArray(users) ? users.length : 0;
  const active = Array.isArray(users) ? users.filter(u => u.active === true).length : 0;
  const blocked = Math.max(0, total - active);
  if (refs.companyUsersTotalCount) refs.companyUsersTotalCount.textContent = String(total);
  if (refs.companyUsersActiveCount) refs.companyUsersActiveCount.textContent = String(active);
  if (refs.companyUsersBlockedCount) refs.companyUsersBlockedCount.textContent = String(blocked);
}

function filterCompanyUsers(users, search) {
  const qtxt = String(search || "").toLowerCase().trim();
  if (!qtxt) return Array.isArray(users) ? users : [];
  return (Array.isArray(users) ? users : []).filter((u) => {
    const haystack = [
      u.name,
      u.email,
      u.phone,
      u.id,
      u.role,
      u.active === true ? "ativo" : "bloqueado"
    ].map(v => String(v || "").toLowerCase()).join(" ");
    return haystack.includes(qtxt);
  });
}

function renderCompanyInstallments(companyId, companyData, plan, billing, deps) {
  const { refs } = deps;
  if (!refs.companyInstallmentsPanel || !refs.companyInstallmentsList) return;

  const currentBilling = billing || getCurrentBilling(companyData, activeCompanyBillings, plan);
  const installmentsList = Array.isArray(currentBilling.installments) ? currentBilling.installments : [];
  refs.companyInstallmentsPanel.hidden = false;
  refs.companyInstallmentsList.innerHTML = "";

  if (!installmentsList.length) {
    if (refs.companyInstallmentsSummary) refs.companyInstallmentsSummary.textContent = "Nenhuma parcela encontrada para esta cobranca.";
    return;
  }

  const paidCount = getInstallmentsPaidCount(installmentsList);

  if (refs.companyInstallmentsSummary) {
    refs.companyInstallmentsSummary.textContent = `${getBillingCycleLabel(currentBilling.cycle)} de ${formatDateBR(currentBilling.startDate)} a ${formatDateBR(currentBilling.endDate)} - ${paidCount}/${installmentsList.length} parcela(s) pagas.`;
  }
  if (refs.companyDetailFinancialCardInfo) {
    refs.companyDetailFinancialCardInfo.textContent = `${paidCount}/${installmentsList.length} parcelas pagas`;
  }

  for (const installment of installmentsList) {
    const paid = installment.paid === true;
    const item = document.createElement("label");
    item.className = `company-installment-item ${paid ? "is-paid" : ""}`;
    item.innerHTML = `
      <input type="checkbox" ${paid ? "checked" : ""} data-installment-number="${installment.number}">
      <span class="company-installment-name">Parcela ${installment.number}</span>
      <strong>${formatCompanyPlanPrice(installment.value)}</strong>
      <small>${formatDateBR(installment.dueDate)} - ${paid ? "Pago" : "Pendente"}</small>
    `;
    const checkbox = item.querySelector("input");
    checkbox.addEventListener("change", async () => {
      checkbox.disabled = true;
      await setCompanyInstallmentPaid(companyId, currentBilling.id, Number(installment.number), checkbox.checked, deps);
    });
    refs.companyInstallmentsList.appendChild(item);
  }
}

function renderCompanyBillingHistory(companyId, billings, deps) {
  const { refs } = deps;
  if (!refs.companyBillingHistoryList) return;
  const list = sortBillings(billings || []);
  refs.companyBillingHistoryList.innerHTML = "";
  if (!list.length) {
    refs.companyBillingHistoryList.innerHTML = `<p class="muted">Nenhuma cobranca registrada.</p>`;
    return;
  }

  for (const billing of list) {
    const summary = buildBillingSummary(billing);
    const item = document.createElement("article");
    const selected = (billing.id || "") === activeViewedBillingId;
    item.className = `company-billing-history-item ${selected ? "is-selected" : ""}`;
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-pressed", selected ? "true" : "false");
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(billing.planName || "-")} - ${getBillingCycleLabel(billing.cycle)}</strong>
        <span>${formatDateBR(billing.startDate)} a ${formatDateBR(billing.endDate)} | venc. ${formatDateBR(billing.dueDate)}</span>
      </div>
      <div>
        <strong>${formatCompanyPlanPrice(billing.totalValue || 0)}</strong>
        <span class="badge ${getBillingStatusClass(summary.status)}">${getBillingStatusLabel(summary.status)}</span>
      </div>
    `;
    const selectBilling = () => {
      activeViewedBillingId = billing.id || "";
      renderCompanyInstallments(companyId, activeCompanyDetailData || {}, activeCompanyDetailPlan || normalizeCompanyPlan(activeCompanyDetailData || {}), billing, deps);
      renderCompanyBillingHistory(companyId, list, deps);
    };
    item.addEventListener("click", selectBilling);
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectBilling();
    });
    refs.companyBillingHistoryList.appendChild(item);
  }
}

export function renderCompanyUsersTable(companyId, users, deps) {
  const { refs, setCompanyUserActive, setCompanyUserRole, loadCompanyDetail } = deps;
  if (!refs.companyUsersTbody) return;
  refs.companyUsersTbody.innerHTML = "";
  updateCompanyUsersCounters(users, refs);

  const filteredUsers = filterCompanyUsers(users, refs.companyUsersSearch?.value || "");

  if (!filteredUsers || filteredUsers.length === 0) {
    if (refs.companyUsersEmpty) {
      refs.companyUsersEmpty.hidden = false;
      refs.companyUsersEmpty.style.display = "block";
    }
    return;
  }
  if (refs.companyUsersEmpty) {
    refs.companyUsersEmpty.hidden = true;
    refs.companyUsersEmpty.style.display = "none";
  }

  for (const u of filteredUsers) {
    const active = u.active === true;
    const role = u.role || "tecnico";
    const displayName = escapeHtml(u.name || "(sem nome)");
    const displayId = escapeHtml(u.id);
    const displayEmail = escapeHtml(u.email || "-");
    const displayPhone = escapeHtml(u.phone || "-");

    const tr = document.createElement("tr");
    tr.className = "company-user-row";
    tr.innerHTML = `
      <td>
        <div class="company-user-cell">
          <div class="company-user-avatar" aria-hidden="true">${displayName.charAt(0).toUpperCase()}</div>
          <div class="company-user-text">
            <div class="cell-main">${displayName}</div>
            <div class="cell-sub">${displayId}</div>
          </div>
        </div>
      </td>
      <td><div class="company-user-data">${displayEmail}</div></td>
      <td><div class="company-user-data">${displayPhone}</div></td>
      <td>
        <select class="input small company-role-select js-role">
          ${["admin", "gestor", "coordenador", "tecnico"].map(r => `<option value="${r}" ${r === role ? "selected" : ""}>${r}</option>`).join("")}
        </select>
      </td>
      <td>
        <span class="badge ${active ? "badge-success" : "badge-danger"}">${active ? "ATIVO" : "BLOQUEADO"}</span>
      </td>
      <td class="actions company-user-actions">
        <button class="btn js-toggle ${active ? "danger" : ""}">${active ? "Bloquear" : "Desbloquear"}</button>
        <button class="btn primary js-save">Salvar perfil</button>
      </td>
    `;

    const btnToggle = tr.querySelector(".js-toggle");
    const selRole = tr.querySelector(".js-role");
    const btnSave = tr.querySelector(".js-save");

    btnToggle.addEventListener("click", async (e) => {
      e.preventDefault();
      await setCompanyUserActive(companyId, u.id, !active);
      await loadCompanyDetail(companyId);
    });

    btnSave.addEventListener("click", async (e) => {
      e.preventDefault();
      const newRole = selRole.value;
      await setCompanyUserRole(companyId, u.id, newRole);
      await loadCompanyDetail(companyId);
    });

    refs.companyUsersTbody.appendChild(tr);
  }

  if (refs.companyUsersEmpty) {
    refs.companyUsersEmpty.style.display = filteredUsers.length ? "none" : "block";
  }
}

export function handleCompanyUsersSearch(deps) {
  const { currentCompanyDetailId, companyDetailUsersCache, renderCompanyUsersTable } = deps;
  const companyId = currentCompanyDetailId || activeCompanyDetailId;
  const users = (companyDetailUsersCache && companyDetailUsersCache.length) ? companyDetailUsersCache : activeCompanyDetailUsers;
  if (!companyId) return;
  renderCompanyUsersTable(companyId, users || [], deps);
}

export async function setCompanyUserActive(companyId, uid, active, deps) {
  const { state, refs, db } = deps;
  if (!state.isSuperAdmin) return;
  try {
    const uRef = doc(db, "companies", companyId, "users", uid);
    await updateDoc(uRef, { active: !!active });
  } catch (err) {
    console.error("Erro ao atualizar usuário:", err);
    showInlineAlert(refs.companyUsersAlert, "Não foi possível atualizar o usuário.", "error");
  }
}

export async function setCompanyUserRole(companyId, uid, role, deps) {
  const { state, refs, db } = deps;
  if (!state.isSuperAdmin) return;
  try {
    if (!["admin", "gestor", "coordenador", "tecnico"].includes(role)) return;
    const uRef = doc(db, "companies", companyId, "users", uid);
    await updateDoc(uRef, { role });
  } catch (err) {
    console.error("Erro ao trocar perfil:", err);
    showInlineAlert(refs.companyUsersAlert, "Não foi possível trocar o perfil.", "error");
  }
}

export async function toggleCompanyBlock(companyId, currentlyActive, deps) {
  const { state, refs, db, loadCompanyDetail, loadCompanies } = deps;
  if (!state.isSuperAdmin) return;
  try {
    const cRef = doc(db, "companies", companyId);

    if (currentlyActive) {
      await updateDoc(cRef, { active: false });
      showInlineAlert(refs.companyUsersAlert, "Empresa bloqueada. Os usuarios desta empresa nao conseguem acessar o sistema.", "success");
    } else {
      await updateDoc(cRef, { active: true });
      showInlineAlert(refs.companyUsersAlert, "Empresa desbloqueada. Usuarios ativos ja podem acessar novamente.", "success");
    }

    await loadCompanyDetail(companyId);
    if (typeof loadCompanies === "function") loadCompanies();
  } catch (err) {
    console.error("Erro ao bloquear/desbloquear empresa:", err);
    showInlineAlert(refs.companyUsersAlert, "Não foi possível alterar o status da empresa.", "error");
  }
}

export async function saveCompanyPlan(companyId, deps) {
  const { refs, state, db, loadCompanyDetail, loadCompanies } = deps;
  if (!state.isSuperAdmin) return;
  clearInlineAlert(refs.companyUsersAlert);

  const plan = getCompanyPlan(refs.companyPlanDetail?.value || DEFAULT_COMPANY_PLAN_ID);
  const billingCycle = normalizeBillingCycle(refs.companyPlanBillingCycleDetail?.value);
  const planInstallments = normalizePlanInstallments(refs.companyPlanInstallmentsDetail?.value, billingCycle);
  const billingPrice = billingCycle === "annual" ? plan.annualPrice : plan.price;
  const planInstallmentValue = billingCycle === "annual" ? billingPrice / planInstallments : billingPrice;
  try {
    const currentBilling = getCurrentBilling(activeCompanyDetailData || {}, activeCompanyBillings, activeCompanyDetailPlan || normalizeCompanyPlan(activeCompanyDetailData || {}));
    const planChanged = plan.id !== activeCompanyDetailPlan?.id
      || billingCycle !== activeCompanyDetailPlan?.billingCycle
      || planInstallments !== Number(activeCompanyDetailPlan?.installments || 1);
    const companyPayload = {
      planId: plan.id,
      planName: plan.label,
      planUserLimit: plan.userLimit,
      planPrice: plan.price,
      planAnnualPrice: plan.annualPrice,
      planBillingCycle: billingCycle,
      planBillingPrice: billingPrice,
      planInstallments,
      planInstallmentValue,
      planUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    if (planChanged) {
      const currentEnd = parseDateISO(currentBilling.endDate);
      const nextStart = formatDateISO(currentEnd ? addDays(currentEnd, 1) : new Date());
      const nextDue = dateWithDueDay(nextStart, currentBilling.dueDay || getDueDay(currentBilling.dueDate));
      const billingRef = doc(collection(db, "companies", companyId, "billings"));
      const billing = buildBillingRecord({
        billingId: billingRef.id,
        companyId,
        plan,
        cycle: billingCycle,
        startDate: nextStart,
        dueDate: nextDue,
        installmentCount: planInstallments,
        source: "plan-change",
        createdBy: state.user?.uid || ""
      });
      const batch = writeBatch(db);
      batch.set(billingRef, billing);
      batch.update(doc(db, "companies", companyId), {
        ...companyPayload,
        billing: buildBillingSummary(billing),
        billingStartDate: billing.startDate,
        billingEndDate: billing.endDate,
        billingDueDate: billing.dueDate
      });
      await batch.commit();
      showInlineAlert(refs.companyUsersAlert, `Plano salvo e nova cobranca criada para ${formatDateBR(billing.startDate)}.`, "success");
    } else {
      await updateDoc(doc(db, "companies", companyId), companyPayload);
      showInlineAlert(refs.companyUsersAlert, `Plano salvo: ${plan.label} (${getBillingCycleLabel(billingCycle)}).`, "success");
    }
    await loadCompanyDetail(companyId);
    await loadCompanies?.();
  } catch (err) {
    console.error("[company-plan:save]", err);
    showInlineAlert(refs.companyUsersAlert, err?.message || "Nao foi possivel salvar o plano.", "error");
  }
}

export async function saveCompanyFinancial(companyId, deps) {
  const { refs, state, db, loadCompanyDetail, loadCompanies } = deps;
  if (!state.isSuperAdmin) return;
  clearInlineAlert(refs.companyUsersAlert);

  const financialContactName = (refs.companyFinancialNameDetail?.value || "").trim();
  const financialContactEmail = (refs.companyFinancialEmailDetail?.value || "").trim();
  const financialContactPhone = normalizePhone(refs.companyFinancialPhoneDetail?.value || "");
  const billingStartDate = (refs.companyBillingStartDateDetail?.value || "").trim();
  const billingDueDate = (refs.companyBillingDueDateDetail?.value || "").trim();

  if (financialContactEmail && !isEmailValidBasic(financialContactEmail)) {
    return showInlineAlert(refs.companyUsersAlert, "Informe um e-mail financeiro valido.", "error");
  }

  try {
    const currentBilling = getCurrentBilling(activeCompanyDetailData || {}, activeCompanyBillings, activeCompanyDetailPlan || normalizeCompanyPlan(activeCompanyDetailData || {}));
    const currentPlan = getCompanyPlan(currentBilling.planId || activeCompanyDetailPlan?.id || DEFAULT_COMPANY_PLAN_ID);
    let billing = buildBillingRecord({
      billingId: currentBilling.id && currentBilling.id !== "legacy-current" ? currentBilling.id : "",
      companyId,
      plan: currentPlan,
      cycle: currentBilling.cycle || activeCompanyDetailPlan?.billingCycle,
      startDate: billingStartDate || currentBilling.startDate,
      dueDate: billingDueDate || currentBilling.dueDate,
      installmentCount: currentBilling.installmentCount || activeCompanyDetailPlan?.installments || 1,
      source: currentBilling.source || "manual-update",
      createdBy: currentBilling.createdBy || state.user?.uid || ""
    });
    const oldInstallments = Array.isArray(currentBilling.installments) ? currentBilling.installments : [];
    billing.installments = billing.installments.map(item => {
      const previous = oldInstallments.find(old => Number(old.number) === Number(item.number));
      return previous ? {
        ...item,
        paid: previous.paid === true,
        paidAt: previous.paidAt || null,
        status: previous.paid === true ? "paid" : "pending"
      } : item;
    });
    billing.status = getBillingStatus(billing.installments);
    billing.paidInstallments = getInstallmentsPaidCount(billing.installments);

    let targetRef;
    if (!billing.id || billing.id === "legacy-current") {
      targetRef = doc(collection(db, "companies", companyId, "billings"));
      billing.id = targetRef.id;
      await setDoc(targetRef, billing);
    } else {
      targetRef = doc(db, "companies", companyId, "billings", billing.id);
      await updateDoc(targetRef, {
        startDate: billing.startDate,
        endDate: billing.endDate,
        dueDate: billing.dueDate,
        dueDay: billing.dueDay,
        installments: billing.installments,
        status: billing.status,
        paidInstallments: billing.paidInstallments,
        updatedAt: serverTimestamp()
      });
    }

    await updateDoc(doc(db, "companies", companyId), {
      financialContactName,
      financialContactEmail,
      financialContactPhone,
      billing: buildBillingSummary(billing),
      billingStartDate: billing.startDate,
      billingEndDate: billing.endDate,
      billingDueDate: billing.dueDate,
      financialUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    showInlineAlert(refs.companyUsersAlert, "Dados financeiros salvos.", "success");
    await loadCompanyDetail(companyId);
    await loadCompanies?.();
  } catch (err) {
    console.error("[company-financial:save]", err);
    showInlineAlert(refs.companyUsersAlert, err?.message || "Nao foi possivel salvar os dados financeiros.", "error");
  }
}

export async function createCompanyRenewal(companyId, deps) {
  const { refs, state, db, loadCompanyDetail, loadCompanies } = deps;
  if (!state.isSuperAdmin) return;
  clearInlineAlert(refs.companyUsersAlert);

  const plan = getCompanyPlan(refs.companyRenewalPlan?.value || activeCompanyDetailPlan?.id || DEFAULT_COMPANY_PLAN_ID);
  const billingCycle = normalizeBillingCycle(refs.companyRenewalCycle?.value || activeCompanyDetailPlan?.billingCycle);
  const planInstallments = normalizePlanInstallments(refs.companyRenewalInstallments?.value, billingCycle);
  const startDate = (refs.companyRenewalStartDate?.value || "").trim() || getSuggestedRenewalStartDate();
  const dueDate = (refs.companyRenewalDueDate?.value || "").trim() || dateWithDueDay(startDate, getCurrentBillingDueDay());
  const billingPrice = billingCycle === "annual" ? plan.annualPrice : plan.price;
  const planInstallmentValue = billingCycle === "annual" ? billingPrice / planInstallments : billingPrice;

  try {
    const billingRef = doc(collection(db, "companies", companyId, "billings"));
    const billing = buildBillingRecord({
      billingId: billingRef.id,
      companyId,
      plan,
      cycle: billingCycle,
      startDate,
      dueDate,
      installmentCount: planInstallments,
      source: "renewal",
      createdBy: state.user?.uid || ""
    });
    const batch = writeBatch(db);
    batch.set(billingRef, billing);
    batch.update(doc(db, "companies", companyId), {
      planId: plan.id,
      planName: plan.label,
      planUserLimit: plan.userLimit,
      planPrice: plan.price,
      planAnnualPrice: plan.annualPrice,
      planBillingCycle: billingCycle,
      planBillingPrice: billingPrice,
      planInstallments,
      planInstallmentValue,
      billing: buildBillingSummary(billing),
      billingStartDate: billing.startDate,
      billingEndDate: billing.endDate,
      billingDueDate: billing.dueDate,
      planUpdatedAt: serverTimestamp(),
      financialUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await batch.commit();
    showInlineAlert(refs.companyUsersAlert, `Cobranca renovada: ${formatDateBR(billing.startDate)} a ${formatDateBR(billing.endDate)}.`, "success");
    await loadCompanyDetail(companyId);
    await loadCompanies?.();
  } catch (err) {
    console.error("[company-renewal:create]", err);
    showInlineAlert(refs.companyUsersAlert, err?.message || "Nao foi possivel gerar a renovacao.", "error");
  }
}

export async function setCompanyInstallmentPaid(companyId, billingId, installmentNumber, paid, deps) {
  const { refs, state, db, loadCompanyDetail, loadCompanies } = deps;
  if (!state.isSuperAdmin) return;
  const number = Number(installmentNumber || 0);
  if (!Number.isFinite(number) || number < 1) return;
  clearInlineAlert(refs.companyUsersAlert);

  try {
    let billing = activeCompanyBillings.find(item => item.id === billingId);
    let targetBillingId = billingId;
    if (!billing) {
      billing = getCurrentBilling(activeCompanyDetailData || {}, activeCompanyBillings, activeCompanyDetailPlan || normalizeCompanyPlan(activeCompanyDetailData || {}));
    }
    const installments = (Array.isArray(billing.installments) ? billing.installments : []).map(item => {
      if (Number(item.number) !== number) return item;
      return {
        ...item,
        paid: paid === true,
        paidAt: paid === true ? new Date().toISOString() : null,
        status: paid === true ? "paid" : "pending"
      };
    });
    const status = getBillingStatus(installments);
    const paidInstallments = getInstallmentsPaidCount(installments);
    const payload = {
      ...billing,
      installments,
      status,
      paidInstallments,
      updatedAt: serverTimestamp()
    };
    if (!targetBillingId || targetBillingId === "legacy-current") {
      const newRef = doc(collection(db, "companies", companyId, "billings"));
      targetBillingId = newRef.id;
      payload.id = targetBillingId;
      await setDoc(newRef, payload);
    } else {
      await updateDoc(doc(db, "companies", companyId, "billings", targetBillingId), {
        installments,
        status,
        paidInstallments,
        updatedAt: serverTimestamp()
      });
    }
    const isCurrentBilling = targetBillingId === activeCompanyDetailData?.billing?.currentBillingId
      || (!activeCompanyDetailData?.billing?.currentBillingId && targetBillingId === activeCompanyBillings[0]?.id);
    const companyPayload = {
      financialUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    if (isCurrentBilling) {
      companyPayload.billing = buildBillingSummary({ ...payload, id: targetBillingId });
    }
    await updateDoc(doc(db, "companies", companyId), companyPayload);
    showInlineAlert(refs.companyUsersAlert, "Status da parcela atualizado.", "success");
    await loadCompanyDetail(companyId);
    await loadCompanies?.();
  } catch (err) {
    console.error("[company-installment:paid]", err);
    showInlineAlert(refs.companyUsersAlert, err?.message || "Nao foi possivel atualizar a parcela.", "error");
    await loadCompanyDetail(companyId).catch(() => {});
  }
}

export async function createCompany(deps) {
  const { refs, auth, callHttpFunctionWithAuth, loadCompanies } = deps;
  clearAlert(refs.createCompanyAlert);

  try {
    if (!auth.currentUser) {
      return setAlert(refs.createCompanyAlert, "Você precisa estar logado como Admin Master.");
    }

    await auth.currentUser.getIdToken(true);

    const companyId = (refs.companyIdEl?.value || "").trim();
    const companyName = (refs.companyNameEl?.value || "").trim();
    const cnpj = (refs.companyCnpjEl?.value || "").trim();
    const plan = getCompanyPlan(refs.companyPlanEl?.value || DEFAULT_COMPANY_PLAN_ID);
    const billingCycle = normalizeBillingCycle(refs.companyPlanBillingCycleEl?.value);
    const planInstallments = normalizePlanInstallments(refs.companyPlanInstallmentsEl?.value, billingCycle);
    const financialContactName = (refs.companyFinancialNameEl?.value || "").trim();
    const financialContactEmail = (refs.companyFinancialEmailEl?.value || "").trim();
    const financialContactPhone = normalizePhone(refs.companyFinancialPhoneEl?.value || "");
    const billingStartDate = (refs.companyBillingStartDateEl?.value || "").trim() || todayISO();
    const billingDueDate = (refs.companyBillingDueDateEl?.value || "").trim();

    const adminName = (refs.adminNameEl?.value || "").trim();
    const adminEmail = (refs.adminEmailEl?.value || "").trim();
    const adminPhone = (refs.adminPhoneEl?.value || "").trim();
    const adminActive = (refs.adminActiveEl?.value || "true") === "true";

    if (!companyId) return setAlert(refs.createCompanyAlert, "Informe o ID da empresa (slug).");
    if (!companyName) return setAlert(refs.createCompanyAlert, "Informe o nome da empresa.");
    if (!cnpj || !isCnpjValidBasic(cnpj)) return setAlert(refs.createCompanyAlert, "Informe um CNPJ válido (14 dígitos).");
    if (financialContactEmail && !isEmailValidBasic(financialContactEmail)) return setAlert(refs.createCompanyAlert, "Informe um e-mail financeiro valido.");
    if (!adminName) return setAlert(refs.createCompanyAlert, "Informe o nome do Admin da empresa.");
    if (!adminEmail || !isEmailValidBasic(adminEmail)) return setAlert(refs.createCompanyAlert, "Informe um e-mail válido para o Admin.");

    setAlert(refs.createCompanyAlert, "Criando empresa e Admin...", "info");

    const payload = {
      companyId,
      companyName,
      cnpj: normalizeCnpj(cnpj),
      planId: plan.id,
      planBillingCycle: billingCycle,
      planInstallments,
      financial: {
        name: financialContactName,
        email: financialContactEmail,
        phone: financialContactPhone,
        billingStartDate,
        billingDueDate
      },
      admin: {
        name: adminName,
        email: adminEmail,
        phone: normalizePhone(adminPhone),
        active: adminActive
      }
    };

    const data = await callHttpFunctionWithAuth("createCompanyWithAdminHttp", payload);

    const uid = data?.uid;
    const resetLink = data?.resetLink;
    await loadCompanies();

    clearAlert(refs.createCompanyAlert);
    showCompanyCreateSuccess({ adminEmail, uid, resetLink });

  } catch (err) {
    console.error("Erro ao criar empresa:", err);
    clearCompanyCreateSuccess();
    setAlert(refs.createCompanyAlert, err?.message || "Erro ao criar empresa");
  }
}
