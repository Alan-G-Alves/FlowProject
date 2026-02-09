/**
 * projects.domain.js
 * Lógica de negócio para gestão de projetos
 */

import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { setAlert, clearAlert } from "../ui/alerts.js";
import { setView } from "../ui/router.js";
import { slugify } from "../utils/format.js";
import { escapeHtml } from "../utils/dom.js";
import { getTeamNameById, initialFromName } from "../utils/helpers.js";

/**
 * Abre a view de projetos
 */
export function openProjectsView(deps) {
  const { loadProjects } = deps;
  setView("projects");
  loadProjects().catch(err => {
    console.error(err);
    alert("Erro ao carregar projetos: " + (err?.message || err));
  });
}

/**
 * Carrega lista de projetos
 */
export async function loadProjects(deps) {
  const { refs, state, db } = deps;
  
  if (!refs.projectsGrid) return;
  
  refs.projectsGrid.innerHTML = '<div class="loading">Carregando projetos...</div>';
  
  if (refs.projectsEmpty) refs.projectsEmpty.hidden = true;
  
  try {
    const companyId = state.companyId;
    if (!companyId) throw new Error("companyId não encontrado");
    
    // Query base
    let q = query(
      collection(db, `companies/${companyId}/projects`),
      orderBy("createdAt", "desc")
    );
    
    // Filtros (se houver refs)
    const teamFilter = refs.projectTeamFilter?.value || "";
    const statusFilter = refs.projectStatusFilter?.value || "";
    const coordinatorFilter = refs.projectCoordinatorFilter?.value || "";
    const searchText = (refs.projectSearch?.value || "").trim().toLowerCase();
    
    const snap = await getDocs(q);
    let projects = [];
    
    snap.forEach(docSnap => {
      projects.push({ id: docSnap.id, ...docSnap.data() });
    });
    
    // Filtros client-side (nome, equipe, status, coordenador)
    if (searchText) {
      projects = projects.filter(p => 
        (p.name || "").toLowerCase().includes(searchText)
      );
    }
    
    if (teamFilter) {
      projects = projects.filter(p => p.teamId === teamFilter);
    }
    
    if (statusFilter) {
      projects = projects.filter(p => p.status === statusFilter);
    }
    
    if (coordinatorFilter) {
      projects = projects.filter(p => p.coordinatorUid === coordinatorFilter);
    }
    
    refs.projectsGrid.innerHTML = "";
    
    if (projects.length === 0) {
      if (refs.projectsEmpty) refs.projectsEmpty.hidden = false;
      return;
    }
    
    for (const proj of projects) {
      renderProjectCard(proj, deps);
    }
    
  } catch (err) {
    console.error("loadProjects error", err);
    refs.projectsGrid.innerHTML = '<div class="alert">Erro ao carregar projetos.</div>';
  }
}

/**
 * Renderiza card de projeto
 */
