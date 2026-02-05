/**
 * manager-users.domain.js
 * Módulo de domínio para gestão de técnicos (Gestor)
 * 
 * Funcionalidades:
 * - CRUD de técnicos (usuários com role='tecnico')
 * - Gestão de equipes administradas pelo gestor
 * - Modal de criação de técnicos
 * - Modal de definição de equipes administradas
 */

import { collection, getDocs, doc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { setAlert, clearAlert } from "../ui/alerts.js";
import { show, hide, escapeHtml } from "../utils/dom.js";
import { normalizePhone, isEmailValidBasic } from "../utils/validators.js";

/** =========================
 *  GESTOR: USUÁRIOS (TÉCNICOS)
 *  ========================= */

export function openManagerUsersView(deps) {
  const { setView, loadTeams, loadManagerUsers } = deps;
  setView("managerUsers");
  Promise.all([loadTeams(), loadManagerUsers()]).catch(err => {
    console.error(err);
    alert("Erro ao carregar usuários do gestor: " + (err?.message || err));
  });
}

export function getManagedTeamIds(state) {
  const ids = state.profile?.managedTeamIds;
  return Array.isArray(ids) ? ids : [];
}

export function populateMgrTeamFilter(deps) {
  const { refs, state } = deps;
  if (!refs.mgrTeamFilter) return;
  
  const managedIds = getManagedTeamIds(state);
  refs.mgrTeamFilter.innerHTML = '<option value="">Todas as minhas equipes</option>';

  const activeManagedTeams = (state.teams || [])
    .filter(t => t.active !== false && managedIds.includes(t.id))
    .sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  for (const t of activeManagedTeams){
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name || t.id;
    refs.mgrTeamFilter.appendChild(opt);
  }
}

function intersects(arr1, arr2) {
  return arr1.some(item => arr2.includes(item));
}

export function getTeamNameById(state, teamId) {
  const t = (state.teams || []).find(t => t.id === teamId);
  return t?.name || teamId;
}

export async function loadManagerUsers(deps) {
  const { refs, state, db } = deps;
  if (!refs.mgrUsersTbody) return;

  refs.mgrUsersTbody.innerHTML = "";
  hide(refs.mgrUsersEmpty);

  const managedIds = getManagedTeamIds(state);
  populateMgrTeamFilter(deps);

  const snap = await getDocs(collection(db, "companies", state.companyId, "users"));
  const all = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

  const q = (refs.mgrUserSearch?.value || "").toLowerCase().trim();
  const teamFilter = (refs.mgrTeamFilter?.value || "").trim();

  const filtered = all.filter(u => {
    if (u.role !== "tecnico") return false;

    const teamIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
    if (!intersects(teamIds, managedIds)) return false;
    if (teamFilter && !teamIds.includes(teamFilter)) return false;

    const text = `${u.uid} ${u.name||""} ${u.email||""} ${u.phone||""}`.toLowerCase();
    if (q && !text.includes(q)) return false;

    return true;
  }).sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  if (filtered.length === 0){
    show(refs.mgrUsersEmpty);
    return;
  }

  for (const u of filtered){
    const tr = document.createElement("tr");
    const teamIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
    const teamsLabel = teamIds.length ? teamIds.map(tid => getTeamNameById(state, tid)).join(", ") : "—";
    const statusLabel = (u.active === false) ? "Inativo" : "Ativo";

    tr.innerHTML = `
      <td>
        <div style="display:flex; flex-direction:column; gap:2px;">
          <div><b>${escapeHtml(u.name || "—")}</b></div>
          <div class="muted" style="font-size:12px;">UID: ${escapeHtml(u.uid)}</div>
        </div>
      </td>
      <td>${escapeHtml(u.email || "—")}</td>
      <td>${escapeHtml(u.phone || "—")}</td>
      <td>${escapeHtml(teamsLabel)}</td>
      <td><span class="badge small">${statusLabel}</span></td>
      <td>
        <div class="action-row">
          <button class="btn sm" data-act="toggle">${u.active === false ? "Ativar" : "Inativar"}</button>
        </div>
      </td>
    `;

    tr.querySelector('[data-act="toggle"]').addEventListener("click", async () => {
      const nextActive = (u.active === false);
      if (!confirm(`Deseja ${nextActive ? "ativar" : "inativar"} "${u.name}"?`)) return;
      await updateDoc(doc(db, "companies", state.companyId, "users", u.uid), { active: nextActive });
      await loadManagerUsers(deps);
    });

    refs.mgrUsersTbody.appendChild(tr);
  }
}

/** =========================
 *  MODAL CRIAR TÉCNICO
 *  ========================= */

export function openCreateTechModal(deps) {
  const { refs, state, ensureTeamsForChips } = deps;
  if (!refs.modalCreateTech) return;
  
  clearAlert(refs.createTechAlert);
  refs.modalCreateTech.hidden = false;

  // Não pedir UID manualmente (vamos criar no Auth via secondaryAuth)
  try{
    const uidLabel = refs.techUidEl?.closest("label");
    if (uidLabel) uidLabel.style.display = "none";
  }catch(_){}

  refs.techUidEl.value = "";
  refs.techNameEl.value = "";
  refs.techEmailEl.value = "";
  refs.techPhoneEl.value = "";
  refs.techActiveEl.value = "true";

  state.mgrSelectedTeamIds = [];
  ensureTeamsForChips()
    .then(() => renderMgrTeamChips(deps))
    .catch(() => renderMgrTeamChips(deps));
}

export function closeCreateTechModal(refs) {
  if (refs.modalCreateTech) refs.modalCreateTech.hidden = true;
}

export function renderMgrTeamChips(deps) {
  const { refs, state } = deps;
  if (!refs.mgrTeamChipsEl) return;
  refs.mgrTeamChipsEl.innerHTML = "";

  const managedIds = getManagedTeamIds(state);
  const teams = (state.teams || [])
    .filter(t => t.active !== false && managedIds.includes(t.id))
    .sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  if (teams.length === 0){
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.fontSize = "13px";
    hint.textContent = "Nenhuma equipe administrada encontrada. Peça ao Admin da empresa para definir suas equipes administradas.";
    refs.mgrTeamChipsEl.appendChild(hint);
    return;
  }

  for (const t of teams){
    const chip = document.createElement("div");
    chip.className = "chip-option" + (state.mgrSelectedTeamIds.includes(t.id) ? " selected" : "");
    chip.innerHTML = `<span class="dot"></span><span>${escapeHtml(t.name)}</span>`;

    chip.addEventListener("click", () => {
      const idx = state.mgrSelectedTeamIds.indexOf(t.id);
      if (idx >= 0) state.mgrSelectedTeamIds.splice(idx, 1);
      else state.mgrSelectedTeamIds.push(t.id);
      renderMgrTeamChips(deps);
    });

    refs.mgrTeamChipsEl.appendChild(chip);
  }
}

export async function createTech(deps) {
  const { refs, state, db, createUserWithAuthAndResetLink, setAlertWithResetLink, loadManagerUsers } = deps;
  
  clearAlert(refs.createTechAlert);

  let uid = (refs.techUidEl.value || "").trim();
  const name = (refs.techNameEl.value || "").trim();
  const email = (refs.techEmailEl.value || "").trim();
  const phone = normalizePhone(refs.techPhoneEl.value || "");
  const active = (refs.techActiveEl.value || "true") === "true";
  const teamIds = Array.from(new Set(state.mgrSelectedTeamIds || []));

  // UID agora é opcional (se vazio, criamos automaticamente no Auth via Cloud Function)
  const wantsAutoAuth = !uid;
  if (!name) return setAlert(refs.createTechAlert, "Informe o nome do técnico.");
  if (!email || !isEmailValidBasic(email)) return setAlert(refs.createTechAlert, "Informe um e-mail válido.");
  if (teamIds.length === 0) return setAlert(refs.createTechAlert, "Selecione pelo menos 1 equipe.");

  const managedIds = new Set(getManagedTeamIds(state));
  if (teamIds.some(t => !managedIds.has(t))){
    return setAlert(refs.createTechAlert, "Você selecionou uma equipe fora do seu escopo de gestão.");
  }

  setAlert(refs.createTechAlert, "Salvando...", "info");

  if (wantsAutoAuth) {
    const data = await createUserWithAuthAndResetLink({
      companyId: state.companyId,
      name,
      email,
      phone,
      role: "tecnico",
      teamIds
    });

    uid = data.uid;

    await setDoc(doc(db, "userCompanies", uid), { companyId: state.companyId });

    closeCreateTechModal(refs);
    await loadManagerUsers(deps);
    setAlertWithResetLink(refs.createTechAlert, "Técnico criado com sucesso!", email, data.resetLink);
    return;
  }
  
  await setDoc(doc(db, "companies", state.companyId, "users", uid), {
    name,
    role: "tecnico",
    email,
    phone,
    active,
    teamIds,
    teamId: teamIds[0] || ""
  });

  await setDoc(doc(db, "userCompanies", uid), { companyId: state.companyId });

  closeCreateTechModal(refs);
  await loadManagerUsers(deps);
}

/** =========================
 *  MODAL EQUIPES ADMINISTRADAS
 *  ========================= */

export function openManagedTeamsModal(deps, targetUid, targetName) {
  const { refs, state } = deps;
  if (!refs.modalManagedTeams) return;
  
  clearAlert(refs.managedTeamsAlert);
  refs.modalManagedTeams.hidden = false;

  state.managedTeamsTargetUid = targetUid;

  const title = targetName ? `Gestor: ${targetName}` : "Gestor";
  if (refs.managedTeamsSubtitle) refs.managedTeamsSubtitle.textContent = `${title} • selecione as equipes administradas`;

  const row = (state._usersCache || []).find(u => u.uid === targetUid);
  const current = Array.isArray(row?.managedTeamIds) ? row.managedTeamIds : [];
  state.managedTeamsSelected = Array.from(new Set(current));

  renderManagedTeamsChips(deps);
}

export function closeManagedTeamsModal(refs) {
  if (refs.modalManagedTeams) refs.modalManagedTeams.hidden = true;
}

export function renderManagedTeamsChips(deps) {
  const { refs, state } = deps;
  if (!refs.managedTeamsChips) return;
  refs.managedTeamsChips.innerHTML = "";

  const activeTeams = (state.teams || [])
    .filter(t => t.active !== false)
    .sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  if (activeTeams.length === 0){
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.fontSize = "13px";
    hint.textContent = "Crie equipes antes de definir equipes administradas.";
    refs.managedTeamsChips.appendChild(hint);
    return;
  }

  for (const t of activeTeams){
    const chip = document.createElement("div");
    chip.className = "chip-option" + (state.managedTeamsSelected.includes(t.id) ? " selected" : "");
    chip.innerHTML = `<span class="dot"></span><span>${escapeHtml(t.name)}</span>`;

    chip.addEventListener("click", () => {
      const idx = state.managedTeamsSelected.indexOf(t.id);
      if (idx >= 0) state.managedTeamsSelected.splice(idx, 1);
      else state.managedTeamsSelected.push(t.id);
      renderManagedTeamsChips(deps);
    });

    refs.managedTeamsChips.appendChild(chip);
  }
}

export async function saveManagedTeams(deps) {
  const { refs, state, db, loadUsers } = deps;
  
  clearAlert(refs.managedTeamsAlert);

  const targetUid = state.managedTeamsTargetUid;
  if (!targetUid) return setAlert(refs.managedTeamsAlert, "UID alvo inválido.");

  const managedTeamIds = Array.from(new Set(state.managedTeamsSelected || []));
  setAlert(refs.managedTeamsAlert, "Salvando...", "info");

  await updateDoc(doc(db, "companies", state.companyId, "users", targetUid), {
    managedTeamIds
  });

  closeManagedTeamsModal(refs);
  await loadUsers();
}
