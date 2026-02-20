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

function parseSearchQuery(q){
  const raw = (q || "").toString().trim();
  if (!raw) return { terms: [], skillTerms: [], softTerms: [], hardTerms: [] };

  const parts = raw.split(/\s+/).filter(Boolean);
  const terms = [];
  const skillTerms = [];
  const softTerms = [];
  const hardTerms = [];

  for (const p of parts){
    const m = p.match(/^(skill:|skills:|sk:|s:|soft:|h:|hard:)(.+)$/i);
    if (m){
      const kind = (m[1] || "").toLowerCase();
      const value = normalizeText(m[2]);
      if (!value) continue;
      if (kind === "s:" || kind === "soft:") softTerms.push(value);
      else if (kind === "h:" || kind === "hard:") hardTerms.push(value);
      else skillTerms.push(value);
      continue;
    }
    const v = normalizeText(p);
    if (v) terms.push(v);
  }

  return {
    terms,
    skillTerms,
    softTerms,
    hardTerms
  };
}

function initialsFromName(name){
  const n = (name || "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "";
  const b = parts.length > 1 ? (parts[parts.length-1]?.[0] || "") : (parts[0]?.[1] || "");
  return (a + b).toUpperCase();
}

function renderTechAvatarHtml(user){
  const url = (user?.photoURL || "").toString().trim();
  const initials = initialsFromName(user?.name);
  if (url) {
    return `<span class="tech-avatar"><img src="${escapeHtml(url)}" alt="" loading="lazy" /></span>`;
  }
  return `<span class="tech-avatar tech-avatar-fallback">${escapeHtml(initials)}</span>`;
}

async function uploadAvatarForUser(deps, uid, file){
  const { storage } = deps;
  if (!storage || !uid || !file) return "";

  const maxMb = 2;
  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  const type = (file.type || "").toLowerCase();
  if (!allowed.includes(type)) throw new Error("Formato inválido. Use PNG/JPG/WEBP.");
  if (file.size > maxMb * 1024 * 1024) throw new Error(`A imagem é muito grande (máx. ${maxMb}MB).`);

  const ext = type.includes("png") ? "png" : (type.includes("webp") ? "webp" : "jpg");
  // ✅ Storage path SEM extensão (bate com storage.rules: /avatars/{uid})
  const path = `avatars/${uid}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type || "image/jpeg" });
  return await getDownloadURL(ref);
}


async function waitForCompanyUserDoc(db, companyId, uid, timeoutMs = 4000){
  const started = Date.now();
  while (Date.now() - started < timeoutMs){
    try{
      const snap = await getDoc(doc(db, "companies", companyId, "users", uid));
      if (snap.exists()) return true;
    }catch(_){}
    // pequeno backoff
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

function setCreateTechModalMode(deps, mode, tech){
  const { refs, state } = deps;
  const modal = refs.modalCreateTech;
  if (!modal) return;

  const titleEl = modal.querySelector(".modal-header h2");
  const subEl = modal.querySelector(".modal-header p");
  const isEdit = mode === "edit";

  if (titleEl) titleEl.textContent = isEdit ? "Editar Técnico" : "Novo Técnico";
  if (subEl) subEl.textContent = isEdit
    ? "Edite os dados do técnico. O e-mail não pode ser alterado."
    : "O técnico será vinculado automaticamente a todas as equipes do seu escopo.";

  // Email não pode ser editado
  if (refs.techEmailEl) refs.techEmailEl.disabled = !!isEdit;

  // UID continua oculto (mas armazenamos no state)
  state._mgrEditingTechUid = isEdit ? (tech?.uid || "") : null;

  // Label do botão
  if (refs.btnCreateTech) refs.btnCreateTech.textContent = isEdit ? "Salvar alterações" : "Salvar";
}

export function openEditTechModal(deps, techUser){
  const { refs, state } = deps;
  if (!refs.modalCreateTech) {
    console.warn("[manager-users] modalCreateTech não encontrado no DOM");
    return;
  }

  clearAlert(refs.createTechAlert);

  // modo edição
  setCreateTechModalMode(deps, "edit", techUser);

  // preenche campos
  refs.techUidEl.value = techUser?.uid || "";
  refs.techNameEl.value = techUser?.name || "";
  refs.techEmailEl.value = techUser?.email || "";
  refs.techPhoneEl.value = techUser?.phone || "";
  refs.techActiveEl.value = (techUser?.active === false) ? "false" : "true";

  // chips
  state._techSoftSkillsDraft = Array.isArray(techUser?.softSkills) ? [...techUser.softSkills] : [];
  state._techHardSkillsDraft = Array.isArray(techUser?.hardSkills) ? [...techUser.hardSkills] : [];
  setupChipInput(refs.techSoftSkillInputEl, refs.techSoftSkillChips, deps.state, "_techSoftSkillsDraft", "soft");
  setupChipInput(refs.techHardSkillInputEl, refs.techHardSkillChips, deps.state, "_techHardSkillsDraft", "hard");

  // avatar preview (usa photoURL existente)
  state._techAvatarFile = null;
  if (refs.techAvatarFileEl) refs.techAvatarFileEl.value = "";
  const url = (techUser?.photoURL || "").toString().trim();
  if (refs.techAvatarPreviewImg && refs.techAvatarPreviewFallback){
    if (url){
      refs.techAvatarPreviewImg.src = url;
      refs.techAvatarPreviewImg.style.display = "block";
      refs.techAvatarPreviewFallback.textContent = "";
    } else {
      refs.techAvatarPreviewImg.style.display = "none";
      refs.techAvatarPreviewImg.src = "";
      refs.techAvatarPreviewFallback.textContent = initialsFromName(techUser?.name || "");
    }
  }

  // abre modal (garante visibilidade mesmo se estiver dentro de container hidden)
  const modal = refs.modalCreateTech;
  try{
    const hiddenParent = modal.parentElement && modal.parentElement.closest && modal.parentElement.closest("[hidden]");
    if (hiddenParent) document.body.appendChild(modal);
  }catch(_){ }

  modal.hidden = false;
  modal.removeAttribute("hidden");
  modal.classList.add("open");
  modal.style.display = "flex";
  document.body.classList.add("modal-open");

  try{ refs.techNameEl?.focus?.(); }catch(_){ }
}

async function retryUploadAvatarWithBackoff(deps, uid, file, maxWaitMs = 30000){
  const started = Date.now();
  let delay = 600;
  let lastErr = null;

  while (Date.now() - started < maxWaitMs){
    try{
      const url = await uploadAvatarForUser(deps, uid, file);
      if (url) return url;
    }catch(err){
      lastErr = err;
      const code = (err?.code || "").toString();
      const msg = (err?.message || "").toString().toLowerCase();

      // storage/unauthorized costuma acontecer por corrida no exists() do Storage Rules.
      // A gente re-tenta por alguns segundos.
      const retryable = code === "storage/unauthorized" || msg.includes("permission") || msg.includes("unauthorized") || msg.includes("forbidden");
      if (!retryable) throw err;
    }

    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(Math.round(delay * 1.6), 4000);
  }

  if (lastErr) throw lastErr;
  throw new Error("Não foi possível enviar a foto.");
}

export async function updateTech(deps){
  const { refs, state, db } = deps;
  clearAlert(refs.createTechAlert);

  const uid = (state._mgrEditingTechUid || "").trim();
  if (!uid) return setAlert(refs.createTechAlert, "Não foi possível identificar o técnico para edição.");

  const name = (refs.techNameEl.value || "").trim();
  const phone = normalizePhone(refs.techPhoneEl.value || "");
  const active = (refs.techActiveEl.value || "true") === "true";
  const softSkills = uniqClean(state._techSoftSkillsDraft || []);
  const hardSkills = uniqClean(state._techHardSkillsDraft || []);

  if (!name) return setAlert(refs.createTechAlert, "Informe o nome do técnico.");

  setAlert(refs.createTechAlert, "Salvando alterações...", "info");

  const userRef = doc(db, "companies", state.companyId, "users", uid);

  // upload avatar (opcional)
  let photoURL = "";
  if (state._techAvatarFile){
    try{
      setAlert(refs.createTechAlert, "Enviando foto...", "info");
      await waitForCompanyUserDoc(db, state.companyId, uid, 8000);
      photoURL = await uploadAvatarForUser(deps, uid, state._techAvatarFile);
    }catch(errUp){
      console.warn("avatar upload failed", errUp);
      // não bloqueia edição
    }
  }

  const patch = {
    name,
    phone,
    active,
    softSkills,
    hardSkills,
    ...(photoURL ? { photoURL } : {})
  };

  await updateDoc(userRef, patch);

  // fecha modal e recarrega
  setAlert(refs.createTechAlert, "Salvo!", "success");
  closeCreateTechModal(refs, state);
  await loadManagerUsers(deps);

  // volta para modo criação (para não “vazar” estado)
  setCreateTechModalMode(deps, "create");
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

function setupChipInput(inputEl, chipsEl, state, key, type){
  if (!inputEl || !chipsEl) return;

  // init state
  state[key] = Array.isArray(state[key]) ? state[key] : [];

  const chipTypeClass = (type === "hard") ? "chip-hard" : "chip-soft";

  const render = () => {
    chipsEl.innerHTML = "";
    for (const v of state[key]){
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `chip mini removable ${chipTypeClass}`;
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
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
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

  // Evita duplicidade por chamadas concorrentes (race condition)
  // Ex.: load disparado 2x ao abrir a tela / listeners duplicados
  state._mgrUsersLoadSeq = (state._mgrUsersLoadSeq || 0) + 1;
  const mySeq = state._mgrUsersLoadSeq;

  refs.mgrUsersTbody.innerHTML = "";
  hide(refs.mgrUsersEmpty);

  // Filtro por equipe removido na UI (mantemos a lista global por empresa)

  const snap = await getDocs(collection(db, "companies", state.companyId, "users"));
  if (mySeq !== state._mgrUsersLoadSeq) return; // resposta antiga, ignora
  const allRaw = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  // Remove duplicados (mesmo e-mail) mantendo o registro mais completo
  const allMap = new Map();
  for (const u of allRaw){
    const key = (u.emailLower || u.email || u.uid || "").toString().toLowerCase();
    if (!key) { allMap.set(u.uid, u); continue; }
    const prev = allMap.get(key);
    if (!prev) { allMap.set(key, u); continue; }
    const score = (x) => (x?.number ? 10 : 0) + (x?.updatedAt ? 2 : 0) + (x?.createdAt ? 1 : 0);
    allMap.set(key, score(u) >= score(prev) ? u : prev);
  }
  const all = Array.from(allMap.values());

  const qRaw = (refs.mgrUserSearch?.value || "");
  const { terms, skillTerms, softTerms, hardTerms } = parseSearchQuery(qRaw);
  // UI não possui mais filtro por equipe

  const filtered = all.filter(u => {
    if (u.role !== "tecnico") return false;

    const teamIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
    // Visibilidade global (sem filtro por equipe)

    const softArr = Array.isArray(u.softSkills) ? u.softSkills : [];
    const hardArr = Array.isArray(u.hardSkills) ? u.hardSkills : [];
    const soft = softArr.join(" ");
    const hard = hardArr.join(" ");
    const status = (u.active === false) ? "bloqueado inativo" : "ativo";
    const teamsTxt = teamIds.map(tid => getTeamNameById(state, tid)).join(" ");
    const text = normalizeText(`${u.uid} ${u.name||""} ${u.email||""} ${u.phone||""} ${status} ${teamsTxt} ${soft} ${hard} ${u.feedbackCount||0}`);
    for (const t of terms){
      if (!text.includes(t)) return false;
    }

    // filtro explícito por skill (skill:, soft:, hard:)
    if (skillTerms.length){
      const sAll = normalizeText(`${soft} ${hard}`);
      for (const st of skillTerms){
        if (!sAll.includes(st)) return false;
      }
    }
    if (softTerms.length){
      const sSoft = normalizeText(soft);
      for (const st of softTerms){
        if (!sSoft.includes(st)) return false;
      }
    }
    if (hardTerms.length){
      const sHard = normalizeText(hard);
      for (const st of hardTerms){
        if (!sHard.includes(st)) return false;
      }
    }

    return true;
  }).sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  if (mySeq !== state._mgrUsersLoadSeq) return; // evita render duplicado

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
      <td><span class="badge small">#${escapeHtml(String(u.number ?? "—"))}</span></td>
      <td>
        <div class="tech-name-cell">
          ${renderTechAvatarHtml(u)}
          <div class="tech-name-text">
            <div><b>${escapeHtml(u.name || "—")}</b></div>
          </div>
        </div>
      </td>
      <td>${escapeHtml(u.email || "—")}</td>
      <td>${escapeHtml(u.phone || "—")}</td>
      <td>${escapeHtml(teamsLabel)}</td>
      <td><span data-soft></span></td>
      <td><span data-hard></span></td>
      <td>
        <button class="btn sm ghost" data-act="feedbackCount">
          ${(u.feedbackCount||0)}
        </button>
      </td>
      <td><span class="badge small">${statusLabel}</span></td>
      <td>
        <div class="table-actions">
          <button class="icon-btn xs" data-act="edit" title="Editar" aria-label="Editar">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="btn sm" data-act="toggle">${u.active === false ? "Ativar" : "Bloquear"}</button>
        </div>
      </td>
    `;

    tr.querySelector('[data-act="edit"]').addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try{
        console.log("[manager-users] edit click", { uid: u.uid, email: u.email });
        openEditTechModal(deps, u);
      }catch(err){
        console.error("[manager-users] failed to open edit modal", err);
      }
    });

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

    const renderMiniChips = (wrap, arr, type) => {
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
        chip.className = `chip mini ${(type === "hard") ? "chip-hard" : "chip-soft"}`;
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

    renderMiniChips(softWrap, softArr, "soft");
    renderMiniChips(hardWrap, hardArr, "hard");

    tr.querySelector('[data-act="feedbackCount"]').addEventListener("click", async () => {
      await openTechFeedbackModal(deps, u);
    });

    refs.mgrUsersTbody.appendChild(tr);
  }
}


