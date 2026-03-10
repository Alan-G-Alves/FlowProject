import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { setAlert, clearAlert } from "../ui/alerts.js";
import { escapeHtml } from "../utils/dom.js";
import { ensureClientsCache } from "./clients.domain.js";

let _bound = false;
let _activeProjectId = "";
let _activeProject = null;
let _tabs = [];
let _tasks = [];
let _activities = [];
const ACTIVITY_CHIP_COLORS = ["t1", "t2", "t3", "t4", "t5", "t6"];

function setWorkspaceOpenUI(deps, isOpen){
  const refs = _wsRefs(deps);
  if (refs.projectWorkspacePanel){
    refs.projectWorkspacePanel.classList.toggle("is-open", Boolean(isOpen));
  }
  refs.viewMyProjects?.classList.toggle("workspace-open", Boolean(isOpen));
}

function _wsRefs(deps){
  const r = deps?.refs || {};
  const byId = (id) => document.getElementById(id);
  return {
    viewMyProjects: r.viewMyProjects || byId("viewMyProjects"),
    projectWorkspaceTabs: r.projectWorkspaceTabs || byId("projectWorkspaceTabs"),
    projectWorkspacePanel: r.projectWorkspacePanel || byId("projectWorkspacePanel"),
    btnCloseProjectWorkspace: r.btnCloseProjectWorkspace || byId("btnCloseProjectWorkspace"),
    btnOpenWorkspaceView: r.btnOpenWorkspaceView || byId("btnOpenWorkspaceView"),
    btnOpenWorkspaceEdit: r.btnOpenWorkspaceEdit || byId("btnOpenWorkspaceEdit"),
    btnDeleteWorkspaceProject: r.btnDeleteWorkspaceProject || byId("btnDeleteWorkspaceProject"),
    projectWorkspaceTitle: r.projectWorkspaceTitle || byId("projectWorkspaceTitle"),
    projectWorkspaceSubtitle: r.projectWorkspaceSubtitle || byId("projectWorkspaceSubtitle"),
    projectWorkspaceBreadcrumb: r.projectWorkspaceBreadcrumb || byId("projectWorkspaceBreadcrumb"),
    projectWorkspaceCover: r.projectWorkspaceCover || byId("projectWorkspaceCover"),
    btnOpenTaskForm: r.btnOpenTaskForm || byId("btnOpenTaskForm"),
    projectTaskFormWrap: r.projectTaskFormWrap || byId("projectTaskFormWrap"),
    taskNameInput: r.taskNameInput || byId("taskNameInput"),
    taskStartDateInput: r.taskStartDateInput || byId("taskStartDateInput"),
    taskEndDateInput: r.taskEndDateInput || byId("taskEndDateInput"),
    taskPlannedHoursInput: r.taskPlannedHoursInput || byId("taskPlannedHoursInput"),
    btnCancelTaskForm: r.btnCancelTaskForm || byId("btnCancelTaskForm"),
    btnSaveTask: r.btnSaveTask || byId("btnSaveTask"),
    projectTaskAlert: r.projectTaskAlert || byId("projectTaskAlert"),
    projectTaskList: r.projectTaskList || byId("projectTaskList"),
  };
}

function roleOf(state){
  return (state?.profile?.role || "").toString().toLowerCase();
}

function isTech(state){
  return roleOf(state) === "tecnico";
}

function canManageTasks(state){
  const r = roleOf(state);
  return r === "admin" || r === "gestor" || r === "coordenador";
}

function canUseRangeForActivities(state){
  return !isTech(state);
}

function fmtDate(v){
  if (!v) return "-";
  if (typeof v === "string" && v.length >= 10){
    const s = v.slice(0, 10);
    const [y, m, d] = s.split("-");
    if (y && m && d) return `${d}/${m}/${y}`;
  }
  return String(v);
}

