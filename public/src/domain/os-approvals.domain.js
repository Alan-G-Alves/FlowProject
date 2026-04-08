import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { hide, show, escapeHtml } from "../utils/dom.js";

let _bound = false;
let _itemsCache = [];
let _statusFilter = "pending";
let _selectedIds = new Set();

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function fmtDate(value) {
  if (!value) return "-";
  const raw = String(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatHours(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return "0h";
  const rounded = Math.round(num * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}h` : `${String(rounded).replace(".", ",")}h`;
}

function truncateText(value, max = 220) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}...`;
}

function buildSearchText(item) {
  return normalizeText([
    item.projectName,
    item.clientName,
    item.managerName,
    item.techName,
    item.taskName,
    item.note,
    item.workDate,
    fmtDate(item.workDate),
    item.statusLabel
  ].join(" "));
}

function itemMatchesStatus(item) {
  return _statusFilter === "approved"
    ? item.status === "os_aprovada"
    : item.status === "os_gerada";
}

function filteredItems(refs) {
  const q = normalizeText(refs.osApprovalsSearchInput?.value || "");
  const managerUid = refs.osApprovalsManagerFilter?.value || "";
  const projectId = refs.osApprovalsProjectFilter?.value || "";

  return _itemsCache.filter((item) => {
    if (!itemMatchesStatus(item)) return false;
    if (managerUid && item.managerUid !== managerUid) return false;
    if (projectId && item.projectId !== projectId) return false;
    if (q && !buildSearchText(item).includes(q)) return false;
    return true;
  });
}

function renderFilters(refs, items) {
  if (refs.osApprovalsManagerFilter) {
    const current = refs.osApprovalsManagerFilter.value || "";
    const managers = Array.from(new Map(
      items
        .filter((item) => item.managerUid)
        .map((item) => [item.managerUid, item.managerName || "Sem gestor"])
    ).entries()).sort((a, b) => a[1].localeCompare(b[1]));

    refs.osApprovalsManagerFilter.innerHTML = '<option value="">Todos</option>' +
      managers.map(([uid, name]) => `<option value="${escapeHtml(uid)}">${escapeHtml(name)}</option>`).join("");
    refs.osApprovalsManagerFilter.value = managers.some(([uid]) => uid === current) ? current : "";
  }

  if (refs.osApprovalsProjectFilter) {
    const current = refs.osApprovalsProjectFilter.value || "";
    const projects = Array.from(new Map(
      items
        .filter((item) => item.projectId)
        .map((item) => [item.projectId, item.projectName || "Projeto"])
    ).entries()).sort((a, b) => a[1].localeCompare(b[1]));

    refs.osApprovalsProjectFilter.innerHTML = '<option value="">Todos</option>' +
      projects.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("");
    refs.osApprovalsProjectFilter.value = projects.some(([id]) => id === current) ? current : "";
  }
}

function updateSummary(refs, items) {
  const pending = items.filter((item) => item.status === "os_gerada");
  const approved = items.filter((item) => item.status === "os_aprovada");
  const pendingHours = pending.reduce((acc, item) => acc + Number(item.workedHours || item.hoursWorked || 0), 0);
  const approvedHours = approved.reduce((acc, item) => acc + Number(item.workedHours || item.hoursWorked || 0), 0);

  if (refs.osApprovalsPendingCount) refs.osApprovalsPendingCount.textContent = String(pending.length);
  if (refs.osApprovalsApprovedCount) refs.osApprovalsApprovedCount.textContent = String(approved.length);
  if (refs.osApprovalsPendingHours) refs.osApprovalsPendingHours.textContent = formatHours(pendingHours);
  if (refs.osApprovalsApprovedHours) refs.osApprovalsApprovedHours.textContent = formatHours(approvedHours);
}

function syncStatusCards() {
  document.querySelectorAll("[data-os-approvals-status]").forEach((card) => {
    const isActive = (card.getAttribute("data-os-approvals-status") || "pending") === _statusFilter;
    card.classList.toggle("is-active", isActive);
    card.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function updateBulkBar(refs, visibleItems) {
  const selectedVisible = visibleItems.filter((item) => _selectedIds.has(item.id));
  if (refs.osApprovalsBulkMeta) {
    refs.osApprovalsBulkMeta.textContent = `${selectedVisible.length} selecionada(s)`;
  }
  if (refs.osApprovalsBulkBar) refs.osApprovalsBulkBar.hidden = visibleItems.length === 0;
  if (refs.btnOsApprovalsBulkAction) {
    refs.btnOsApprovalsBulkAction.disabled = selectedVisible.length === 0;
    refs.btnOsApprovalsBulkAction.textContent = _statusFilter === "approved"
      ? "Estornar selecionadas"
      : "Aprovar selecionadas";
  }
  if (refs.osApprovalsSelectAll) {
    refs.osApprovalsSelectAll.checked = visibleItems.length > 0 && selectedVisible.length === visibleItems.length;
    refs.osApprovalsSelectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleItems.length;
  }
}

function renderList(refs, items) {
  if (!refs.osApprovalsList) return;
  refs.osApprovalsList.innerHTML = "";

  if (!items.length) {
    show(refs.osApprovalsEmpty);
    updateBulkBar(refs, []);
    return;
  }

  hide(refs.osApprovalsEmpty);

  const html = items.map((item) => {
    const selected = _selectedIds.has(item.id);
    const noteShort = truncateText(item.note || "", 240);
    return `
      <article class="os-approval-card ${item.status === "os_aprovada" ? "is-approved" : "is-pending"}">
        <div class="os-approval-card-head">
          <label class="check os-approval-check">
            <input type="checkbox" data-os-select="${escapeHtml(item.id)}" ${selected ? "checked" : ""} />
            <span></span>
          </label>
          <div class="os-approval-card-title">
            <div class="os-approval-kicker">Projeto</div>
            <h3>${escapeHtml(item.projectName || "Projeto")}</h3>
            <p class="muted">${escapeHtml(item.taskName || "Tarefa")} • ${escapeHtml(item.techName || "Tecnico")}</p>
          </div>
          <div class="os-approval-card-status">
            <span class="os-approval-status-pill ${item.status === "os_aprovada" ? "approved" : "pending"}">${escapeHtml(item.statusLabel)}</span>
          </div>
        </div>

        <div class="os-approval-chip-row">
          ${item.clientName ? `<span class="activity-tag">Cliente: ${escapeHtml(item.clientName)}</span>` : ""}
          <span class="activity-tag">Gestor: ${escapeHtml(item.managerName || "-")}</span>
          <span class="activity-tag">Data: ${escapeHtml(fmtDate(item.workDate))}</span>
          <span class="activity-tag">Horas previstas: ${escapeHtml(formatHours(item.hoursWorked))}</span>
          <span class="activity-tag">Horas apontadas: ${escapeHtml(formatHours(item.workedHours || item.hoursWorked))}</span>
        </div>

        <div class="os-approval-note">${escapeHtml(noteShort || "Sem observacao registrada.")}</div>

        <details class="os-approval-details">
          <summary>Ver detalhes</summary>
          <div class="os-approval-details-grid">
            <div class="os-approval-detail-card">
              <span class="os-approval-detail-label">Inicio</span>
              <strong>${escapeHtml(item.startTime || "-")}</strong>
            </div>
            <div class="os-approval-detail-card">
              <span class="os-approval-detail-label">Fim</span>
              <strong>${escapeHtml(item.endTime || "-")}</strong>
            </div>
            <div class="os-approval-detail-card">
              <span class="os-approval-detail-label">Descanso</span>
              <strong>${escapeHtml(item.breakTime || "01:00")}</strong>
            </div>
            <div class="os-approval-detail-card">
              <span class="os-approval-detail-label">Key users</span>
              <strong>${escapeHtml((item.keyUsers || []).join(", ") || "-")}</strong>
            </div>
            ${item.status === "os_aprovada" ? `
              <div class="os-approval-detail-card">
                <span class="os-approval-detail-label">Aprovado por</span>
                <strong>${escapeHtml(item.approvedByName || item.approvedByEmail || "-")}</strong>
              </div>
              <div class="os-approval-detail-card">
                <span class="os-approval-detail-label">Aprovado em</span>
                <strong>${escapeHtml(item.approvedAtLabel || "-")}</strong>
              </div>
            ` : ""}
          </div>
          <div class="os-approval-details-note">${escapeHtml(item.note || "Sem observacao registrada.")}</div>
        </details>

        <div class="os-approval-actions">
          <button class="btn ${item.status === "os_aprovada" ? "ghost" : "primary"}" data-os-action="${item.status === "os_aprovada" ? "undo" : "approve"}" data-os-id="${escapeHtml(item.id)}" type="button">
            ${item.status === "os_aprovada" ? "Estornar aprovacao" : "Aprovar OS"}
          </button>
        </div>
      </article>
    `;
  }).join("");

  refs.osApprovalsList.innerHTML = html;
  updateBulkBar(refs, items);
}

function render(refs) {
  const visible = filteredItems(refs);
  syncStatusCards();
  renderList(refs, visible);
}

async function updateApprovalStatus(ids, nextStatus, deps) {
  const { state, db, auth } = deps;
  const currentUid = auth?.currentUser?.uid || "";
  const currentUser = (state._usersCache || []).find((item) => item.uid === currentUid) || null;
  const currentName = currentUser?.name || auth?.currentUser?.email || "";
  const currentEmail = auth?.currentUser?.email || "";

  for (const id of ids) {
    const payload = nextStatus === "os_aprovada"
      ? {
          status: "os_aprovada",
          approvedAt: serverTimestamp(),
          approvedBy: currentUid,
          approvedByName: currentName,
          approvedByEmail: currentEmail,
          approvalRevertedAt: null,
          approvalRevertedBy: null,
          approvalRevertedByName: null,
          updatedAt: serverTimestamp(),
          updatedBy: currentUid
        }
      : {
          status: "os_gerada",
          approvalRevertedAt: serverTimestamp(),
          approvalRevertedBy: currentUid,
          approvalRevertedByName: currentName,
          updatedAt: serverTimestamp(),
          updatedBy: currentUid
        };

    await updateDoc(doc(db, `companies/${state.companyId}/activities`, id), payload);
  }
}

function bindEvents(deps) {
  if (_bound) return;
  _bound = true;
  const { refs } = deps;

  document.querySelectorAll("[data-os-approvals-status]").forEach((card) => {
    const apply = () => {
      _statusFilter = card.getAttribute("data-os-approvals-status") || "pending";
      _selectedIds = new Set();
      render(refs);
    };
    card.addEventListener("click", apply);
    card.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        apply();
      }
    });
  });

  refs.osApprovalsSearchInput?.addEventListener("input", () => render(refs));
  refs.osApprovalsManagerFilter?.addEventListener("change", () => {
    _selectedIds = new Set();
    render(refs);
  });
  refs.osApprovalsProjectFilter?.addEventListener("change", () => {
    _selectedIds = new Set();
    render(refs);
  });
  refs.osApprovalsSelectAll?.addEventListener("change", () => {
    const visible = filteredItems(refs);
    if (refs.osApprovalsSelectAll.checked) {
      visible.forEach((item) => _selectedIds.add(item.id));
    } else {
      visible.forEach((item) => _selectedIds.delete(item.id));
    }
    render(refs);
  });
  refs.btnOsApprovalsBulkAction?.addEventListener("click", async () => {
    const visible = filteredItems(refs).filter((item) => _selectedIds.has(item.id));
    if (!visible.length) return;
    const nextStatus = _statusFilter === "approved" ? "os_gerada" : "os_aprovada";
    await updateApprovalStatus(visible.map((item) => item.id), nextStatus, deps);
    _selectedIds = new Set();
    await loadOsApprovals(deps);
  });
  refs.osApprovalsList?.addEventListener("change", (ev) => {
    const checkbox = ev.target?.closest?.("[data-os-select]");
    if (!checkbox) return;
    const id = checkbox.getAttribute("data-os-select");
    if (!id) return;
    if (checkbox.checked) _selectedIds.add(id);
    else _selectedIds.delete(id);
    render(refs);
  });
  refs.osApprovalsList?.addEventListener("click", async (ev) => {
    const btn = ev.target?.closest?.("[data-os-action]");
    if (!btn) return;
    const id = btn.getAttribute("data-os-id");
    const action = btn.getAttribute("data-os-action");
    if (!id || !action) return;
    await updateApprovalStatus([id], action === "undo" ? "os_gerada" : "os_aprovada", deps);
    _selectedIds.delete(id);
    await loadOsApprovals(deps);
  });
}

function visibleProjectsForRole(projects, role, currentUid) {
  if (role === "admin") return projects;
  if (role === "gestor") return projects.filter((project) => project.managerUid === currentUid);
  if (role === "coordenador") return projects.filter((project) => project.coordinatorUid === currentUid);
  return [];
}

export function openOsApprovalsView(deps) {
  bindEvents(deps);
  deps.setView("osApprovals");
  loadOsApprovals(deps).catch((err) => {
    console.error(err);
    alert("Nao foi possivel carregar a aprovacao de OS.");
  });
}

export async function loadOsApprovals(deps) {
  const { refs, state, db, auth } = deps;
  if (!refs.osApprovalsList) return;

  bindEvents(deps);
  refs.osApprovalsList.innerHTML = '<div class="panel subtle"><p class="muted">Carregando OS...</p></div>';
  hide(refs.osApprovalsEmpty);

  const companyId = state.companyId;
  const currentUid = auth?.currentUser?.uid || "";
  const role = String(state.profile?.role || "").toLowerCase();
  if (!companyId || !currentUid) {
    refs.osApprovalsList.innerHTML = "";
    show(refs.osApprovalsEmpty);
    return;
  }

  const [activitiesSnap, projectsSnap, usersSnap] = await Promise.all([
    getDocs(collection(db, `companies/${companyId}/activities`)),
    getDocs(collection(db, `companies/${companyId}/projects`)),
    getDocs(query(collection(db, `companies/${companyId}/users`)))
  ]);

  const users = usersSnap.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    return { uid: data.uid || docSnap.id, ...data };
  });
  state._usersCache = users;

  const usersByUid = new Map(users.map((user) => [user.uid, user]));
  const allProjects = projectsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const visibleProjects = visibleProjectsForRole(allProjects, role, currentUid);
  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));
  const projectsById = new Map(visibleProjects.map((project) => [project.id, project]));

  const items = activitiesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((activity) => ["os_gerada", "os_aprovada"].includes(String(activity.status || "").toLowerCase()))
    .filter((activity) => visibleProjectIds.has(activity.projectId))
    .map((activity) => {
      const project = projectsById.get(activity.projectId) || {};
      const manager = usersByUid.get(project.managerUid) || {};
      const techUid = Array.isArray(activity.techUids) ? activity.techUids[0] : "";
      const tech = usersByUid.get(techUid) || {};
      return {
        ...activity,
        status: String(activity.status || "").toLowerCase(),
        statusLabel: String(activity.status || "").toLowerCase() === "os_aprovada" ? "OS Aprovada" : "OS Gerada",
        projectId: activity.projectId || project.id || "",
        projectName: project.name || activity.projectName || "Projeto",
        clientName: project.clientName || project.client?.name || activity.clientName || "",
        managerUid: project.managerUid || "",
        managerName: manager.name || project.managerName || "Sem gestor",
        taskName: activity.taskName || "Tarefa",
        techName: Array.isArray(activity.techNames) && activity.techNames.length ? activity.techNames.join(", ") : (tech.name || "Tecnico"),
        workedHours: Number(activity.workedHours || 0),
        hoursWorked: Number(activity.hoursWorked || 0),
        keyUsers: Array.isArray(activity.keyUsers) ? activity.keyUsers : [],
        note: activity.note || "",
        approvedAtLabel: activity.approvedAt?.toDate ? activity.approvedAt.toDate().toLocaleDateString("pt-BR") : ""
      };
    })
    .sort((a, b) => String(b.workDate || "").localeCompare(String(a.workDate || "")));

  _itemsCache = items;
  _selectedIds = new Set(Array.from(_selectedIds).filter((id) => items.some((item) => item.id === id)));

  renderFilters(refs, items);
  updateSummary(refs, items);
  render(refs);
}
