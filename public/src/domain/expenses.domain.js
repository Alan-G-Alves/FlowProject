import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

import { clearAlert, showDialogAlert } from "../ui/alerts.js";
import { escapeHtml, hide, show } from "../utils/dom.js";
import { createNotifications } from "../services/notifications.service.js?v=1776052722";

const EXPENSE_RECEIPT_MAX_SIZE = 8 * 1024 * 1024;

let _bound = false;
let _expenseItemsCache = [];
let _expenseStatusFilter = "pending";
let _expenseFormContext = null;
let _expenseReceiptFile = null;
let _expenseReceiptObjectUrl = "";
let _activityExpenseDraftSeq = 0;
let _expenseApprovalsPage = 1;
const EXPENSE_APPROVALS_PAGE_SIZE = 8;

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatCurrencyBRL(value) {
  const num = Number(value || 0);
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseCurrencyInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/[^0-9,.-]/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFileInputFilled(input) {
  return Boolean(input?.files && input.files.length > 0);
}

function collectActivityExpenseDrafts(refs, { validate = false } = {}) {
  const rows = Array.from(refs?.myActivityExpenseDrafts?.querySelectorAll?.("[data-activity-expense-draft]") || []);
  const drafts = [];

  rows.forEach((row, index) => {
    const lineNumber = index + 1;
    const type = String(row.querySelector("[data-expense-draft-type]")?.value || "alimentacao").trim();
    const amountInput = row.querySelector("[data-expense-draft-amount]");
    const observationInput = row.querySelector("[data-expense-draft-observation]");
    const fileInput = row.querySelector("[data-expense-draft-file]");
    const amountRaw = String(amountInput?.value || "").trim();
    const observation = String(observationInput?.value || "").trim();
    const receiptFile = fileInput?.files?.[0] || null;
    const hasAnyValue = Boolean(amountRaw || observation || isFileInputFilled(fileInput));

    if (!hasAnyValue) return;

    const amount = parseCurrencyInput(amountRaw);
    if (validate) {
      if (!type) throw new Error(`Selecione o tipo da despesa na linha ${lineNumber}.`);
      if (!amount || amount <= 0) throw new Error(`Informe um valor maior que zero na despesa ${lineNumber}.`);
      if (!observation || observation.length < 10) throw new Error(`Descreva a despesa ${lineNumber} com pelo menos 10 caracteres.`);
      if (!receiptFile) throw new Error(`Anexe o comprovante da despesa ${lineNumber}.`);
      if ((receiptFile.size || 0) > EXPENSE_RECEIPT_MAX_SIZE) throw new Error(`O comprovante da despesa ${lineNumber} deve ter no maximo 8 MB.`);
    }

    drafts.push({
      type,
      amount,
      observation,
      receiptFile
    });
  });

  return drafts;
}

function formatDateLabel(value) {
  if (!value) return "-";
  try {
    if (value?.toDate) return value.toDate().toLocaleDateString("pt-BR");
  } catch (_) {}
  const raw = String(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || "-");
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatDateTimeLabel(value) {
  if (!value) return "-";
  try {
    if (value?.toDate) return value.toDate().toLocaleString("pt-BR");
  } catch (_) {}
  return String(value || "-");
}

function truncateText(value, max = 220) {
  const text = String(value || "").trim();
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}...`;
}

function expenseTypeLabel(type) {
  const map = {
    alimentacao: "Alimentacao",
    trajeto: "Trajeto",
    estadia: "Estadia"
  };
  return map[String(type || "").toLowerCase()] || "Despesa";
}

function expenseStatusLabel(status) {
  const map = {
    pending: "Pendente",
    approved: "Aprovada",
    rejected: "Reprovada"
  };
  return map[String(status || "").toLowerCase()] || "Pendente";
}

function getExpenseChargeState(item) {
  const status = String(item?.status || "").toLowerCase();
  if (status === "pending") {
    return {
      cls: "pending-decision",
      label: "Definir na aprovacao",
      filterValue: ""
    };
  }
  const chargedToClient = item?.chargedToClient === true;
  return chargedToClient
    ? { cls: "client", label: "Conta do cliente", filterValue: "client" }
    : { cls: "internal", label: "Conta propria", filterValue: "internal" };
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function buildExpenseSearchText(item) {
  const charge = getExpenseChargeState(item);
  return normalizeText([
    item.projectName,
    item.taskName,
    item.activityName,
    item.techName,
    item.typeLabel,
    item.observation,
    item.receipt?.name,
    item.amountLabel,
    item.statusLabel,
    charge.label
  ].join(" "));
}

function visibleProjectsForRole(projects, role, currentUid) {
  if (role === "admin") return projects;
  if (role === "gestor") return projects.filter((project) => project.managerUid === currentUid);
  if (role === "coordenador") return projects.filter((project) => project.coordinatorUid === currentUid);
  return [];
}

function canApproveExpenses(role) {
  return ["admin", "gestor", "coordenador"].includes(String(role || "").toLowerCase());
}

function canCreateManualExpense(role) {
  return ["admin", "gestor", "coordenador"].includes(String(role || "").toLowerCase());
}

function userRoleByUid(users, uid) {
  const user = users.find((entry) => String(entry.uid || entry.id || "") === String(uid || ""));
  return String(user?.role || "").toLowerCase();
}

function canViewExpenseForRole(item, role, currentUid, users) {
  const normalizedRole = String(role || "").toLowerCase();
  const ownerUids = [item.createdBy, item.techUid].map((value) => String(value || "")).filter(Boolean);
  const isOwnExpense = ownerUids.includes(String(currentUid || ""));
  if (normalizedRole === "admin") return true;
  if (normalizedRole === "gestor" || normalizedRole === "coordenador") {
    const ownerRole = userRoleByUid(users, item.createdBy || item.techUid);
    return isOwnExpense || ownerRole === "tecnico" || String(item.createdByRole || "").toLowerCase() === "tecnico";
  }
  return isOwnExpense;
}

function clearReceiptPreview(refs) {
  if (refs.expenseReceiptPreview) refs.expenseReceiptPreview.innerHTML = "";
  if (refs.expenseReceiptSummary) refs.expenseReceiptSummary.textContent = "Nenhum comprovante";
}

function revokeReceiptObjectUrl() {
  if (_expenseReceiptObjectUrl) {
    try { URL.revokeObjectURL(_expenseReceiptObjectUrl); } catch (_) {}
    _expenseReceiptObjectUrl = "";
  }
}

function setReceiptFile(file, refs) {
  revokeReceiptObjectUrl();
  _expenseReceiptFile = file || null;
  if (!_expenseReceiptFile) {
    clearReceiptPreview(refs);
    return;
  }

  const typeLabel = String(_expenseReceiptFile.type || "").includes("pdf") ? "PDF" : "Imagem";
  if (refs.expenseReceiptSummary) refs.expenseReceiptSummary.textContent = `${typeLabel} selecionado`;

  const row = document.createElement("div");
  row.className = "expense-receipt-item";
  row.innerHTML = `
    <div class="expense-receipt-item-main">
      <strong>${escapeHtml(_expenseReceiptFile.name || "Comprovante")}</strong>
      <span>${escapeHtml(`${formatBytes(_expenseReceiptFile.size || 0)} • ${typeLabel}`)}</span>
    </div>
    <div class="expense-receipt-item-actions"></div>
  `;

  if (refs.expenseReceiptPreview) {
    refs.expenseReceiptPreview.innerHTML = "";
    refs.expenseReceiptPreview.appendChild(row);
  }
}

function updateObservationCounter(refs) {
  if (!refs.expenseObservationCounter) return;
  const size = String(refs.expenseObservationEl?.value || "").trim().length;
  refs.expenseObservationCounter.textContent = `${size}/10 minimo`;
  refs.expenseObservationCounter.classList.toggle("is-ready", size >= 10);
}

async function retryUploadReceipt(storage, path, file) {
  const receiptRef = storageRef(storage, path);
  let waitMs = 500;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await uploadBytes(receiptRef, file, { contentType: file.type || "application/octet-stream" });
      return await getDownloadURL(receiptRef);
    } catch (err) {
      const code = String(err?.code || "");
      const msg = String(err?.message || "").toLowerCase();
      const retryable = code === "storage/unauthorized" || msg.includes("permission") || msg.includes("unauthorized");
      if (!retryable || attempt >= 5) throw err;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      waitMs = Math.min(Math.round(waitMs * 1.6), 4000);
    }
  }
  return "";
}

async function createExpenseRecord(input, deps) {
  const { db, storage, auth, state } = deps;
  const role = String(state.profile?.role || "").toLowerCase();
  const currentUid = auth?.currentUser?.uid || "";
  const receiptFile = input?.receiptFile || null;
  const amount = Number(input?.amount || 0);
  const chargedToClient = role === "tecnico" ? false : input?.chargedToClient === true;

  if (!state.companyId) throw new Error("Empresa nao identificada para registrar a despesa.");
  if (!input?.projectId) throw new Error("Projeto obrigatorio para registrar a despesa.");
  if (!input?.type) throw new Error("Tipo obrigatorio para registrar a despesa.");
  if (!input?.observation || String(input.observation).trim().length < 10) throw new Error("Descreva a despesa com pelo menos 10 caracteres.");
  if (!amount || amount <= 0) throw new Error("Informe um valor maior que zero para a despesa.");
  if (!receiptFile) throw new Error("Anexe o comprovante da despesa para continuar.");
  if ((receiptFile.size || 0) > EXPENSE_RECEIPT_MAX_SIZE) throw new Error("O comprovante deve ter no maximo 8 MB.");

  const basePayload = {
    companyId: state.companyId,
    projectId: String(input.projectId || "").trim(),
    projectName: input.projectName || "Projeto",
    taskId: String(input.taskId || "").trim(),
    taskName: input.taskName || "",
    activityId: String(input.activityId || "").trim(),
    activityName: input.activityName || "",
    workDate: input.workDate || "",
    type: String(input.type || "").trim(),
    observation: String(input.observation || "").trim(),
    amount,
    chargedToClient,
    status: "pending",
    source: input.source === "manual" ? "manual" : "activity",
    receipt: {},
    techUid: input.techUid || currentUid,
    techName: input.techName || state.profile?.name || auth?.currentUser?.email || "Usuario",
    managerUid: input.managerUid || "",
    managerName: input.managerName || "",
    coordinatorUid: input.coordinatorUid || "",
    coordinatorName: input.coordinatorName || "",
    createdBy: currentUid,
    createdByName: state.profile?.name || auth?.currentUser?.email || "Usuario",
    createdByRole: role,
    approvedBy: "",
    approvedByName: "",
    approvedByEmail: "",
    rejectedBy: "",
    rejectedByName: "",
    rejectionReason: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: currentUid
  };

  const expenseRef = await addDoc(collection(db, `companies/${state.companyId}/expenses`), basePayload);
  let receiptPath = "";
  let receiptUrl = "";

  try {
    const safeName = String(receiptFile.name || "comprovante").replace(/[^\w.\-]+/g, "_");
    receiptPath = `expenseReceipts/${state.companyId}/${expenseRef.id}/${Date.now()}_${safeName}`;
    receiptUrl = await retryUploadReceipt(storage, receiptPath, receiptFile);
    await updateDoc(doc(db, `companies/${state.companyId}/expenses`, expenseRef.id), {
      receipt: {
        name: receiptFile.name || "comprovante",
        path: receiptPath,
        url: receiptUrl,
        size: Number(receiptFile.size || 0),
        contentType: String(receiptFile.type || "").trim(),
        uploadedAt: new Date().toISOString()
      },
      updatedAt: serverTimestamp(),
      updatedBy: currentUid
    });
  } catch (err) {
    if (receiptPath) {
      try { await deleteObject(storageRef(storage, receiptPath)); } catch (_) {}
    }
    throw err;
  }

  if (role !== "tecnico") {
    await recalcProjectExpenseTotals(db, state.companyId, basePayload.projectId);
  }

  await createNotifications(db, state.companyId, [
    basePayload.managerUid,
    basePayload.coordinatorUid
  ], {
    type: "expense_submitted",
    title: "Nova despesa para aprovacao",
    message: `${basePayload.createdByName || "Usuario"} registrou ${expenseTypeLabel(basePayload.type).toLowerCase()} em ${basePayload.projectName || "um projeto"}.`,
    entityType: "expense",
    entityId: expenseRef.id,
    projectId: basePayload.projectId,
    activityId: basePayload.activityId || "",
    taskId: basePayload.taskId || "",
    createdBy: currentUid,
    createdByName: basePayload.createdByName,
    createdByEmail: auth?.currentUser?.email || ""
  }).catch((err) => console.warn("[notifications:expense-submit]", err));

  return {
    id: expenseRef.id,
    ...basePayload,
    receipt: {
      name: receiptFile.name || "comprovante",
      path: receiptPath,
      url: receiptUrl || await getDownloadURL(storageRef(storage, receiptPath)).catch(() => ""),
      size: Number(receiptFile.size || 0),
      contentType: String(receiptFile.type || "").trim(),
      uploadedAt: new Date().toISOString()
    },
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function buildExpenseOptionsData(projects, tasks, activities) {
  const tasksByProject = new Map();
  const activitiesByTask = new Map();

  for (const task of tasks) {
    const key = String(task.projectId || "");
    if (!tasksByProject.has(key)) tasksByProject.set(key, []);
    tasksByProject.get(key).push(task);
  }

  for (const activity of activities) {
    const key = String(activity.taskId || "");
    if (!activitiesByTask.has(key)) activitiesByTask.set(key, []);
    activitiesByTask.get(key).push(activity);
  }

  return { projects, tasksByProject, activitiesByTask };
}

function renderProjectOptions(refs, projects, selectedId = "") {
  if (!refs.expenseProjectEl) return;
  refs.expenseProjectEl.innerHTML = projects.map((project) => (
    `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name || "Projeto")}</option>`
  )).join("");
  refs.expenseProjectEl.value = selectedId && projects.some((project) => project.id === selectedId)
    ? selectedId
    : (projects[0]?.id || "");
}

function renderTaskOptions(refs, tasks, selectedId = "") {
  if (!refs.expenseTaskEl) return;
  refs.expenseTaskEl.innerHTML = ['<option value="">Nao vincular</option>']
    .concat(tasks.map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.name || "Tarefa")}</option>`))
    .join("");
  refs.expenseTaskEl.value = selectedId && tasks.some((task) => task.id === selectedId) ? selectedId : "";
}