/** =========================
 *  FEEDBACK DO TÉCNICO (Modal)
 *  ========================= */
async function openTechFeedbackModal(deps, techUser) {
  const { refs, state, db, auth } = deps;
  if (!refs.modalTechFeedback) {
    alert("Modal de feedback não encontrado.");
    return;
  }

  // guarda contexto
  state._techFeedbackUid = techUser.uid;
  state._techFeedbackName = techUser.name || "Técnico";

  refs.techFeedbackSubtitle.textContent = `Técnico: ${state._techFeedbackName} • ${techUser.email || ""}`.trim();

  clearAlert(refs.techFeedbackAlert);
  refs.techFeedbackDate.value = "";
  refs.techFeedbackScore.value = "";
  refs.techFeedbackNote.value = "";

  refs.modalTechFeedback.hidden = false;

  await loadTechFeedbackList(deps);
}

export function closeTechFeedbackModal(refs) {
  if (refs.modalTechFeedback) refs.modalTechFeedback.hidden = true;
}

async function loadTechFeedbackList(deps) {
  const { refs, state, db } = deps;
  if (!refs.techFeedbackList || !state._techFeedbackUid) return;

  refs.techFeedbackList.innerHTML = `<div class="muted" style="padding:10px;">Carregando...</div>`;

  try {
    const q = query(
      collection(db, "companies", state.companyId, "users", state._techFeedbackUid, "feedbacks"),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      refs.techFeedbackList.innerHTML = `<div class="muted" style="padding:10px;">Nenhum feedback ainda.</div>`;
      return;
    }

    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refs.techFeedbackList.innerHTML = "";
    for (const it of items) {
      const div = document.createElement("div");
      div.className = "panel subtle";
      div.style.margin = "8px";
      div.style.padding = "10px";

      const date = it.date || (it.createdAt?.toDate ? it.createdAt.toDate().toLocaleDateString("pt-BR") : "");
      const score = (it.score ?? "");
      const by = it.createdByName || it.createdByEmail || "";
      const note = it.note || "";

      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:10px;">
          <div><b>${escapeHtml(date || "—")}</b> <span class="badge small" style="margin-left:6px;">${escapeHtml(String(score || "—"))}</span></div>
          <div class="muted" style="font-size:12px;">${escapeHtml(by)}</div>
        </div>
        <div style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(note || "—")}</div>
      `;
      refs.techFeedbackList.appendChild(div);
    }
  } catch (err) {
    console.error(err);
    refs.techFeedbackList.innerHTML = `<div class="muted" style="padding:10px;">Erro ao carregar feedbacks.</div>`;
  }
}

export async function saveTechFeedback(deps) {
  const { refs, state, db, auth } = deps;
  clearAlert(refs.techFeedbackAlert);

  if (!state._techFeedbackUid) return;

  const date = refs.techFeedbackDate.value;
  const score = Number(refs.techFeedbackScore.value || 0);
  const note = (refs.techFeedbackNote.value || "").trim();

  if (!date) return setAlert(refs.techFeedbackAlert, "Informe a data.");
  if (!score || score < 1 || score > 10) return setAlert(refs.techFeedbackAlert, "Informe uma nota de 1 a 10.");
  if (!note) return setAlert(refs.techFeedbackAlert, "Escreva uma anotação.");

  setAlert(refs.techFeedbackAlert, "Salvando...", "info");

  const createdBy = auth.currentUser?.uid || "";
  const createdByEmail = auth.currentUser?.email || "";

  try {
    // pega nome do avaliador (se tiver)
    const meSnap = await getDoc(doc(db, "companies", state.companyId, "users", createdBy));
    const meName = meSnap.exists() ? (meSnap.data().name || "") : "";

    await addDoc(collection(db, "companies", state.companyId, "users", state._techFeedbackUid, "feedbacks"), {
      date,
      score,
      note,
      createdBy,
      createdByEmail,
      createdByName: meName,
      createdAt: serverTimestamp()
    });

    // Atualiza contador no técnico (best effort)
    await updateDoc(doc(db, "companies", state.companyId, "users", state._techFeedbackUid), {
      feedbackCount: increment(1)
    });

    refs.techFeedbackDate.value = "";
    refs.techFeedbackScore.value = "";
    refs.techFeedbackNote.value = "";

    await loadTechFeedbackList(deps);
    setAlert(refs.techFeedbackAlert, "Feedback salvo!", "success");
    await loadManagerUsers(deps);
  } catch (err) {
    console.error(err);
    setAlert(refs.techFeedbackAlert, "Erro ao salvar feedback: " + (err?.message || err));
  }
}


/** =========================
 *  MODAL CRIAR TÉCNICO
 *  ========================= */

export function openCreateTechModal(deps) {
  const { refs, state, ensureTeamsForChips } = deps;
  if (!refs.modalCreateTech) return;
  
  clearAlert(refs.createTechAlert);
  // modo criação
  setCreateTechModalMode(deps, "create");
  if (refs.btnCreateTech) { refs.btnCreateTech.disabled = false; refs.btnCreateTech.textContent = "Salvar"; }
  // skills (chips)
  deps.state._techSoftSkillsDraft = [];
  deps.state._techHardSkillsDraft = [];
  setupChipInput(refs.techSoftSkillInputEl, refs.techSoftSkillChips, deps.state, "_techSoftSkillsDraft", "soft");
  setupChipInput(refs.techHardSkillInputEl, refs.techHardSkillChips, deps.state, "_techHardSkillsDraft", "hard");

  // avatar (upload antes de salvar -> envia após criar UID)
  state._techAvatarFile = null;
  if (refs.techAvatarFileEl) refs.techAvatarFileEl.value = "";
  if (refs.techAvatarPreviewImg && refs.techAvatarPreviewFallback){
    refs.techAvatarPreviewImg.style.display = "none";
    refs.techAvatarPreviewImg.src = "";
    refs.techAvatarPreviewFallback.textContent = initialsFromName("");
  }

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

  // atualiza fallback com base no nome enquanto digita
  if (refs.techNameEl && refs.techAvatarPreviewFallback){
    if (!refs.techNameEl.dataset.boundAvatar){
      refs.techNameEl.dataset.boundAvatar = "1";
      refs.techNameEl.addEventListener("input", () => {
        if (refs.techAvatarPreviewImg && refs.techAvatarPreviewImg.style.display !== "none") return;
        refs.techAvatarPreviewFallback.textContent = initialsFromName(refs.techNameEl.value);
      });
    }
    refs.techAvatarPreviewFallback.textContent = initialsFromName(refs.techNameEl.value);
  }

  if (refs.techAvatarFileEl && refs.techAvatarPreviewImg && refs.techAvatarPreviewFallback){
    if (!refs.techAvatarFileEl.dataset.bound){
      refs.techAvatarFileEl.dataset.bound = "1";
      refs.techAvatarFileEl.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        state._techAvatarFile = file;

        // preview local
        const reader = new FileReader();
        reader.onload = () => {
          refs.techAvatarPreviewImg.src = reader.result;
          refs.techAvatarPreviewImg.style.display = "block";
          refs.techAvatarPreviewFallback.textContent = "";
        };
        reader.readAsDataURL(file);

        // permite reenviar o mesmo arquivo
        e.target.value = "";
      });
    }
  }

  if (refs.btnTechRemovePhoto && refs.techAvatarPreviewImg && refs.techAvatarPreviewFallback){
    if (!refs.btnTechRemovePhoto.dataset.bound){
      refs.btnTechRemovePhoto.dataset.bound = "1";
      refs.btnTechRemovePhoto.addEventListener("click", () => {
        state._techAvatarFile = null;
        refs.techAvatarPreviewImg.style.display = "none";
        refs.techAvatarPreviewImg.src = "";
        refs.techAvatarPreviewFallback.textContent = initialsFromName(refs.techNameEl?.value || "");
      });
    }
  }

  state.mgrSelectedTeamIds = [];
  ensureTeamsForChips()
    .then(() => renderMgrTeamChips(deps))
    .catch(() => renderMgrTeamChips(deps));
}

export function closeCreateTechModal(refs, state) {
  const el = refs?.modalCreateTech;
  if (!el) return;

  // Fecha de verdade (compatível com modal que usa display:flex + classe open)
  el.classList.remove("open");
  el.style.display = "none";
  el.hidden = true;

  // opcional: limpar alert ao fechar
  if (refs.createTechAlert) {
    try { refs.createTechAlert.innerHTML = ""; } catch(_){}
  }

  // limpa modo edição (se recebeu state)
  if (state){
    state._mgrEditingTechUid = null;
  }

  // garante que o email volta a ser editável no próximo "Novo Técnico"
  try{
    if (refs.techEmailEl) refs.techEmailEl.disabled = false;
  }catch(_){ }

  // Se você usa body travado quando modal abre
  try {
    // só remove se não houver outro modal aberto
    const hasOpen = document.querySelector(".modal.open, .modal:not([hidden])");
    if (!hasOpen) document.body.classList.remove("modal-open");
  } catch (_) {}
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

  // Se estiver em modo edição, salva alterações aqui mesmo
  if (state._mgrEditingTechUid){
    return await updateTech(deps);
  }

  clearAlert(refs.createTechAlert);

  // Guard (inicia mais abaixo, após validações)

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

  // Guard: evita duplo submit (double click / double binding)
  if (state._isCreatingTech) return;
  state._isCreatingTech = true;

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

      // ⚠️ A Cloud Function pode não gravar campos extras (softSkills/hardSkills/emailLower/etc).
      // Garantimos aqui via merge (best effort) para manter consistência na tela e no Firestore.
      try{
        await setDoc(doc(db, "companies", state.companyId, "users", uid), baseUserData, { merge: true });
      }catch(errMerge){
        console.warn("merge user extra fields failed", errMerge);
      }
      try{
        await setDoc(doc(db, "userCompanies", uid), { companyId: state.companyId }, { merge: true });
      }catch(errUc){
        console.warn("merge userCompanies failed", errUc);
      }

      // Upload de avatar (opcional) após UID existir
      if (state._techAvatarFile){
        try{
          setAlert(refs.createTechAlert, "Enviando foto...", "info");
          // ✅ Evita falha por corrida no exists() das Storage Rules
          // (às vezes o doc já existe, mas o Storage ainda não “enxerga” imediatamente).
          // Fazemos retries por alguns segundos.
          const photoURL = await retryUploadAvatarWithBackoff(deps, uid, state._techAvatarFile, 30000);
          if (photoURL){
            // merge para não depender do doc já existir/estar pronto
            await setDoc(doc(db, "companies", state.companyId, "users", uid), { photoURL }, { merge: true });
          }
        }catch(errUp){
          console.warn("avatar upload failed", errUp);
          setAlert(refs.createTechAlert, "Técnico criado! Não foi possível enviar a foto agora. Clique em **Editar** e tente novamente em alguns segundos.", "warning");
          // não bloqueia criação
        }
      }

      // A criação e a escrita no Firestore são feitas pela Cloud Function (Admin SDK).
      // Mantemos o modal aberto para o usuário copiar o link de redefinição.
      await loadManagerUsers(deps);

      const numLabel = data?.number ? `#${data.number} ` : "";
      setAlertWithResetLink(refs.createTechAlert, `Técnico ${numLabel}criado com sucesso!`, email, data.resetLink);

      // ✅ Após sucesso: desabilita o botão salvar para evitar duplicidade
      if (refs.btnCreateTech) {
        refs.btnCreateTech.disabled = true;
        refs.btnCreateTech.textContent = "Salvo";
      }

      return;
    }

    await setDoc(doc(db, "companies", state.companyId, "users", uid), baseUserData);
    await setDoc(doc(db, "userCompanies", uid), { companyId: state.companyId });

    if (state._techAvatarFile){
      try{
        setAlert(refs.createTechAlert, "Enviando foto...", "info");
        await waitForCompanyUserDoc(db, state.companyId, uid, 3000);
        const photoURL = await uploadAvatarForUser(deps, uid, state._techAvatarFile);
        if (photoURL){
          await updateDoc(doc(db, "companies", state.companyId, "users", uid), { photoURL });
        }
      }catch(errUp){
        console.warn("avatar upload failed", errUp);
      }
    }

    closeCreateTechModal(refs);
    await loadManagerUsers(deps);
  } catch (err) {
    const code = err?.code || "";
    if (code === "auth/email-already-in-use") {
      return setAlert(refs.createTechAlert, "Este e-mail já está em uso no sistema. Se for da sua empresa e não aparece na lista, peça ao Admin para verificar o cadastro.");
    }
    console.error(err);
    return setAlert(refs.createTechAlert, "Erro ao salvar: " + (err?.message || err));
  } finally {
    state._isCreatingTech = false;
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