function renderProjectCard(proj, deps) {
  const { refs, state, openProjectDetailModal } = deps;
  
  const card = document.createElement("div");
  card.className = "card";
  card.style.gridColumn = "span 4";
  
  const statusBadge = getStatusBadge(proj.status);
  const priorityBadge = getPriorityBadge(proj.priority);
  const teamName = getTeamNameById(proj.teamId, state.teams);
  
  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
      <h3 class="title" style="margin:0;">${escapeHtml(proj.name || "Sem nome")}</h3>
      ${statusBadge}
    </div>
    <p class="desc" style="margin:6px 0 12px 0;">${escapeHtml(proj.description || "Sem descrição")}</p>
    <div class="meta" style="display:flex; gap:8px; flex-wrap:wrap;">
      ${priorityBadge}
      <span class="badge small">${escapeHtml(teamName)}</span>
    </div>
  `;
  
  card.addEventListener("click", () => {
    if (openProjectDetailModal) {
      openProjectDetailModal(proj.id);
    }
  });
  
  refs.projectsGrid.appendChild(card);
}

/**
 * Badge de status
 */
function getStatusBadge(status) {
  const map = {
    "a-fazer": '<span class="badge" style="background:rgba(59,130,246,.10); border-color:rgba(59,130,246,.25); color:#1e40af;">A Fazer</span>',
    "em-andamento": '<span class="badge" style="background:rgba(249,115,22,.10); border-color:rgba(249,115,22,.25); color:#c2410c;">Em Andamento</span>',
    "concluido": '<span class="badge badge-success">Concluído</span>'
  };
  return map[status] || '<span class="badge">—</span>';
}

/**
 * Badge de prioridade
 */
function getPriorityBadge(priority) {
  const map = {
    "baixa": '<span class="badge small" style="background:rgba(148,163,184,.10); border-color:rgba(148,163,184,.25);">Baixa</span>',
    "media": '<span class="badge small" style="background:rgba(249,115,22,.10); border-color:rgba(249,115,22,.25);">Média</span>',
    "alta": '<span class="badge small" style="background:rgba(239,68,68,.10); border-color:rgba(239,68,68,.25); color:#b91c1c;">Alta</span>'
  };
  return map[priority] || '<span class="badge small">—</span>';
}

/**
 * Abre modal de criar projeto
 */
export function openCreateProjectModal(deps) {
  const { refs, state } = deps;
  
  if (!refs.modalCreateProject) return;
  
  clearAlert(refs.createProjectAlert);
  
  // Limpa campos
  if (refs.projectNameEl) refs.projectNameEl.value = "";
  if (refs.projectDescriptionEl) refs.projectDescriptionEl.value = "";
  if (refs.projectTeamEl) refs.projectTeamEl.value = "";
  if (refs.projectCoordinatorEl) refs.projectCoordinatorEl.value = "";
  if (refs.projectStatusEl) refs.projectStatusEl.value = "a-fazer";
  if (refs.projectPriorityEl) refs.projectPriorityEl.value = "media";
  if (refs.projectStartDateEl) refs.projectStartDateEl.value = "";
  if (refs.projectEndDateEl) refs.projectEndDateEl.value = "";
  
  // Preenche select de equipes
  populateTeamSelect(refs.projectTeamEl, state.teams);
  
  // Preenche select de coordenadores (Gestores + Coordenadores da empresa)
  populateCoordinatorSelect(refs.projectCoordinatorEl, deps);
  
  refs.modalCreateProject.hidden = false;
  document.body.classList.add("modal-open");
}

/**
 * Fecha modal de criar projeto
 */
export function closeCreateProjectModal(refs) {
  if (!refs.modalCreateProject) return;
  refs.modalCreateProject.hidden = true;
  document.body.classList.remove("modal-open");
}

/**
 * Cria projeto
 */
export async function createProject(deps) {
  const { refs, state, db, auth, loadProjects } = deps;
  
  clearAlert(refs.createProjectAlert);
  
  const name = (refs.projectNameEl?.value || "").trim();
  const description = (refs.projectDescriptionEl?.value || "").trim();
  const teamId = refs.projectTeamEl?.value || "";
  const coordinatorUid = refs.projectCoordinatorEl?.value || "";
  const status = refs.projectStatusEl?.value || "a-fazer";
  const priority = refs.projectPriorityEl?.value || "media";
  const startDate = refs.projectStartDateEl?.value || "";
  const endDate = refs.projectEndDateEl?.value || "";
  
  if (!name) {
    setAlert(refs.createProjectAlert, "Informe o nome do projeto.");
    return;
  }
  
  if (!teamId) {
    setAlert(refs.createProjectAlert, "Selecione uma equipe.");
    return;
  }
  
  setAlert(refs.createProjectAlert, "Salvando...", "info");
  
  try {
    const companyId = state.companyId;
    const user = auth.currentUser;
    
    if (!companyId || !user) throw new Error("Não autenticado ou empresa não encontrada");
    
    const projectId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    const payload = {
      name,
      description,
      teamId,
      coordinatorUid: coordinatorUid || "",
      status,
      priority,
      startDate: startDate || null,
      endDate: endDate || null,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid
    };
    
    await setDoc(doc(db, `companies/${companyId}/projects`, projectId), payload);
    
    setAlert(refs.createProjectAlert, "Projeto criado com sucesso!", "success");
    
    setTimeout(() => {
      closeCreateProjectModal(refs);
      loadProjects();
    }, 600);
    
  } catch (err) {
    console.error("createProject error", err);
    setAlert(refs.createProjectAlert, "Erro ao criar projeto: " + (err?.message || err));
  }
}

/**
 * Popula select de equipes
 */
function populateTeamSelect(selectEl, teams) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Selecione uma equipe</option>';
  
  for (const team of teams) {
    const opt = document.createElement("option");
    opt.value = team.id;
    opt.textContent = team.name || team.id;
    selectEl.appendChild(opt);
  }
}

/**
 * Popula select de coordenadores (Gestores + Coordenadores)
 */
async function populateCoordinatorSelect(selectEl, deps) {
  if (!selectEl) return;
  
  const { state, db } = deps;
  
  selectEl.innerHTML = '<option value="">Selecione um coordenador (opcional)</option>';
  
  try {
    const companyId = state.companyId;
    if (!companyId) return;
    
    const snap = await getDocs(
      query(
        collection(db, `companies/${companyId}/users`),
        where("role", "in", ["gestor", "coordenador"]),
        where("active", "==", true)
      )
    );
    
    const users = [];
    snap.forEach(docSnap => {
      users.push({ uid: docSnap.id, ...docSnap.data() });
    });
    
    users.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    
    for (const u of users) {
      const opt = document.createElement("option");
      opt.value = u.uid;
      opt.textContent = `${u.name || "Sem nome"} (${u.role === "gestor" ? "Gestor" : "Coordenador"})`;
      selectEl.appendChild(opt);
    }
    
  } catch (err) {
    console.error("populateCoordinatorSelect error", err);
  }
}

/**
 * Abre modal de detalhes do projeto
 */
export async function openProjectDetailModal(projectId, deps) {
  const { refs, state, db } = deps;
  
  if (!refs.modalProjectDetail) return;
  
  clearAlert(refs.projectDetailAlert);
  
  try {
    const companyId = state.companyId;
    if (!companyId) throw new Error("companyId não encontrado");
    
    const docSnap = await getDoc(doc(db, `companies/${companyId}/projects`, projectId));
    
    if (!docSnap.exists()) {
      throw new Error("Projeto não encontrado");
    }
    
    const proj = { id: docSnap.id, ...docSnap.data() };
    
    // Preenche dados do modal
    if (refs.projectDetailTitle) refs.projectDetailTitle.textContent = proj.name || "Projeto";
    if (refs.projectDetailDescription) refs.projectDetailDescription.textContent = proj.description || "Sem descrição";
    if (refs.projectDetailTeam) refs.projectDetailTeam.textContent = getTeamNameById(proj.teamId, state.teams);
    if (refs.projectDetailStatus) refs.projectDetailStatus.innerHTML = getStatusBadge(proj.status);
    if (refs.projectDetailPriority) refs.projectDetailPriority.innerHTML = getPriorityBadge(proj.priority);
    
    // Coordenador
    if (refs.projectDetailCoordinator) {
      if (proj.coordinatorUid) {
        const coordSnap = await getDoc(doc(db, `companies/${companyId}/users`, proj.coordinatorUid));
        const coordName = coordSnap.exists() ? (coordSnap.data().name || "Sem nome") : "Não encontrado";
        refs.projectDetailCoordinator.textContent = coordName;
      } else {
        refs.projectDetailCoordinator.textContent = "Nenhum";
      }
    }
    
    // Datas
    if (refs.projectDetailStartDate) {
      refs.projectDetailStartDate.textContent = proj.startDate || "—";
    }
    if (refs.projectDetailEndDate) {
      refs.projectDetailEndDate.textContent = proj.endDate || "—";
    }
    
    // Botões de ação
    if (refs.btnEditProject) {
      refs.btnEditProject.onclick = () => {
        closeProjectDetailModal(refs);
        openEditProjectModal(projectId, deps);
      };
    }
    
    if (refs.btnDeleteProject) {
      refs.btnDeleteProject.onclick = async () => {
        if (!confirm(`Deseja realmente deletar o projeto "${proj.name}"?`)) return;
        
        try {
          await deleteDoc(doc(db, `companies/${companyId}/projects`, projectId));
          closeProjectDetailModal(refs);
          deps.loadProjects();
          alert("Projeto deletado com sucesso!");
        } catch (err) {
          console.error("deleteProject error", err);
          setAlert(refs.projectDetailAlert, "Erro ao deletar projeto.");
        }
      };
    }
    
    refs.modalProjectDetail.hidden = false;
    document.body.classList.add("modal-open");
    
  } catch (err) {
    console.error("openProjectDetailModal error", err);
    alert("Erro ao abrir detalhes do projeto: " + (err?.message || err));
  }
}

/**
 * Fecha modal de detalhes do projeto
 */
export function closeProjectDetailModal(refs) {
  if (!refs.modalProjectDetail) return;
  refs.modalProjectDetail.hidden = true;
  document.body.classList.remove("modal-open");
}

/**
 * Abre modal de editar projeto
 */
export async function openEditProjectModal(projectId, deps) {
  const { refs, state, db } = deps;
  
  if (!refs.modalEditProject) return;
  
  clearAlert(refs.editProjectAlert);
  
  try {
    const companyId = state.companyId;
    if (!companyId) throw new Error("companyId não encontrado");
    
    const docSnap = await getDoc(doc(db, `companies/${companyId}/projects`, projectId));
    
    if (!docSnap.exists()) {
      throw new Error("Projeto não encontrado");
    }
    
    const proj = { id: docSnap.id, ...docSnap.data() };
    
    // Preenche campos
    if (refs.editProjectNameEl) refs.editProjectNameEl.value = proj.name || "";
    if (refs.editProjectDescriptionEl) refs.editProjectDescriptionEl.value = proj.description || "";
    if (refs.editProjectTeamEl) refs.editProjectTeamEl.value = proj.teamId || "";
    if (refs.editProjectCoordinatorEl) refs.editProjectCoordinatorEl.value = proj.coordinatorUid || "";
    if (refs.editProjectStatusEl) refs.editProjectStatusEl.value = proj.status || "a-fazer";
    if (refs.editProjectPriorityEl) refs.editProjectPriorityEl.value = proj.priority || "media";
    if (refs.editProjectStartDateEl) refs.editProjectStartDateEl.value = proj.startDate || "";
    if (refs.editProjectEndDateEl) refs.editProjectEndDateEl.value = proj.endDate || "";
    
    // Preenche selects
    populateTeamSelect(refs.editProjectTeamEl, state.teams);
    await populateCoordinatorSelect(refs.editProjectCoordinatorEl, deps);
    
    // Define valores depois de preencher options
    if (refs.editProjectTeamEl) refs.editProjectTeamEl.value = proj.teamId || "";
    if (refs.editProjectCoordinatorEl) refs.editProjectCoordinatorEl.value = proj.coordinatorUid || "";
    
    // Salva ID do projeto no modal (para update)
    refs.modalEditProject.dataset.projectId = projectId;
    
    refs.modalEditProject.hidden = false;
    document.body.classList.add("modal-open");
    
  } catch (err) {
    console.error("openEditProjectModal error", err);
    alert("Erro ao abrir editor de projeto: " + (err?.message || err));
  }
}

/**
 * Fecha modal de editar projeto
 */
export function closeEditProjectModal(refs) {
  if (!refs.modalEditProject) return;
  refs.modalEditProject.hidden = true;
  document.body.classList.remove("modal-open");
}

/**
 * Atualiza projeto
 */
export async function updateProject(deps) {
  const { refs, state, db, auth, loadProjects } = deps;
  
  clearAlert(refs.editProjectAlert);
  
  const projectId = refs.modalEditProject?.dataset?.projectId;
  if (!projectId) {
    setAlert(refs.editProjectAlert, "ID do projeto não encontrado.");
    return;
  }
  
  const name = (refs.editProjectNameEl?.value || "").trim();
  const description = (refs.editProjectDescriptionEl?.value || "").trim();
  const teamId = refs.editProjectTeamEl?.value || "";
  const coordinatorUid = refs.editProjectCoordinatorEl?.value || "";
  const status = refs.editProjectStatusEl?.value || "a-fazer";
  const priority = refs.editProjectPriorityEl?.value || "media";
  const startDate = refs.editProjectStartDateEl?.value || "";
  const endDate = refs.editProjectEndDateEl?.value || "";
  
  if (!name) {
    setAlert(refs.editProjectAlert, "Informe o nome do projeto.");
    return;
  }
  
  if (!teamId) {
    setAlert(refs.editProjectAlert, "Selecione uma equipe.");
    return;
  }
  
  setAlert(refs.editProjectAlert, "Salvando...", "info");
  
  try {
    const companyId = state.companyId;
    const user = auth.currentUser;
    
    if (!companyId || !user) throw new Error("Não autenticado ou empresa não encontrada");
    
    const payload = {
      name,
      description,
      teamId,
      coordinatorUid: coordinatorUid || "",
      status,
      priority,
      startDate: startDate || null,
      endDate: endDate || null,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid
    };
    
    await updateDoc(doc(db, `companies/${companyId}/projects`, projectId), payload);
    
    setAlert(refs.editProjectAlert, "Projeto atualizado com sucesso!", "success");
    
    setTimeout(() => {
      closeEditProjectModal(refs);
      loadProjects();
    }, 600);
    
  } catch (err) {
    console.error("updateProject error", err);
    setAlert(refs.editProjectAlert, "Erro ao atualizar projeto: " + (err?.message || err));
  }
}
