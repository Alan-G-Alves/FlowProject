import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { clearAlert, setAlert } from "../ui/alerts.js";
import { escapeHtml, hide, show } from "../utils/dom.js";

let _bound = false;
let _currentActivity = null;
let _currentModalMode = "view";
let _myActivitiesCache = [];
let _myActivitiesAllCache = [];
let _myActivitiesStatusFilter = "all";

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

function diffHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const s = /^(\d{2}):(\d{2})$/.exec(String(startTime));
  const e = /^(\d{2}):(\d{2})$/.exec(String(endTime));
  if (!s || !e) return 0;
  const startMinutes = Number(s[1]) * 60 + Number(s[2]);
  const endMinutes = Number(e[1]) * 60 + Number(e[2]);
  if (endMinutes <= startMinutes) return 0;
  return (endMinutes - startMinutes) / 60;
}

function isOverdue(activity) {
  const workDate = String(activity?.workDate || "").slice(0, 10);
  if (!workDate || activity?.status === "os_gerada") return false;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return workDate < todayKey;
}

function getStatusMeta(activity) {
  if (isOverdue(activity)) {
    return { label: "Atrasada", cls: "orange", itemCls: "overdue" };
  }
  if (String(activity?.status || "") === "os_gerada") {
    return { label: "OS Gerada", cls: "green", itemCls: "ok" };
  }
  return { label: "Sem OS", cls: "red", itemCls: "pending" };
}

function buildSearchText(item) {
  const status = getStatusMeta(item.activity).label;
  return normalizeText([
    item.projectName,
    item.taskName,
    item.activity.name,
    item.activity.workDate,
    fmtDate(item.activity.workDate),
    status,
    ...(Array.isArray(item.activity.keyUsers) ? item.activity.keyUsers : [])
  ].join(" "));
}

