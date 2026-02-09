// public/src/domain/teams.domain.js
// Lógica de negócio para gerenciamento de equipes (Admin da empresa)

import {
  doc,
  getDoc,
  collection,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { show, hide, escapeHtml } from "../utils/dom.js";
import { setAlert, clearAlert } from "../ui/alerts.js";
import { humanizeRole } from "../utils/roles.js";

/** =========================
 *  TEAMS DOMAIN
 *  ========================= */

export async function loadTeams(deps) {
  const { refs, state, db, openTeamDetailsModal } = deps;
  if (!refs.teamsGrid) return;

  refs.teamsGrid.innerHTML = "";
  hide(refs.teamsEmpty);

  const snap = await getDocs(collection(db, "companies", state.companyId, "teams"));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const q = (refs.teamSearch?.value || "").toLowerCase().trim();
  const filtered = !q ? all : all.filter(t =>
    (t.name || "").toLowerCase().includes(q) ||
    (t.id || "").toLowerCase().includes(q)
  );

  state.teams = filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  if (state.teams.length === 0) {
    show(refs.teamsEmpty);
    return;
  }

  for (const t of state.teams) {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <h3 class="title">${t.name || t.id}</h3>
      <p class="desc">ID: <b>${t.id}</b></p>
      <div class="meta">
        <span class="badge">${t.active === false ? "Inativa" : "Ativa"}</span>
      </div>
    `;
    el.addEventListener("click", async () => {
      await openTeamDetailsModal(t.id);
    });
    refs.teamsGrid.appendChild(el);
  }
}

export function closeTeamDetailsModal(deps) {
  const { refs, state } = deps;
  if (!refs.modalTeamDetails) return;
  refs.modalTeamDetails.hidden = true;
  clearAlert(refs.teamDetailsAlert);
  state.selectedTeamId = null;
}

export async function loadTeamMembers(teamId, deps) {
  const { refs, state, db, removeUserFromTeam, openTeamDetailsModal, loadUsers, loadManagerUsers } = deps;
  if (!refs.teamDetailsUsersEl) return [];
  refs.teamDetailsUsersEl.innerHTML = "";
  hide(refs.teamDetailsEmptyEl);

  const q = query(
    collection(db, "companies", state.companyId, "users"),
    where("teamIds", "array-contains", teamId)
  );

  const snap = await getDocs(q);
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  if (users.length === 0) {
    show(refs.teamDetailsEmptyEl);
    return [];
  }

  for (const u of users) {
    const row = document.createElement("div");
    row.className = "list-item";
    const roleLabel = humanizeRole(u.role);
    row.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center; justify-content:space-between;">
        <div style="min-width:0;">
          <div style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(u.name || "Sem nome")}</div>
          <div class="muted" style="font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${roleLabel} • ${escapeHtml(u.email || "—")}
          </div>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn sm danger" data-act="remove">Remover</button>
        </div>
      </div>
    `;

    row.querySelector('[data-act="remove"]').addEventListener("click", async () => {
      if (!confirm(`Remover "${u.name}" desta equipe?`)) return;
      try {
        await removeUserFromTeam(u.uid, teamId);
        await openTeamDetailsModal(teamId, { keepOpen: true });
        if (typeof loadUsers === "function") loadUsers().catch(() => { });
        if (typeof loadManagerUsers === "function") loadManagerUsers().catch(() => { });
      } catch (err) {
        console.error(err);
        setAlert(refs.teamDetailsAlert, "Erro ao remover usuário: " + (err?.message || err));
      }
    });

    refs.teamDetailsUsersEl.appendChild(row);
  }

  return users;
}

export async function removeUserFromTeam(uid, teamId, deps) {
  const { state, db } = deps;
  const ref = doc(db, "companies", state.companyId, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Usuário não encontrado.");
  const u = snap.data();

  const teamIds = Array.isArray(u.teamIds) ? u.teamIds.slice() : [];
  const nextTeamIds = teamIds.filter(t => t !== teamId);

  const updates = { teamIds: nextTeamIds };

  if ((u.teamId || "") === teamId) {
    updates.teamId = nextTeamIds[0] || "";
  }

  await updateDoc(ref, updates);
}

export async function openTeamDetailsModal(teamId, deps) {
  const { refs, state, db, loadTeams, openTeamDetailsModal, loadTeamMembers, renderTeamChips } = deps;
  if (!refs.modalTeamDetails) return;
  clearAlert(refs.teamDetailsAlert);
  refs.modalTeamDetails.hidden = false;
  state.selectedTeamId = teamId;
  state.currentTeamId = teamId; // Para usar no botão de adicionar usuários

  const teamRef = doc(db, "companies", state.companyId, "teams", teamId);
  const teamSnap = await getDoc(teamRef);
  if (!teamSnap.exists()) {
    setAlert(refs.teamDetailsAlert, "Equipe não encontrada.");
    return;
  }
  const team = { id: teamSnap.id, ...teamSnap.data() };

  refs.teamDetailsNameEl.value = team.name || team.id;
  refs.teamDetailsIdEl.value = team.id;
  refs.teamDetailsStatusEl.value = (team.active === false) ? "Inativa" : "Ativa";

  refs.btnTeamToggleActive.textContent = (team.active === false) ? "Ativar" : "Desativar";
  refs.btnTeamToggleActive.onclick = async () => {
    try {
      const nextActive = !(team.active === false);
      if (!confirm(`Deseja ${nextActive ? "ativar" : "inativar"} a equipe "${team.name}"?`)) return;
      await updateDoc(teamRef, { active: !nextActive });
      await loadTeams();
      await openTeamDetailsModal(teamId);
      if (!refs.modalCreateUser.hidden) renderTeamChips();
    } catch (err) {
      console.error(err);
      setAlert(refs.teamDetailsAlert, "Erro ao atualizar equipe: " + (err?.message || err));
    }
  };

  const members = await loadTeamMembers(teamId);

  refs.btnTeamDelete.disabled = members.length > 0;
  refs.btnTeamDelete.onclick = async () => {
    if (members.length > 0) return;
    if (!confirm(`Excluir definitivamente a equipe "${team.name}"?`)) return;
    try {
      await deleteDoc(teamRef);
      closeTeamDetailsModal(deps);
      await loadTeams();
      if (!refs.modalCreateUser.hidden) renderTeamChips();
    } catch (err) {
      console.error(err);
      setAlert(refs.teamDetailsAlert, "Erro ao excluir equipe: " + (err?.message || err));
    }
  };
}

export async function ensureTeamsForChips(deps) {
  const { state, db } = deps;
  if (!state.companyId) return;
  const snap = await getDocs(collection(db, "companies", state.companyId, "teams"));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.teams = all.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function getNextTeamId(deps) {
  const { state, db } = deps;
  if (!state.companyId) throw new Error("companyId ausente.");
  const snap = await getDocs(collection(db, "companies", state.companyId, "teams"));
  let maxN = 0;
  snap.forEach(d => {
    const id = d.id || "";
    const m = /^#(\d+)$/.exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n)) maxN = Math.max(maxN, n);
    }
  });
  return `#${maxN + 1}`;
}

export function openCreateTeamModal(deps) {
  const { refs, getNextTeamId } = deps;
  if (!refs.modalCreateTeam) return;
  clearAlert(refs.createTeamAlert);
  refs.modalCreateTeam.hidden = false;

  try {
    const idLabel = refs.teamIdEl?.closest("label");
    if (idLabel) idLabel.style.display = "none";
  } catch (_) { }

  refs.teamNameEl.value = "";
  refs.teamIdEl.value = "";

  getNextTeamId()
    .then(id => { refs.teamIdEl.value = id; })
    .catch(() => { refs.teamIdEl.value = ""; });
}

export function closeCreateTeamModal(refs) {
  if (refs.modalCreateTeam) refs.modalCreateTeam.hidden = true;
}

export async function createTeam(deps) {
  const { refs, state, db, auth, getNextTeamId, loadTeams } = deps;
  clearAlert(refs.createTeamAlert);

  const name = (refs.teamNameEl.value || "").trim();
  if (!name) return setAlert(refs.createTeamAlert, "Informe o nome da equipe.");

  setAlert(refs.createTeamAlert, "Salvando...", "info");

  const teamId = await getNextTeamId();

  await setDoc(doc(db, "companies", state.companyId, "teams", teamId), {
    name,
    active: true,
    number: parseInt(teamId.replace("#", ""), 10) || null,
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser.uid
  });

  closeCreateTeamModal(refs);
  await loadTeams();
}

/**
 * Abre modal para adicionar usuários à equipe
 */
export async function openAddUsersToTeamModal(teamId, teamName, deps) {
  const { refs, state, db } = deps;
  
  if (!refs.modalAddUsersToTeam) return;
  
  // Armazenar ID da equipe no state
  state.currentTeamId = teamId;
  state.selectedUsersToAdd = [];
  
  // Atualizar título
  refs.addUsersTeamName.textContent = `Selecione os usuários para adicionar à equipe: ${teamName}`;
  
  // Limpar alertas
  if (refs.addUsersToTeamAlert) {
    refs.addUsersToTeamAlert.hidden = true;
  }
  
  // Mostrar modal
  refs.modalAddUsersToTeam.hidden = false;
  
  // Carregar usuários disponíveis
  await loadAvailableUsers(deps);
}

/**
 * Carregar usuários que NÃO estão na equipe
 */
async function loadAvailableUsers(deps) {
  const { refs, state, db } = deps;
  const teamId = state.currentTeamId;
  
  if (!refs.addUsersToTeamList) return;
  
  refs.addUsersToTeamList.innerHTML = '<p class="muted">Carregando usuários...</p>';
  
  try {
    // Buscar todos os usuários da empresa
    const usersSnap = await getDocs(
      collection(db, "companies", state.companyId, "users")
    );
    
    // Filtrar usuários que NÃO estão na equipe
    const availableUsers = [];
    usersSnap.forEach(doc => {
      const data = doc.data();
      const userTeamIds = data.teamIds || [];
      
      // Se o usuário NÃO está na equipe, adiciona à lista
      if (!userTeamIds.includes(teamId)) {
        availableUsers.push({
          uid: doc.id,
          name: data.name,
          email: data.email,
          role: data.role
        });
      }
    });
    
    // Renderizar chips de usuários
    renderAvailableUsersChips(availableUsers, deps);
    
  } catch (err) {
    console.error(err);
    refs.addUsersToTeamList.innerHTML = '<p class="muted">Erro ao carregar usuários.</p>';
  }
}

/**
 * Renderizar chips de usuários disponíveis
 */
function renderAvailableUsersChips(users, deps) {
  const { refs, state } = deps;
  
  if (!refs.addUsersToTeamList) return;
  
  refs.addUsersToTeamList.innerHTML = '';
  
  if (users.length === 0) {
    refs.addUsersToTeamList.innerHTML = '<p class="muted">Todos os usuários já estão nesta equipe.</p>';
    return;
  }
  
  users.forEach(user => {
    const isSelected = state.selectedUsersToAdd.includes(user.uid);
    
    const chip = document.createElement("button");
    chip.className = `chip ${isSelected ? "selected" : ""}`;
    chip.type = "button";
    chip.innerHTML = `
      <strong>${escapeHtml(user.name)}</strong>
      <br>
      <small style="opacity:0.7;">${escapeHtml(user.email)}</small>
    `;
    
    chip.addEventListener("click", () => {
      const index = state.selectedUsersToAdd.indexOf(user.uid);
      if (index > -1) {
        state.selectedUsersToAdd.splice(index, 1);
      } else {
        state.selectedUsersToAdd.push(user.uid);
      }
      renderAvailableUsersChips(users, deps);
    });
    
    refs.addUsersToTeamList.appendChild(chip);
  });
}

/**
 * Salvar usuários adicionados à equipe
 */
export async function saveAddUsersToTeam(deps) {
  const { refs, state, db } = deps;
  const teamId = state.currentTeamId;
  const usersToAdd = state.selectedUsersToAdd || [];
  
  if (usersToAdd.length === 0) {
    setAlert(refs.addUsersToTeamAlert, "Selecione pelo menos um usuário.");
    return;
  }
  
  setAlert(refs.addUsersToTeamAlert, "Salvando...", "info");
  
  try {
    // Atualizar cada usuário selecionado
    for (const uid of usersToAdd) {
      const userRef = doc(db, "companies", state.companyId, "users", uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        const userData = userSnap.data();
        const currentTeamIds = userData.teamIds || [];
        
        // Adicionar o teamId se ainda não existe
        if (!currentTeamIds.includes(teamId)) {
          currentTeamIds.push(teamId);
          
          await updateDoc(userRef, {
            teamIds: currentTeamIds,
            teamId: currentTeamIds[0] || "" // Primeiro teamId como padrão
          });
        }
      }
    }
    
    // Fechar modal
    refs.modalAddUsersToTeam.hidden = true;
    
    // Recarregar detalhes da equipe
    const { openTeamDetailsModal } = deps;
    if (openTeamDetailsModal) {
      await openTeamDetailsModal(teamId, deps);
    }
    
  } catch (err) {
    console.error(err);
    setAlert(refs.addUsersToTeamAlert, "Erro ao adicionar usuários: " + (err?.message || err));
  }
}

/**
 * Fechar modal de adicionar usuários
 */
export function closeAddUsersToTeamModal(refs) {
  if (refs.modalAddUsersToTeam) {
    refs.modalAddUsersToTeam.hidden = true;
  }
}
