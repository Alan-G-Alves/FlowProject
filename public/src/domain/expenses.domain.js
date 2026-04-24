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

import { setAlert, clearAlert } from "../ui/alerts.js";
import { escapeHtml, hide, show } from "../utils/dom.js";
import { createNotifications } from "../services/notifications.service.js?v=1776052722";

const EXPENSE_RECEIPT_MAX_SIZE = 8 * 1024 * 1024;

let _bound = false;
let _expenseItemsCache = [];
let _expenseStatusFilter = "pending";
let _expenseFormContext = null;
let _expenseReceiptFile = null;
let _expenseReceiptObjectUrl = "";

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

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function buildExpenseSearchText(item) {
  return normalizeText([
    item.projectName,
    item.taskName,
    item.activityName,
    item.techName,
    item.typeLabel,
    item.observation,
    item.receipt?.name,
    item.amountLabel,
    item.statusLabel
  ].join(" "));
}

function visibleProjectsForRole(projects, role, currentUid) {
  if (role === "admin") return projects;
  if (role === "gestor") return projects.filter((project) => project.managerUid === currentUid);
  if (role === "coordenador") return projects.filter((project) => project.coordinatorUid === currentUid);
  return [];
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

  const [projectsSnap, tasksSnap, activitiesSnap, usersSnap] = await Promise.all([
    getDocs(collection(db, `companies/${companyId}/projects`)),
    getDocs(collection(db, `companies/${companyId}/tasks`)),
    getDocs(collection(db, `companies/${companyId}/activities`)),
    getDocs(collection(db, `companies/${companyId}/users`))
  ]);

  const users = usersSnap.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    return { uid: data.uid || docSnap.id, ...data };
  });

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
    users
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
  const { refs } = deps;
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
  if (refs.expenseProjectEl) refs.expenseProjectEl.disabled = lockContext;
  if (refs.expenseTaskEl) refs.expenseTaskEl.disabled = lockContext;
  if (refs.expenseActivityEl) refs.expenseActivityEl.disabled = lockContext;

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
  const chargedToClient = refs.expenseChargedToClientEl?.checked === true;
  const currentUid = auth?.currentUser?.uid || "";

  if (!projectId) return setAlert(refs.expenseFormAlert, "Selecione o projeto da despesa.", "error");
  if (!type) return setAlert(refs.expenseFormAlert, "Selecione o tipo da despesa.", "error");
  if (!observation || observation.length < 10) return setAlert(refs.expenseFormAlert, "A observacao precisa ter no minimo 10 caracteres.", "error");
  if (!amount || amount <= 0) return setAlert(refs.expenseFormAlert, "Informe um valor valido para a despesa.", "error");
  if (!_expenseReceiptFile) return setAlert(refs.expenseFormAlert, "Selecione o comprovante da despesa.", "error");
  if ((_expenseReceiptFile.size || 0) > EXPENSE_RECEIPT_MAX_SIZE) {
    return setAlert(refs.expenseFormAlert, "O comprovante deve ter no maximo 8MB.", "error");
  }

  const project = (_expenseFormContext.optionsData?.projects || []).find((item) => item.id === projectId) || {};
  const task = ((_expenseFormContext.optionsData?.tasksByProject.get(projectId)) || []).find((item) => item.id === taskId) || {};
  const activity = (((_expenseFormContext.optionsData?.activitiesByTask.get(taskId)) || [])).find((item) => item.id === activityId) || {};
  const role = String(state.profile?.role || "").toLowerCase();

  setAlert(refs.expenseFormAlert, "Salvando despesa e enviando comprovante...", "info");

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

  try {
    const safeName = String(_expenseReceiptFile.name || "comprovante").replace(/[^\w.\-]+/g, "_");
    receiptPath = `expenseReceipts/${state.companyId}/${expenseRef.id}/${Date.now()}_${safeName}`;
    const receiptUrl = await retryUploadReceipt(storage, receiptPath, _expenseReceiptFile);
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

  await recalcProjectExpenseTotals(db, state.companyId, projectId);

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

  closeExpenseForm(refs);
  if (typeof _expenseFormContext?.onSaved === "function") {
    await _expenseFormContext.onSaved();
  }
}

function filteredExpenseItems(refs) {
  const q = normalizeText(refs.expenseApprovalsSearchInput?.value || "");
  const projectId = refs.expenseApprovalsProjectFilter?.value || "";
  const type = refs.expenseApprovalsTypeFilter?.value || "";
  const charge = refs.expenseApprovalsChargeFilter?.value || "";

  return _expenseItemsCache.filter((item) => {
    if (String(item.status || "").toLowerCase() !== _expenseStatusFilter) return false;
    if (projectId && item.projectId !== projectId) return false;
    if (type && item.type !== type) return false;
    if (charge === "client" && item.chargedToClient !== true) return false;
    if (charge === "internal" && item.chargedToClient === true) return false;
    if (q && !buildExpenseSearchText(item).includes(q)) return false;
    return true;
  });
}