function bindEvents(deps) {
  if (_bound) return;
  _bound = true;
  const { refs } = deps;

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
      return items.filter((item) => String(item.activity?.status || "") !== "os_gerada" && !isOverdue(item.activity));
    case "generated":
      return items.filter((item) => String(item.activity?.status || "") === "os_gerada");
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
  const pending = items.filter((item) => String(item.activity?.status || "") !== "os_gerada" && !isOverdue(item.activity)).length;
  const generated = items.filter((item) => String(item.activity?.status || "") === "os_gerada").length;
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

        const pendingCount = taskGroup.activities.filter((item) => String(item.activity.status || "") !== "os_gerada" && !isOverdue(item.activity)).length;
        const generatedCount = taskGroup.activities.filter((item) => String(item.activity.status || "") === "os_gerada").length;
        const overdueCount = taskGroup.activities.filter((item) => isOverdue(item.activity)).length;

        const activitiesHtml = taskGroup.activities.map((item) => {
          const meta = getStatusMeta(item.activity);
          const notePreview = String(item.activity.note || "").trim();
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
                <span class="activity-tag">Key users: ${escapeHtml((Array.isArray(item.activity.keyUsers) && item.activity.keyUsers.length) ? item.activity.keyUsers.join(", ") : "-")}</span>
                <span class="activity-tag">Apontamento: ${escapeHtml(item.activity.startTime && item.activity.endTime ? `${item.activity.startTime} - ${item.activity.endTime}` : "Pendente")}</span>
              </div>
              ${notePreview ? `<div class="my-activities-note-preview">${escapeHtml(notePreview)}</div>` : `<div class="my-activities-note-preview muted">Sem observacao registrada.</div>`}
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
                <span class="task-status-pill task-status-pill--done">OS Gerada: <b>${escapeHtml(String(generatedCount))}</b></span>
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
  const modal = document.getElementById("modalMyActivity");
  if (modal) modal.hidden = true;
}

function openMyActivityModal(activityId, mode, deps) {
  const { refs } = deps;
  const item = _myActivitiesCache.find((entry) => entry.activity.id === activityId);
  if (!item || !refs.modalMyActivity) return;

  _currentActivity = item;
  _currentModalMode = mode === "edit" ? "edit" : "view";
  clearAlert(refs.myActivityModalAlert);

  const readOnly = _currentModalMode !== "edit";
  if (refs.myActivityModalTitle) refs.myActivityModalTitle.textContent = readOnly ? "Visualizar atividade" : "Apontar atividade";
  if (refs.myActivityModalSubtitle) refs.myActivityModalSubtitle.textContent = readOnly
    ? "Confira os detalhes completos da atividade."
    : "Preencha seu apontamento. Ao salvar, a atividade vai para OS Gerada e segue para aprovacao do gestor.";

  if (refs.myActivityProject) refs.myActivityProject.value = item.projectName || "";
  if (refs.myActivityTask) refs.myActivityTask.value = item.taskName || "";
  if (refs.myActivityName) refs.myActivityName.value = item.activity.name || "";
  if (refs.myActivityDate) refs.myActivityDate.value = fmtDate(item.activity.workDate);
  if (refs.myActivityHours) refs.myActivityHours.value = `${item.activity.hoursWorked || 0}h`;
  if (refs.myActivityStatus) refs.myActivityStatus.value = getStatusMeta(item.activity).label;
  if (refs.myActivityStartTime) refs.myActivityStartTime.value = item.activity.startTime || "";
  if (refs.myActivityEndTime) refs.myActivityEndTime.value = item.activity.endTime || "";
  if (refs.myActivityKeyUsers) refs.myActivityKeyUsers.value = Array.isArray(item.activity.keyUsers) ? item.activity.keyUsers.join(", ") : "";
  if (refs.myActivityNote) refs.myActivityNote.value = item.activity.note || "";

  if (refs.myActivityStartTime) refs.myActivityStartTime.disabled = readOnly;
  if (refs.myActivityEndTime) refs.myActivityEndTime.disabled = readOnly;
  if (refs.myActivityNote) refs.myActivityNote.disabled = readOnly;
  if (refs.btnSaveMyActivityModal) refs.btnSaveMyActivityModal.hidden = readOnly;
  if (refs.btnCancelMyActivityModal) refs.btnCancelMyActivityModal.textContent = readOnly ? "Fechar" : "Cancelar";

  refs.modalMyActivity.hidden = false;
}

async function saveMyActivityModal(deps) {
  const { refs, state, db, auth } = deps;
  if (!_currentActivity) return;

  clearAlert(refs.myActivityModalAlert);

  const start = refs.myActivityStartTime?.value || "";
  const end = refs.myActivityEndTime?.value || "";
  const note = (refs.myActivityNote?.value || "").trim();
  const hoursDiff = diffHours(start, end);
  const maxHours = asNumber(_currentActivity.activity.hoursWorked);
  const currentUid = auth?.currentUser?.uid || "";
  const isAssigned = Array.isArray(_currentActivity.activity.techUids) && _currentActivity.activity.techUids.includes(currentUid);

  if (!isAssigned) {
    setAlert(refs.myActivityModalAlert, "Esta atividade nao esta vinculada ao tecnico logado.", "error");
    return;
  }
  if (hoursDiff <= 0) {
    setAlert(refs.myActivityModalAlert, "Informe hora inicio e fim validas.", "error");
    return;
  }
  if (hoursDiff > maxHours) {
    setAlert(refs.myActivityModalAlert, `O apontamento nao pode ultrapassar ${maxHours}h previstas para a atividade.`, "error");
    return;
  }
  if (note.length < 50) {
    setAlert(refs.myActivityModalAlert, "A observacao precisa ter no minimo 50 caracteres.", "error");
    return;
  }

  await updateDoc(doc(db, `companies/${state.companyId}/activities`, _currentActivity.activity.id), {
    startTime: start,
    endTime: end,
    note,
    status: "os_gerada",
    techFilledAt: serverTimestamp(),
    techFilledBy: currentUid,
    updatedAt: serverTimestamp(),
    updatedBy: currentUid
  });

  closeMyActivityModal();
  await loadMyActivities(deps);
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
      taskId: activity.taskId || task?.id || "",
      taskName: task?.name || activity.taskName || "Tarefa sem nome"
    };
  });

  const queryText = normalizeText(refs.myActivitiesSearchInput?.value || "");
  const filtered = enriched.filter((item) => !queryText || buildSearchText(item).includes(queryText));
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
