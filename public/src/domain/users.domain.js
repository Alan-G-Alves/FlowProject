// public/src/domain/users.domain.js
// Lógica de negócio para gerenciamento de usuários da empresa (Admin)

import {
  doc,
  collection,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { show, hide } from "../utils/dom.js";
import { setAlert, clearAlert } from "../ui/alerts.js";
import { normalizeRole } from "../utils/roles.js";
import { normalizePhone } from "../utils/format.js";
import { isEmailValidBasic } from "../utils/validators.js";

// Helper para mostrar link de redefinição de senha
function setAlertWithResetLink(alertEl, msg, email, resetLink) {
  if (!alertEl) return;
  alertEl.hidden = false;
  alertEl.className = "alert success";
  alertEl.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <div>${msg}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <a href="${resetLink}" target="_blank" rel="noopener" style="color: inherit; text-decoration: underline;">Abrir link de definição de senha</a>
        <button class="btn sm" id="btnCopyResetLink">Copiar link</button>
      </div>
      <div class="muted" style="font-size:12px;">Envie este link para <b>${email}</b>. Ele serve para definir a senha no primeiro acesso.</div>
    </div>
  `;
  const btn = alertEl.querySelector("#btnCopyResetLink");
  btn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(resetLink);
      btn.textContent = "Copiado!";
      setTimeout(() => btn.textContent = "Copiar link", 1200);
    } catch (e) {
      alert("Não consegui copiar automaticamente. Copie manualmente pelo navegador.");
    }
  });
}

/** =========================
 *  USERS DOMAIN (Admin da Empresa)
 *  ========================= */

export async function loadUsers(deps) {
  const { refs, state, db, loadTeams, openManagedTeamsModal } = deps;
  if (!refs.usersTbody) return;

  refs.usersTbody.innerHTML = "";
  hide(refs.usersEmpty);

  const snap = await getDocs(collection(db, "companies", state.companyId, "users"));
  const all = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

  const q = (refs.userSearch?.value || "").toLowerCase().trim();

  state._usersCache = all;

  const filtered = all.filter(u => {
    const text = `${u.uid} ${u.name || ""} ${u.email || ""} ${u.phone || ""}`.toLowerCase();
    const okQ = !q || text.includes(q);
    const roleFilter = (refs.userRoleFilter?.value || "").trim();
    const okRole = !roleFilter || (u.role === roleFilter);
    return okQ && okRole;
  }).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  if (filtered.length === 0) {
    show(refs.usersEmpty);
    return;
  }

  for (const u of filtered) {
    const tr = document.createElement("tr");

    const teamIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
    const teamsLabel = teamIds.length ? teamIds.join(", ") : "—";
    const statusLabel = (u.active === false) ? "Inativo" : "Ativo";

    tr.innerHTML = `
      <td>
        <div style="display:flex; flex-direction:column; gap:2px;">
          <div><b>${u.name || "—"}</b></div>
          <div class="muted" style="font-size:12px;">UID: ${u.uid}</div>
        </div>
      </td>
      <td>${normalizeRole(u.role)}</td>
      <td>${u.email || "—"}</td>
      <td>${u.phone || "—"}</td>
      <td>${teamsLabel}</td>
      <td><span class="badge small">${statusLabel}</span></td>
      <td>
        <div class="action-row">
          <button class="btn sm" data-act="toggle">${u.active === false ? "Ativar" : "Inativar"}</button>${u.role === "gestor" ? `<button class="btn sm link" data-act="managed">Equipes gerenciadas</button>` : ""}${u.role !== "admin" ? `<button class="btn sm link" data-act="edit-teams">Equipes</button>` : ""}
        </div>
      </td>
    `;

    tr.querySelector('[data-act="toggle"]').addEventListener("click", async () => {
      const nextActive = (u.active === false);
      if (!confirm(`Deseja ${nextActive ? "ativar" : "inativar"} "${u.name}"?`)) return;
      await updateDoc(doc(db, "companies", state.companyId, "users", u.uid), { active: nextActive });
      await loadUsers(deps);
    });

    const btnManaged = tr.querySelector('[data-act="managed"]');
    if (btnManaged) {
      btnManaged.addEventListener("click", async () => {
        await loadTeams();
        openManagedTeamsModal(u.uid, u.name);
      });
    }
    refs.usersTbody.appendChild(tr);
  }
}

export function openCreateUserModal(deps) {
  const { refs, state, ensureTeamsForChips, renderTeamChips } = deps;
  if (!refs.modalCreateUser) return;
  clearAlert(refs.createUserAlert);
  refs.modalCreateUser.hidden = false;

  try {
    const uidLabel = refs.newUserUidEl?.closest("label");
    if (uidLabel) uidLabel.style.display = "none";
  } catch (_) { }

  refs.newUserUidEl.value = "";
  refs.newUserNameEl.value = "";
  refs.newUserRoleEl.value = "tecnico";
  refs.newUserEmailEl.value = "";
  refs.newUserPhoneEl.value = "";
  refs.newUserActiveEl.value = "true";

  state.selectedTeamIds = [];

  ensureTeamsForChips()
    .then(() => renderTeamChips())
    .catch(() => renderTeamChips());
}

export function closeCreateUserModal(refs) {
  if (refs.modalCreateUser) refs.modalCreateUser.hidden = true;
}

export function renderTeamChips(deps) {
  const { refs, state } = deps;
  if (!refs.teamChipsEl) return;
  refs.teamChipsEl.innerHTML = "";

  const activeTeams = (state.teams || []).filter(t => t.active !== false);

  if (activeTeams.length === 0) {
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.fontSize = "13px";
    hint.textContent = "Crie pelo menos 1 equipe para selecionar aqui.";
    refs.teamChipsEl.appendChild(hint);
    return;
  }

  for (const t of activeTeams) {
    const chip = document.createElement("div");
    chip.className = "chip-option" + (state.selectedTeamIds.includes(t.id) ? " selected" : "");
    chip.innerHTML = `<span class="dot"></span><span>${t.name}</span>`;

    chip.addEventListener("click", () => {
      const idx = state.selectedTeamIds.indexOf(t.id);
      if (idx >= 0) state.selectedTeamIds.splice(idx, 1);
      else state.selectedTeamIds.push(t.id);
      renderTeamChips(deps);
    });

    refs.teamChipsEl.appendChild(chip);
  }
}

export async function createUser(deps) {
  const { refs, state, db, auth, loadUsers } = deps;
  clearAlert(refs.createUserAlert);

  let uid = (refs.newUserUidEl?.value || "").trim();
  const name = (refs.newUserNameEl?.value || "").trim();
  const role = (refs.newUserRoleEl?.value || "").trim();
  const email = (refs.newUserEmailEl?.value || "").trim();
  const phone = normalizePhone(refs.newUserPhoneEl?.value || "");
  const active = (refs.newUserActiveEl?.value || "true") === "true";
  const teamIds = Array.from(new Set(state.selectedTeamIds || []));

  const wantsAutoAuth = !uid;

  if (!name) return setAlert(refs.createUserAlert, "Informe o nome do usuário.");
  if (!role) return setAlert(refs.createUserAlert, "Selecione a função.");
  if (!email || !isEmailValidBasic(email)) return setAlert(refs.createUserAlert, "Informe um e-mail válido.");

  if (role !== "admin" && teamIds.length === 0) {
    return setAlert(refs.createUserAlert, "Selecione pelo menos 1 equipe para este usuário.");
  }

  setAlert(refs.createUserAlert, "Salvando...", "info");

  try {
    if (wantsAutoAuth) {
      const { functions, httpsCallable, auth } = deps;
      
      if (!auth.currentUser) {
        return setAlert(refs.createUserAlert, "Erro: Você não está autenticado. Faça login novamente.");
      }
      
      console.log("🔧 Tentando criar usuário...");
      console.log("📦 Payload:", { companyId: state.companyId, name, email, role, teamIds });
      
      try {
        // Obter token
        const token = await auth.currentUser.getIdToken(true);
        console.log("✅ Token obtido");
        
        // Usar HTTP endpoint como workaround
        const projectId = "flowproject-17930";
        const region = "us-central1";
        const url = `https://${region}-${projectId}.cloudfunctions.net/createUserInTenantHttp`;
        
        console.log("🌐 Chamando HTTP endpoint:", url);
        
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            companyId: state.companyId,
            name,
            email,
            phone,
            role,
            teamIds
          })
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error?.message || "Erro ao criar usuário");
        }

        const result = await response.json();
        console.log("✅ Usuário criado:", result);

        uid = result.uid;
        const resetLink = result.resetLink;

        await loadUsers(deps);

        setAlertWithResetLink(
          refs.createUserAlert,
          `Usuário criado com sucesso!`,
          email,
          resetLink
        );
        
        return;
      } catch (funcErr) {
        console.error("❌ Erro:", funcErr);
        throw funcErr;
      }
    }

    // Fluxo manual (UID já existe no Auth)
    await setDoc(doc(db, "companies", state.companyId, "users", uid), {
      name,
      role,
      email,
      phone,
      active,
      teamIds,
      teamId: teamIds[0] || "",
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid
    });

    await setDoc(doc(db, "userCompanies", uid), { companyId: state.companyId });

    closeCreateUserModal(refs);
    await loadUsers(deps);

  } catch (err) {
    console.error(err);
    
    // Tratamento de erros específicos da Cloud Function
    if (err?.code === 'functions/already-exists') {
      setAlert(refs.createUserAlert, "Já existe um usuário com este e-mail.");
    } else if (err?.code === 'functions/permission-denied') {
      setAlert(refs.createUserAlert, "Você não tem permissão para criar este tipo de usuário.");
    } else if (err?.code === 'functions/invalid-argument') {
      setAlert(refs.createUserAlert, "Dados inválidos: " + (err?.message || "Verifique os campos."));
    } else {
      setAlert(refs.createUserAlert, "Erro ao salvar: " + (err?.message || err));
    }
  }
}