function renderActivityOptions(refs, activities, selectedId = "") {
  if (!refs.expenseActivityEl) return;
  refs.expenseActivityEl.innerHTML = ['<option value="">Nao vincular</option>']
    .concat(activities.map((activity) => `<option value="${escapeHtml(activity.id)}">${escapeHtml(activity.name || "Atividade")}</option>`))
    .join("");
  refs.expenseActivityEl.value = selectedId && activities.some((activity) => activity.id === selectedId) ? selectedId : "";
}

function syncExpenseSelectors(refs) {
  const options = _expenseFormContext?.optionsData;
  if (!options) return;
  const projectId = refs.expenseProjectEl?.value || "";
  const currentTaskId = refs.expenseTaskEl?.value || "";
  const currentActivityId = refs.expenseActivityEl?.value || "";
  const tasks = (options.tasksByProject.get(projectId) || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  renderTaskOptions(refs, tasks, currentTaskId);
  const activities = (options.activitiesByTask.get(refs.expenseTaskEl?.value || "") || []).slice().sort((a, b) => String(a.workDate || "").localeCompare(String(b.workDate || "")));
  renderActivityOptions(refs, activities, currentActivityId);
}

async function recalcProjectExpenseTotals(db, companyId, projectId) {
  if (!db || !companyId || !projectId) return null;
  const snap = await getDocs(query(collection(db, `companies/${companyId}/expenses`), where("projectId", "==", projectId)));
  const items = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const approved = items.filter((item) => String(item.status || "").toLowerCase() === "approved");
  const pending = items.filter((item) => String(item.status || "").toLowerCase() === "pending");
  const rejected = items.filter((item) => String(item.status || "").toLowerCase() === "rejected");
  const internalApproved = approved
    .filter((item) => item.chargedToClient !== true)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const clientApproved = approved
    .filter((item) => item.chargedToClient === true)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingValue = pending.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const approvedValue = approved.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const summary = {
    totalApproved: approvedValue,
    totalPending: pendingValue,
    totalRejected: rejected.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    approvedInternal: internalApproved,
    approvedClient: clientApproved,
    countPending: pending.length,
    countApproved: approved.length,
    countRejected: rejected.length,
    updatedAt: serverTimestamp()
  };

  await updateDoc(doc(db, `companies/${companyId}/projects`, projectId), {
    expenseTotals: summary,
    updatedAt: serverTimestamp()
  }).catch(() => {});

  return summary;
}

async function loadExpenseFormData(deps, context) {
  const { db, state, auth } = deps;
  const companyId = state.companyId;
  const currentUid = auth?.currentUser?.uid || "";
  const role = String(state.profile?.role || "").toLowerCase();

  const [projectsSnap, tasksSnap, activitiesSnap] = await Promise.all([
    getDocs(collection(db, `companies/${companyId}/projects`)),
    getDocs(collection(db, `companies/${companyId}/tasks`)),
    getDocs(collection(db, `companies/${companyId}/activities`))
  ]);

  const allProjects = projectsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  let projects = visibleProjectsForRole(allProjects, role, currentUid);
  if (context?.source === "activity" && context?.projectId) {
    projects = allProjects.filter((project) => project.id === context.projectId);
  }

  const tasks = tasksSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((task) => projects.some((project) => project.id === task.projectId));
  const activities = activitiesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((activity) => projects.some((project) => project.id === activity.projectId));

  return {
    projects,
    tasks,
    activities,
    users: []
  };
}

function resetExpenseForm(refs) {
  clearAlert(refs.expenseFormAlert);
  if (refs.expenseTypeEl) refs.expenseTypeEl.value = "alimentacao";
  if (refs.expenseAmountEl) refs.expenseAmountEl.value = "";
  if (refs.expenseChargedToClientEl) refs.expenseChargedToClientEl.checked = false;
  if (refs.expenseObservationEl) refs.expenseObservationEl.value = "";
  if (refs.expenseReceiptFileEl) refs.expenseReceiptFileEl.value = "";
  if (refs.expenseContextBanner) {
    refs.expenseContextBanner.hidden = true;
    refs.expenseContextBanner.textContent = "";
  }
  updateObservationCounter(refs);
  setReceiptFile(null, refs);
}

async function openExpenseForm(context, deps) {
  bindEvents(deps);
  const { refs, state } = deps;
  if (!refs.modalExpenseForm) return;

  _expenseFormContext = context || { source: "manual" };
  resetExpenseForm(refs);

  if (refs.expenseFormTitle) {
    refs.expenseFormTitle.textContent = _expenseFormContext.source === "activity" ? "Despesa da Atividade" : "Despesa Avulsa";
  }
  if (refs.expenseFormSubtitle) {
    refs.expenseFormSubtitle.textContent = _expenseFormContext.source === "activity"
      ? "Vincule o comprovante diretamente a esta atividade para facilitar a aprovacao."
      : "Registre uma despesa manual do projeto com o contexto completo.";
  }

  const data = await loadExpenseFormData(deps, _expenseFormContext);
  _expenseFormContext.optionsData = buildExpenseOptionsData(data.projects, data.tasks, data.activities);
  _expenseFormContext.users = data.users;

  renderProjectOptions(refs, data.projects, _expenseFormContext.projectId || "");
  syncExpenseSelectors(refs);

  if (refs.expenseTaskEl && _expenseFormContext.taskId) refs.expenseTaskEl.value = _expenseFormContext.taskId;
  syncExpenseSelectors(refs);
  if (refs.expenseActivityEl && _expenseFormContext.activityId) refs.expenseActivityEl.value = _expenseFormContext.activityId;

  const lockContext = _expenseFormContext.source === "activity";
  const role = String(state.profile?.role || "").toLowerCase();
  const isTech = role === "tecnico";
  if (refs.expenseProjectEl) refs.expenseProjectEl.disabled = lockContext;
  if (refs.expenseTaskEl) refs.expenseTaskEl.disabled = lockContext;
  if (refs.expenseActivityEl) refs.expenseActivityEl.disabled = lockContext;
  if (refs.expenseChargedToClientEl) {
    refs.expenseChargedToClientEl.checked = false;
    refs.expenseChargedToClientEl.disabled = isTech;
    const chargeField = refs.expenseChargedToClientEl.closest(".expense-checkbox-field");
    if (chargeField) chargeField.hidden = isTech;
  }

  if (lockContext && refs.expenseContextBanner) {
    refs.expenseContextBanner.hidden = false;
    refs.expenseContextBanner.innerHTML = `
      <strong>${escapeHtml(_expenseFormContext.projectName || "Projeto")}</strong>
      • ${escapeHtml(_expenseFormContext.taskName || "Tarefa")}
      • ${escapeHtml(_expenseFormContext.activityName || "Atividade")}
      ${_expenseFormContext.workDate ? ` • ${escapeHtml(formatDateLabel(_expenseFormContext.workDate))}` : ""}
    `;
  }

  refs.modalExpenseForm.hidden = false;
}

function closeExpenseForm(refs) {
  if (refs?.modalExpenseForm) refs.modalExpenseForm.hidden = true;
  revokeReceiptObjectUrl();
  _expenseFormContext = null;
  _expenseReceiptFile = null;
}

async function showExpenseDialog(message, options = {}) {
  await showDialogAlert(message, {
    title: options.title || "Despesas",
    type: options.type || "info",
    confirmLabel: options.confirmLabel || "Entendi"
  });
}

async function saveExpenseForm(deps) {
  const { refs, db, storage, auth, state } = deps;
  if (!_expenseFormContext) return;

  clearAlert(refs.expenseFormAlert);

  const projectId = String(refs.expenseProjectEl?.value || "").trim();
  const taskId = String(refs.expenseTaskEl?.value || "").trim();
  const activityId = String(refs.expenseActivityEl?.value || "").trim();
  const type = String(refs.expenseTypeEl?.value || "alimentacao").trim();
  const observation = String(refs.expenseObservationEl?.value || "").trim();
  const amount = parseCurrencyInput(refs.expenseAmountEl?.value || "");
  const role = String(state.profile?.role || "").toLowerCase();
  const chargedToClient = role === "tecnico"
    ? false
    : refs.expenseChargedToClientEl?.checked === true;
  const currentUid = auth?.currentUser?.uid || "";

  if (!projectId) return showExpenseDialog("Escolha o projeto ao qual essa despesa pertence.", { title: "Projeto obrigatório", type: "error" });
  if (!type) return showExpenseDialog("Selecione o tipo da despesa para continuar.", { title: "Tipo obrigatório", type: "error" });
  if (!observation || observation.length < 10) return showExpenseDialog("Descreva a despesa com pelo menos 10 caracteres.", { title: "Descrição incompleta", type: "error" });
  if (!amount || amount <= 0) return showExpenseDialog("Informe um valor maior que zero para a despesa.", { title: "Valor inválido", type: "error" });
  if (!_expenseReceiptFile) return showExpenseDialog("Anexe o comprovante da despesa para continuar.", { title: "Comprovante obrigatório", type: "error" });
  if ((_expenseReceiptFile.size || 0) > EXPENSE_RECEIPT_MAX_SIZE) {
    return showExpenseDialog("O comprovante deve ter no máximo 8 MB.", { title: "Arquivo muito grande", type: "error" });
  }

  const project = (_expenseFormContext.optionsData?.projects || []).find((item) => item.id === projectId) || {};
  const task = ((_expenseFormContext.optionsData?.tasksByProject.get(projectId)) || []).find((item) => item.id === taskId) || {};
  const activity = (((_expenseFormContext.optionsData?.activitiesByTask.get(taskId)) || [])).find((item) => item.id === activityId) || {};
  const saveButton = refs.btnSaveExpenseForm;
  const originalSaveLabel = saveButton?.textContent || "Salvar despesa";
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "Salvando...";
  }

  try {
    const basePayload = {
      companyId: state.companyId,
      projectId,
      projectName: project.name || _expenseFormContext.projectName || "Projeto",
      taskId: taskId || "",
      taskName: task.name || _expenseFormContext.taskName || "",
      activityId: activityId || "",
      activityName: activity.name || _expenseFormContext.activityName || "",
      workDate: activity.workDate || _expenseFormContext.workDate || "",
      type,
      observation,
      amount,
      chargedToClient,
      status: "pending",
      source: _expenseFormContext.source === "activity" ? "activity" : "manual",
      receipt: {},
      techUid: _expenseFormContext.techUid || currentUid,
      techName: _expenseFormContext.techName || state.profile?.name || auth?.currentUser?.email || "Usuario",
      managerUid: project.managerUid || _expenseFormContext.managerUid || "",
      managerName: project.managerName || _expenseFormContext.managerName || "",
      coordinatorUid: project.coordinatorUid || _expenseFormContext.coordinatorUid || "",
      coordinatorName: project.coordinatorName || _expenseFormContext.coordinatorName || "",
      createdBy: currentUid,
      createdByName: state.profile?.name || auth?.currentUser?.email || "Usuario",
      createdByRole: role,
      approvedBy: "",
      approvedByName: "",
      approvedByEmail: "",
      rejectedBy: "",
      rejectedByName: "",
      rejectionReason: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: currentUid
    };

    const expenseRef = await addDoc(collection(db, `companies/${state.companyId}/expenses`), basePayload);
    let receiptPath = "";
    let receiptUrl = "";

    try {
      const safeName = String(_expenseReceiptFile.name || "comprovante").replace(/[^\w.\-]+/g, "_");
      receiptPath = `expenseReceipts/${state.companyId}/${expenseRef.id}/${Date.now()}_${safeName}`;
      receiptUrl = await retryUploadReceipt(storage, receiptPath, _expenseReceiptFile);
      await updateDoc(doc(db, `companies/${state.companyId}/expenses`, expenseRef.id), {
        receipt: {
          name: _expenseReceiptFile.name || "comprovante",
          path: receiptPath,
          url: receiptUrl,
          size: Number(_expenseReceiptFile.size || 0),
          contentType: String(_expenseReceiptFile.type || "").trim(),
          uploadedAt: new Date().toISOString()
        },
        updatedAt: serverTimestamp(),
        updatedBy: currentUid
      });
    } catch (err) {
      if (receiptPath) {
        try { await deleteObject(storageRef(storage, receiptPath)); } catch (_) {}
      }
      throw err;
    }

    if (role !== "tecnico") {
      await recalcProjectExpenseTotals(db, state.companyId, projectId);
    }

    await createNotifications(db, state.companyId, [
      basePayload.managerUid,
      basePayload.coordinatorUid
    ], {
      type: "expense_submitted",
      title: "Nova despesa para aprovacao",
      message: `${basePayload.createdByName || "Usuario"} registrou ${expenseTypeLabel(type).toLowerCase()} em ${basePayload.projectName || "um projeto"}.`,
      entityType: "expense",
      entityId: expenseRef.id,
      projectId,
      activityId: activityId || "",
      taskId: taskId || "",
      createdBy: currentUid,
      createdByName: basePayload.createdByName,
      createdByEmail: auth?.currentUser?.email || ""
    }).catch((err) => console.warn("[notifications:expense-submit]", err));

    const savedExpense = {
      id: expenseRef.id,
      ...basePayload,
      receipt: {
        name: _expenseReceiptFile.name || "comprovante",
        path: receiptPath,
        url: receiptUrl || await getDownloadURL(storageRef(storage, receiptPath)).catch(() => ""),
        size: Number(_expenseReceiptFile.size || 0),
        contentType: String(_expenseReceiptFile.type || "").trim(),
        uploadedAt: new Date().toISOString()
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const onSaved = _expenseFormContext?.onSaved;
    closeExpenseForm(refs);
    if (typeof onSaved === "function") {
      await onSaved(savedExpense);
    }
    await showExpenseDialog("Despesa enviada para aprovação com sucesso.", {
      title: "Despesa enviada",
      type: "success",
      confirmLabel: "Fechar"
    });
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = originalSaveLabel;
    }
  }
}

function filteredExpenseItems(refs) {
  const q = normalizeText(refs.expenseApprovalsSearchInput?.value || "");
  const projectId = refs.expenseApprovalsProjectFilter?.value || "";
  const type = refs.expenseApprovalsTypeFilter?.value || "";
  const userKey = refs.expenseApprovalsUserFilter?.value || "";
  const approverKey = refs.expenseApprovalsApproverFilter?.value || "";
  let startDate = String(refs.expenseApprovalsStartDateInput?.value || "").slice(0, 10);
  let endDate = String(refs.expenseApprovalsEndDateInput?.value || "").slice(0, 10);
  if (startDate && endDate && startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
  }

  return _expenseItemsCache.filter((item) => {
    const workDate = String(item.workDate || "").slice(0, 10);
    const itemUserKeys = [
      item.createdBy,
      item.techUid,
      normalizeText(item.createdByName || ""),
      normalizeText(item.techName || "")
    ].filter(Boolean);
    const itemApproverKeys = [
      item.approvedBy,
      item.rejectedBy,
      normalizeText(item.approvedByName || ""),
      normalizeText(item.rejectedByName || "")
    ].filter(Boolean);
    if (_expenseStatusFilter !== "all" && String(item.status || "").toLowerCase() !== _expenseStatusFilter) return false;
    if (projectId && item.projectId !== projectId) return false;
    if (type && item.type !== type) return false;
    if (userKey && !itemUserKeys.includes(userKey)) return false;
    if (approverKey && !itemApproverKeys.includes(approverKey)) return false;
    if (startDate && (!workDate || workDate < startDate)) return false;
    if (endDate && (!workDate || workDate > endDate)) return false;
    if (q && !buildExpenseSearchText(item).includes(q)) return false;
    return true;
  });
}

function renderExpenseFilters(refs, items) {
  if (!refs.expenseApprovalsProjectFilter) return;
  const current = refs.expenseApprovalsProjectFilter.value || "";
  const currentUser = refs.expenseApprovalsUserFilter?.value || "";
  const currentApprover = refs.expenseApprovalsApproverFilter?.value || "";
  const projects = Array.from(new Map(items.map((item) => [item.projectId, item.projectName || "Projeto"])).entries())
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  refs.expenseApprovalsProjectFilter.innerHTML = ['<option value="">Todos</option>']
    .concat(projects.map(([id, label]) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`))
    .join("");
  refs.expenseApprovalsProjectFilter.value = projects.some(([id]) => id === current) ? current : "";

  if (refs.expenseApprovalsUserFilter) {
    const usersMap = new Map();
    for (const item of items) {
      const label = String(item.createdByName || item.techName || "Usuario").trim();
      const key = String(item.createdBy || item.techUid || normalizeText(label)).trim();
      if (key && !usersMap.has(key)) usersMap.set(key, label || "Usuario");
    }
    const users = Array.from(usersMap.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    refs.expenseApprovalsUserFilter.innerHTML = ['<option value="">Todos</option>']
      .concat(users.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`))
      .join("");
    refs.expenseApprovalsUserFilter.value = users.some(([key]) => key === currentUser) ? currentUser : "";
  }

  if (refs.expenseApprovalsApproverFilter) {
    const approversMap = new Map();
    for (const item of items) {
      const label = String(item.approvedByName || item.rejectedByName || "").trim();
      const key = String(item.approvedBy || item.rejectedBy || normalizeText(label)).trim();
      if (key && label && !approversMap.has(key)) approversMap.set(key, label);
    }
    const approvers = Array.from(approversMap.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    refs.expenseApprovalsApproverFilter.innerHTML = ['<option value="">Todos</option>']
      .concat(approvers.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`))
      .join("");
    refs.expenseApprovalsApproverFilter.value = approvers.some(([key]) => key === currentApprover) ? currentApprover : "";
  }
}

function updateExpenseSummary(refs, items) {
  const pending = items.filter((item) => item.status === "pending");
  const approved = items.filter((item) => item.status === "approved");
  const rejected = items.filter((item) => item.status === "rejected");
  const pendingValue = pending.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const internalValue = approved
    .filter((item) => item.chargedToClient !== true)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const clientValue = approved
    .filter((item) => item.chargedToClient === true)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  if (refs.expenseApprovalsPendingCount) refs.expenseApprovalsPendingCount.textContent = String(pending.length);
  if (refs.expenseApprovalsApprovedCount) refs.expenseApprovalsApprovedCount.textContent = String(approved.length);
  if (refs.expenseApprovalsRejectedCount) refs.expenseApprovalsRejectedCount.textContent = String(rejected.length);
  if (refs.expenseApprovalsPendingValue) refs.expenseApprovalsPendingValue.textContent = formatCurrencyBRL(pendingValue);
  if (refs.expenseApprovalsInternalValue) refs.expenseApprovalsInternalValue.textContent = formatCurrencyBRL(internalValue);
  if (refs.expenseApprovalsClientValue) refs.expenseApprovalsClientValue.textContent = formatCurrencyBRL(clientValue);
}

function syncExpenseStatusCards() {
  document.querySelectorAll("[data-expense-status]").forEach((card) => {
    const active = (card.getAttribute("data-expense-status") || "pending") === _expenseStatusFilter;
    card.classList.toggle("is-active", active);
    card.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function renderExpenseList(refs, items, deps) {
  if (!refs.expenseApprovalsList) return;
  refs.expenseApprovalsList.innerHTML = "";
  const { pageItems } = getExpenseApprovalsPage(items);
  renderExpenseApprovalsPagination(refs, items);

  if (!pageItems.length) {
    show(refs.expenseApprovalsEmpty);
    return;
  }

  hide(refs.expenseApprovalsEmpty);
  const canApprove = canApproveExpenses(deps?.state?.profile?.role);
  refs.expenseApprovalsList.innerHTML = pageItems.map((item) => `
    <article class="expense-approval-card is-${escapeHtml(item.status)}">
      <div class="expense-approval-head">
        <div class="expense-approval-title">
          <div class="expense-approval-kicker">${escapeHtml(item.projectName || "Projeto")}</div>
          <h3><span class="expense-approval-type">${escapeHtml(item.typeLabel)}</span> <span>| ${escapeHtml(item.techName || "Usuario")}</span></h3>
          <p class="muted">${escapeHtml(item.taskName || "Sem tarefa")} ${item.activityName ? `| ${escapeHtml(item.activityName)}` : "| Despesa avulsa"}</p>
        </div>
        <div class="expense-approval-actions">
          <span class="expense-status-pill ${escapeHtml(item.status)}">${escapeHtml(item.statusLabel)}</span>
          ${item.status === "pending" && canApprove ? `<button class="btn sm expense-action-approve" type="button" data-expense-action="approve" data-expense-id="${escapeHtml(item.id)}">Aprovar</button><button class="btn sm expense-action-reject" type="button" data-expense-action="reject" data-expense-id="${escapeHtml(item.id)}">Reprovar</button>` : ""}
        </div>
      </div>
      <div class="expense-approval-compact-meta">
        <strong>${escapeHtml(item.amountLabel)}</strong>
        <span>${escapeHtml(item.workDateLabel)}</span>
        <span>${escapeHtml(item.createdByName || item.techName || "-")}</span>
        <span>${escapeHtml(item.source === "activity" ? "Atividade" : "Manual")}</span>
      </div>
      <div class="expense-approval-note">${escapeHtml(truncateText(item.observation || "Sem observacao.", 140))}</div>
      ${item.status === "pending" && canApprove ? `
        <div class="expense-approval-decision">
          <div class="expense-approval-decision-head">
            <strong>Responsabilidade</strong>
          </div>
          <div class="expense-approval-decision-options" role="radiogroup" aria-label="Responsabilidade da despesa">
            <label class="expense-decision-option">
              <input type="radio" name="expense-charge-${escapeHtml(item.id)}" value="internal" />
              <span>Conta propria</span>
            </label>
            <label class="expense-decision-option">
              <input type="radio" name="expense-charge-${escapeHtml(item.id)}" value="client" />
              <span>Conta do cliente</span>
            </label>
          </div>
        </div>
      ` : ""}
      ${item.rejectionReason ? `<div class="expense-approval-reason"><strong>Motivo da reprovacao:</strong><br>${escapeHtml(item.rejectionReason)}</div>` : ""}
      <div class="expense-approval-footer">
        <div class="expense-approval-receipt">
          ${item.receipt?.url ? `<a class="btn ghost sm" href="${escapeHtml(item.receipt.url)}" target="_blank" rel="noopener">Abrir comprovante</a>` : `<span class="muted">Sem comprovante</span>`}
          ${item.receipt?.name ? `<span class="expense-approval-meta">${escapeHtml(item.receipt.name)}</span>` : ""}
        </div>
        <div class="expense-approval-meta">
          ${item.status === "approved" ? `Aprovada em ${escapeHtml(item.approvedAtLabel || "-")} por ${escapeHtml(item.approvedByName || "-")}` : ""}
          ${item.status === "rejected" ? `Reprovada em ${escapeHtml(item.rejectedAtLabel || "-")} por ${escapeHtml(item.rejectedByName || "-")}` : ""}
        </div>
      </div>
    </article>
  `).join("");
}

function getExpenseApprovalsPage(items) {
  const totalPages = Math.max(1, Math.ceil(items.length / EXPENSE_APPROVALS_PAGE_SIZE));
  _expenseApprovalsPage = Math.min(Math.max(1, Number(_expenseApprovalsPage || 1)), totalPages);
  const startIndex = (_expenseApprovalsPage - 1) * EXPENSE_APPROVALS_PAGE_SIZE;
  return {
    totalPages,
    pageItems: items.slice(startIndex, startIndex + EXPENSE_APPROVALS_PAGE_SIZE),
    startRow: items.length ? startIndex + 1 : 0,
    endRow: Math.min(items.length, startIndex + EXPENSE_APPROVALS_PAGE_SIZE)
  };
}

function renderExpenseApprovalsPagination(refs, items) {
  if (!refs.expenseApprovalsPagination) return;
  const { totalPages, startRow, endRow } = getExpenseApprovalsPage(items);
  refs.expenseApprovalsPagination.hidden = items.length === 0;
  refs.expenseApprovalsPagination.innerHTML = items.length ? `
    <span>${escapeHtml(String(startRow))}-${escapeHtml(String(endRow))} de ${escapeHtml(String(items.length))} despesas</span>
    <div>
      <button type="button" data-expense-approvals-page="prev" ${_expenseApprovalsPage <= 1 ? "disabled" : ""}>Anterior</button>
      <strong>Pagina ${escapeHtml(String(_expenseApprovalsPage))} de ${escapeHtml(String(totalPages))}</strong>
      <button type="button" data-expense-approvals-page="next" ${_expenseApprovalsPage >= totalPages ? "disabled" : ""}>Proxima</button>
    </div>
  ` : "";
}

function renderExpenseApprovals(refs, deps) {
  syncExpenseStatusCards();
  const items = filteredExpenseItems(refs);
  renderExpenseList(refs, items, deps);
}

function renderActivityExpensesList(refs, items) {
  const safeItems = Array.isArray(items) ? items : [];
  const total = safeItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingCount = safeItems.filter((item) => String(item.status || "").toLowerCase() === "pending").length;

  if (refs.myActivityExpenseTotal) refs.myActivityExpenseTotal.textContent = formatCurrencyBRL(total);
  if (refs.myActivityExpensePendingCount) refs.myActivityExpensePendingCount.textContent = String(pendingCount);
  if (!refs.myActivityExpensesList) return;

  if (!safeItems.length) {
    refs.myActivityExpensesList.innerHTML = '<div class="my-activity-expenses-empty">Nenhuma despesa registrada para esta atividade ainda.</div>';
    return;
  }

  refs.myActivityExpensesList.innerHTML = safeItems.map((item) => `
    <article class="my-activity-expense-item">
      <div class="my-activity-expense-item-head">
        <div class="my-activity-expense-item-title">
          <strong>${escapeHtml(expenseTypeLabel(item.type))}</strong>
          <span class="expense-status-pill ${escapeHtml(String(item.status || "pending").toLowerCase())}">${escapeHtml(expenseStatusLabel(item.status))}</span>
          ${getExpenseChargeState(item).cls === "pending-decision" ? "" : `<span class="expense-badge ${getExpenseChargeState(item).cls}">${escapeHtml(getExpenseChargeState(item).label)}</span>`}
        </div>
        <div class="my-activity-expense-item-value">${escapeHtml(formatCurrencyBRL(item.amount || 0))}</div>
      </div>
      <div class="my-activity-expense-item-meta">
        <span class="my-activity-expense-item-note">${escapeHtml(truncateText(item.observation || "", 90))}</span>
        <span class="expense-approval-meta">${escapeHtml(formatDateTimeLabel(item.createdAt))}</span>
        ${item.receipt?.url ? `<a class="btn ghost sm" href="${escapeHtml(item.receipt.url)}" target="_blank" rel="noopener">Abrir comprovante</a>` : ""}
      </div>
    </article>
  `).join("");
}

export function resetActivityExpenseDrafts(refs) {
  if (refs?.myActivityExpenseDrafts) refs.myActivityExpenseDrafts.innerHTML = "";
  if (refs?.myActivityExpenseComposer) refs.myActivityExpenseComposer.hidden = true;
}

export function addActivityExpenseDraft(refs) {
  if (!refs?.myActivityExpenseDrafts) return;
  if (refs.myActivityExpenseComposer) refs.myActivityExpenseComposer.hidden = false;

  if (!refs.myActivityExpenseDrafts.querySelector(".my-activity-expense-draft-table")) {
    refs.myActivityExpenseDrafts.innerHTML = `
      <div class="my-activity-expense-draft-table"></div>
    `;
  }

  const table = refs.myActivityExpenseDrafts.querySelector(".my-activity-expense-draft-table");
  const draftId = `activity-expense-draft-${++_activityExpenseDraftSeq}`;
  const row = document.createElement("div");
  row.className = "my-activity-expense-draft-row";
  row.setAttribute("data-activity-expense-draft", draftId);
  row.innerHTML = `
    <label class="field">
      <span>Tipo de despesa</span>
      <select data-expense-draft-type>
        <option value="alimentacao">Alimentacao</option>
        <option value="trajeto">Trajeto</option>
        <option value="estadia">Estadia</option>
      </select>
    </label>
    <label class="field">
      <span>Valor</span>
      <input data-expense-draft-amount inputmode="decimal" placeholder="R$ 0,00" />
    </label>
    <label class="field">
      <span>Observacao</span>
      <input data-expense-draft-observation placeholder="Contexto da despesa" />
    </label>
    <label class="field my-activity-expense-file-field">
      <span>Comprovante</span>
      <input data-expense-draft-file type="file" accept=".pdf,image/png,image/jpeg,image/jpg,image/webp" />
    </label>
    <button class="icon-btn xs my-activity-expense-draft-remove" data-remove-activity-expense-draft="${escapeHtml(draftId)}" type="button" title="Remover despesa" aria-label="Remover despesa">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </button>
  `;
  table.appendChild(row);
  row.querySelector("[data-expense-draft-type]")?.focus();
}

export function removeActivityExpenseDraft(refs, draftId) {
  const row = Array.from(refs?.myActivityExpenseDrafts?.querySelectorAll?.("[data-activity-expense-draft]") || [])
    .find((item) => item.getAttribute("data-activity-expense-draft") === String(draftId || ""));
  if (row) row.remove();
  const hasRows = Boolean(refs?.myActivityExpenseDrafts?.querySelector?.("[data-activity-expense-draft]"));
  if (!hasRows) resetActivityExpenseDrafts(refs);
}

export function validateActivityExpenseDrafts(refs) {
  return collectActivityExpenseDrafts(refs, { validate: true });
}

export async function saveActivityExpenseDrafts(activityContext, deps, drafts = null) {
  const { auth, state } = deps;
  const safeDrafts = Array.isArray(drafts) ? drafts : collectActivityExpenseDrafts(deps.refs, { validate: true });
  const saved = [];

  for (const draft of safeDrafts) {
    const savedExpense = await createExpenseRecord({
      source: "activity",
      projectId: activityContext?.projectId || "",
      projectName: activityContext?.projectName || "",
      taskId: activityContext?.taskId || "",
      taskName: activityContext?.taskName || "",
      activityId: activityContext?.activity?.id || "",
      activityName: activityContext?.activity?.name || "",
      workDate: activityContext?.activity?.workDate || "",
      techUid: auth?.currentUser?.uid || "",
      techName: state?.profile?.name || auth?.currentUser?.email || "",
      managerUid: activityContext?.managerUid || "",
      managerName: activityContext?.managerName || "",
      coordinatorUid: activityContext?.coordinatorUid || "",
      coordinatorName: activityContext?.coordinatorName || "",
      type: draft.type,
      amount: draft.amount,
      observation: draft.observation,
      receiptFile: draft.receiptFile
    }, deps);
    saved.push(savedExpense);
  }

  if (saved.length) {
    const currentItems = Array.isArray(activityContext?.__expenseItems) ? activityContext.__expenseItems.slice() : [];
    activityContext.__expenseItems = [...saved, ...currentItems];
    renderActivityExpensesList(deps.refs, activityContext.__expenseItems);
    resetActivityExpenseDrafts(deps.refs);
    await loadActivityExpenses(activityContext, deps).catch(() => {});
  }

  return saved;
}

async function updateExpenseStatus(ids, nextStatus, deps, rejectionReason = "", options = {}) {
  const { db, state, auth } = deps;
  const currentUid = auth?.currentUser?.uid || "";
  const currentName = state.profile?.name || auth?.currentUser?.email || "Gestao";
  const currentEmail = auth?.currentUser?.email || "";
  const currentRole = String(state.profile?.role || "").toLowerCase();

  for (const id of ids) {
    const item = _expenseItemsCache.find((entry) => entry.id === id);
    if (!item) continue;
    const payload = nextStatus === "approved"
      ? {
          status: "approved",
          chargedToClient: options.chargedToClient === true,
          approvedAt: serverTimestamp(),
          approvedBy: currentUid,
          approvedByName: currentName,
          approvedByEmail: currentEmail,
          approvedByRole: currentRole,
          rejectedAt: null,
          rejectedBy: "",
          rejectedByName: "",
          rejectedByRole: "",
          rejectionReason: "",
          updatedAt: serverTimestamp(),
          updatedBy: currentUid
        }
      : {
          status: "rejected",
          rejectedAt: serverTimestamp(),
          rejectedBy: currentUid,
          rejectedByName: currentName,
          rejectedByRole: currentRole,
          rejectionReason: rejectionReason,
          approvedAt: null,
          approvedBy: "",
          approvedByName: "",
          approvedByEmail: "",
          approvedByRole: "",
          updatedAt: serverTimestamp(),
          updatedBy: currentUid
        };

    await updateDoc(doc(db, `companies/${state.companyId}/expenses`, id), payload);
    await recalcProjectExpenseTotals(db, state.companyId, item.projectId);
    await createNotifications(db, state.companyId, [item.createdBy, item.techUid], {
      type: nextStatus === "approved" ? "expense_approved" : "expense_rejected",
      title: nextStatus === "approved" ? "Despesa aprovada" : "Despesa reprovada",
      message: `${currentName} ${nextStatus === "approved" ? "aprovou" : "reprovou"} sua despesa em ${item.projectName || "um projeto"}.`,
      entityType: "expense",
      entityId: id,
      projectId: item.projectId || "",
      activityId: item.activityId || "",
      taskId: item.taskId || "",
      createdBy: currentUid,
      createdByName: currentName,
      createdByEmail: currentEmail
    }).catch((err) => console.warn("[notifications:expense-status]", err));
  }
}

export async function loadActivityExpenses(activityContext, deps) {
  const { refs, db, state, auth } = deps;
  if (!refs.myActivityExpensesList || !activityContext?.activity?.id || !state.companyId) return;

  refs.myActivityExpensesList.innerHTML = '<div class="my-activity-expenses-empty">Carregando despesas desta atividade...</div>';
  const role = String(state.profile?.role || "").toLowerCase();
  const currentUid = auth?.currentUser?.uid || "";
  const constraints = role === "tecnico"
    ? [where("createdBy", "==", currentUid)]
    : [where("activityId", "==", activityContext.activity.id)];

  const snap = await getDocs(query(collection(db, `companies/${state.companyId}/expenses`), ...constraints));

  const items = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((item) => String(item.activityId || "") === String(activityContext.activity.id || ""))
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    });
  activityContext.__expenseItems = items;
  renderActivityExpensesList(refs, items);
}

export async function openActivityExpenseModal(activityContext, deps) {
  bindEvents(deps);
  await openExpenseForm({
    source: "activity",
    projectId: activityContext?.projectId || "",
    projectName: activityContext?.projectName || "",
    taskId: activityContext?.taskId || "",
    taskName: activityContext?.taskName || "",
    activityId: activityContext?.activity?.id || "",
    activityName: activityContext?.activity?.name || "",
    workDate: activityContext?.activity?.workDate || "",
    techUid: deps.auth?.currentUser?.uid || "",
    techName: deps.state?.profile?.name || deps.auth?.currentUser?.email || "",
    managerUid: activityContext?.managerUid || "",
    managerName: activityContext?.managerName || "",
    coordinatorUid: activityContext?.coordinatorUid || "",
    coordinatorName: activityContext?.coordinatorName || "",
    onSaved: async (savedExpense) => {
      const currentItems = Array.isArray(activityContext?.__expenseItems) ? activityContext.__expenseItems.slice() : [];
      if (savedExpense) {
        activityContext.__expenseItems = [savedExpense, ...currentItems.filter((item) => item.id !== savedExpense.id)];
        renderActivityExpensesList(deps.refs, activityContext.__expenseItems);
      }
      await loadActivityExpenses(activityContext, deps).catch(() => {});
    }
  }, deps);
}

export function openExpenseApprovalsView(deps) {
  bindEvents(deps);
  deps.setView("expenseApprovals");
  loadExpenseApprovals(deps).catch((err) => {
    console.error(err);
    showExpenseDialog("Não foi possível carregar as despesas agora. Tente novamente em instantes.", {
      title: "Falha ao carregar",
      type: "error"
    });
  });
}

export async function loadExpenseApprovals(deps) {
  const { refs, state, db, auth } = deps;
  if (!refs.expenseApprovalsList) return;
  refs.expenseApprovalsList.innerHTML = '<div class="panel subtle"><p class="muted">Carregando despesas...</p></div>';
  hide(refs.expenseApprovalsEmpty);

  const companyId = state.companyId;
  const currentUid = auth?.currentUser?.uid || "";
  const role = String(state.profile?.role || "").toLowerCase();
  if (refs.btnOpenManualExpense) {
    refs.btnOpenManualExpense.hidden = !canCreateManualExpense(role);
  }
  if (!companyId || !currentUid) {
    refs.expenseApprovalsList.innerHTML = "";
    if (refs.expenseApprovalsPagination) {
      refs.expenseApprovalsPagination.innerHTML = "";
      refs.expenseApprovalsPagination.hidden = true;
    }
    show(refs.expenseApprovalsEmpty);
    return;
  }

  const usersPromise = role === "tecnico"
    ? Promise.resolve({
        docs: [{
          id: currentUid,
          data: () => ({ ...(state.profile || {}), role: "tecnico" })
        }]
      })
    : getDocs(collection(db, `companies/${companyId}/users`));

  const expensesPromise = role === "admin"
    ? getDocs(collection(db, `companies/${companyId}/expenses`))
    : role === "gestor" || role === "coordenador"
      ? Promise.all([
          getDocs(query(collection(db, `companies/${companyId}/expenses`), where("createdBy", "==", currentUid))),
          getDocs(query(collection(db, `companies/${companyId}/expenses`), where("createdByRole", "==", "tecnico")))
        ]).then((snaps) => {
          const docsById = new Map();
          snaps.forEach((snap) => snap.docs.forEach((docSnap) => docsById.set(docSnap.id, docSnap)));
          return { docs: Array.from(docsById.values()) };
        })
      : getDocs(query(collection(db, `companies/${companyId}/expenses`), where("createdBy", "==", currentUid)));

  const [expensesSnap, usersSnap] = await Promise.all([
    expensesPromise,
    usersPromise
  ]);

  const users = usersSnap.docs.map((docSnap) => ({ uid: docSnap.id, id: docSnap.id, ...docSnap.data() }));
  state._usersCache = users;

  _expenseItemsCache = expensesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((item) => canViewExpenseForRole(item, role, currentUid, users))
    .map((item) => ({
      ...item,
      status: String(item.status || "pending").toLowerCase(),
      statusLabel: expenseStatusLabel(item.status),
      typeLabel: expenseTypeLabel(item.type),
      amountLabel: formatCurrencyBRL(item.amount || 0),
      workDateLabel: item.workDate ? formatDateLabel(item.workDate) : "Sem data",
      approvedAtLabel: formatDateTimeLabel(item.approvedAt),
      rejectedAtLabel: formatDateTimeLabel(item.rejectedAt)
    }))
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    });

  renderExpenseFilters(refs, _expenseItemsCache);
  updateExpenseSummary(refs, _expenseItemsCache);
  renderExpenseApprovals(refs, deps);
}

function bindEvents(deps) {
  if (_bound) return;
  _bound = true;
  const { refs } = deps;

  refs.expenseObservationEl?.addEventListener("input", () => updateObservationCounter(refs));
  refs.expenseReceiptFileEl?.addEventListener("change", (event) => {
    const file = event.target.files?.[0] || null;
    setReceiptFile(file, refs);
    event.target.value = "";
  });
  refs.btnRemoveExpenseReceipt?.addEventListener("click", () => setReceiptFile(null, refs));
  refs.expenseProjectEl?.addEventListener("change", () => syncExpenseSelectors(refs));
  refs.expenseTaskEl?.addEventListener("change", () => syncExpenseSelectors(refs));
  refs.btnCloseExpenseForm?.addEventListener("click", () => closeExpenseForm(refs));
  refs.btnCancelExpenseForm?.addEventListener("click", () => closeExpenseForm(refs));
  refs.modalExpenseForm?.addEventListener("click", (event) => {
    if (event.target?.dataset?.closeExpenseForm === "true") closeExpenseForm(refs);
  });
  refs.btnSaveExpenseForm?.addEventListener("click", () => {
    saveExpenseForm(deps).catch((err) => {
      console.error(err);
      showExpenseDialog(err?.message || "Não foi possível salvar a despesa. Tente novamente.", {
        title: "Falha ao salvar",
        type: "error"
      });
    });
  });

  refs.btnOpenManualExpense?.addEventListener("click", () => {
    openExpenseForm({ source: "manual" }, deps).catch((err) => {
      console.error(err);
      showExpenseDialog("Não foi possível abrir o formulário de despesa.", {
        title: "Falha ao abrir",
        type: "error"
      });
    });
  });
  const rerenderFromFirstPage = () => {
    _expenseApprovalsPage = 1;
    renderExpenseApprovals(refs, deps);
  };
  refs.expenseApprovalsSearchInput?.addEventListener("input", rerenderFromFirstPage);
  refs.expenseApprovalsProjectFilter?.addEventListener("change", rerenderFromFirstPage);
  refs.expenseApprovalsTypeFilter?.addEventListener("change", rerenderFromFirstPage);
  refs.expenseApprovalsUserFilter?.addEventListener("change", rerenderFromFirstPage);
  refs.expenseApprovalsApproverFilter?.addEventListener("change", rerenderFromFirstPage);
  refs.expenseApprovalsStartDateInput?.addEventListener("change", rerenderFromFirstPage);
  refs.expenseApprovalsEndDateInput?.addEventListener("change", rerenderFromFirstPage);
  refs.expenseApprovalsPagination?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-expense-approvals-page]");
    if (!button) return;
    const direction = button.getAttribute("data-expense-approvals-page");
    _expenseApprovalsPage = direction === "prev" ? Math.max(1, _expenseApprovalsPage - 1) : _expenseApprovalsPage + 1;
    renderExpenseApprovals(refs, deps);
  });

  document.querySelectorAll("[data-expense-status]").forEach((card) => {
    const apply = () => {
      _expenseStatusFilter = card.getAttribute("data-expense-status") || "pending";
      _expenseApprovalsPage = 1;
      renderExpenseApprovals(refs, deps);
    };
    card.addEventListener("click", apply);
    card.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        apply();
      }
    });
  });

  refs.expenseApprovalsList?.addEventListener("click", async (event) => {
    const button = event.target?.closest?.("[data-expense-action]");
    if (!button) return;
    const expenseId = button.getAttribute("data-expense-id");
    const action = button.getAttribute("data-expense-action");
    if (!expenseId || !action) return;
    if (!canApproveExpenses(deps?.state?.profile?.role)) return;

    if (action === "approve") {
      const card = button.closest(".expense-approval-card");
      const selectedCharge = card?.querySelector(`input[name="expense-charge-${expenseId}"]:checked`)?.value || "";
      if (!selectedCharge) {
        await showExpenseDialog("Defina quem assume a despesa antes de concluir a aprovação.", {
          title: "Responsabilidade pendente",
          type: "error"
        });
        return;
      }
      await updateExpenseStatus([expenseId], "approved", deps, "", {
        chargedToClient: selectedCharge === "client"
      });
    } else {
      const reason = (prompt("Informe o motivo da reprovacao (minimo de 10 caracteres):") || "").trim();
      if (reason.length < 10) {
        await showExpenseDialog("Informe um motivo com pelo menos 10 caracteres para reprovar a despesa.", {
          title: "Motivo insuficiente",
          type: "error"
        });
        return;
      }
      await updateExpenseStatus([expenseId], "rejected", deps, reason);
    }
    await loadExpenseApprovals(deps);
  });
}

export async function computeProjectExpenseSummary(db, companyId, projectId) {
  if (!db || !companyId || !projectId) {
    return {
      totalApproved: 0,
      totalPending: 0,
      approvedInternal: 0,
      approvedClient: 0,
      countPending: 0,
      countApproved: 0,
      countRejected: 0
    };
  }
  const snap = await getDocs(query(collection(db, `companies/${companyId}/expenses`), where("projectId", "==", projectId)));
  const items = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const approved = items.filter((item) => String(item.status || "").toLowerCase() === "approved");
  const pending = items.filter((item) => String(item.status || "").toLowerCase() === "pending");
  const rejected = items.filter((item) => String(item.status || "").toLowerCase() === "rejected");
  return {
    totalApproved: approved.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    totalPending: pending.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    approvedInternal: approved.filter((item) => item.chargedToClient !== true).reduce((sum, item) => sum + Number(item.amount || 0), 0),
    approvedClient: approved.filter((item) => item.chargedToClient === true).reduce((sum, item) => sum + Number(item.amount || 0), 0),
    countPending: pending.length,
    countApproved: approved.length,
    countRejected: rejected.length
  };
}