function parseDateOnly(v){
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function overlap(aStart, aEnd, bStart, bEnd){
  const aS = parseDateOnly(aStart);
  const aE = parseDateOnly(aEnd);
  const bS = parseDateOnly(bStart);
  const bE = parseDateOnly(bEnd);
  if (!aS || !aE || !bS || !bE) return false;
  return aS <= bE && bS <= aE;
}

function diffHours(startTime, endTime){
  if (!startTime || !endTime) return 0;
  const s = /^(\d{2}):(\d{2})$/.exec(String(startTime));
  const e = /^(\d{2}):(\d{2})$/.exec(String(endTime));
  if (!s || !e) return 0;
  const sMin = Number(s[1]) * 60 + Number(s[2]);
  const eMin = Number(e[1]) * 60 + Number(e[2]);
  if (eMin <= sMin) return 0;
  return (eMin - sMin) / 60;
}

function asNumber(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function keyUsersFromProjectClient(state, project){
  const clientId = project?.clientId || "";
  if (!clientId) return [];
  const clients = Array.isArray(state?._clientsCache) ? state._clientsCache : [];
  const c = clients.find(x => x.id === clientId);
  if (!c) return [];
  if (Array.isArray(c.keyUsers) && c.keyUsers.length){
    return c.keyUsers.filter(Boolean).map(ku => ({
      name: ku.name || "",
      email: ku.email || "",
      phone: ku.phone || ""
    }));
  }
  const legacy = {
    name: c.keyUserName || "",
    email: c.keyUserEmail || "",
    phone: c.keyUserPhone || ""
  };
  return (legacy.name || legacy.email || legacy.phone) ? [legacy] : [];
}

function techsFromProject(state, project){
  const users = Array.isArray(state?._usersCache) ? state._usersCache : [];
  const techUids = Array.isArray(project?.techUids) ? project.techUids.filter(Boolean) : [];
  if (!techUids.length) return [];
  return techUids
    .map(uid => users.find(u => u && u.uid === uid && (u.role || "").toLowerCase() === "tecnico"))
    .filter(Boolean)
    .map(u => ({
      uid: u.uid,
      name: u.name || u.email || u.uid
    }));
}

function weekdayName(idx){
  return ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"][idx] || "";
}

function datesForRangeByWeekdays(start, end, weekdaysSet){
  const out = [];
  const s = parseDateOnly(start);
  const e = parseDateOnly(end);
  if (!s || !e || s > e) return out;
  const cur = new Date(s);
  while (cur <= e){
    if (weekdaysSet.has(cur.getDay())){
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, "0");
      const d = String(cur.getDate()).padStart(2, "0");
      out.push(`${y}-${m}-${d}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

async function ensureWorkspaceContext(deps){
  const { db, state } = deps || {};
  const companyId = state?.companyId;
  if (!db || !companyId) return;

  if (!Array.isArray(state.teams) || !state.teams.length){
    const teamsSnap = await getDocs(collection(db, `companies/${companyId}/teams`));
    state.teams = teamsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  if (!Array.isArray(state._usersCache) || !state._usersCache.length){
    const usersSnap = await getDocs(collection(db, `companies/${companyId}/users`));
    state._usersCache = usersSnap.docs.map((d) => {
      const data = d.data() || {};
      return { uid: data.uid || d.id, ...data };
    });
  }
}

function getActivitySelectionInput(taskId, kind){
  return document.getElementById(`actSelected${kind}-${taskId}`);
}

function getActivitySelectionValues(taskId, kind){
  const input = getActivitySelectionInput(taskId, kind);
  if (!input?.value) return [];
  try {
    const parsed = JSON.parse(input.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function setActivitySelectionValues(taskId, kind, values){
  const input = getActivitySelectionInput(taskId, kind);
  if (!input) return;
  input.value = JSON.stringify(Array.isArray(values) ? values : []);
}

function renderActivitySelectionChips(taskId, kind, items){
  const wrap = document.getElementById(`act${kind}Chips-${taskId}`);
  if (!wrap) return;
  const list = Array.isArray(items) ? items : [];
  if (!list.length){
    wrap.innerHTML = `<span class="muted">Nenhum selecionado.</span>`;
    return;
  }
  wrap.innerHTML = list.map((item, idx) => `
    <span class="chip project-tech-chip ${ACTIVITY_CHIP_COLORS[idx % ACTIVITY_CHIP_COLORS.length]}">
      <span>${escapeHtml(item.label)}</span>
      <button
        type="button"
        class="project-tech-chip-remove"
        data-remove-activity-${kind.toLowerCase()}="${escapeHtml(taskId)}"
        data-remove-value="${escapeHtml(item.value)}"
        aria-label="Remover ${kind.toLowerCase()}"
      >x</button>
    </span>
  `).join("");
}

function addActivitySelection(taskId, kind, value, label){
  if (!taskId || !value) return;
  const current = getActivitySelectionValues(taskId, kind);
  if (current.some(item => item?.value === value)) return;
  const next = [...current, { value, label: label || value }];
  setActivitySelectionValues(taskId, kind, next);
  renderActivitySelectionChips(taskId, kind, next);
}

function removeActivitySelection(taskId, kind, value){
  const next = getActivitySelectionValues(taskId, kind).filter(item => item?.value !== value);
  setActivitySelectionValues(taskId, kind, next);
  renderActivitySelectionChips(taskId, kind, next);
}

function bindOnce(deps){
  if (_bound) return;
  _bound = true;
  const refs = _wsRefs(deps);

  refs.btnCloseProjectWorkspace?.addEventListener("click", () => {
    closeProjectWorkspace(deps);
  });

  refs.btnOpenWorkspaceEdit?.addEventListener("click", async () => {
    if (!_activeProjectId) return;
    if (typeof deps.openEditProjectModal === "function"){
      await deps.openEditProjectModal(_activeProjectId);
    }
  });

  refs.btnOpenWorkspaceView?.addEventListener("click", async () => {
    if (!_activeProjectId) return;
    if (typeof deps.openProjectDetailModal === "function"){
      await deps.openProjectDetailModal(_activeProjectId);
    }
  });

  refs.btnDeleteWorkspaceProject?.addEventListener("click", async () => {
    await deleteActiveProject(deps);
  });

  refs.btnOpenTaskForm?.addEventListener("click", () => {
    if (!canManageTasks(deps.state)) return;
    refs.projectTaskFormWrap.hidden = false;
  });

  refs.btnCancelTaskForm?.addEventListener("click", () => {
    refs.projectTaskFormWrap.hidden = true;
    clearTaskForm(refs);
  });

  refs.btnSaveTask?.addEventListener("click", async () => {
    await saveTask(deps);
  });

  refs.projectWorkspaceTabs?.addEventListener("click", async (ev) => {
    const closeBtn = ev.target?.closest?.("[data-close-tab]");
    if (closeBtn){
      const pid = closeBtn.getAttribute("data-close-tab");
      _tabs = _tabs.filter(t => t.id !== pid);
      if (_activeProjectId === pid){
        _activeProjectId = "";
        _activeProject = null;
        if (_tabs.length){
          await openProjectWorkspace(_tabs[0].id, deps);
        } else {
          closeProjectWorkspace(deps);
        }
      } else {
        renderTabs(refs);
      }
      return;
    }

    const tab = ev.target?.closest?.("[data-open-tab]");
    if (!tab) return;
    const pid = tab.getAttribute("data-open-tab");
    if (!pid) return;
    await openProjectWorkspace(pid, deps);
  });

  refs.projectWorkspaceBreadcrumb?.addEventListener("click", (ev) => {
    const backBtn = ev.target?.closest?.("[data-back-kanban]");
    if (!backBtn) return;
    closeProjectWorkspace(deps);
  });

  refs.projectTaskList?.addEventListener("click", async (ev) => {
    const addActivityBtn = ev.target?.closest?.("[data-open-activity-form]");
    if (addActivityBtn){
      const taskId = addActivityBtn.getAttribute("data-open-activity-form");
      const wrap = document.getElementById(`activityFormWrap-${taskId}`);
      if (wrap) wrap.hidden = false;
      return;
    }

    const cancelActivityBtn = ev.target?.closest?.("[data-cancel-activity-form]");
    if (cancelActivityBtn){
      const taskId = cancelActivityBtn.getAttribute("data-cancel-activity-form");
      const wrap = document.getElementById(`activityFormWrap-${taskId}`);
      if (wrap) wrap.hidden = true;
      return;
    }

    const saveActivityBtn = ev.target?.closest?.("[data-save-activity]");
    if (saveActivityBtn){
      const taskId = saveActivityBtn.getAttribute("data-save-activity");
      await saveActivity(taskId, deps);
      return;
    }

    const saveTechFillBtn = ev.target?.closest?.("[data-save-tech-fill]");
    if (saveTechFillBtn){
      const activityId = saveTechFillBtn.getAttribute("data-save-tech-fill");
      await saveTechFill(activityId, deps);
      return;
    }

    const removeTechBtn = ev.target?.closest?.("[data-remove-activity-techs]");
    if (removeTechBtn){
      removeActivitySelection(
        removeTechBtn.getAttribute("data-remove-activity-techs"),
        "Techs",
        removeTechBtn.getAttribute("data-remove-value")
      );
      return;
    }

    const removeKeyUserBtn = ev.target?.closest?.("[data-remove-activity-keyusers]");
    if (removeKeyUserBtn){
      removeActivitySelection(
        removeKeyUserBtn.getAttribute("data-remove-activity-keyusers"),
        "KeyUsers",
        removeKeyUserBtn.getAttribute("data-remove-value")
      );
      return;
    }
  });

  refs.projectTaskList?.addEventListener("change", (ev) => {
    const techSelect = ev.target?.closest?.("[data-activity-tech-select]");
    if (techSelect){
      const taskId = techSelect.getAttribute("data-activity-tech-select");
      const value = techSelect.value || "";
      const label = techSelect.options?.[techSelect.selectedIndex]?.textContent?.trim() || value;
      if (value) addActivitySelection(taskId, "Techs", value, label);
      techSelect.value = "";
      return;
    }

    const keyUserSelect = ev.target?.closest?.("[data-activity-keyuser-select]");
    if (keyUserSelect){
      const taskId = keyUserSelect.getAttribute("data-activity-keyuser-select");
      const value = keyUserSelect.value || "";
      const label = keyUserSelect.options?.[keyUserSelect.selectedIndex]?.textContent?.trim() || value;
      if (value) addActivitySelection(taskId, "KeyUsers", value, label);
      keyUserSelect.value = "";
    }
  });
}

function clearTaskForm(refs){
  if (refs.taskNameInput) refs.taskNameInput.value = "";
  if (refs.taskStartDateInput) refs.taskStartDateInput.value = "";
  if (refs.taskEndDateInput) refs.taskEndDateInput.value = "";
  if (refs.taskPlannedHoursInput) refs.taskPlannedHoursInput.value = "";
}

function renderTabs(refs){
  if (!refs.projectWorkspaceTabs) return;
  if (!_tabs.length){
    refs.projectWorkspaceTabs.innerHTML = "";
    return;
  }
  refs.projectWorkspaceTabs.innerHTML = _tabs.map(t => `
    <button class="workspace-tab ${t.id === _activeProjectId ? "active" : ""}" data-open-tab="${escapeHtml(t.id)}" type="button">
      <span>${escapeHtml(t.label)}</span>
      <span class="workspace-tab-close" data-close-tab="${escapeHtml(t.id)}">x</span>
    </button>
  `).join("");
}

async function ensureTab(projectId, deps){
  if (!projectId) return;
  const existing = _tabs.find(t => t.id === projectId);
  if (existing) return;

  let label = `Projeto ${projectId}`;
  try{
    const companyId = deps?.state?.companyId;
    if (companyId){
      const snap = await getDoc(doc(deps.db, `companies/${companyId}/projects`, projectId));
      if (snap.exists()){
        const data = snap.data() || {};
        const fromProject = `${data.projectNumber || ""} ${data.name || ""}`.trim();
        if (fromProject) label = fromProject;
      }
    }
  }catch(_){ }

  _tabs.unshift({ id: projectId, label });
}

function renderCover(refs, project, state){
  if (!refs.projectWorkspaceCover) return;
  const teamName = (state.teams || []).find(t => t.id === project.teamId)?.name || "-";
  const status = project.status || "a-fazer";
  const client = project.clientName || "-";
  const manager = (state._usersCache || []).find(u => u.uid === project.managerUid)?.name || "-";
  const coordinator = (state._usersCache || []).find(u => u.uid === project.coordinatorUid)?.name || "-";
  const endDate = fmtDate(project.endDate);
  const billingValue = project.billingValue ? Number(project.billingValue).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "-";

  refs.projectWorkspaceCover.innerHTML = `
    <div class="project-cover-hero">
      <div>
        <div class="project-cover-eyebrow"><span class="project-cover-id">#${escapeHtml(String(project.projectNumber || project.id || "-"))}</span><span class="project-cover-eyebrow-text">PROJETO</span></div>
        <div class="project-cover-title">${escapeHtml(project.name || "Projeto")}</div>
        <div class="project-cover-subtitle">Workspace central do projeto com tarefas e atividades vinculadas.</div>
      </div>
      <div class="project-cover-badges">
        <span class="badge small">Status: ${escapeHtml(status)}</span>
        <span class="badge small">Prazo: ${escapeHtml(endDate)}</span>
        <div class="project-cover-actions" id="projectCoverActionsSlot"></div>
      </div>
    </div>
    <div class="project-cover-grid">
      <div class="project-cover-card">
        <span class="project-cover-label">Cliente</span>
        <strong>${escapeHtml(client)}</strong>
      </div>
      <div class="project-cover-card">
        <span class="project-cover-label">Equipe</span>
        <strong>${escapeHtml(teamName)}</strong>
      </div>
      <div class="project-cover-card">
        <span class="project-cover-label">Gestor</span>
        <strong>${escapeHtml(manager)}</strong>
      </div>
      <div class="project-cover-card">
        <span class="project-cover-label">Coordenador</span>
        <strong>${escapeHtml(coordinator)}</strong>
      </div>
      <div class="project-cover-card">
        <span class="project-cover-label">Horas do projeto</span>
        <strong>${escapeHtml(String(project.billingHours ?? "-"))}h</strong>
      </div>
      <div class="project-cover-card">
        <span class="project-cover-label">Valor do projeto</span>
        <strong>${escapeHtml(billingValue)}</strong>
      </div>
    </div>
  `;

  const actionsSlot = document.getElementById("projectCoverActionsSlot");
  if (actionsSlot){
    [refs.btnOpenWorkspaceView, refs.btnOpenWorkspaceEdit, refs.btnDeleteWorkspaceProject].forEach((btn) => {
      if (btn) actionsSlot.appendChild(btn);
    });
  }
}

function renderBreadcrumb(refs, project){
  if (!refs.projectWorkspaceBreadcrumb) return;
  const name = project?.name || "Projeto";
  refs.projectWorkspaceBreadcrumb.innerHTML = `
    <button class="crumb-link" data-back-kanban="1" type="button">Meus Projetos</button>
    <span class="crumb-sep">/</span>
    <span class="crumb-current">${escapeHtml(name)}</span>
  `;
}

function renderTasks(deps){
  const { refs, state } = deps;
  if (!refs.projectTaskList) return;
  const isUserTech = isTech(state);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const iconPending = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true"><path d="M12 8v5l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/></svg>';
  const iconDone = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true"><path d="M5 12l4 4L19 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const iconOverdue = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true"><path d="M12 8v5m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const keyUsers = keyUsersFromProjectClient(state, _activeProject);
  const projectTechs = techsFromProject(state, _activeProject);
  const byTask = new Map();
  _activities.forEach(a => {
    const arr = byTask.get(a.taskId) || [];
    arr.push(a);
    byTask.set(a.taskId, arr);
  });

  if (!_tasks.length){
    refs.projectTaskList.innerHTML = `<div class="panel subtle"><p class="muted">Nenhuma tarefa cadastrada neste projeto.</p></div>`;
    return;
  }

  refs.projectTaskList.innerHTML = _tasks.map(t => {
    const taskActs = byTask.get(t.id) || [];
    const worked = taskActs.reduce((acc, a) => acc + asNumber(a.hoursWorked), 0);
    const planned = asNumber(t.plannedHours);
    const balance = Math.max(0, planned - worked);
    const statusCounters = taskActs.reduce((acc, a) => {
      const workDate = parseDateOnly(a.workDate);
      const isOverdue = Boolean(workDate && workDate < today && a.status !== "os_gerada");
      if (a.status === "os_gerada") acc.done += 1;
      else acc.pending += 1;
      if (isOverdue) acc.overdue += 1;
      return acc;
    }, { pending: 0, done: 0, overdue: 0 });
    const groupedActs = new Map();
    taskActs.forEach((a) => {
      const activityName = (a.name || "Atividade").trim();
      const names = Array.isArray(a.techNames) && a.techNames.length ? a.techNames : ["Sem tecnico"];
      const techKey = names.join(" | ");
      const workDate = parseDateOnly(a.workDate);
      const isOverdue = Boolean(workDate && workDate < today && a.status !== "os_gerada");

      const current = groupedActs.get(activityName) || {
        label: activityName,
        techGroups: new Map(),
        activities: [],
        overdue: 0,
        pending: 0,
        earliestDate: null
      };

      const techGroup = current.techGroups.get(techKey) || {
        label: names.join(", "),
        activities: [],
        overdue: 0,
        pending: 0,
        earliestDate: null
      };

      techGroup.activities.push(a);
      current.activities.push(a);
      if (a.status !== "os_gerada") {
        techGroup.pending += 1;
        current.pending += 1;
      }
      if (isOverdue) {
        techGroup.overdue += 1;
        current.overdue += 1;
      }
      if (workDate && (!techGroup.earliestDate || workDate < techGroup.earliestDate)) techGroup.earliestDate = workDate;
      if (workDate && (!current.earliestDate || workDate < current.earliestDate)) current.earliestDate = workDate;

      current.techGroups.set(techKey, techGroup);
      groupedActs.set(activityName, current);
    });
    const activityRows = Array.from(groupedActs.values())
      .sort((a, b) => {
        if (b.overdue !== a.overdue) return b.overdue - a.overdue;
        if (b.pending !== a.pending) return b.pending - a.pending;
        if (a.earliestDate && b.earliestDate) return a.earliestDate - b.earliestDate;
        if (a.earliestDate) return -1;
        if (b.earliestDate) return 1;
        return a.label.localeCompare(b.label);
      })
      .map((group, groupIdx) => {
      const groupHours = group.activities.reduce((acc, a) => acc + asNumber(a.hoursWorked), 0);
      const techGroupRows = Array.from(group.techGroups.values())
        .sort((a, b) => {
          if (b.overdue !== a.overdue) return b.overdue - a.overdue;
          if (b.pending !== a.pending) return b.pending - a.pending;
          if (a.earliestDate && b.earliestDate) return a.earliestDate - b.earliestDate;
          if (a.earliestDate) return -1;
          if (b.earliestDate) return 1;
          return a.label.localeCompare(b.label);
        })
        .map((techGroup, techIdx) => {
        const techGroupHours = techGroup.activities.reduce((acc, a) => acc + asNumber(a.hoursWorked), 0);
        const activityCards = techGroup.activities.map(a => {
      const canTechFill = isUserTech && ["admin","gestor","coordenador"].includes((a.createdByRole || "").toLowerCase());
      const assignedTechs = Array.isArray(a.techNames) && a.techNames.length ? a.techNames.join(", ") : "Sem tecnico";
      const workDate = parseDateOnly(a.workDate);
      const isOverdue = Boolean(workDate && workDate < today && a.status !== "os_gerada");
      return `
        <div class="activity-item ${isOverdue ? "overdue" : (a.status === "os_gerada" ? "ok" : "pending")}">
          <div class="activity-main">
            <div>
              <b>${escapeHtml(a.name || "Atividade")}</b>
              <div class="activity-meta-line">${escapeHtml(fmtDate(a.workDate))} | ${escapeHtml(String(a.hoursWorked || 0))}h</div>
            </div>
            <span class="activity-status ${isOverdue ? "orange" : (a.status === "os_gerada" ? "green" : "red")}">${isOverdue ? "Atrasada" : (a.status === "os_gerada" ? "OS Gerada" : "Sem Ordem de Servico")}</span>
          </div>
          <div class="activity-tags">
            <span class="activity-tag">Tecnicos: ${escapeHtml(assignedTechs)}</span>
            <span class="activity-tag">Key users: ${escapeHtml(Array.isArray(a.keyUsers) && a.keyUsers.length ? a.keyUsers.join(", ") : "-")}</span>
            ${isOverdue ? `<span class="activity-tag activity-tag--warn">Acao necessaria</span>` : ""}
          </div>
          ${canTechFill ? `
            <div class="activity-tech-fill">
              <input type="time" id="actStart-${escapeHtml(a.id)}" />
              <input type="time" id="actEnd-${escapeHtml(a.id)}" />
              <textarea id="actObs-${escapeHtml(a.id)}" rows="2" placeholder="Observacao do tecnico (minimo 50 caracteres)">${escapeHtml(a.note || "")}</textarea>
              <button class="btn primary sm" data-save-tech-fill="${escapeHtml(a.id)}" type="button">Salvar preenchimento</button>
            </div>
          ` : ""}
        </div>
      `;
      }).join("");
      return `
        <details class="activity-group activity-group--nested" ${techIdx === 0 ? "open" : ""}>
          <summary class="activity-group-summary">
            <div>
              <div class="activity-group-title">${escapeHtml(techGroup.label)}</div>
              <div class="activity-group-subtitle">${escapeHtml(String(techGroup.activities.length))} atividade(s) | ${escapeHtml(String(techGroupHours))}h | Pendentes: ${escapeHtml(String(techGroup.pending))}</div>
            </div>
            <span class="activity-group-toggle">Expandir</span>
          </summary>
          <div class="activity-group-list">
            ${activityCards}
          </div>
        </details>
      `;
      }).join("");
      return `
        <details class="activity-group" ${groupIdx === 0 ? "open" : ""}>
          <summary class="activity-group-summary">
            <div>
              <div class="activity-group-title">${escapeHtml(group.label)}</div>
              <div class="activity-group-subtitle">${escapeHtml(String(group.activities.length))} atividade(s) | ${escapeHtml(String(groupHours))}h | Tecnicos: ${escapeHtml(String(group.techGroups.size))} | Pendentes: ${escapeHtml(String(group.pending))}</div>
            </div>
            <span class="activity-group-toggle">Expandir</span>
          </summary>
          <div class="activity-group-list">
            <div class="activity-subsection-title">Tecnicos com esta atividade</div>
            ${techGroupRows}
          </div>
        </details>
      `;
    }).join("");

    const rangeDisabled = canUseRangeForActivities(state) ? "" : "disabled";
    const keyUserOptions = keyUsers.map((ku, idx) => {
      const label = ku.name || ku.email || ku.phone || `Key user ${idx + 1}`;
      return `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`;
    }).join("");
    const techOptions = projectTechs.map((t) => (
      `<option value="${escapeHtml(t.uid)}">${escapeHtml(t.name)}</option>`
    )).join("");

    return `
      <details class="task-card task-tree ${statusCounters.overdue ? "task-card--overdue" : ""}" ${statusCounters.overdue || !_tasks.indexOf(t) ? "open" : ""}>
        <summary class="task-summary">
          <div class="task-summary-main">
            <div class="task-head-main">
              <div class="task-step">Tarefa</div>
              <div class="task-title-row">
                <h4>#${escapeHtml(String(t.taskNumber || "-"))} ${escapeHtml(t.name || "")}</h4>
                <span class="task-validity-inline">Validade: ${escapeHtml(fmtDate(t.startDate))} ate ${escapeHtml(fmtDate(t.endDate))}</span>
              </div>
            </div>
            <div class="task-summary-statuses">
              <div class="task-top-metrics">
                <div class="task-kpis">
                ${isUserTech ? `<span class="kpi">Horas orcadas: <b>-</b></span>` : `<span class="kpi">Horas orcadas: <b>${escapeHtml(String(planned))}h</b></span>`}
                <span class="kpi">Horas trabalhadas: <b>${escapeHtml(String(worked))}h</b></span>
                <span class="kpi">Saldo disponivel: <b>${escapeHtml(String(balance))}h</b></span>
                <span class="kpi">Atividades: <b>${escapeHtml(String(taskActs.length))}</b></span>
                </div>
                <div class="task-status-strip">
                  <span class="task-status-pill task-status-pill--pending">${iconPending} Sem OS: <b>${escapeHtml(String(statusCounters.pending))}</b></span>
                  <span class="task-status-pill task-status-pill--done">${iconDone} OS Gerada: <b>${escapeHtml(String(statusCounters.done))}</b></span>
                  <span class="task-status-pill task-status-pill--overdue">${iconOverdue} Atrasadas: <b>${escapeHtml(String(statusCounters.overdue))}</b></span>
                </div>
              </div>
            </div>
          </div>
          <div class="task-summary-right">
            <button class="btn sm" data-open-activity-form="${escapeHtml(t.id)}" type="button">+ Atividade</button>
            <span class="task-toggle-label">Expandir</span>
          </div>
        </summary>
        <div class="task-body">
          <div class="panel subtle" id="activityFormWrap-${escapeHtml(t.id)}" hidden>
          <div class="project-form-grid">
            <label class="field">
              <span>Nome da atividade</span>
              <input id="actName-${escapeHtml(t.id)}" maxlength="100" placeholder="Ex.: Reuniao com cliente" />
            </label>
            <label class="field">
              <span>Modo de data</span>
              <select id="actMode-${escapeHtml(t.id)}">
                <option value="single">Dia unico</option>
                <option value="range" ${rangeDisabled}>Range de dias</option>
              </select>
            </label>
            <label class="field">
              <span>Dia da atividade</span>
              <input type="date" id="actDate-${escapeHtml(t.id)}" />
            </label>
            <label class="field">
              <span>Range inicio</span>
              <input type="date" id="actRangeStart-${escapeHtml(t.id)}" />
            </label>
            <label class="field">
              <span>Range fim</span>
              <input type="date" id="actRangeEnd-${escapeHtml(t.id)}" />
            </label>
            <label class="field">
              <span>Horas (1 a 12)</span>
              <input type="number" id="actHours-${escapeHtml(t.id)}" min="1" max="12" step="0.5" placeholder="8" />
            </label>
            <div class="field">
              <span>Key users</span>
              <select id="actKeyUsers-${escapeHtml(t.id)}" data-activity-keyuser-select="${escapeHtml(t.id)}">
                <option value="">Selecione um key user</option>
                ${keyUserOptions || `<option value="" disabled>Nenhum key user vinculado ao cliente do projeto</option>`}
              </select>
              <div class="help">Selecao multipla em chips coloridos.</div>
              <input type="hidden" id="actSelectedKeyUsers-${escapeHtml(t.id)}" value="[]" />
              <div id="actKeyUsersChips-${escapeHtml(t.id)}" class="chips project-tech-chips activity-selection-chips"><span class="muted">Nenhum selecionado.</span></div>
            </div>
            <div class="field">
              <span>Tecnicos do projeto</span>
              <select id="actTechs-${escapeHtml(t.id)}" data-activity-tech-select="${escapeHtml(t.id)}">
                <option value="">Selecione um tecnico</option>
                ${techOptions || `<option value="" disabled>Nenhum tecnico vinculado ao projeto</option>`}
              </select>
              <div class="help">Selecao multipla em chips coloridos.</div>
              <input type="hidden" id="actSelectedTechs-${escapeHtml(t.id)}" value="[]" />
              <div id="actTechsChips-${escapeHtml(t.id)}" class="chips project-tech-chips activity-selection-chips"><span class="muted">Nenhum selecionado.</span></div>
            </div>
            <label class="field span-2">
              <span>Observacao</span>
              <textarea id="actObsInput-${escapeHtml(t.id)}" rows="2" placeholder="Observacao da atividade"></textarea>
            </label>
          </div>
          <div class="weekdays-pills" id="actWeekdays-${escapeHtml(t.id)}">
            ${[1,2,3,4,5,6,0].map(d => `<label class="weekday-pill"><input type="checkbox" value="${d}" />${weekdayName(d)}</label>`).join("")}
          </div>
          <div class="project-form-actions">
            <button class="btn ghost sm" data-cancel-activity-form="${escapeHtml(t.id)}" type="button">Cancelar</button>
            <button class="btn primary sm" data-save-activity="${escapeHtml(t.id)}" type="button">Salvar atividade</button>
          </div>
          </div>

          <div class="activity-tree">
            <div class="activity-tree-head">
              <div>
                <div class="task-step">Atividades</div>
                <div class="muted">Agrupadas por nome da atividade e expandidas por tecnicos.</div>
              </div>
              <span class="activity-tree-hint">Clique nos grupos para expandir</span>
            </div>
            <div class="activity-list">${activityRows || `<p class="muted">Sem atividades.</p>`}</div>
          </div>
        </div>
      </details>
    `;
  }).join("");
}

async function loadProjectData(deps, projectId){
  const { db, state } = deps;
  const companyId = state.companyId;
  if (!companyId) throw new Error("Empresa não identificada.");

  await ensureWorkspaceContext(deps);
  try { await ensureClientsCache(deps); } catch (_) {}

  const pSnap = await getDoc(doc(db, `companies/${companyId}/projects`, projectId));
  if (!pSnap.exists()) throw new Error("Projeto não encontrado.");
  _activeProject = { id: pSnap.id, ...pSnap.data() };

  const tSnap = await getDocs(query(collection(db, `companies/${companyId}/tasks`), where("projectId", "==", projectId)));
  _tasks = tSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => asNumber(a.taskNumber) - asNumber(b.taskNumber));

  const aSnap = await getDocs(query(collection(db, `companies/${companyId}/activities`), where("projectId", "==", projectId)));
  _activities = aSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => String(a.workDate || "").localeCompare(String(b.workDate || "")));
}

async function saveTask(deps){
  const { refs, state, db, auth } = deps;
  if (!canManageTasks(state)){
    setAlert(refs.projectTaskAlert, "Somente gestor, admin e coordenador podem criar tarefas.", "error");
    return;
  }
  clearAlert(refs.projectTaskAlert);
  const name = (refs.taskNameInput?.value || "").trim();
  const startDate = refs.taskStartDateInput?.value || "";
  const endDate = refs.taskEndDateInput?.value || "";
  const plannedHours = asNumber(refs.taskPlannedHoursInput?.value || 0);
  if (!name || !startDate || !endDate){
    setAlert(refs.projectTaskAlert, "Preencha nome e período da tarefa.", "error");
    return;
  }
  if (parseDateOnly(endDate) < parseDateOnly(startDate)){
    setAlert(refs.projectTaskAlert, "A data final da tarefa não pode ser menor que a inicial.", "error");
    return;
  }

  const projectHours = asNumber(_activeProject?.billingHours || 0);
  const totalPlanned = _tasks.reduce((acc, t) => acc + asNumber(t.plannedHours), 0);
  if (projectHours > 0 && (totalPlanned + plannedHours) > projectHours){
    const saldo = Math.max(0, projectHours - totalPlanned);
    setAlert(refs.projectTaskAlert, `Horas orçadas excedem o projeto. Saldo disponível: ${saldo}h`, "error");
    return;
  }

  const overlaps = _tasks.filter(t => overlap(startDate, endDate, t.startDate, t.endDate));
  if (overlaps.length){
    const names = overlaps.map(t => t.name).join(", ");
    setAlert(refs.projectTaskAlert, `Aviso: já existem tarefas neste período (${names}).`, "info");
  }

  const companyId = state.companyId;
  const uid = auth?.currentUser?.uid || "";
  const nextTaskNumber = _tasks.reduce((mx, t) => Math.max(mx, asNumber(t.taskNumber)), 0) + 1;
  const taskId = `tsk-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const payload = {
    taskNumber: nextTaskNumber,
    projectId: _activeProject.id,
    projectName: _activeProject.name || "",
    name,
    startDate,
    endDate,
    plannedHours,
    createdBy: uid,
    createdByRole: roleOf(state),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid
  };
  await setDoc(doc(db, `companies/${companyId}/tasks`, taskId), payload);
  refs.projectTaskFormWrap.hidden = true;
  clearTaskForm(refs);
  await refreshWorkspace(deps);
}

async function saveActivity(taskId, deps){
  const { refs, state, db, auth } = deps;
  const task = _tasks.find(t => t.id === taskId);
  if (!task) return;
  const projectKeyUsers = keyUsersFromProjectClient(state, _activeProject);

  const name = (document.getElementById(`actName-${taskId}`)?.value || "").trim();
  const mode = (document.getElementById(`actMode-${taskId}`)?.value || "single").trim();
  const singleDate = document.getElementById(`actDate-${taskId}`)?.value || "";
  const rangeStart = document.getElementById(`actRangeStart-${taskId}`)?.value || "";
  const rangeEnd = document.getElementById(`actRangeEnd-${taskId}`)?.value || "";
  const hoursWorked = asNumber(document.getElementById(`actHours-${taskId}`)?.value || 0);
  const note = (document.getElementById(`actObsInput-${taskId}`)?.value || "").trim();
  const keyUsers = getActivitySelectionValues(taskId, "KeyUsers").map(item => item?.value).filter(Boolean);
  const techUids = getActivitySelectionValues(taskId, "Techs").map(item => item?.value).filter(Boolean);

  if (!name || hoursWorked <= 0){
    setAlert(refs.projectTaskAlert, "Preencha nome e horas da atividade.", "error");
    return;
  }
  if (!projectKeyUsers.length){
    setAlert(refs.projectTaskAlert, "Nao ha key user vinculado ao cliente deste projeto. Cadastre key user no cliente para incluir atividades.", "error");
    return;
  }
  if (!keyUsers.length){
    setAlert(refs.projectTaskAlert, "Selecione ao menos um key user para a atividade.", "error");
    return;
  }
  if (hoursWorked > 12){
    setAlert(refs.projectTaskAlert, "A atividade aceita no máximo 12 horas por dia.", "error");
    return;
  }
  if (!techUids.length){
    setAlert(refs.projectTaskAlert, "Selecione ao menos um tecnico do projeto para a atividade.", "error");
    return;
  }

  if (mode === "range" && !canUseRangeForActivities(state)){
    setAlert(refs.projectTaskAlert, "Técnico só pode incluir atividade em dia único.", "error");
    return;
  }

  const companyId = state.companyId;
  const uid = auth?.currentUser?.uid || "";
  const creatorRole = roleOf(state);
  const techNames = techsFromProject(state, _activeProject)
    .filter(t => techUids.includes(t.uid))
    .map(t => t.name);
  let dates = [];
  if (mode === "single"){
    if (!singleDate){
      setAlert(refs.projectTaskAlert, "Informe o dia da atividade.", "error");
      return;
    }
    dates = [singleDate];
  } else {
    if (!rangeStart || !rangeEnd){
      setAlert(refs.projectTaskAlert, "Informe o range de dias.", "error");
      return;
    }
    const weekdayChecks = Array.from(document.querySelectorAll(`#actWeekdays-${taskId} input[type=checkbox]:checked`));
    if (!weekdayChecks.length){
      setAlert(refs.projectTaskAlert, "Selecione ao menos um dia da semana para o range.", "error");
      return;
    }
    const setDays = new Set(weekdayChecks.map(x => Number(x.value)));
    dates = datesForRangeByWeekdays(rangeStart, rangeEnd, setDays);
    if (!dates.length){
      setAlert(refs.projectTaskAlert, "Nenhum dia útil gerado para o range selecionado.", "error");
      return;
    }
  }

  // datas dentro da validade da tarefa
  for (const d of dates){
    if (!overlap(d, d, task.startDate, task.endDate)){
      setAlert(refs.projectTaskAlert, `A data ${fmtDate(d)} está fora do período da tarefa.`, "error");
      return;
    }
  }

  for (const d of dates){
    const actId = `act-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    await setDoc(doc(db, `companies/${companyId}/activities`, actId), {
      projectId: _activeProject.id,
      taskId,
      taskName: task.name || "",
      name,
      workDate: d,
      hoursWorked,
      techUids,
      techNames,
      keyUsers,
      note,
      status: "sem_os",
      createdBy: uid,
      createdByRole: creatorRole,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: uid
    });
  }

  await refreshWorkspace(deps);
}

async function saveTechFill(activityId, deps){
  const { refs, state, db, auth } = deps;
  const act = _activities.find(a => a.id === activityId);
  if (!act) return;

  const start = document.getElementById(`actStart-${activityId}`)?.value || "";
  const end = document.getElementById(`actEnd-${activityId}`)?.value || "";
  const note = (document.getElementById(`actObs-${activityId}`)?.value || "").trim();
  const hoursDiff = diffHours(start, end);
  const maxHours = asNumber(act.hoursWorked);

  if (hoursDiff <= 0){
    setAlert(refs.projectTaskAlert, "Informe hora início e fim válidas.", "error");
    return;
  }
  if (hoursDiff > maxHours){
    setAlert(refs.projectTaskAlert, `A soma início/fim não pode ultrapassar ${maxHours}h.`, "error");
    return;
  }
  if (note.length < 50){
    setAlert(refs.projectTaskAlert, "A observação precisa ter no mínimo 50 caracteres.", "error");
    return;
  }

  const companyId = state.companyId;
  const uid = auth?.currentUser?.uid || "";
  await updateDoc(doc(db, `companies/${companyId}/activities`, activityId), {
    startTime: start,
    endTime: end,
    note,
    status: "os_gerada",
    updatedAt: serverTimestamp(),
    updatedBy: uid
  });

  await refreshWorkspace(deps);
}

async function refreshWorkspace(deps){
  if (!_activeProjectId) return;
  await loadProjectData(deps, _activeProjectId);
  const refs = _wsRefs(deps);
  const { state } = deps;
  renderTabs(refs);
  renderCover(refs, _activeProject, state);
  renderTasks(deps);
}

async function deleteActiveProject(deps){
  const { state, db } = deps;
  const refs = _wsRefs(deps);
  if (!_activeProjectId || !state?.companyId) return;

  if (_tasks.length || _activities.length){
    setAlert(refs.projectTaskAlert, "Nao e permitido excluir um projeto com tarefas ou atividades vinculadas.", "error");
    return;
  }

  const tasksSnap = await getDocs(query(collection(db, `companies/${state.companyId}/tasks`), where("projectId", "==", _activeProjectId)));
  const actsSnap = await getDocs(query(collection(db, `companies/${state.companyId}/activities`), where("projectId", "==", _activeProjectId)));
  if (!tasksSnap.empty || !actsSnap.empty){
    setAlert(refs.projectTaskAlert, "Nao e permitido excluir um projeto com tarefas ou atividades vinculadas.", "error");
    return;
  }

  const projectName = _activeProject?.name || "este projeto";
  if (!confirm(`Deseja realmente excluir ${projectName}?`)) return;

  await deleteDoc(doc(db, `companies/${state.companyId}/projects`, _activeProjectId));
  _tabs = _tabs.filter(t => t.id !== _activeProjectId);
  closeProjectWorkspace(deps);
}

export async function openProjectTab(projectId, deps){
  bindOnce(deps);
  const refs = _wsRefs(deps);
  await ensureTab(projectId, deps);
  renderTabs(refs);
}

export async function openProjectWorkspace(projectId, deps){
  bindOnce(deps);
  const refs = _wsRefs(deps);
  if (!refs.projectWorkspacePanel) return;
  await ensureTab(projectId, deps);
  _activeProjectId = projectId;
  setWorkspaceOpenUI(deps, true);
  if (refs.projectWorkspaceTitle) refs.projectWorkspaceTitle.textContent = "Carregando projeto...";
  if (refs.projectWorkspaceSubtitle) refs.projectWorkspaceSubtitle.textContent = `ID: ${projectId}`;
  if (refs.projectWorkspaceBreadcrumb) {
    refs.projectWorkspaceBreadcrumb.innerHTML = `<span class="crumb-current">Carregando projeto...</span>`;
  }
  if (refs.projectWorkspaceCover) {
    refs.projectWorkspaceCover.innerHTML = `<p class="muted">Carregando dados do projeto...</p>`;
  }
  if (refs.projectTaskList) {
    refs.projectTaskList.innerHTML = `<div class="panel subtle"><p class="muted">Carregando tarefas...</p></div>`;
  }

  try{
    await loadProjectData(deps, projectId);
    const label = `${_activeProject?.projectNumber || ""} ${_activeProject?.name || "Projeto"}`.trim();
    _tabs = _tabs.map(t => t.id === projectId ? { ...t, label } : t);
    if (refs.projectWorkspaceTitle) refs.projectWorkspaceTitle.textContent = "";
    if (refs.projectWorkspaceSubtitle) refs.projectWorkspaceSubtitle.textContent = "";
    if (refs.btnOpenWorkspaceView) refs.btnOpenWorkspaceView.style.display = "";
    if (refs.btnOpenWorkspaceEdit) refs.btnOpenWorkspaceEdit.style.display = isTech(deps.state) ? "none" : "";
    if (refs.btnDeleteWorkspaceProject) refs.btnDeleteWorkspaceProject.style.display = isTech(deps.state) ? "none" : "";
    if (refs.btnOpenTaskForm) refs.btnOpenTaskForm.style.display = canManageTasks(deps.state) ? "" : "none";
    if (refs.projectTaskFormWrap) refs.projectTaskFormWrap.hidden = true;
    clearAlert(refs.projectTaskAlert);
    clearTaskForm(refs);

    renderTabs(refs);
    if (refs.projectWorkspaceBreadcrumb) refs.projectWorkspaceBreadcrumb.innerHTML = "";
    renderCover(refs, _activeProject, deps.state);
    renderTasks(deps);
  }catch(err){
    console.error("[workspace] open error:", err);
    if (refs.projectTaskAlert) setAlert(refs.projectTaskAlert, err?.message || "Não foi possível abrir o workspace do projeto.", "error");
    if (refs.projectWorkspaceCover) {
      refs.projectWorkspaceCover.innerHTML = `<p class="muted">Não foi possível carregar os dados do projeto.</p>`;
    }
  }
}

export function closeProjectWorkspace(deps){
  const refs = _wsRefs(deps);
  setWorkspaceOpenUI(deps, false);
  _activeProjectId = "";
  _activeProject = null;
  if (refs.projectWorkspaceBreadcrumb) refs.projectWorkspaceBreadcrumb.innerHTML = "";
  renderTabs(refs);
}