function renderExpenseFilters(refs, items) {
  if (!refs.expenseApprovalsProjectFilter) return;
  const current = refs.expenseApprovalsProjectFilter.value || "";
  const projects = Array.from(new Map(items.map((item) => [item.projectId, item.projectName || "Projeto"])).entries())
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  refs.expenseApprovalsProjectFilter.innerHTML = ['<option value="">Todos</option>']
    .concat(projects.map(([id, label]) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`))
    .join("");
  refs.expenseApprovalsProjectFilter.value = projects.some(([id]) => id === current) ? current : "";
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

function renderExpenseList(refs, items) {
  if (!refs.expenseApprovalsList) return;
  refs.expenseApprovalsList.innerHTML = "";

  if (!items.length) {
    show(refs.expenseApprovalsEmpty);
    return;
  }

  hide(refs.expenseApprovalsEmpty);
  refs.expenseApprovalsList.innerHTML = items.map((item) => `
    <article class="expense-approval-card is-${escapeHtml(item.status)}">
      <div class="expense-approval-head">
        <div class="expense-approval-title">
          <div class="expense-approval-kicker">${escapeHtml(item.projectName || "Projeto")}</div>
          <h3>${escapeHtml(item.typeLabel)} • ${escapeHtml(item.techName || "Usuario")}</h3>
          <p class="muted">${escapeHtml(item.taskName || "Sem tarefa")} ${item.activityName ? `• ${escapeHtml(item.activityName)}` : "• Despesa avulsa"}</p>
        </div>
        <div class="expense-approval-actions">
          <span class="expense-badge ${item.chargedToClient ? "client" : "internal"}">${item.chargedToClient ? "Conta do cliente" : "Conta propria"}</span>
          <span class="expense-status-pill ${escapeHtml(item.status)}">${escapeHtml(item.statusLabel)}</span>
          ${item.status === "pending" ? `<button class="btn primary sm" type="button" data-expense-action="approve" data-expense-id="${escapeHtml(item.id)}">Aprovar</button><button class="btn ghost sm" type="button" data-expense-action="reject" data-expense-id="${escapeHtml(item.id)}">Reprovar</button>` : ""}
        </div>
      </div>
      <div class="expense-approval-grid">
        <div class="expense-approval-metric">
          <span>Valor</span>
          <strong>${escapeHtml(item.amountLabel)}</strong>
        </div>
        <div class="expense-approval-metric">
          <span>Data</span>
          <strong>${escapeHtml(item.workDateLabel)}</strong>
        </div>
        <div class="expense-approval-metric">
          <span>Lancada por</span>
          <strong>${escapeHtml(item.createdByName || item.techName || "-")}</strong>
        </div>
        <div class="expense-approval-metric">
          <span>Origem</span>
          <strong>${escapeHtml(item.source === "activity" ? "Atividade" : "Manual")}</strong>
        </div>
      </div>
      <div class="expense-approval-note">${escapeHtml(item.observation || "Sem observacao.")}</div>
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

function renderExpenseApprovals(refs) {
  syncExpenseStatusCards();
  renderExpenseList(refs, filteredExpenseItems(refs));
}

async function updateExpenseStatus(ids, nextStatus, deps, rejectionReason = "") {
  const { db, state, auth } = deps;
  const currentUid = auth?.currentUser?.uid || "";
  const currentName = state.profile?.name || auth?.currentUser?.email || "Gestao";
  const currentEmail = auth?.currentUser?.email || "";

  for (const id of ids) {
    const item = _expenseItemsCache.find((entry) => entry.id === id);
    if (!item) continue;
    const payload = nextStatus === "approved"
      ? {
          status: "approved",
          approvedAt: serverTimestamp(),
          approvedBy: currentUid,
          approvedByName: currentName,
          approvedByEmail: currentEmail,
          rejectedAt: null,
          rejectedBy: "",
          rejectedByName: "",
          rejectionReason: "",
          updatedAt: serverTimestamp(),
          updatedBy: currentUid
        }
      : {
          status: "rejected",
          rejectedAt: serverTimestamp(),
          rejectedBy: currentUid,
          rejectedByName: currentName,
          rejectionReason: rejectionReason,
          approvedAt: null,
          approvedBy: "",
          approvedByName: "",
          approvedByEmail: "",
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
  const { refs, db, state } = deps;
  if (!refs.myActivityExpensesList || !activityContext?.activity?.id || !state.companyId) return;

  refs.myActivityExpensesList.innerHTML = '<div class="my-activity-expenses-empty">Carregando despesas desta atividade...</div>';
  const snap = await getDocs(query(
    collection(db, `companies/${state.companyId}/expenses`),
    where("activityId", "==", activityContext.activity.id)
  ));

  const items = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    });

  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingCount = items.filter((item) => String(item.status || "").toLowerCase() === "pending").length;
  if (refs.myActivityExpenseTotal) refs.myActivityExpenseTotal.textContent = formatCurrencyBRL(total);
  if (refs.myActivityExpensePendingCount) refs.myActivityExpensePendingCount.textContent = String(pendingCount);

  if (!items.length) {
    refs.myActivityExpensesList.innerHTML = '<div class="my-activity-expenses-empty">Nenhuma despesa registrada para esta atividade ainda.</div>';
    return;
  }

  refs.myActivityExpensesList.innerHTML = items.map((item) => `
    <article class="my-activity-expense-item">
      <div class="my-activity-expense-item-head">
        <div class="my-activity-expense-item-title">
          <strong>${escapeHtml(expenseTypeLabel(item.type))}</strong>
          <span class="expense-status-pill ${escapeHtml(String(item.status || "pending").toLowerCase())}">${escapeHtml(expenseStatusLabel(item.status))}</span>
          <span class="expense-badge ${item.chargedToClient ? "client" : "internal"}">${item.chargedToClient ? "Conta do cliente" : "Conta propria"}</span>
        </div>
        <div class="my-activity-expense-item-value">${escapeHtml(formatCurrencyBRL(item.amount || 0))}</div>
      </div>
      <div class="my-activity-expense-item-note">${escapeHtml(truncateText(item.observation || "", 180))}</div>
      <div class="my-activity-expense-item-meta">
        <span class="expense-approval-meta">${escapeHtml(formatDateTimeLabel(item.createdAt))}</span>
        ${item.receipt?.url ? `<a class="btn ghost sm" href="${escapeHtml(item.receipt.url)}" target="_blank" rel="noopener">Abrir comprovante</a>` : ""}
      </div>
    </article>
  `).join("");
}

export async function openActivityExpenseModal(activityContext, deps) {
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
    onSaved: async () => {
      await loadActivityExpenses(activityContext, deps);
    }
  }, deps);
}

export function openExpenseApprovalsView(deps) {
  bindEvents(deps);
  deps.setView("expenseApprovals");
  loadExpenseApprovals(deps).catch((err) => {
    console.error(err);
    alert("Nao foi possivel carregar as despesas.");
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
  if (!companyId || !currentUid) {
    refs.expenseApprovalsList.innerHTML = "";
    show(refs.expenseApprovalsEmpty);
    return;
  }

  const [expensesSnap, projectsSnap] = await Promise.all([
    getDocs(collection(db, `companies/${companyId}/expenses`)),
    getDocs(collection(db, `companies/${companyId}/projects`))
  ]);

  const allProjects = projectsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const visibleProjects = visibleProjectsForRole(allProjects, role, currentUid);
  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));

  _expenseItemsCache = expensesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((item) => visibleProjectIds.has(item.projectId))
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
  renderExpenseApprovals(refs);
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
      setAlert(refs.expenseFormAlert, err?.message || "Nao foi possivel salvar a despesa.", "error");
    });
  });

  refs.btnOpenManualExpense?.addEventListener("click", () => {
    openExpenseForm({ source: "manual" }, deps).catch((err) => {
      console.error(err);
      alert("Nao foi possivel abrir o formulario de despesa.");
    });
  });
  refs.btnReloadExpenseApprovals?.addEventListener("click", () => {
    loadExpenseApprovals(deps).catch((err) => console.error(err));
  });
  refs.expenseApprovalsSearchInput?.addEventListener("input", () => renderExpenseApprovals(refs));
  refs.expenseApprovalsProjectFilter?.addEventListener("change", () => renderExpenseApprovals(refs));
  refs.expenseApprovalsTypeFilter?.addEventListener("change", () => renderExpenseApprovals(refs));
  refs.expenseApprovalsChargeFilter?.addEventListener("change", () => renderExpenseApprovals(refs));

  document.querySelectorAll("[data-expense-status]").forEach((card) => {
    const apply = () => {
      _expenseStatusFilter = card.getAttribute("data-expense-status") || "pending";
      renderExpenseApprovals(refs);
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

    if (action === "approve") {
      await updateExpenseStatus([expenseId], "approved", deps);
    } else {
      const reason = (prompt("Informe o motivo da reprovacao (minimo de 10 caracteres):") || "").trim();
      if (reason.length < 10) return alert("Informe um motivo com pelo menos 10 caracteres.");
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
