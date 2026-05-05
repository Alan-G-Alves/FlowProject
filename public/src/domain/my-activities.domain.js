import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { clearAlert, setAlert } from "../ui/alerts.js";
import { escapeHtml, hide, show } from "../utils/dom.js";
import { createNotifications } from "../services/notifications.service.js?v=1776052722";
import * as expensesDomain from "./expenses.domain.js?v=1777953600";

let _bound = false;
let _currentActivity = null;
let _currentModalMode = "view";
let _myActivitiesCache = [];
let _myActivitiesAllCache = [];
let _myActivitiesStatusFilter = "all";
let _afterModalSave = null;
let _currentState = null;

function getActivityStatusValue(activity) {
  return String(activity?.status || "").toLowerCase();
}

function isApproved(activity) {
  return getActivityStatusValue(activity) === "os_aprovada";
}

function isCompleted(activity) {
  const status = getActivityStatusValue(activity);
  return status === "os_gerada" || status === "os_aprovada";
}

function getActivityNoteMinChars(state) {
  const num = Number(state?.company?.activityNoteMinChars);
  if (!Number.isFinite(num)) return 50;
  return Math.max(0, Math.min(1000, Math.round(num)));
}

function updateMyActivityNoteCounter(refs) {
  if (!refs?.myActivityNoteCounter) return;
  const minChars = getActivityNoteMinChars(_currentState);
  const noteLength = String(refs.myActivityNote?.value || "").trim().length;
  refs.myActivityNoteCounter.textContent = `${noteLength}/${minChars} minimo`;
  refs.myActivityNoteCounter.classList.toggle("is-ready", noteLength >= minChars);
}

function formatHours(value) {
  if (!Number.isFinite(value) || value <= 0) return "0h";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}h` : `${String(rounded).replace(".", ",")}h`;
}

function truncateText(value, max = 180) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}...`;
}

function parseTimeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function updateMyActivityComputedHours(refs) {
  if (!refs?.myActivityComputedHours) return;
  const start = refs.myActivityStartTime?.value || "";
  const end = refs.myActivityEndTime?.value || "";
  const breakTime = refs.myActivityBreakTime?.value || "01:00";
  const total = diffHours(start, end, breakTime);

  refs.myActivityComputedHours.textContent = formatHours(total);
  refs.myActivityComputedHours.classList.toggle("is-over", total > 0 && asNumber(_currentActivity?.activity?.hoursWorked) > 0 && total > asNumber(_currentActivity?.activity?.hoursWorked));
}

function setMyActivityModalError(refs, message) {
  setAlert(refs.myActivityModalAlert, message, "error");
  const body = refs.myActivityModalAlert?.closest?.(".modal-body");
  if (body) body.scrollTo({ top: 0, behavior: "smooth" });
}

