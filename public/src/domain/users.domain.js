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
          <button class="btn sm" data-act="toggle">${u.active === false ? "Ativar" : "Inativar"}</button>${u.role === "gestor" ? `<button class="btn sm link" data-act="managed">Equipes</button>` : ""}
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

  setAlert(refs.createUserAlert, "Verificando e-mail...", "info");

  try {
    // VERIFICAR SE EMAIL JÁ EXISTE (em qualquer empresa)
    const q = query(collection(db, "platformUsers"), where("email", "==", email));
    const snap = await getDocs(q);
    
    if (!snap.empty) {
      return setAlert(refs.createUserAlert, "Este e-mail já está cadastrado no sistema.");
    }

    setAlert(refs.createUserAlert, "Salvando...", "info");

    if (wantsAutoAuth) {
      // Usar Cloud Function createUserInTenant (evita erro de permissão)
      const { functions, httpsCallable } = deps;
      const fnCreateUser = httpsCallable(functions, "createUserInTenant");
      
      const result = await fnCreateUser({
        companyId: state.companyId,
        name,
        email,
        phone,
        role,
        teamIds
      });

      uid = result.data.uid;
      const resetLink = result.data.resetLink;

      await loadUsers(deps);

      // Mostrar sucesso com link de redefinição
      setAlertWithResetLink(
        refs.createUserAlert,
        `Usuário criado com sucesso!`,
        email,
        resetLink
      );
      
      // Manter modal aberto para mostrar o link
      // Não fecha automaticamente
      
      return;
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
    setAlert(refs.createUserAlert, "Erro ao salvar: " + (err?.message || err));
  }
}
