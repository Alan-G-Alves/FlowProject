import {
  collection,
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

function setWorkspaceOpenUI(deps, isOpen){
  const refs = _wsRefs(deps);
  if (refs.projectWorkspacePanel) refs.projectWorkspacePanel.hidden = !isOpen;
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
    projectWorkspaceTitle: r.projectWorkspaceTitle || byId("projectWorkspaceTitle"),
    projectWorkspaceSubtitle: r.projectWorkspaceSubtitle || byId("projectWorkspaceSubtitle"),
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
  if (!v) return "—";
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

function bindOnce(deps){
  if (_bound) return;
  _bound = true;
  const refs = _wsRefs(deps);

  refs.btnCloseProjectWorkspace?.addEventListener("click", () => {
    closeProjectWorkspace(deps);
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
  const teamName = (state.teams || []).find(t => t.id === project.teamId)?.name || "—";
  const status = project.status || "a-fazer";
  const client = project.clientName || "—";
  const manager = (state._usersCache || []).find(u => u.uid === project.managerUid)?.name || "—";

  refs.projectWorkspaceCover.innerHTML = `
    <div class="project-cover-title">${escapeHtml(project.name || "Projeto")}</div>
    <div class="project-cover-meta">
      <span class="badge small">Status: ${escapeHtml(status)}</span>
      <span class="badge small">Equipe: ${escapeHtml(teamName)}</span>
      <span class="badge small">Cliente: ${escapeHtml(client)}</span>
      <span class="badge small">Gestor: ${escapeHtml(manager)}</span>
      <span class="badge small">Horas projeto: ${escapeHtml(String(project.billingHours ?? "—"))}</span>
    </div>
  `;
}

function renderTasks(deps){
  const { refs, state } = deps;
  if (!refs.projectTaskList) return;
  const isUserTech = isTech(state);
  const keyUsers = keyUsersFromProjectClient(state, _activeProject);
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
    const activityRows = taskActs.map(a => {
      const canTechFill = isUserTech && ["admin","gestor","coordenador"].includes((a.createdByRole || "").toLowerCase());
      return `
        <div class="activity-item ${a.status === "os_gerada" ? "ok" : "pending"}">
          <div class="activity-main">
            <b>${escapeHtml(a.name || "Atividade")}</b>
            <span class="muted">${escapeHtml(fmtDate(a.workDate))} • ${escapeHtml(String(a.hoursWorked || 0))}h</span>
          </div>
          <div class="activity-status ${a.status === "os_gerada" ? "green" : "red"}">${a.status === "os_gerada" ? "OS Gerada" : "Sem Ordem de Serviço"}</div>
          ${canTechFill ? `
            <div class="activity-tech-fill">
              <input type="time" id="actStart-${escapeHtml(a.id)}" />
              <input type="time" id="actEnd-${escapeHtml(a.id)}" />
              <textarea id="actObs-${escapeHtml(a.id)}" rows="2" placeholder="Observação do técnico (mínimo 50 caracteres)">${escapeHtml(a.note || "")}</textarea>
              <button class="btn primary sm" data-save-tech-fill="${escapeHtml(a.id)}" type="button">Salvar preenchimento</button>
            </div>
          ` : ""}
        </div>
      `;
    }).join("");

    const rangeDisabled = canUseRangeForActivities(state) ? "" : "disabled";
    const keyUserOptions = keyUsers.map((ku, idx) => {
      const label = ku.name || ku.email || ku.phone || `Key user ${idx + 1}`;
      return `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`;
    }).join("");

    return `
      <article class="task-card">
        <div class="task-head">
          <div>
            <h4>#${escapeHtml(String(t.taskNumber || "—"))} ${escapeHtml(t.name || "")}</h4>
            <p class="muted">Validade: ${escapeHtml(fmtDate(t.startDate))} até ${escapeHtml(fmtDate(t.endDate))}</p>
          </div>
          <button class="btn sm" data-open-activity-form="${escapeHtml(t.id)}" type="button">+ Atividade</button>
        </div>
        <div class="task-kpis">
          ${isUserTech ? `<span class="kpi">Horas orçadas: <b>—</b></span>` : `<span class="kpi">Horas orçadas: <b>${escapeHtml(String(planned))}h</b></span>`}
          <span class="kpi">Horas trabalhadas: <b>${escapeHtml(String(worked))}h</b></span>
          <span class="kpi">Saldo disponível: <b>${escapeHtml(String(balance))}h</b></span>
        </div>

        <div class="panel subtle" id="activityFormWrap-${escapeHtml(t.id)}" hidden>
          <div class="project-form-grid">
            <label class="field">
              <span>Nome da atividade</span>
              <input id="actName-${escapeHtml(t.id)}" maxlength="100" placeholder="Ex.: Reunião com cliente" />
            </label>
            <label class="field">
              <span>Modo de data</span>
              <select id="actMode-${escapeHtml(t.id)}">
                <option value="single">Dia único</option>
                <option value="range" ${rangeDisabled}>Range de dias</option>
              </select>
            </label>
            <label class="field">
              <span>Dia da atividade</span>
              <input type="date" id="actDate-${escapeHtml(t.id)}" />
            </label>
            <label class="field">
              <span>Range início</span>
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
            <label class="field">
              <span>Key users</span>
              <select id="actKeyUsers-${escapeHtml(t.id)}" multiple>${keyUserOptions}</select>
            </label>
            <label class="field span-2">
              <span>Observação</span>
              <textarea id="actObsInput-${escapeHtml(t.id)}" rows="2" placeholder="Observação da atividade"></textarea>
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

        <div class="activity-list">${activityRows || `<p class="muted">Sem atividades.</p>`}</div>
      </article>
    `;
  }).join("");
}

async function loadProjectData(deps, projectId){
  const { db, state } = deps;
  const companyId = state.companyId;
  if (!companyId) throw new Error("Empresa não identificada.");

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

  const name = (document.getElementById(`actName-${taskId}`)?.value || "").trim();
  const mode = (document.getElementById(`actMode-${taskId}`)?.value || "single").trim();
  const singleDate = document.getElementById(`actDate-${taskId}`)?.value || "";
  const rangeStart = document.getElementById(`actRangeStart-${taskId}`)?.value || "";
  const rangeEnd = document.getElementById(`actRangeEnd-${taskId}`)?.value || "";
  const hoursWorked = asNumber(document.getElementById(`actHours-${taskId}`)?.value || 0);
  const note = (document.getElementById(`actObsInput-${taskId}`)?.value || "").trim();
  const keyUsers = Array.from(document.getElementById(`actKeyUsers-${taskId}`)?.selectedOptions || []).map(o => o.value);

  if (!name || hoursWorked <= 0){
    setAlert(refs.projectTaskAlert, "Preencha nome e horas da atividade.", "error");
    return;
  }
  if (hoursWorked > 12){
    setAlert(refs.projectTaskAlert, "A atividade aceita no máximo 12 horas por dia.", "error");
    return;
  }

  if (mode === "range" && !canUseRangeForActivities(state)){
    setAlert(refs.projectTaskAlert, "Técnico só pode incluir atividade em dia único.", "error");
    return;
  }

  const companyId = state.companyId;
  const uid = auth?.currentUser?.uid || "";
  const creatorRole = roleOf(state);
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
    if (refs.projectWorkspaceTitle) refs.projectWorkspaceTitle.textContent = _activeProject?.name || "Projeto";
    if (refs.projectWorkspaceSubtitle) refs.projectWorkspaceSubtitle.textContent = `Projeto #${_activeProject?.projectNumber || "—"}`;
    if (refs.btnOpenTaskForm) refs.btnOpenTaskForm.style.display = canManageTasks(deps.state) ? "" : "none";
    if (refs.projectTaskFormWrap) refs.projectTaskFormWrap.hidden = true;
    clearAlert(refs.projectTaskAlert);
    clearTaskForm(refs);

    renderTabs(refs);
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
  renderTabs(refs);
}