function fmtDate(value) {
  if (!value) return "-";
  const raw = String(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function diffHours(startTime, endTime, breakTime = "00:00") {
  if (!startTime || !endTime) return 0;
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  const breakMinutes = parseTimeToMinutes(breakTime);
  if (startMinutes == null || endMinutes == null || breakMinutes == null) return 0;
  if (endMinutes <= startMinutes) return 0;
  const workedMinutes = endMinutes - startMinutes - breakMinutes;
  if (workedMinutes <= 0) return 0;
  return workedMinutes / 60;
}

function isOverdue(activity) {
  const workDate = String(activity?.workDate || "").slice(0, 10);
  if (!workDate || isCompleted(activity)) return false;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return workDate < todayKey;
}

function getStatusMeta(activity) {
  if (isOverdue(activity)) {
    return { label: "Atrasada", cls: "orange", itemCls: "overdue" };
  }
  if (isApproved(activity)) {
    return { label: "OS Aprovada", cls: "green", itemCls: "ok" };
  }
  if (getActivityStatusValue(activity) === "os_gerada") {
    return { label: "OS Enviada", cls: "amber", itemCls: "sent" };
  }
  return { label: "Sem OS", cls: "red", itemCls: "pending" };
}

function buildSearchText(item) {
  const status = getStatusMeta(item.activity).label;
  return normalizeText([
    item.projectName,
    item.clientName,
    item.taskName,
    item.activity.name,
    item.activity.workDate,
    fmtDate(item.activity.workDate),
    status,
    ...(Array.isArray(item.activity.keyUsers) ? item.activity.keyUsers : [])
  ].join(" "));
}

function isWithinActivityPeriod(item, startDate, endDate) {
  const workDate = String(item?.activity?.workDate || "").slice(0, 10);
  if (!workDate) return !startDate && !endDate;
  if (startDate && workDate < startDate) return false;
  if (endDate && workDate > endDate) return false;
  return true;
}

function bindEvents(deps) {
  if (_bound) return;
  _bound = true;
  const { refs } = deps;
  _currentState = deps.state;

  document.querySelectorAll("[data-my-activities-filter]").forEach((card) => {
    const apply = () => {
      const nextFilter = card.getAttribute("data-my-activities-filter") || "all";
      _myActivitiesStatusFilter = nextFilter;
      loadMyActivities(deps).catch((err) => {
        console.error(err);
        alert("Nao foi possivel aplicar o filtro.");
      });
    };

    card.addEventListener("click", apply);
    card.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        apply();
      }
    });
  });

  refs.myActivitiesList?.addEventListener("click", (ev) => {
    const viewBtn = ev.target?.closest?.("[data-view-my-activity]");
    if (viewBtn) {
      openMyActivityModal(viewBtn.getAttribute("data-view-my-activity"), "view", deps);
      return;
    }

    const editBtn = ev.target?.closest?.("[data-edit-my-activity]");
    if (editBtn) {
      openMyActivityModal(editBtn.getAttribute("data-edit-my-activity"), "edit", deps);
    }
  });

  refs.btnCloseMyActivityModal?.addEventListener("click", closeMyActivityModal);
  refs.btnCancelMyActivityModal?.addEventListener("click", closeMyActivityModal);
  refs.btnOpenActivityExpense?.addEventListener("click", () => {
    if (!_currentActivity) return;
    expensesDomain.addActivityExpenseDraft(refs);
  });
  refs.myActivityExpenseDrafts?.addEventListener("click", (ev) => {
    const removeBtn = ev.target?.closest?.("[data-remove-activity-expense-draft]");
    if (!removeBtn) return;
    expensesDomain.removeActivityExpenseDraft(refs, removeBtn.getAttribute("data-remove-activity-expense-draft"));
  });
  refs.myActivityNote?.addEventListener("input", () => updateMyActivityNoteCounter(refs));
  refs.myActivityStartTime?.addEventListener("input", () => updateMyActivityComputedHours(refs));
  refs.myActivityEndTime?.addEventListener("input", () => updateMyActivityComputedHours(refs));
  refs.myActivityBreakTime?.addEventListener("input", () => updateMyActivityComputedHours(refs));
  refs.modalMyActivity?.addEventListener("click", (ev) => {
    if (ev.target?.dataset?.closeMyActivity === "true") closeMyActivityModal();
  });
  refs.btnSaveMyActivityModal?.addEventListener("click", async () => {
    await saveMyActivityModal(deps);
  });
}

function applyStatusFilter(items) {
  switch (_myActivitiesStatusFilter) {
    case "pending":
      return items.filter((item) => !isCompleted(item.activity) && !isOverdue(item.activity));
    case "generated":
      return items.filter((item) => isCompleted(item.activity));
    case "overdue":
      return items.filter((item) => isOverdue(item.activity));
    default:
      return items;
  }
}

