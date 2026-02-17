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

// ===== helpers (skills / busca / feedback) =====
function normalizeText(v){
  return (v || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function splitTerms(q){
  const s = normalizeText(q);
  if (!s) return [];
  return s.split(/\s+/).filter(Boolean);
}

function uniqClean(list){
  const out = [];
  const seen = new Set();
  for (const raw of (list || [])){
    const v = (raw || "").toString().trim();
    if (!v) continue;
    const key = normalizeText(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function setupChipInput(inputEl, chipsEl, state, key){
  if (!inputEl || !chipsEl) return;

  // init state
  state[key] = Array.isArray(state[key]) ? state[key] : [];

  const render = () => {
    chipsEl.innerHTML = "";
    for (const v of state[key]){
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip mini removable";
      chip.textContent = v;
      chip.title = "Clique para remover";
      chip.addEventListener("click", () => {
        state[key] = state[key].filter(x => normalizeText(x) !== normalizeText(v));
        render();
      });
      chipsEl.appendChild(chip);
    }
  };

  const addFromInput = () => {
    const raw = (inputEl.value || "").trim();
    if (!raw) return;
    // permite separar por vírgula
    const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
    state[key] = uniqClean([...(state[key]||[]), ...parts]);
    inputEl.value = "";
    render();
  };

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ","){
      e.preventDefault();
      addFromInput();
    }
  });

  inputEl.addEventListener("blur", () => addFromInput());

  render();
}

async function getFeedbackCount(db, companyId, uid){
  // se já existe em campo, preferimos ele (mais rápido)
  try{
    // nada aqui; count vem do doc do usuário no loadManagerUsers
    return 0;
  }catch(_){
    return 0;
  }
}

import { collection, getDocs, doc, setDoc, updateDoc, serverTimestamp, query, where, limit } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { setAlert, clearAlert } from "../ui/alerts.js";
import { humanizeRole } from "../utils/roles.js";
import { show, hide, escapeHtml } from "../utils/dom.js";
import { isEmailValidBasic } from "../utils/validators.js";
import { normalizePhone } from "../utils/format.js";



async function findUserUidByEmailInCompany(db, companyId, email){
  const emailLower = normalizeText(email);
  const usersCol = collection(db, "companies", companyId, "users");

  try{
    // Preferível: campo emailLower (vamos manter/gravar daqui pra frente)
    const q1 = query(usersCol, where("emailLower", "==", emailLower), limit(1));
    const s1 = await getDocs(q1);
    if (!s1.empty) return s1.docs[0].id;
  }catch(_){/* ignore */}

  try{
    // Fallback: alguns docs antigos podem não ter emailLower
    const q2 = query(usersCol, where("email", "==", email), limit(1));
    const s2 = await getDocs(q2);
    if (!s2.empty) return s2.docs[0].id;
  }catch(_){/* ignore */}

  return null;
}

async function loadAllActiveTeamIds(db, companyId){
  const snap = await getDocs(collection(db, "companies", companyId, "teams"));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => t && t.id && t.active !== false)
    .map(t => t.id);
}
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
  refs.mgrTeamFilter.innerHTML = '<option value="">Todas as equipes</option>';

  const activeManagedTeams = (state.teams || [])
    .filter(t => t.active !== false)
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

  const qRaw = (refs.mgrUserSearch?.value || "");
  const terms = splitTerms(qRaw);
  const teamFilter = (refs.mgrTeamFilter?.value || "").trim();

  const filtered = all.filter(u => {
    if (u.role !== "tecnico") return false;

    const teamIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
    // ✅ Visibilidade global entre gestores/coordenadores: não filtramos mais por equipes administradas
    if (teamFilter && !teamIds.includes(teamFilter)) return false;

    const soft = Array.isArray(u.softSkills) ? u.softSkills.join(" ") : "";
    const hard = Array.isArray(u.hardSkills) ? u.hardSkills.join(" ") : "";
    const status = (u.active === false) ? "bloqueado inativo" : "ativo";
    const teamsTxt = teamIds.map(tid => getTeamNameById(state, tid)).join(" ");
    const text = normalizeText(`${u.uid} ${u.name||""} ${u.email||""} ${u.phone||""} ${status} ${teamsTxt} ${soft} ${hard} ${u.feedbackCount||0}`);
    for (const t of terms){
      if (!text.includes(t)) return false;
    }

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
        <div class="action-col">
          <div class="action-row">
            <button class="btn sm" data-act="toggle">${u.active === false ? "Ativar" : "Bloquear"}</button>
            <button class="btn sm ghost" data-act="feedback">Feedback <span class="badge small" style="margin-left:6px;">${(u.feedbackCount||0)}</span></button>
          </div>

          <div class="action-meta">
            <div class="meta-line"><b>Soft:</b> <span data-soft></span></div>
            <div class="meta-line"><b>Hard:</b> <span data-hard></span></div>
          </div>
        </div>
      </td>
    `;

    tr.querySelector('[data-act="toggle"]').addEventListener("click", async () => {
      const nextActive = (u.active === false);
      if (!confirm(`Deseja ${nextActive ? "ativar" : "bloquear"} "${u.name}"?`)) return;
      await updateDoc(doc(db, "companies", state.companyId, "users", u.uid), { active: nextActive });
      await loadManagerUsers(deps);
    });


    // skills chips
    const softWrap = tr.querySelector("[data-soft]");
    const hardWrap = tr.querySelector("[data-hard]");
    const softArr = Array.isArray(u.softSkills) ? u.softSkills : [];
    const hardArr = Array.isArray(u.hardSkills) ? u.hardSkills : [];

    const renderMiniChips = (wrap, arr) => {
      if (!wrap) return;
      wrap.innerHTML = "";
      if (!arr.length){
        const em = document.createElement("span");
        em.className = "muted";
        em.style.fontSize = "12px";
        em.textContent = "—";
        wrap.appendChild(em);
        return;
      }
      for (const v of arr.slice(0,6)){
        const chip = document.createElement("span");
        chip.className = "chip mini";
        chip.textContent = v;
        wrap.appendChild(chip);
      }
      if (arr.length > 6){
        const more = document.createElement("span");
        more.className = "muted";
        more.style.fontSize = "12px";
        more.textContent = `+${arr.length-6}`;
        wrap.appendChild(more);
      }
    };

    renderMiniChips(softWrap, softArr);
    renderMiniChips(hardWrap, hardArr);

    tr.querySelector('[data-act="feedback"]').addEventListener("click", async () => {
      await openTechFeedbackModal(deps, u);
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

  // evita duplo clique / duplo envio
  if (state._creatingTech) return;
  state._creatingTech = true;
  // skills (chips)
  deps.state._techSoftSkillsDraft = [];
  deps.state._techHardSkillsDraft = [];
  setupChipInput(refs.techSoftSkillInputEl, refs.techSoftSkillChips, deps.state, "_techSoftSkillsDraft");
  setupChipInput(refs.techHardSkillInputEl, refs.techHardSkillChips, deps.state, "_techHardSkillsDraft");

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
    .filter(t => t.active !== false)
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

export 
async function createTech(deps) {
  const { refs, state, db, auth, createUserWithAuthAndResetLink, setAlertWithResetLink, loadManagerUsers } = deps;

  clearAlert(refs.createTechAlert);

  let uid = (refs.techUidEl.value || "").trim();
  const name = (refs.techNameEl.value || "").trim();
  const email = (refs.techEmailEl.value || "").trim();
  const phone = normalizePhone(refs.techPhoneEl.value || "");
  const active = (refs.techActiveEl.value || "true") === "true";

  const softSkills = uniqClean(state._techSoftSkillsDraft || []);
  const hardSkills = uniqClean(state._techHardSkillsDraft || []);

  // UID agora é opcional (se vazio, criamos automaticamente no Auth via Cloud Function)
  const wantsAutoAuth = !uid;

  if (!name) return setAlert(refs.createTechAlert, "Informe o nome do técnico.");
  if (!email || !isEmailValidBasic(email)) return setAlert(refs.createTechAlert, "Informe um e-mail válido.");

  // ❗Regra: não permitir e-mail repetido na MESMA empresa
  const existingUid = await findUserUidByEmailInCompany(db, state.companyId, email);
  if (existingUid && existingUid !== uid) {
    return setAlert(refs.createTechAlert, "Este e-mail já está cadastrado nesta empresa. Use outro e-mail ou edite o usuário existente.");
  }

  // ✅ Regra do FlowProject: Técnico pertence à EMPRESA (aparece para todos os gestores)
  // -> Vinculamos automaticamente a TODAS as equipes ativas da empresa (se existirem)
  // -> Se ainda não existir equipe, permitimos salvar com teamIds vazio.
  const assignableTeamIds = await loadAllActiveTeamIds(db, state.companyId);

  setAlert(refs.createTechAlert, "Salvando...", "info");

  const baseUserData = {
    name,
    role: "tecnico",
    email,
    emailLower: normalizeText(email),
    phone,
    active,
    teamIds: assignableTeamIds,
    teamId: assignableTeamIds[0] || "",
    softSkills,
    hardSkills,
    feedbackCount: 0
  };

  try {
    if (wantsAutoAuth) {
      const data = await createUserWithAuthAndResetLink({
        companyId: state.companyId,
        name,
        email,
        phone,
        role: "tecnico",
        teamIds: assignableTeamIds
      });

      uid = data.uid;

      await setDoc(doc(db, "companies", state.companyId, "users", uid), baseUserData);
      await setDoc(doc(db, "userCompanies", uid), { companyId: state.companyId });

      closeCreateTechModal(refs);
      await loadManagerUsers(deps);
      setAlertWithResetLink(refs.createTechAlert, "Técnico criado com sucesso!", email, data.resetLink || data.resetLink === "" ? data.resetLink : "");
      return;
    }

    await setDoc(doc(db, "companies", state.companyId, "users", uid), baseUserData);
    await setDoc(doc(db, "userCompanies", uid), { companyId: state.companyId });

    closeCreateTechModal(refs);
    await loadManagerUsers(deps);
  } catch (err) {
    const code = err?.code || "";
    if (code === "auth/email-already-in-use") {
      return setAlert(refs.createTechAlert, "Este e-mail já está em uso no sistema. Se for da sua empresa e não aparece na lista, peça ao Admin para verificar o cadastro.");
    }
    console.error(err);
    return setAlert(refs.createTechAlert, "Erro ao salvar: " + (err?.message || err));
  }
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