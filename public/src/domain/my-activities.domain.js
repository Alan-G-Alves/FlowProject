import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { clearAlert, setAlert } from "../ui/alerts.js";
import { escapeHtml, hide, show } from "../utils/dom.js";
import { createNotifications } from "../services/notifications.service.js?v=1776052722";
import * as expensesDomain from "./expenses.domain.js?v=1779741200";

let _bound = false;
let _currentActivity = null;
let _currentModalMode = "view";
let _myActivitiesCache = [];
let _myActivitiesAllCache = [];
let _myExpensesCache = [];
let _myExpensesStatusFilter = "pending";
let _myActivitiesStatusFilter = "all";
let _afterModalSave = null;
let _currentState = null;
let _manualProjects = [];
let _manualTasks = [];
let _manualActivities = [];
let _manualClients = [];

const MANUAL_ACTIVITY_CHIP_COLORS = ["t1", "t2", "t3", "t4", "t5", "t6"];

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

function canTechRescheduleActivity(state) {
  return state?.company?.allowTechActivityReschedule === true;
}

function activityTechUid(activity, fallbackUid = "") {
  const techUids = Array.isArray(activity?.techUids) ? activity.techUids.filter(Boolean) : [];
  return techUids.includes(fallbackUid) ? fallbackUid : (techUids[0] || fallbackUid || "");
}

function activityGroupKey(activity, fallbackUid = "") {
  const scheduleGroupId = String(activity?.scheduleGroupId || "").trim();
  if (scheduleGroupId) return `group:${scheduleGroupId}`;
  return [
    String(activity?.projectId || "").trim(),
    String(activity?.taskId || "").trim(),
    normalizeText(activity?.name || ""),
    activityTechUid(activity, fallbackUid)
  ].join("::");
}

function sameActivityGroup(activity, targetActivity, fallbackUid = "") {
  if (!activity || !targetActivity) return false;
  if (!Array.isArray(activity.techUids) || !activity.techUids.includes(fallbackUid)) return false;
  return activityGroupKey(activity, fallbackUid) === activityGroupKey(targetActivity, fallbackUid);
}

function effectiveActivityCapacityHours(activity) {
  const planned = asNumber(activity?.hoursWorked);
  const pointed = asNumber(activity?.workedHours);
  return Math.max(planned, pointed);
}

function summarizeActivityGroup(activities, targetActivity, currentUid, excludeActivityId = "") {
  const groupActivities = (Array.isArray(activities) ? activities : [])
    .filter((activity) => sameActivityGroup(activity, targetActivity, currentUid));
  const plannedHours = groupActivities.reduce((sum, activity) => sum + effectiveActivityCapacityHours(activity), 0);
  const pointedHours = groupActivities
    .filter((activity) => activity.id !== excludeActivityId)
    .reduce((sum, activity) => sum + asNumber(activity.workedHours), 0);
  return { plannedHours, pointedHours, remainingHours: Math.max(0, plannedHours - pointedHours) };
}