function syncSummaryCards() {
  document.querySelectorAll("[data-my-activities-filter]").forEach((card) => {
    const isActive = (card.getAttribute("data-my-activities-filter") || "all") === _myActivitiesStatusFilter;
    card.classList.toggle("is-active", isActive);
    card.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function updateSummary(refs, items) {
  const total = items.length;
  const pending = items.filter((item) => !isCompleted(item.activity) && !isOverdue(item.activity)).length;
  const generated = items.filter((item) => isCompleted(item.activity)).length;
  const overdue = items.filter((item) => isOverdue(item.activity)).length;

  if (refs.myActivitiesTotalCount) refs.myActivitiesTotalCount.textContent = String(total);
  if (refs.myActivitiesPendingCount) refs.myActivitiesPendingCount.textContent = String(pending);
  if (refs.myActivitiesGeneratedCount) refs.myActivitiesGeneratedCount.textContent = String(generated);
  if (refs.myActivitiesOverdueCount) refs.myActivitiesOverdueCount.textContent = String(overdue);
}

function renderMyActivitiesList(refs, items) {
  if (!refs.myActivitiesList) return;
  refs.myActivitiesList.innerHTML = "";

  if (!items.length) {
    show(refs.myActivitiesEmpty);
    return;
  }
  hide(refs.myActivitiesEmpty);

  const projectsMap = new Map();
  for (const item of items) {
    const projectKey = item.projectId || "sem-projeto";
    const taskKey = item.taskId || "sem-tarefa";
    if (!projectsMap.has(projectKey)) {
      projectsMap.set(projectKey, {
        projectId: projectKey,
        projectName: item.projectName,
        tasks: new Map()
      });
    }
    const projectGroup = projectsMap.get(projectKey);
    if (!projectGroup.tasks.has(taskKey)) {
      projectGroup.tasks.set(taskKey, {
        taskId: taskKey,
        taskName: item.taskName,
        activities: []
      });
    }
    projectGroup.tasks.get(taskKey).activities.push(item);
  }

  const projectCards = Array.from(projectsMap.values()).map((projectGroup) => {
    const taskCards = Array.from(projectGroup.tasks.values())
      .sort((a, b) => a.taskName.localeCompare(b.taskName))
      .map((taskGroup) => {
        taskGroup.activities.sort((a, b) => {
          const aOverdue = isOverdue(a.activity) ? 1 : 0;
          const bOverdue = isOverdue(b.activity) ? 1 : 0;
          if (bOverdue !== aOverdue) return bOverdue - aOverdue;
          if ((a.activity.workDate || "") !== (b.activity.workDate || "")) {
            return String(a.activity.workDate || "").localeCompare(String(b.activity.workDate || ""));
          }
          return String(a.activity.name || "").localeCompare(String(b.activity.name || ""));
        });

        const pendingCount = taskGroup.activities.filter((item) => !isCompleted(item.activity) && !isOverdue(item.activity)).length;
        const generatedCount = taskGroup.activities.filter((item) => isCompleted(item.activity)).length;
        const overdueCount = taskGroup.activities.filter((item) => isOverdue(item.activity)).length;

        const activitiesHtml = taskGroup.activities.map((item) => {
          const meta = getStatusMeta(item.activity);
          const notePreview = String(item.activity.note || "").trim();
          const notePreviewShort = truncateText(notePreview, 180);
          return `
            <div class="activity-item ${meta.itemCls}">
              <div class="activity-main">
                <div>
                  <b>${escapeHtml(item.activity.name || "Atividade")}</b>
                  <div class="activity-meta-line">${escapeHtml(fmtDate(item.activity.workDate))} | ${escapeHtml(String(item.activity.hoursWorked || 0))}h previstas</div>
                </div>
                <div class="activity-head-actions">
                  <span class="activity-status ${meta.cls}">${escapeHtml(meta.label)}</span>
                  <div class="activity-action-bar">
                    <button class="icon-btn xs activity-action activity-action-view" data-view-my-activity="${escapeHtml(item.activity.id)}" type="button" title="Visualizar atividade" aria-label="Visualizar atividade">
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M1.5 12s3.8-6.5 10.5-6.5S22.5 12 22.5 12 18.7 18.5 12 18.5 1.5 12 1.5 12Z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.8"/></svg>
                    </button>
                    <button class="icon-btn xs activity-action activity-action-edit" data-edit-my-activity="${escapeHtml(item.activity.id)}" type="button" title="Apontar ou editar atividade" aria-label="Apontar ou editar atividade">
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m12 6 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                    </button>
                  </div>
                </div>
              </div>
              <div class="activity-tags">
                <span class="activity-tag">Projeto: ${escapeHtml(item.projectName)}</span>
                ${item.clientName ? `<span class="activity-tag">Cliente: ${escapeHtml(item.clientName)}</span>` : ""}
                <span class="activity-tag">Key users: ${escapeHtml((Array.isArray(item.activity.keyUsers) && item.activity.keyUsers.length) ? item.activity.keyUsers.join(", ") : "-")}</span>
                <span class="activity-tag">Apontamento: ${escapeHtml(item.activity.startTime && item.activity.endTime ? `${item.activity.startTime} - ${item.activity.endTime}` : "Pendente")}</span>
              </div>
              ${notePreview ? `<div class="my-activities-note-preview" title="${escapeHtml(notePreview)}">${escapeHtml(notePreviewShort)}</div>` : `<div class="my-activities-note-preview muted">Sem observacao registrada.</div>`}
            </div>
          `;
        }).join("");

        return `
          <details class="my-activities-task-card">
            <summary class="my-activities-task-summary">
              <div>
                <div class="my-activities-task-kicker">Tarefa</div>
                <div class="my-activities-task-title">${escapeHtml(taskGroup.taskName)}</div>
                <div class="my-activities-task-subtitle">${escapeHtml(String(taskGroup.activities.length))} atividade(s) vinculada(s)</div>
              </div>
              <div class="my-activities-task-statuses">
                <span class="task-status-pill task-status-pill--pending">Sem OS: <b>${escapeHtml(String(pendingCount))}</b></span>
                <span class="task-status-pill task-status-pill--sent">OS Enviadas: <b>${escapeHtml(String(generatedCount))}</b></span>
                <span class="task-status-pill task-status-pill--overdue">Atrasadas: <b>${escapeHtml(String(overdueCount))}</b></span>
              </div>
            </summary>
            <div class="my-activities-task-list">
              ${activitiesHtml}
            </div>
          </details>
        `;
      }).join("");

    const totalActivities = Array.from(projectGroup.tasks.values()).reduce((acc, task) => acc + task.activities.length, 0);

    return `
      <article class="my-activities-project-card">
        <div class="my-activities-project-head">
          <div>
            <div class="my-activities-project-kicker">Projeto</div>
            <h3>${escapeHtml(projectGroup.projectName)}</h3>
            <p class="muted">${escapeHtml(String(totalActivities))} atividade(s) para acompanhamento tecnico.</p>
          </div>
        </div>
        <div class="my-activities-project-body">
          ${taskCards}
        </div>
      </article>
    `;
  }).join("");

  refs.myActivitiesList.innerHTML = projectCards;
}

function closeMyActivityModal() {
  _currentActivity = null;
  _currentModalMode = "view";
  _afterModalSave = null;
  const modal = document.getElementById("modalMyActivity");
  if (modal) modal.hidden = true;
  const totalEl = document.getElementById("myActivityExpenseTotal");
  const pendingEl = document.getElementById("myActivityExpensePendingCount");
  const listEl = document.getElementById("myActivityExpensesList");
  if (totalEl) totalEl.textContent = "R$ 0,00";
  if (pendingEl) pendingEl.textContent = "0";
  if (listEl) listEl.innerHTML = '<div class="my-activity-expenses-empty">Nenhuma despesa registrada para esta atividade ainda.</div>';
  expensesDomain.resetActivityExpenseDrafts({
    myActivityExpenseComposer: document.getElementById("myActivityExpenseComposer"),
    myActivityExpenseDrafts: document.getElementById("myActivityExpenseDrafts")
  });
}

function openMyActivityModalItem(item, mode, deps, options = {}) {
  const { refs, state } = deps;
  if (!item || !refs.modalMyActivity) return;
  _currentState = state;

  _currentActivity = item;
  _currentModalMode = mode === "edit" ? "edit" : "view";
  _afterModalSave = typeof options.afterSave === "function" ? options.afterSave : null;
  clearAlert(refs.myActivityModalAlert);

  const readOnly = _currentModalMode !== "edit" || isApproved(item.activity);
  const statusMeta = getStatusMeta(item.activity);
  if (refs.myActivityModalTitle) refs.myActivityModalTitle.textContent = readOnly ? "Visualizar atividade" : "Apontar atividade";
  if (refs.myActivityModalSubtitle) refs.myActivityModalSubtitle.textContent = readOnly
    ? "Confira os detalhes completos da atividade."
    : "Preencha seu apontamento. Ao salvar, a atividade vai para OS Enviada e segue para aprovacao do gestor.";

  if (refs.myActivityProject) refs.myActivityProject.textContent = item.projectName || "-";
  if (refs.myActivityClient) refs.myActivityClient.textContent = item.clientName || "-";
  if (refs.myActivityTask) refs.myActivityTask.textContent = item.taskName || "-";
  if (refs.myActivityName) refs.myActivityName.textContent = item.activity.name || "Atividade";
  if (refs.myActivityDate) refs.myActivityDate.textContent = fmtDate(item.activity.workDate);
  if (refs.myActivityHours) refs.myActivityHours.textContent = `${item.activity.hoursWorked || 0}h`;
  if (refs.myActivityStatusBadge) {
    refs.myActivityStatusBadge.textContent = statusMeta.label;
    refs.myActivityStatusBadge.className = `my-activity-status-badge my-activity-status-badge--${statusMeta.itemCls}`;
  }
  if (refs.myActivityStartTime) refs.myActivityStartTime.value = item.activity.startTime || "";
  if (refs.myActivityEndTime) refs.myActivityEndTime.value = item.activity.endTime || "";
  if (refs.myActivityBreakTime) refs.myActivityBreakTime.value = item.activity.breakTime || "01:00";
  if (refs.myActivityKeyUsers) refs.myActivityKeyUsers.textContent = Array.isArray(item.activity.keyUsers) && item.activity.keyUsers.length
    ? item.activity.keyUsers.join(", ")
    : "-";
  if (refs.myActivityNote) refs.myActivityNote.value = item.activity.note || "";
  const minChars = getActivityNoteMinChars(state);
  if (refs.myActivityNote) {
    refs.myActivityNote.placeholder = minChars > 0
      ? `Descreva o que foi realizado, dificuldades, resultado, validacoes feitas e qualquer contexto importante. Minimo de ${minChars} caracteres.`
      : "Descreva o que foi realizado, dificuldades, resultado, validacoes feitas e qualquer contexto importante.";
  }

  if (refs.myActivityStartTime) refs.myActivityStartTime.disabled = readOnly;
  if (refs.myActivityEndTime) refs.myActivityEndTime.disabled = readOnly;
  if (refs.myActivityBreakTime) refs.myActivityBreakTime.disabled = readOnly;
  if (refs.myActivityNote) refs.myActivityNote.disabled = readOnly;
  if (refs.myActivityTip) {
    refs.myActivityTip.textContent = readOnly
      ? (isApproved(item.activity) ? "Esta atividade ja foi aprovada pela gestao e esta apenas para consulta." : "Visualizacao somente leitura do apontamento e do contexto da atividade.")
      : "Preencha inicio, fim e uma observacao completa para enviar ao gestor.";
  }
  if (refs.btnSaveMyActivityModal) refs.btnSaveMyActivityModal.hidden = readOnly;
  if (refs.btnCancelMyActivityModal) {
    refs.btnCancelMyActivityModal.textContent = readOnly ? "Fechar" : "Cancelar";
    refs.btnCancelMyActivityModal.hidden = !readOnly;
  }
  if (refs.btnOpenActivityExpense) refs.btnOpenActivityExpense.hidden = readOnly;
  expensesDomain.resetActivityExpenseDrafts(refs);
  updateMyActivityNoteCounter(refs);
  updateMyActivityComputedHours(refs);

  refs.modalMyActivity.hidden = false;
  expensesDomain.loadActivityExpenses(item, deps).catch((err) => {
    console.error(err);
    if (refs.myActivityExpensesList) {
      refs.myActivityExpensesList.innerHTML = '<div class="my-activity-expenses-empty">Nao foi possivel carregar as despesas desta atividade.</div>';
    }
  });
}

function openMyActivityModal(activityId, mode, deps) {
  const item = _myActivitiesCache.find((entry) => entry.activity.id === activityId);
  openMyActivityModalItem(item, mode, deps);
}

export function openMyActivityModalForItem(item, mode, deps, options = {}) {
  bindEvents(deps);
  openMyActivityModalItem(item, mode, deps, options);
}

async function saveMyActivityModal(deps) {
  const { refs, state, db, auth } = deps;
  if (!_currentActivity) return;

  clearAlert(refs.myActivityModalAlert);

  if (state.companyId) {
    try {
      const companySnap = await getDoc(doc(db, "companies", state.companyId));
      if (companySnap.exists()) state.company = { id: companySnap.id, ...companySnap.data() };
    } catch (err) {
      console.warn("[my-activities:company-settings]", err);
    }
  }

  const start = refs.myActivityStartTime?.value || "";
  const end = refs.myActivityEndTime?.value || "";
  const breakTime = refs.myActivityBreakTime?.value || "01:00";
  const note = (refs.myActivityNote?.value || "").trim();
  const minChars = getActivityNoteMinChars(state);
  const hoursDiff = diffHours(start, end, breakTime);
  const maxHours = asNumber(_currentActivity.activity.hoursWorked);
  const currentUid = auth?.currentUser?.uid || "";
  const isAssigned = Array.isArray(_currentActivity.activity.techUids) && _currentActivity.activity.techUids.includes(currentUid);

  if (!isAssigned) {
    setMyActivityModalError(refs, "Esta atividade nao esta vinculada ao tecnico logado.");
    return;
  }
  if (hoursDiff <= 0) {
    setMyActivityModalError(refs, "Informe hora inicio e fim validas.");
    return;
  }
  if (hoursDiff > maxHours) {
    setMyActivityModalError(refs, `O apontamento nao pode ultrapassar ${maxHours}h previstas para a atividade.`);
    return;
  }
  if (note.length < minChars) {
    setMyActivityModalError(refs, `A observacao precisa ter no minimo ${minChars} caracteres.`);
    return;
  }

  let expenseDrafts = [];
  try {
    expenseDrafts = expensesDomain.validateActivityExpenseDrafts(refs, state);
  } catch (err) {
    setMyActivityModalError(refs, err?.message || "Revise as despesas adicionadas.");
    return;
  }

  const saveButton = refs.btnSaveMyActivityModal;
  const originalSaveLabel = saveButton?.textContent || "Salvar apontamento";
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = expenseDrafts.length ? "Salvando apontamento e despesas..." : "Salvando apontamento...";
  }

  try {
    await updateDoc(doc(db, `companies/${state.companyId}/activities`, _currentActivity.activity.id), {
      startTime: start,
      endTime: end,
      breakTime,
      workedHours: hoursDiff,
      note,
      status: "os_gerada",
      techFilledAt: serverTimestamp(),
      techFilledBy: currentUid,
      updatedAt: serverTimestamp(),
      updatedBy: currentUid
    });

    if (expenseDrafts.length) {
      await expensesDomain.saveActivityExpenseDrafts(_currentActivity, deps, expenseDrafts);
    }

    await createNotifications(db, state.companyId, [_currentActivity.managerUid, _currentActivity.coordinatorUid], {
      type: "os_submitted",
      title: "OS enviada para aprovacao",
      message: `${state.profile?.name || "Tecnico"} enviou apontamento em ${_currentActivity.projectName || "um projeto"}.`,
      entityType: "activity",
      entityId: _currentActivity.activity.id,
      activityId: _currentActivity.activity.id,
      projectId: _currentActivity.projectId || "",
      taskId: _currentActivity.taskId || "",
      createdBy: currentUid,
      createdByName: state.profile?.name || "",
      createdByEmail: auth?.currentUser?.email || ""
    }).catch((err) => console.warn("[notifications:os-submitted]", err));

    const afterSave = _afterModalSave;
    closeMyActivityModal();
    if (afterSave) {
      await afterSave();
    } else {
      await loadMyActivities(deps);
    }
  } catch (err) {
    console.error(err);
    setMyActivityModalError(refs, err?.message || "Nao foi possivel salvar o apontamento. Tente novamente.");
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = originalSaveLabel;
    }
  }
}

export function openMyActivitiesView(deps) {
  const { setView } = deps;
  bindEvents(deps);
  setView("myActivities");
  loadMyActivities(deps).catch((err) => {
    console.error(err);
    alert("Nao foi possivel carregar suas atividades.");
  });
}

export async function loadMyActivities(deps) {
  const { refs, state, db, auth } = deps;
  if (!refs.myActivitiesList) return;

  bindEvents(deps);
  refs.myActivitiesList.innerHTML = '<div class="panel subtle"><p class="muted">Carregando atividades...</p></div>';
  hide(refs.myActivitiesEmpty);

  const companyId = state.companyId;
  const currentUid = auth?.currentUser?.uid || "";
  if (!companyId || !currentUid) {
    refs.myActivitiesList.innerHTML = "";
    show(refs.myActivitiesEmpty);
    return;
  }

  const activitiesSnap = await getDocs(query(
    collection(db, `companies/${companyId}/activities`),
    where("techUids", "array-contains", currentUid)
  ));

  const allActivities = activitiesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

  const projectsSnap = await getDocs(collection(db, `companies/${companyId}/projects`));
  const tasksSnap = await getDocs(collection(db, `companies/${companyId}/tasks`));
  const projectsById = new Map(projectsSnap.docs.map((docSnap) => [docSnap.id, { id: docSnap.id, ...docSnap.data() }]));
  const tasksById = new Map(tasksSnap.docs.map((docSnap) => [docSnap.id, { id: docSnap.id, ...docSnap.data() }]));

  const enriched = allActivities.map((activity) => {
    const project = projectsById.get(activity.projectId) || null;
    const task = tasksById.get(activity.taskId) || null;
    return {
      activity,
      projectId: activity.projectId || project?.id || "",
      projectName: project?.name || activity.projectName || "Projeto sem nome",
      managerUid: project?.managerUid || "",
      coordinatorUid: project?.coordinatorUid || "",
      clientName: project?.clientName || project?.client?.name || activity.clientName || "",
      taskId: activity.taskId || task?.id || "",
      taskName: task?.name || activity.taskName || "Tarefa sem nome"
    };
  });

  const queryText = normalizeText(refs.myActivitiesSearchInput?.value || "");
  let periodStart = String(refs.myActivitiesStartDateInput?.value || "").slice(0, 10);
  let periodEnd = String(refs.myActivitiesEndDateInput?.value || "").slice(0, 10);
  if (periodStart && periodEnd && periodStart > periodEnd) {
    [periodStart, periodEnd] = [periodEnd, periodStart];
  }
  const filtered = enriched.filter((item) => {
    if (queryText && !buildSearchText(item).includes(queryText)) return false;
    if (!isWithinActivityPeriod(item, periodStart, periodEnd)) return false;
    return true;
  });
  const statusFiltered = applyStatusFilter(filtered);

  statusFiltered.sort((a, b) => {
    if (a.projectName !== b.projectName) return a.projectName.localeCompare(b.projectName);
    if (a.taskName !== b.taskName) return a.taskName.localeCompare(b.taskName);
    const aOverdue = isOverdue(a.activity) ? 1 : 0;
    const bOverdue = isOverdue(b.activity) ? 1 : 0;
    if (bOverdue !== aOverdue) return bOverdue - aOverdue;
    return String(a.activity.workDate || "").localeCompare(String(b.activity.workDate || ""));
  });

  _myActivitiesAllCache = enriched;
  _myActivitiesCache = statusFiltered;
  updateSummary(refs, enriched);
  syncSummaryCards();
  renderMyActivitiesList(refs, statusFiltered);
}