/**
 * Abrir modal para editar equipes do usuário
 */
export function openEditUserTeamsModal(uid, userName, currentTeamIds, deps) {
  const { refs, state } = deps;
  
  if (!refs.modalEditUserTeams) return;
  
  // Armazenar dados do usuário sendo editado
  state.editingUserUid = uid;
  state.editingUserTeamIds = [...(currentTeamIds || [])];
  
  // Atualizar título
  if (refs.editUserTeamsTitle) {
    refs.editUserTeamsTitle.textContent = `Selecione as equipes para ${userName}`;
  }
  
  // Limpar alert
  if (refs.editUserTeamsAlert) {
    refs.editUserTeamsAlert.hidden = true;
    refs.editUserTeamsAlert.textContent = "";
  }
  
  // Renderizar chips de equipes
  renderEditUserTeamsChips(deps);
  
  refs.modalEditUserTeams.hidden = false;
}

/**
 * Renderizar chips de equipes no modal de edição
 */
function renderEditUserTeamsChips(deps) {
  const { refs, state } = deps;
  
  if (!refs.editUserTeamsChips) return;
  
  refs.editUserTeamsChips.innerHTML = "";
  
  const teams = state.teams || [];
  const selectedIds = state.editingUserTeamIds || [];
  
  if (teams.length === 0) {
    refs.editUserTeamsChips.innerHTML = '<p class="muted">Nenhuma equipe cadastrada.</p>';
    return;
  }
  
  teams.forEach(team => {
    const isSelected = selectedIds.includes(team.id);
    
    const chip = document.createElement("button");
    chip.className = `chip ${isSelected ? "selected" : ""}`;
    chip.textContent = team.name;
    chip.type = "button";
    
    chip.addEventListener("click", () => {
      const index = state.editingUserTeamIds.indexOf(team.id);
      if (index > -1) {
        state.editingUserTeamIds.splice(index, 1);
      } else {
        state.editingUserTeamIds.push(team.id);
      }
      renderEditUserTeamsChips(deps);
    });
    
    refs.editUserTeamsChips.appendChild(chip);
  });
}

/**
 * Salvar equipes editadas do usuário
 */
export async function saveEditUserTeams(deps) {
  const { refs, state, db, auth } = deps;
  
  const uid = state.editingUserUid;
  const teamIds = state.editingUserTeamIds || [];
  
  if (!uid) {
    return setAlert(refs.editUserTeamsAlert, "Erro: usuário não identificado.");
  }
  
  setAlert(refs.editUserTeamsAlert, "Salvando...", "info");
  
  try {
    await updateDoc(doc(db, "companies", state.companyId, "users", uid), {
      teamIds,
      teamId: teamIds[0] || ""
    });
    
    // Fechar modal
    refs.modalEditUserTeams.hidden = true;
    
    // Recarregar lista
    const { loadUsers } = deps;
    if (loadUsers) await loadUsers(deps);
    
  } catch (err) {
    console.error(err);
    setAlert(refs.editUserTeamsAlert, "Erro ao salvar: " + (err?.message || err));
  }
}