async function loadActivityGroupActivities(deps, currentUid) {
  const { db, state } = deps;
  const companyId = state.companyId;
  if (!companyId || !currentUid) return [];
  try {
    const snap = await getDocs(query(
      collection(db, `companies/${companyId}/activities`),
      where("techUids", "array-contains", currentUid)
    ));
    return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  } catch (err) {
    console.warn("[my-activities:group-hours]", err);
    return _myActivitiesAllCache.map((item) => item.activity).filter(Boolean);
  }
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
  const allowReschedule = canTechRescheduleActivity(_currentState);
  const currentUid = _currentState?.authUid || "";
  const cacheSummary = allowReschedule && _currentActivity
    ? summarizeActivityGroup(_myActivitiesAllCache.map((item) => item.activity).filter(Boolean), _currentActivity.activity, currentUid, _currentActivity.activity.id)
    : null;
  const maxAllowed = allowReschedule && cacheSummary?.plannedHours > 0
    ? cacheSummary.remainingHours
    : asNumber(_currentActivity?.activity?.hoursWorked);

  refs.myActivityComputedHours.textContent = formatHours(total);
  refs.myActivityComputedHours.classList.toggle("is-over", total > 0 && maxAllowed > 0 && total > maxAllowed);
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

function activityScheduleInfo(activity) {
  const initialDate = String(activity?.originalWorkDate || activity?.plannedWorkDate || activity?.workDate || "").slice(0, 10);
  const initialHours = asNumber(activity?.originalHoursWorked ?? activity?.hoursWorked);
  const pointedDate = String(activity?.workDate || "").slice(0, 10);
  const pointedHours = asNumber(activity?.workedHours) || diffHours(activity?.startTime || "", activity?.endTime || "", activity?.breakTime || "01:00");
  const hasPointing = pointedHours > 0 || Boolean(activity?.startTime && activity?.endTime);
  const hasRemanage = Boolean(
    hasPointing
    && (
      (initialDate && pointedDate && initialDate !== pointedDate)
      || (initialHours > 0 && pointedHours > 0 && Math.abs(initialHours - pointedHours) > 0.0001)
    )
  );
  return { initialDate, initialHours, pointedDate, pointedHours, hasPointing, hasRemanage };
}

function activityScheduleMetaHtml(activity) {
  const info = activityScheduleInfo(activity);
  if (!info.hasPointing) {
    return `<div class="activity-meta-line"><span class="activity-meta-label">Previsto inicial:</span> <span class="activity-date">${escapeHtml(fmtDate(info.initialDate))}</span> | <span class="activity-hours">${escapeHtml(formatHours(info.initialHours))}</span></div>`;
  }
  return `
    <div class="activity-meta-stack">
      <div class="activity-meta-line"><span class="activity-meta-label">Previsto inicial:</span> <span class="activity-date">${escapeHtml(fmtDate(info.initialDate))}</span> | <span class="activity-hours">${escapeHtml(formatHours(info.initialHours))}</span></div>
      <div class="activity-meta-line ${info.hasRemanage ? "is-remanaged" : ""}"><span class="activity-meta-label">Apontado:</span> <span class="activity-date">${escapeHtml(fmtDate(info.pointedDate))}</span> | <span class="activity-hours">${escapeHtml(formatHours(info.pointedHours))}</span></div>
    </div>
  `;
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

function expenseTypeLabel(type) {
  const map = {
    alimentacao: "Alimentacao",
    trajeto: "Trajeto",
    estadia: "Estadia",
    outras: "Outras"
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

function formatCurrencyBRL(value) {
  const num = Number(value || 0);
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTimeLabel(value) {
  if (!value) return "-";
  try {
    if (value?.toDate) return value.toDate().toLocaleString("pt-BR");
  } catch (_) {}
  return String(value || "-");
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

function buildExpenseSearchText(item) {
  return normalizeText([
    item.projectName,
    item.clientName,
    item.taskName,
    item.activityName,
    item.type,
    expenseTypeLabel(item.type),
    item.status,
    expenseStatusLabel(item.status),
    item.observation,
    item.receipt?.name,
    item.workDate,
    fmtDate(item.workDate)
  ].join(" "));
}

function isWithinActivityPeriod(item, startDate, endDate) {
  const workDate = String(item?.activity?.workDate || "").slice(0, 10);
  if (!workDate) return !startDate && !endDate;
  if (startDate && workDate < startDate) return false;
  if (endDate && workDate > endDate) return false;
  return true;
}

function isWithinExpensePeriod(item, startDate, endDate) {
  const workDate = String(item?.workDate || "").slice(0, 10);
  if (!workDate) return !startDate && !endDate;
  if (startDate && workDate < startDate) return false;
  if (endDate && workDate > endDate) return false;
  return true;
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateOnly(value) {
  const raw = String(value || "").slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isDateInsideRange(date, startDate, endDate) {
  const current = parseDateOnly(date);
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!current || !start || !end) return false;
  return current >= start && current <= end;
}

function selectedManualKeyUsers(refs) {
  const raw = refs.manualActivitySelectedKeyUsers?.value || "[]";
  try {
    const parsed = JSON.parse(raw);
    return (Array.isArray(parsed) ? parsed : []).map((item) => item?.value).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function getManualKeyUserSelections(refs) {
  const raw = refs.manualActivitySelectedKeyUsers?.value || "[]";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function setManualKeyUserSelections(refs, items) {
  if (refs.manualActivitySelectedKeyUsers) {
    refs.manualActivitySelectedKeyUsers.value = JSON.stringify(Array.isArray(items) ? items : []);
  }
}

function renderManualKeyUserChips(refs) {
  if (!refs.manualActivityKeyUsersChips) return;
  const items = getManualKeyUserSelections(refs);
  if (!items.length) {
    refs.manualActivityKeyUsersChips.innerHTML = '<span class="muted">Nenhum selecionado.</span>';
    return;
  }
  refs.manualActivityKeyUsersChips.innerHTML = items.map((item, idx) => `
    <span class="chip project-tech-chip ${MANUAL_ACTIVITY_CHIP_COLORS[idx % MANUAL_ACTIVITY_CHIP_COLORS.length]}">
      <span>${escapeHtml(item.label || item.value)}</span>
      <button
        type="button"
        class="project-tech-chip-remove"
        data-remove-manual-keyuser="${escapeHtml(item.value)}"
        aria-label="Remover key user"
      >x</button>
    </span>
  `).join("");
}

function addManualKeyUserSelection(refs, value, label) {
  if (!value) return;
  const current = getManualKeyUserSelections(refs);
  if (current.some((item) => item?.value === value)) return;
  setManualKeyUserSelections(refs, [...current, { value, label: label || value }]);
  renderManualKeyUserChips(refs);
}

function removeManualKeyUserSelection(refs, value) {
  setManualKeyUserSelections(refs, getManualKeyUserSelections(refs).filter((item) => item?.value !== value));
  renderManualKeyUserChips(refs);
}

function keyUsersForProject(project) {
  const clientId = project?.clientId || "";
  const client = _manualClients.find((item) => item.id === clientId) || null;
  if (!client) return [];
  if (Array.isArray(client.keyUsers) && client.keyUsers.length) {
    return client.keyUsers.filter(Boolean).map((item) => ({
      label: item.name || item.email || item.phone || "Key user",
      value: item.name || item.email || item.phone || "Key user"
    }));
  }
  const legacy = client.keyUserName || client.keyUserEmail || client.keyUserPhone || "";
  return legacy ? [{ label: legacy, value: legacy }] : [];
}

function taskHoursInfo(taskId) {
  const task = _manualTasks.find((item) => item.id === taskId) || null;
  const plannedHours = asNumber(task?.plannedHours);
  const usedHours = _manualActivities
    .filter((activity) => activity.taskId === taskId)
    .reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  return {
    plannedHours,
    usedHours,
    availableHours: Math.max(0, plannedHours - usedHours)
  };
}

function projectHoursInfo(projectId) {
  const project = _manualProjects.find((item) => item.id === projectId) || null;
  const plannedHours = asNumber(project?.billingHours);
  const usedHours = _manualActivities
    .filter((activity) => activity.projectId === projectId)
    .reduce((acc, activity) => acc + asNumber(activity.hoursWorked), 0);
  return {
    plannedHours,
    usedHours,
    availableHours: Math.max(0, plannedHours - usedHours)
  };
}

function updateManualActivityNoteCounter(refs, state) {
  if (!refs?.manualActivityNoteCounter) return;
  const minChars = getActivityNoteMinChars(state);
  const noteLength = String(refs.manualActivityNote?.value || "").trim().length;
  refs.manualActivityNoteCounter.textContent = `${noteLength}/${minChars} minimo`;
  refs.manualActivityNoteCounter.classList.toggle("is-ready", noteLength >= minChars || noteLength === 0);
}

function updateManualActivityAvailabilityHint(refs) {
  if (!refs?.manualActivityAvailabilityHint) return;
  const projectId = refs.manualActivityProject?.value || "";
  const taskId = refs.manualActivityTask?.value || "";
  if (!projectId || !taskId) {
    refs.manualActivityAvailabilityHint.textContent = "Selecione projeto e tarefa para consultar o saldo.";
    return;
  }
  const projectInfo = projectHoursInfo(projectId);
  const taskInfo = taskHoursInfo(taskId);
  const projectText = projectInfo.plannedHours > 0
    ? `Projeto: ${formatHours(projectInfo.availableHours)} disponiveis`
    : "Projeto: sem limite de horas";
  const taskText = taskInfo.plannedHours > 0
    ? `Tarefa: ${formatHours(taskInfo.availableHours)} disponiveis`
    : "Tarefa: sem limite de horas";
  refs.manualActivityAvailabilityHint.textContent = `${projectText}. ${taskText}.`;
}

function populateManualActivityTasks(refs) {
  const projectId = refs.manualActivityProject?.value || "";
  const tasks = _manualTasks
    .filter((task) => task.projectId === projectId)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  if (refs.manualActivityTask) {
    refs.manualActivityTask.innerHTML = '<option value="">Selecione uma tarefa</option>' +
      tasks.map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.name || "Tarefa")}</option>`).join("");
  }

  const project = _manualProjects.find((item) => item.id === projectId) || null;
  const keyUsers = keyUsersForProject(project);
  if (refs.manualActivityKeyUsers) {
    refs.manualActivityKeyUsers.innerHTML = keyUsers.length
      ? '<option value="">Selecione um key user</option>' + keyUsers.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("")
      : '<option value="">Nenhum key user vinculado ao cliente do projeto</option>';
  }
  setManualKeyUserSelections(refs, []);
  renderManualKeyUserChips(refs);
  updateManualActivityAvailabilityHint(refs);
}

function clearManualActivityForm(refs, state) {
  clearAlert(refs.manualActivityAlert);
  if (refs.manualActivityProject) refs.manualActivityProject.value = "";
  if (refs.manualActivityTask) refs.manualActivityTask.innerHTML = '<option value="">Selecione uma tarefa</option>';
  if (refs.manualActivityName) refs.manualActivityName.value = "";
  if (refs.manualActivityDate) refs.manualActivityDate.value = todayKey();
  if (refs.manualActivityHours) refs.manualActivityHours.value = "";
  if (refs.manualActivityKeyUsers) refs.manualActivityKeyUsers.innerHTML = "";
  setManualKeyUserSelections(refs, []);
  renderManualKeyUserChips(refs);
  if (refs.manualActivityNote) refs.manualActivityNote.value = "";
  updateManualActivityNoteCounter(refs, state);
  updateManualActivityAvailabilityHint(refs);
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
    const expenseFilterCard = ev.target?.closest?.("[data-my-expenses-filter]");
    if (expenseFilterCard) {
      _myExpensesStatusFilter = expenseFilterCard.getAttribute("data-my-expenses-filter") || "pending";
      loadMyActivities(deps).catch((err) => {
        console.error(err);
        alert("Nao foi possivel aplicar o filtro de despesas.");
      });
      return;
    }

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

  refs.myActivitiesList?.addEventListener("keydown", (ev) => {
    const expenseFilterCard = ev.target?.closest?.("[data-my-expenses-filter]");
    if (!expenseFilterCard || (ev.key !== "Enter" && ev.key !== " ")) return;
    ev.preventDefault();
    _myExpensesStatusFilter = expenseFilterCard.getAttribute("data-my-expenses-filter") || "pending";
    loadMyActivities(deps).catch((err) => {
      console.error(err);
      alert("Nao foi possivel aplicar o filtro de despesas.");
    });
  });

  refs.btnOpenManualActivity?.addEventListener("click", () => {
    openManualActivityModal(deps).catch((err) => {
      console.error(err);
      alert("Nao foi possivel abrir a inclusao manual de atividade.");
    });
  });
  refs.btnCloseManualActivityModal?.addEventListener("click", () => closeManualActivityModal(refs));
  refs.btnCancelManualActivityModal?.addEventListener("click", () => closeManualActivityModal(refs));
  refs.modalManualActivity?.addEventListener("click", (ev) => {
    if (ev.target?.dataset?.closeManualActivity === "true") closeManualActivityModal(refs);
  });
  refs.manualActivityProject?.addEventListener("change", () => populateManualActivityTasks(refs));
  refs.manualActivityTask?.addEventListener("change", () => updateManualActivityAvailabilityHint(refs));
  refs.manualActivityKeyUsers?.addEventListener("change", () => {
    const select = refs.manualActivityKeyUsers;
    const value = select?.value || "";
    const label = select?.options?.[select.selectedIndex]?.textContent?.trim() || value;
    if (value) addManualKeyUserSelection(refs, value, label);
    if (select) select.value = "";
  });
  refs.manualActivityKeyUsersChips?.addEventListener("click", (ev) => {
    const removeBtn = ev.target?.closest?.("[data-remove-manual-keyuser]");
    if (!removeBtn) return;
    removeManualKeyUserSelection(refs, removeBtn.getAttribute("data-remove-manual-keyuser"));
  });
  refs.manualActivityHours?.addEventListener("input", () => updateManualActivityAvailabilityHint(refs));
  refs.manualActivityNote?.addEventListener("input", () => updateManualActivityNoteCounter(refs, deps.state));
  refs.btnSaveManualActivity?.addEventListener("click", async () => {
    await saveManualActivity(deps);
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

function syncMyActivitiesShell(refs) {
  const expensesMode = _myActivitiesStatusFilter === "expenses";
  const view = refs.viewMyActivities || document.getElementById("viewMyActivities");
  const title = view?.querySelector?.(".page-header h1");
  const subtitle = view?.querySelector?.(".page-header .muted");
  const searchLabel = refs.myActivitiesSearchInput?.closest?.(".field")?.querySelector?.("span");
  const summary = view?.querySelector?.(".my-activities-summary");

  view?.classList?.toggle?.("is-my-expenses-view", expensesMode);
  if (title) title.textContent = expensesMode ? "Despesas" : "Minhas Atividades";
  if (subtitle) {
    subtitle.textContent = expensesMode
      ? "Acompanhe suas despesas pendentes, aprovadas e reprovadas."
      : "Organize seus apontamentos por tarefa e envie tudo com contexto para aprovacao do gestor.";
  }
  if (searchLabel) searchLabel.textContent = expensesMode ? "Buscar despesa" : "Buscar atividade";
  if (refs.myActivitiesSearchInput) {
    refs.myActivitiesSearchInput.placeholder = expensesMode
      ? "Projeto, tarefa, observacao, valor ou comprovante"
      : "Projeto, tarefa, atividade, data ou status";
  }
  if (summary) summary.hidden = expensesMode;
  if (refs.btnOpenManualActivity) refs.btnOpenManualActivity.hidden = expensesMode;
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

function renderMyExpensesList(refs, items) {
  if (!refs.myActivitiesList) return;
  refs.myActivitiesList.innerHTML = "";
  hide(refs.myActivitiesEmpty);

  const normalizedStatus = (status) => String(status || "pending").toLowerCase();
  const statusItems = {
    pending: items.filter((item) => normalizedStatus(item.status) === "pending"),
    approved: items.filter((item) => normalizedStatus(item.status) === "approved"),
    rejected: items.filter((item) => normalizedStatus(item.status) === "rejected")
  };
  const statusMeta = [
    { key: "pending", label: "Pendentes", desc: "Despesas aguardando aprovacao.", cls: "pending" },
    { key: "approved", label: "Aprovadas", desc: "Despesas ja validadas.", cls: "approved" },
    { key: "rejected", label: "Reprovadas", desc: "Despesas devolvidas ou recusadas.", cls: "rejected" }
  ];
  if (!statusMeta.some((meta) => meta.key === _myExpensesStatusFilter)) _myExpensesStatusFilter = "pending";
  const visibleItems = statusItems[_myExpensesStatusFilter] || [];

  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const emptyLabel = {
    pending: "pendente",
    approved: "aprovada",
    rejected: "reprovada"
  };

  refs.myActivitiesList.innerHTML = `
    <section class="my-activities-expenses-view">
      <div class="my-activities-expenses-head">
        <div>
          <div class="my-activities-project-kicker">Despesas</div>
          <h3>Minhas despesas</h3>
          <p class="muted">Somente despesas registradas pelo tecnico logado.</p>
        </div>
        <div class="my-activities-expenses-total">${escapeHtml(formatCurrencyBRL(total))}</div>
      </div>
      <div class="my-activities-expenses-summary">
        ${statusMeta.map((meta) => {
          const statusTotal = statusItems[meta.key].reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const isActive = meta.key === _myExpensesStatusFilter;
          return `
            <article class="my-activities-expense-stat is-${escapeHtml(meta.cls)} ${isActive ? "is-active" : ""}" data-my-expenses-filter="${escapeHtml(meta.key)}" role="button" tabindex="0" aria-pressed="${isActive ? "true" : "false"}">
              <span class="my-activities-stat-label">${escapeHtml(meta.label)}</span>
              <strong>${escapeHtml(String(statusItems[meta.key].length))}</strong>
              <div class="my-activities-expense-value">${escapeHtml(formatCurrencyBRL(statusTotal))}</div>
              <p class="muted">${escapeHtml(meta.desc)}</p>
            </article>
          `;
        }).join("")}
      </div>
      <div class="expense-approvals-list my-activities-expenses-list">
        ${visibleItems.length ? visibleItems.map((item) => `
          <article class="expense-approval-card my-activity-expense-card is-${escapeHtml(String(item.status || "pending").toLowerCase())}">
            <div class="expense-approval-head">
              <div class="expense-approval-title">
                <div class="expense-approval-kicker">${escapeHtml(item.projectName || "Projeto")}</div>
                <h3><span class="expense-approval-type">${escapeHtml(expenseTypeLabel(item.type))}</span> <span>| ${escapeHtml(formatCurrencyBRL(item.amount || 0))}</span></h3>
                ${item.clientName ? `<p class="expense-approval-client">Cliente: ${escapeHtml(item.clientName)}</p>` : ""}
                <p class="muted">${escapeHtml(item.taskName || "Sem tarefa")} ${item.activityName ? `| ${escapeHtml(item.activityName)}` : "| Despesa avulsa"}</p>
              </div>
              <div class="expense-approval-actions">
                <span class="expense-status-pill ${escapeHtml(String(item.status || "pending").toLowerCase())}">${escapeHtml(expenseStatusLabel(item.status))}</span>
              </div>
            </div>
            <div class="expense-approval-compact-meta">
              <strong>${escapeHtml(formatCurrencyBRL(item.amount || 0))}</strong>
              <span>${escapeHtml(fmtDate(item.workDate))}</span>
              <span>${escapeHtml(item.source === "activity" ? "Atividade" : "Manual")}</span>
              <span>${escapeHtml(formatDateTimeLabel(item.createdAt))}</span>
            </div>
            <div class="expense-approval-note">${escapeHtml(truncateText(item.observation || "Sem observacao.", 160))}</div>
            ${item.rejectionReason ? `<div class="expense-approval-reason"><strong>Motivo da reprovacao:</strong><br>${escapeHtml(item.rejectionReason)}</div>` : ""}
            <div class="expense-approval-footer">
              <div class="expense-approval-receipt">
                ${item.receipt?.url ? `<a class="btn ghost sm" href="${escapeHtml(item.receipt.url)}" target="_blank" rel="noopener">Abrir comprovante</a>` : `<span class="muted">Sem comprovante</span>`}
                ${item.receipt?.name ? `<span class="expense-approval-meta">${escapeHtml(item.receipt.name)}</span>` : ""}
              </div>
              <div class="expense-approval-meta">
                ${String(item.status || "").toLowerCase() === "approved" ? `Aprovada em ${escapeHtml(formatDateTimeLabel(item.approvedAt))} por ${escapeHtml(item.approvedByName || "-")}` : ""}
                ${String(item.status || "").toLowerCase() === "rejected" ? `Reprovada em ${escapeHtml(formatDateTimeLabel(item.rejectedAt))} por ${escapeHtml(item.rejectedByName || "-")}` : ""}
              </div>
            </div>
          </article>
        `).join("") : `
          <div class="panel subtle my-activities-expenses-empty">
            <h3>Nenhuma despesa ${escapeHtml(emptyLabel[_myExpensesStatusFilter] || "encontrada")}</h3>
            <p class="muted">Nao ha despesas neste status para os filtros atuais.</p>
          </div>
        `}
      </div>
    </section>
  `;
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
                  ${activityScheduleMetaHtml(item.activity)}
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

function closeManualActivityModal(refs) {
  if (refs?.modalManualActivity) refs.modalManualActivity.hidden = true;
}

async function openManualActivityModal(deps) {
  const { refs, state, db, auth } = deps;
  if (!refs.modalManualActivity) return;
  _currentState = state;
  clearManualActivityForm(refs, state);
  refs.modalManualActivity.hidden = false;
  setAlert(refs.manualActivityAlert, "Carregando projetos e tarefas...", "info");

  const companyId = state.companyId;
  const currentUid = auth?.currentUser?.uid || "";
  if (!companyId || !currentUid) {
    setAlert(refs.manualActivityAlert, "Nao foi possivel identificar o tecnico logado.", "error");
    return;
  }

  const [projectsSnap, tasksSnap, activitiesSnap, clientsSnap] = await Promise.all([
    getDocs(collection(db, `companies/${companyId}/projects`)),
    getDocs(collection(db, `companies/${companyId}/tasks`)),
    getDocs(collection(db, `companies/${companyId}/activities`)),
    getDocs(collection(db, `companies/${companyId}/clients`))
  ]);

  _manualProjects = projectsSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((project) => Array.isArray(project.techUids) && project.techUids.includes(currentUid))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const visibleProjectIds = new Set(_manualProjects.map((project) => project.id));
  _manualTasks = tasksSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((task) => visibleProjectIds.has(task.projectId));
  _manualActivities = activitiesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  _manualClients = clientsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

  if (refs.manualActivityProject) {
    refs.manualActivityProject.innerHTML = '<option value="">Selecione um projeto</option>' +
      _manualProjects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name || "Projeto")}</option>`).join("");
  }
  populateManualActivityTasks(refs);

  if (!_manualProjects.length) {
    setAlert(refs.manualActivityAlert, "Nenhum projeto vinculado ao seu usuario foi encontrado.", "error");
    return;
  }
  clearAlert(refs.manualActivityAlert);
}

async function saveManualActivity(deps) {
  const { refs, state, db, auth } = deps;
  clearAlert(refs.manualActivityAlert);

  const companyId = state.companyId;
  const currentUid = auth?.currentUser?.uid || "";
  const projectId = refs.manualActivityProject?.value || "";
  const taskId = refs.manualActivityTask?.value || "";
  const project = _manualProjects.find((item) => item.id === projectId) || null;
  const task = _manualTasks.find((item) => item.id === taskId) || null;
  const name = String(refs.manualActivityName?.value || "").trim();
  const workDate = String(refs.manualActivityDate?.value || "").slice(0, 10);
  const hoursWorked = asNumber(refs.manualActivityHours?.value || 0);
  const keyUsers = selectedManualKeyUsers(refs);
  const note = String(refs.manualActivityNote?.value || "").trim();
  const minChars = getActivityNoteMinChars(state);
  const willSubmitOs = note.length > 0;

  if (!companyId || !currentUid) {
    setAlert(refs.manualActivityAlert, "Nao foi possivel identificar o tecnico logado.", "error");
    return;
  }
  if (!project || !task) {
    setAlert(refs.manualActivityAlert, "Selecione projeto e tarefa para a atividade.", "error");
    return;
  }
  if (!Array.isArray(project.techUids) || !project.techUids.includes(currentUid)) {
    setAlert(refs.manualActivityAlert, "Voce pode incluir atividade apenas em projetos vinculados ao seu usuario.", "error");
    return;
  }
  if (!name || hoursWorked <= 0) {
    setAlert(refs.manualActivityAlert, "Preencha nome e horas da atividade.", "error");
    return;
  }
  if (hoursWorked > 12) {
    setAlert(refs.manualActivityAlert, "A atividade aceita no maximo 12 horas por dia.", "error");
    return;
  }
  if (!workDate) {
    setAlert(refs.manualActivityAlert, "Informe a data da atividade.", "error");
    return;
  }
  if (!isDateInsideRange(workDate, task.startDate, task.endDate)) {
    setAlert(refs.manualActivityAlert, `A data ${fmtDate(workDate)} esta fora do periodo da tarefa.`, "error");
    return;
  }
  const projectKeyUsers = keyUsersForProject(project);
  if (!projectKeyUsers.length) {
    setAlert(refs.manualActivityAlert, "Nao ha key user vinculado ao cliente deste projeto. Cadastre key user no cliente para incluir atividades.", "error");
    return;
  }
  if (!keyUsers.length) {
    setAlert(refs.manualActivityAlert, "Selecione ao menos um key user para a atividade.", "error");
    return;
  }
  if (willSubmitOs && note.length < minChars) {
    setAlert(refs.manualActivityAlert, `A observacao precisa ter no minimo ${minChars} caracteres para enviar a OS.`, "error");
    return;
  }

  const projectInfo = projectHoursInfo(projectId);
  if (projectInfo.plannedHours > 0 && hoursWorked > projectInfo.availableHours) {
    setAlert(refs.manualActivityAlert, `Horas orcadas excedem o projeto. Saldo disponivel: ${projectInfo.availableHours}h`, "error");
    return;
  }

  const taskInfo = taskHoursInfo(taskId);
  if (taskInfo.plannedHours > 0 && hoursWorked > taskInfo.availableHours) {
    setAlert(
      refs.manualActivityAlert,
      `Horas insuficientes nesta tarefa. Disponiveis: ${taskInfo.availableHours}h. As novas atividades somam ${hoursWorked}h.`,
      "error"
    );
    return;
  }

  const saveButton = refs.btnSaveManualActivity;
  const originalLabel = saveButton?.textContent || "Salvar atividade";
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "Salvando atividade...";
  }

  try {
    const techName = state.profile?.name || auth?.currentUser?.email || "Tecnico";
    const actId = `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const payload = {
      projectId: project.id,
      projectName: project.name || "",
      clientId: project.clientId || "",
      clientName: project.clientName || project.client?.name || "",
      managerUid: project.managerUid || "",
      managerName: project.managerName || "",
      coordinatorUid: project.coordinatorUid || "",
      coordinatorName: project.coordinatorName || "",
      taskId: task.id,
      taskName: task.name || "",
      name,
      workDate,
      hoursWorked,
      techUids: [currentUid],
      techNames: [techName],
      keyUsers,
      note,
      status: willSubmitOs ? "os_gerada" : "sem_os",
      source: "manual",
      createdBy: currentUid,
      createdByName: techName,
      createdByRole: "tecnico",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: currentUid
    };
    if (willSubmitOs) {
      payload.workedHours = hoursWorked;
      payload.techFilledAt = serverTimestamp();
      payload.techFilledBy = currentUid;
    }

    await setDoc(doc(db, `companies/${companyId}/activities`, actId), payload);

    if (willSubmitOs) {
      await createNotifications(db, companyId, [project.managerUid, project.coordinatorUid], {
        type: "os_submitted",
        title: "OS enviada para aprovacao",
        message: `${techName} enviou apontamento manual em ${project.name || "um projeto"}.`,
        entityType: "activity",
        entityId: actId,
        activityId: actId,
        projectId: project.id || "",
        taskId: task.id || "",
        createdBy: currentUid,
        createdByName: techName,
        createdByEmail: auth?.currentUser?.email || ""
      }).catch((err) => console.warn("[notifications:manual-os-submitted]", err));
    }

    closeManualActivityModal(refs);
    await loadMyActivities(deps);
    if (typeof deps.onOnboardingProgressChanged === "function") {
      deps.onOnboardingProgressChanged();
    }
  } catch (err) {
    console.error(err);
    setAlert(refs.manualActivityAlert, err?.message || "Nao foi possivel salvar a atividade manual.", "error");
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = originalLabel;
    }
  }
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
  _currentState = { ...(state || {}), authUid: deps.auth?.currentUser?.uid || "" };

  _currentActivity = item;
  _currentModalMode = mode === "edit" ? "edit" : "view";
  _afterModalSave = typeof options.afterSave === "function" ? options.afterSave : null;
  clearAlert(refs.myActivityModalAlert);

  const readOnly = _currentModalMode !== "edit" || isApproved(item.activity);
  const allowReschedule = canTechRescheduleActivity(state);
  const statusMeta = getStatusMeta(item.activity);
  if (refs.myActivityModalTitle) refs.myActivityModalTitle.textContent = readOnly ? "Visualizar atividade" : "Apontar atividade";
  if (refs.myActivityModalSubtitle) refs.myActivityModalSubtitle.textContent = readOnly
    ? "Confira os detalhes completos da atividade."
    : (allowReschedule
      ? "Ajuste data e horas sem ultrapassar o total programado para esta atividade."
      : "Preencha seu apontamento. Ao salvar, a atividade vai para OS Enviada e segue para aprovacao do gestor.");

  if (refs.myActivityProject) refs.myActivityProject.textContent = item.projectName || "-";
  if (refs.myActivityClient) refs.myActivityClient.textContent = item.clientName || "-";
  if (refs.myActivityTask) refs.myActivityTask.textContent = item.taskName || "-";
  if (refs.myActivityName) refs.myActivityName.textContent = item.activity.name || "Atividade";
  const scheduleInfo = activityScheduleInfo(item.activity);
  if (refs.myActivityDate) {
    refs.myActivityDate.textContent = scheduleInfo.hasPointing
      ? `Prevista: ${fmtDate(scheduleInfo.initialDate)} | Apontada: ${fmtDate(scheduleInfo.pointedDate)}`
      : fmtDate(scheduleInfo.initialDate);
  }
  if (refs.myActivityDateInput) {
    refs.myActivityDateInput.value = String(item.activity.workDate || "").slice(0, 10);
    refs.myActivityDateInput.hidden = readOnly || !allowReschedule;
    refs.myActivityDateInput.disabled = readOnly || !allowReschedule;
  }
  if (refs.myActivityDate) refs.myActivityDate.hidden = !readOnly && allowReschedule;
  if (refs.myActivityHours) {
    refs.myActivityHours.textContent = scheduleInfo.hasPointing
      ? `${formatHours(scheduleInfo.initialHours)} / ${formatHours(scheduleInfo.pointedHours)}`
      : formatHours(scheduleInfo.initialHours);
  }
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
  const allowReschedule = canTechRescheduleActivity(state);
  const selectedDate = allowReschedule
    ? String(refs.myActivityDateInput?.value || _currentActivity.activity.workDate || "").slice(0, 10)
    : String(_currentActivity.activity.workDate || "").slice(0, 10);
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
  if (allowReschedule && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
    setMyActivityModalError(refs, "Informe uma data valida para o apontamento.");
    return;
  }
  if (!allowReschedule && hoursDiff > maxHours) {
    setMyActivityModalError(refs, `O apontamento nao pode ultrapassar ${maxHours}h previstas para a atividade.`);
    return;
  }
  if (allowReschedule) {
    const groupActivities = await loadActivityGroupActivities(deps, currentUid);
    const summary = summarizeActivityGroup(groupActivities, _currentActivity.activity, currentUid, _currentActivity.activity.id);
    const plannedHours = summary.plannedHours || maxHours;
    const totalAfterSave = summary.pointedHours + hoursDiff;
    if (plannedHours > 0 && totalAfterSave > plannedHours + 0.0001) {
      const available = Math.max(0, plannedHours - summary.pointedHours);
      setMyActivityModalError(
        refs,
        `Para esta atividade foi programado o maximo de ${formatHours(plannedHours)}. Restam ${formatHours(available)} para este consultor. Diminua horas de agendas futuras desta atividade ou solicite ao gestor programar mais dias/horas para a atividade.`
      );
      return;
    }
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
    const updatePayload = {
      startTime: start,
      endTime: end,
      breakTime,
      workDate: selectedDate,
      workedHours: hoursDiff,
      note,
      status: "os_gerada",
      techFilledAt: serverTimestamp(),
      techFilledBy: currentUid,
      updatedAt: serverTimestamp(),
      updatedBy: currentUid
    };
    if (!_currentActivity.activity.originalWorkDate) {
      updatePayload.originalWorkDate = String(_currentActivity.activity.workDate || "").slice(0, 10);
    }
    if (_currentActivity.activity.originalHoursWorked == null) {
      updatePayload.originalHoursWorked = asNumber(_currentActivity.activity.hoursWorked);
    }
    await updateDoc(doc(db, `companies/${state.companyId}/activities`, _currentActivity.activity.id), updatePayload);

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
    if (typeof deps.onOnboardingProgressChanged === "function") {
      deps.onOnboardingProgressChanged();
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
  _myActivitiesStatusFilter = "all";
  const { refs, setView } = deps;
  bindEvents(deps);
  setView("myActivities");
  syncMyActivitiesShell(refs);
  loadMyActivities(deps).catch((err) => {
    console.error(err);
    alert("Nao foi possivel carregar suas atividades.");
  });
}

export function openMyExpensesView(deps) {
  _myActivitiesStatusFilter = "expenses";
  _myExpensesStatusFilter = "pending";
  const { refs, setView } = deps;
  bindEvents(deps);
  setView("myActivities");
  syncMyActivitiesShell(refs);
  loadMyActivities(deps).catch((err) => {
    console.error(err);
    alert("Nao foi possivel carregar suas despesas.");
  });
}

export async function loadMyActivities(deps) {
  const { refs, state, db, auth } = deps;
  if (!refs.myActivitiesList) return;

  bindEvents(deps);
  syncMyActivitiesShell(refs);
  refs.myActivitiesList.innerHTML = `<div class="panel subtle"><p class="muted">${_myActivitiesStatusFilter === "expenses" ? "Carregando despesas..." : "Carregando atividades..."}</p></div>`;
  hide(refs.myActivitiesEmpty);

  const companyId = state.companyId;
  const currentUid = auth?.currentUser?.uid || "";
  if (!companyId || !currentUid) {
    refs.myActivitiesList.innerHTML = "";
    show(refs.myActivitiesEmpty);
    return;
  }

  const [activitiesSnap, expensesSnap, projectsSnap, tasksSnap] = await Promise.all([
    getDocs(query(
      collection(db, `companies/${companyId}/activities`),
      where("techUids", "array-contains", currentUid)
    )),
    getDocs(query(
      collection(db, `companies/${companyId}/expenses`),
      where("createdBy", "==", currentUid)
    )),
    getDocs(collection(db, `companies/${companyId}/projects`)),
    getDocs(collection(db, `companies/${companyId}/tasks`))
  ]);

  const allActivities = activitiesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  _myExpensesCache = expensesSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .sort((a, b) => {
      const aDate = String(a.workDate || "");
      const bDate = String(b.workDate || "");
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      const aCreated = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bCreated = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bCreated - aCreated;
    });

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
  syncMyActivitiesShell(refs);
  updateSummary(refs, enriched);
  syncSummaryCards();
  if (_myActivitiesStatusFilter === "expenses") {
    const expenseFiltered = _myExpensesCache.filter((item) => {
      if (queryText && !buildExpenseSearchText(item).includes(queryText)) return false;
      if (!isWithinExpensePeriod(item, periodStart, periodEnd)) return false;
      return true;
    });
    renderMyExpensesList(refs, expenseFiltered);
    return;
  }
  renderMyActivitiesList(refs, statusFiltered);
}
