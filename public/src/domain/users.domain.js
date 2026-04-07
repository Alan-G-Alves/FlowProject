// public/src/domain/users.domain.js
// Lógica de negócio para gerenciamento de usuários da empresa (Admin)

import {
  doc,
  collection,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getDownloadURL, ref as storageRef, uploadBytes, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
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

function normalizeText(v) {
  return (v || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function initialsFromName(name) {
  const n = (name || "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] || "") : (parts[0]?.[1] || "");
  return (a + b).toUpperCase();
}

function uniqClean(list) {
  const seen = new Set();
  const out = [];
  for (const item of (Array.isArray(list) ? list : [])) {
    const value = String(item || "").trim();
    const key = normalizeText(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function readChipsText(chipsEl) {
  if (!chipsEl) return [];
  return Array.from(chipsEl.querySelectorAll(".chip"))
    .map((el) => (el.textContent || "").trim())
    .filter(Boolean);
}

function renderSkillChips(chipsEl, state, key) {
  if (!chipsEl) return;
  chipsEl.innerHTML = "";

  for (const item of (state[key] || [])) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = item;
    chip.addEventListener("click", () => {
      state[key] = (state[key] || []).filter((value) => normalizeText(value) !== normalizeText(item));
      renderSkillChips(chipsEl, state, key);
    });
    chipsEl.appendChild(chip);
  }
}

function setupChipInput(inputEl, chipsEl, state, key, type) {
  if (!inputEl || !chipsEl) return;
  const chipTypeClass = type === "hard" ? "chip-hard" : "chip-soft";

  const render = () => {
    chipsEl.innerHTML = "";
    for (const item of (state[key] || [])) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `chip mini removable ${chipTypeClass}`;
      chip.textContent = item;
      chip.title = "Clique para remover";
      chip.addEventListener("click", () => {
        state[key] = (state[key] || []).filter((value) => normalizeText(value) !== normalizeText(item));
        render();
      });
      chipsEl.appendChild(chip);
    }
  };

  render();
  if (inputEl.dataset.bound) return;
  inputEl.dataset.bound = "1";

  const commit = () => {
    const raw = (inputEl.value || "").trim();
    if (!raw) return;
    const parts = raw.split(",").map((v) => v.trim()).filter(Boolean);
    state[key] = uniqClean([...(state[key] || []), ...parts]);
    inputEl.value = "";
    render();
  };

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    }
    if (e.key === "Backspace" && !inputEl.value && (state[key] || []).length) {
      state[key] = (state[key] || []).slice(0, -1);
      render();
    }
  });
  inputEl.addEventListener("blur", commit);
}

function setNewUserPhotoFileName(refs, label) {
  if (!refs?.newUserPhotoFileName) return;
  refs.newUserPhotoFileName.textContent = label || "Nenhum arquivo selecionado";
}

async function uploadAvatarForUser(deps, uid, file) {
  const { storage } = deps;
  if (!storage || !uid || !file) return "";

  const maxMb = 2;
  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  const type = (file.type || "").toLowerCase();
  if (!allowed.includes(type)) throw new Error("Formato invalido. Use PNG/JPG/WEBP.");
  if (file.size > maxMb * 1024 * 1024) throw new Error(`A imagem e muito grande (max. ${maxMb}MB).`);

  const ref = storageRef(storage, `avatars/${uid}`);
  await uploadBytes(ref, file, { contentType: file.type || "image/jpeg" });
  return await getDownloadURL(ref);
}

async function uploadTempAvatarForDraft(deps, file) {
  const { storage, state, auth } = deps;
  if (!storage || !file) return { tempAvatarPath: "", tempAvatarURL: "" };

  const maxMb = 2;
  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  const type = (file.type || "").toLowerCase();
  if (!allowed.includes(type)) throw new Error("Formato invalido. Use PNG/JPG/WEBP.");
  if (file.size > maxMb * 1024 * 1024) throw new Error(`A imagem e muito grande (max. ${maxMb}MB).`);

  const user = auth?.currentUser;
  if (!user) throw new Error("Nao autenticado.");
  const companyId = (state?.companyId || "").trim();
  if (!companyId) throw new Error("Empresa nao definida.");

  const tempId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tempAvatarPath = `tempAvatars/${companyId}/${user.uid}/${tempId}`;
  const ref = storageRef(storage, tempAvatarPath);
  await uploadBytes(ref, file, { contentType: file.type || "image/jpeg" });
  const tempAvatarURL = await getDownloadURL(ref);
  return { tempAvatarPath, tempAvatarURL };
}

async function deleteTempAvatarIfAny(deps) {
  const { storage, state } = deps;
  const path = (state?._newUserTempAvatarPath || "").trim();
  if (!storage || !path) return;
  try {
    await deleteObject(storageRef(storage, path));
  } catch (_) {}
  state._newUserTempAvatarPath = "";
  state._newUserTempAvatarURL = "";
}

async function waitForCompanyUserDoc(db, companyId, uid, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const snap = await getDoc(doc(db, "companies", companyId, "users", uid));
      if (snap.exists()) return true;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function initNewUserRichFields(deps) {
  const { refs, state } = deps;

  setupChipInput(refs.newUserSoftSkillInputEl, refs.newUserSoftSkillChips, state, "_newUserSoftSkillsDraft", "soft");
  setupChipInput(refs.newUserHardSkillInputEl, refs.newUserHardSkillChips, state, "_newUserHardSkillsDraft", "hard");

  if (refs.newUserNameEl && refs.newUserAvatarPreviewFallback && !refs.newUserNameEl.dataset.boundAvatar) {
    refs.newUserNameEl.dataset.boundAvatar = "1";
    refs.newUserNameEl.addEventListener("input", () => {
      if (refs.newUserAvatarPreviewImg && refs.newUserAvatarPreviewImg.style.display !== "none") return;
      refs.newUserAvatarPreviewFallback.textContent = initialsFromName(refs.newUserNameEl.value);
    });
  }

  if (refs.newUserAvatarFileEl && !refs.newUserAvatarFileEl.dataset.bound) {
    refs.newUserAvatarFileEl.dataset.bound = "1";
    refs.newUserAvatarFileEl.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      setNewUserPhotoFileName(refs, file.name || "Arquivo selecionado");
      await deleteTempAvatarIfAny(deps);
      state._newUserAvatarFile = file;
      state._newUserPhotoRemoved = false;
      setAlert(refs.createUserAlert, "Enviando foto...", "info");
      try {
        const { tempAvatarPath, tempAvatarURL } = await uploadTempAvatarForDraft(deps, file);
        state._newUserTempAvatarPath = tempAvatarPath;
        state._newUserTempAvatarURL = tempAvatarURL;
        if (refs.newUserAvatarPreviewImg) {
          refs.newUserAvatarPreviewImg.src = tempAvatarURL;
          refs.newUserAvatarPreviewImg.style.display = "block";
        }
        if (refs.newUserAvatarPreviewFallback) refs.newUserAvatarPreviewFallback.textContent = "";
        clearAlert(refs.createUserAlert);
      } catch (err) {
        state._newUserTempAvatarPath = "";
        state._newUserTempAvatarURL = "";
        setAlert(refs.createUserAlert, "Nao foi possivel enviar a foto: " + (err?.message || err), "error");
      }
      e.target.value = "";
    });
  }

  if (refs.btnNewUserRemovePhoto && !refs.btnNewUserRemovePhoto.dataset.bound) {
    refs.btnNewUserRemovePhoto.dataset.bound = "1";
    refs.btnNewUserRemovePhoto.addEventListener("click", () => {
      state._newUserAvatarFile = null;
      state._newUserPhotoRemoved = true;
      deleteTempAvatarIfAny(deps);
      setNewUserPhotoFileName(refs, "Nenhum arquivo selecionado");
      if (refs.newUserAvatarPreviewImg) {
        refs.newUserAvatarPreviewImg.style.display = "none";
        refs.newUserAvatarPreviewImg.src = "";
      }
      if (refs.newUserAvatarPreviewFallback) {
        refs.newUserAvatarPreviewFallback.textContent = initialsFromName(refs.newUserNameEl?.value || "");
      }
    });
  }
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
    const teamArr = teamIds.map((teamId) => {
      const team = (state.teams || []).find((item) => item.id === teamId);
      return team?.name || teamId;
    });
    const teamsLabel = teamIds.length ? teamIds.join(", ") : "—";
    const statusLabel = (u.active === false) ? "Inativo" : "Ativo";
    const softSkillsLabel = Array.isArray(u.softSkills) && u.softSkills.length ? u.softSkills.join(", ") : "â€”";
    const hardSkillsLabel = Array.isArray(u.hardSkills) && u.hardSkills.length ? u.hardSkills.join(", ") : "â€”";
    const photoURL = String(u.photoURL || "").trim();
    const avatarHtml = photoURL
      ? `<span class="tech-avatar"><img src="${photoURL}" alt="Foto de ${u.name || "usuario"}" loading="lazy" /></span>`
      : `<span class="tech-avatar"><span class="fallback">${initialsFromName(u.name || "")}</span></span>`;

    tr.innerHTML = `
      <td>
        <div style="display:flex; justify-content:center;">
          ${avatarHtml}
        </div>
      </td>
      <td>
        <div style="display:flex; flex-direction:column; gap:2px;">
          <div><b>${u.name || "—"}</b></div>
          <div class="muted" style="font-size:12px;">UID: ${u.uid}</div>
        </div>
      </td>
      <td>${normalizeRole(u.role)}</td>
      <td>${u.email || "—"}</td>
      <td>${u.phone || "—"}</td>
      <td>${softSkillsLabel}</td>
      <td>${hardSkillsLabel}</td>
      <td>${teamsLabel}</td>
      <td><span class="badge small">${statusLabel}</span></td>
      <td>
        <div class="action-col">
          <div class="table-actions">
            <button class="icon-btn xs btn-edit" data-act="edit" title="Editar" aria-label="Editar">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="icon-btn xs btn-view" data-act="view" title="Visualizar" aria-label="Visualizar">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1.5 12s3.5-7 10.5-7 10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="icon-btn xs ${u.active === false ? "btn-activate" : "btn-block"}" data-act="toggle" title="${u.active === false ? "Ativar" : "Bloquear"}" aria-label="${u.active === false ? "Ativar" : "Bloquear"}">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2v10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <path d="M7.5 4.5a8 8 0 1 0 9 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      </td>
    `;

    const rowCells = tr.querySelectorAll("td");
    if (rowCells[5]) rowCells[5].innerHTML = '<div class="chips-mini" data-soft></div>';
    if (rowCells[6]) rowCells[6].innerHTML = '<div class="chips-mini" data-hard></div>';
    if (rowCells[7]) rowCells[7].innerHTML = '<div class="chips-mini" data-teams></div>';

    tr.querySelector('[data-act="edit"]').addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await loadTeams();
      openEditCompanyUserModal(u, deps);
    });

    tr.querySelector('[data-act="view"]').addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await loadTeams();
      openViewCompanyUserModal(u, deps);
    });

    tr.querySelector('[data-act="toggle"]').addEventListener("click", async () => {
      const nextActive = (u.active === false);
      if (!confirm(`Deseja ${nextActive ? "ativar" : "inativar"} "${u.name}"?`)) return;
      await updateDoc(doc(db, "companies", state.companyId, "users", u.uid), { active: nextActive });
      await loadUsers(deps);
    });

    const softWrap = tr.querySelector("[data-soft]");
    const hardWrap = tr.querySelector("[data-hard]");
    const teamsWrap = tr.querySelector("[data-teams]");
    const softArr = Array.isArray(u.softSkills) ? u.softSkills : [];
    const hardArr = Array.isArray(u.hardSkills) ? u.hardSkills : [];
    const teamsArr = teamArr;

    const renderMiniChips = (wrap, arr, type) => {
      if (!wrap) return;
      wrap.innerHTML = "";
      const limit = 4;
      const expanded = (wrap.dataset.expanded === "1");
      if (!arr.length) {
        const empty = document.createElement("span");
        empty.className = "muted";
        empty.style.fontSize = "12px";
        empty.textContent = "—";
        wrap.appendChild(empty);
        wrap.dataset.expanded = "0";
        return;
      }

      const visible = expanded ? arr : arr.slice(0, limit);
      for (const value of visible) {
        const chip = document.createElement("span");
        chip.className = `chip mini ${type === "hard" ? "chip-hard" : (type === "teams" ? "chip-team" : "chip-soft")}`;
        chip.textContent = value;
        wrap.appendChild(chip);
      }

      if (arr.length > limit) {
        const moreBtn = document.createElement("button");
        moreBtn.type = "button";
        moreBtn.className = `chip mini chip-more ${type === "hard" ? "chip-hard" : (type === "teams" ? "chip-team" : "chip-soft")}`;
        moreBtn.textContent = expanded ? "ver menos" : `+${arr.length - limit}`;
        moreBtn.title = expanded ? "Recolher" : "Ver todas";
        moreBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          wrap.dataset.expanded = (wrap.dataset.expanded === "1") ? "0" : "1";
          renderMiniChips(wrap, arr, type);
        });
        wrap.appendChild(moreBtn);
      }
    };

    renderMiniChips(softWrap, softArr, "soft");
    renderMiniChips(hardWrap, hardArr, "hard");
    renderMiniChips(teamsWrap, teamsArr, "teams");
    refs.usersTbody.appendChild(tr);
  }
}

function setCreateUserModalMode(deps, mode, user = null) {
  const { refs, state } = deps;
  const isView = mode === "view";
  const isEdit = mode === "edit";
  state._adminUserModalMode = mode;
  state._adminEditingUserUid = isEdit ? (user?.uid || "") : null;

  const titleEl = refs.modalCreateUser?.querySelector(".modal-header h2");
  const subEl = refs.modalCreateUser?.querySelector(".modal-header p");
  if (titleEl) titleEl.textContent = isView ? "Visualizar Usuario" : (isEdit ? "Editar Usuario" : "Novo Usuario");
  if (subEl) subEl.textContent = isView
    ? "Visualizacao dos dados do usuario."
    : (isEdit ? "Atualize os dados do usuario." : "Cadastre um usuario, selecione equipes e informe foto e skills quando precisar.");

  if (refs.newUserNameEl) refs.newUserNameEl.disabled = isView;
  if (refs.newUserRoleEl) refs.newUserRoleEl.disabled = isView;
  if (refs.newUserEmailEl) refs.newUserEmailEl.disabled = isEdit || isView;
  if (refs.newUserPhoneEl) refs.newUserPhoneEl.disabled = isView;
  if (refs.newUserActiveEl) refs.newUserActiveEl.disabled = isView;
  if (refs.newUserSoftSkillInputEl) refs.newUserSoftSkillInputEl.disabled = isView;
  if (refs.newUserHardSkillInputEl) refs.newUserHardSkillInputEl.disabled = isView;
  if (refs.newUserAvatarFileEl) refs.newUserAvatarFileEl.disabled = isView;
  if (refs.btnNewUserRemovePhoto) refs.btnNewUserRemovePhoto.disabled = isView;
  if (refs.teamChipsEl) refs.teamChipsEl.classList.toggle("readonly", isView);
  if (refs.newUserSoftSkillChips) refs.newUserSoftSkillChips.classList.toggle("readonly", isView);
  if (refs.newUserHardSkillChips) refs.newUserHardSkillChips.classList.toggle("readonly", isView);
  if (refs.btnCreateUser) {
    refs.btnCreateUser.style.display = isView ? "none" : "";
    refs.btnCreateUser.textContent = isEdit ? "Salvar alteracoes" : "Salvar";
  }
}

function fillCreateUserModal(user, deps) {
  const { refs, state } = deps;
  refs.newUserUidEl.value = user?.uid || "";
  refs.newUserNameEl.value = user?.name || "";
  refs.newUserRoleEl.value = user?.role || "tecnico";
  refs.newUserEmailEl.value = user?.email || "";
  refs.newUserPhoneEl.value = user?.phone || "";
  refs.newUserActiveEl.value = (user?.active === false) ? "false" : "true";

  state.selectedTeamIds = Array.isArray(user?.teamIds) ? [...user.teamIds] : (user?.teamId ? [user.teamId] : []);
  state._newUserSoftSkillsDraft = Array.isArray(user?.softSkills) ? [...user.softSkills] : [];
  state._newUserHardSkillsDraft = Array.isArray(user?.hardSkills) ? [...user.hardSkills] : [];
  state._newUserAvatarFile = null;
  state._newUserTempAvatarPath = "";
  state._newUserTempAvatarURL = "";
  state._newUserPhotoRemoved = false;
  if (refs.newUserSoftSkillInputEl) refs.newUserSoftSkillInputEl.value = "";
  if (refs.newUserHardSkillInputEl) refs.newUserHardSkillInputEl.value = "";
  if (refs.newUserAvatarFileEl) refs.newUserAvatarFileEl.value = "";
  setNewUserPhotoFileName(refs, user?.photoURL ? "Foto atual" : "Nenhum arquivo selecionado");
  if (refs.newUserAvatarPreviewImg && refs.newUserAvatarPreviewFallback) {
    if (user?.photoURL) {
      refs.newUserAvatarPreviewImg.src = user.photoURL;
      refs.newUserAvatarPreviewImg.style.display = "block";
      refs.newUserAvatarPreviewFallback.textContent = "";
    } else {
      refs.newUserAvatarPreviewImg.src = "";
      refs.newUserAvatarPreviewImg.style.display = "none";
      refs.newUserAvatarPreviewFallback.textContent = initialsFromName(user?.name || "");
    }
  }
  initNewUserRichFields(deps);
  renderTeamChips(deps);
}

function openEditCompanyUserModal(user, deps) {
  const { refs } = deps;
  clearAlert(refs.createUserAlert);
  refs.modalCreateUser.hidden = false;
  setCreateUserModalMode(deps, "edit", user);
  fillCreateUserModal(user, deps);
}

function openViewCompanyUserModal(user, deps) {
  const { refs } = deps;
  clearAlert(refs.createUserAlert);
  refs.modalCreateUser.hidden = false;
  setCreateUserModalMode(deps, "view", user);
  fillCreateUserModal(user, deps);
}

export function openCreateUserModal(deps) {
  const { refs, state, ensureTeamsForChips, renderTeamChips } = deps;
  if (!refs.modalCreateUser) return;
  clearAlert(refs.createUserAlert);
  refs.modalCreateUser.hidden = false;
  setCreateUserModalMode(deps, "create");

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
  if (refs.newUserSoftSkillInputEl) refs.newUserSoftSkillInputEl.value = "";
  if (refs.newUserHardSkillInputEl) refs.newUserHardSkillInputEl.value = "";

  state._newUserSoftSkillsDraft = [];
  state._newUserHardSkillsDraft = [];
  state._newUserAvatarFile = null;
  state._newUserTempAvatarPath = "";
  state._newUserTempAvatarURL = "";
  state._newUserPhotoRemoved = false;
  if (refs.newUserAvatarFileEl) refs.newUserAvatarFileEl.value = "";
  setNewUserPhotoFileName(refs, "Nenhum arquivo selecionado");
  if (refs.newUserAvatarPreviewImg) {
    refs.newUserAvatarPreviewImg.style.display = "none";
    refs.newUserAvatarPreviewImg.src = "";
  }
  if (refs.newUserAvatarPreviewFallback) {
    refs.newUserAvatarPreviewFallback.textContent = initialsFromName("");
  }
  initNewUserRichFields(deps);

  state.selectedTeamIds = [];

  ensureTeamsForChips()
    .then(() => renderTeamChips())
    .catch(() => renderTeamChips());
}

export function closeCreateUserModal(depsOrRefs) {
  const refs = depsOrRefs?.refs || depsOrRefs;
  const state = depsOrRefs?.state;
  if (refs?.modalCreateUser) refs.modalCreateUser.hidden = true;
  if (state) {
    state._newUserAvatarFile = null;
    state._newUserSoftSkillsDraft = [];
    state._newUserHardSkillsDraft = [];
    state._adminEditingUserUid = null;
    state._adminUserModalMode = "create";
    state._newUserPhotoRemoved = false;
    deleteTempAvatarIfAny(depsOrRefs);
  }
}

export function renderTeamChips(deps) {
  const { refs, state } = deps;
  if (!refs.teamChipsEl) return;
  refs.teamChipsEl.innerHTML = "";
  const readOnly = state._adminUserModalMode === "view";

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

    if (!readOnly) {
      chip.addEventListener("click", () => {
        const idx = state.selectedTeamIds.indexOf(t.id);
        if (idx >= 0) state.selectedTeamIds.splice(idx, 1);
        else state.selectedTeamIds.push(t.id);
        renderTeamChips(deps);
      });
    }

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
  const softSkills = uniqClean((state._newUserSoftSkillsDraft && state._newUserSoftSkillsDraft.length)
    ? state._newUserSoftSkillsDraft
    : readChipsText(refs.newUserSoftSkillChips));
  const hardSkills = uniqClean((state._newUserHardSkillsDraft && state._newUserHardSkillsDraft.length)
    ? state._newUserHardSkillsDraft
    : readChipsText(refs.newUserHardSkillChips));

  const wantsAutoAuth = !uid;

  if (state._adminEditingUserUid) {
    return await updateCompanyUser(deps);
  }

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
            teamIds,
            tempAvatarPath: (state._newUserTempAvatarPath || "").trim(),
            softSkills,
            hardSkills
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

        try {
          await setDoc(doc(db, "companies", state.companyId, "users", uid), {
            name,
            role,
            email,
            emailLower: normalizeText(email),
            phone,
            active,
            teamIds,
            teamId: teamIds[0] || "",
            softSkills,
            hardSkills
          }, { merge: true });
        } catch (mergeErr) {
          console.warn("merge user extra fields failed", mergeErr);
        }

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
      emailLower: normalizeText(email),
      phone,
      active,
      teamIds,
      teamId: teamIds[0] || "",
      softSkills,
      hardSkills,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid
    });

    await setDoc(doc(db, "userCompanies", uid), { companyId: state.companyId });

    if (state._newUserAvatarFile) {
      try {
        setAlert(refs.createUserAlert, "Enviando foto...", "info");
        await waitForCompanyUserDoc(db, state.companyId, uid, 3000);
        const photoURL = await uploadAvatarForUser(deps, uid, state._newUserAvatarFile);
        if (photoURL) {
          await updateDoc(doc(db, "companies", state.companyId, "users", uid), { photoURL });
        }
      } catch (errUp) {
        console.warn("avatar upload failed", errUp);
      }
    }

    closeCreateUserModal(deps);
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
  } finally {
    state._newUserAvatarFile = null;
  }
}

async function updateCompanyUser(deps) {
  const { refs, state, db, loadUsers } = deps;
  const uid = state._adminEditingUserUid;
  const name = (refs.newUserNameEl?.value || "").trim();
  const role = (refs.newUserRoleEl?.value || "").trim();
  const email = (refs.newUserEmailEl?.value || "").trim();
  const phone = normalizePhone(refs.newUserPhoneEl?.value || "");
  const active = (refs.newUserActiveEl?.value || "true") === "true";
  const teamIds = Array.from(new Set(state.selectedTeamIds || []));
  const softSkills = uniqClean((state._newUserSoftSkillsDraft && state._newUserSoftSkillsDraft.length)
    ? state._newUserSoftSkillsDraft
    : readChipsText(refs.newUserSoftSkillChips));
  const hardSkills = uniqClean((state._newUserHardSkillsDraft && state._newUserHardSkillsDraft.length)
    ? state._newUserHardSkillsDraft
    : readChipsText(refs.newUserHardSkillChips));

  if (!uid) return setAlert(refs.createUserAlert, "Nao foi possivel identificar o usuario.");
  if (!name) return setAlert(refs.createUserAlert, "Informe o nome do usuario.");
  if (!role) return setAlert(refs.createUserAlert, "Selecione a funcao.");
  if (!email || !isEmailValidBasic(email)) return setAlert(refs.createUserAlert, "Informe um e-mail valido.");
  if (role !== "admin" && teamIds.length === 0) {
    return setAlert(refs.createUserAlert, "Selecione pelo menos 1 equipe para este usuario.");
  }

  setAlert(refs.createUserAlert, "Salvando alteracoes...", "info");

  try {
    const payload = {
      name,
      role,
      phone,
      active,
      teamIds,
      teamId: teamIds[0] || "",
      softSkills,
      hardSkills
    };

    if (state._newUserPhotoRemoved) payload.photoURL = "";

    await updateDoc(doc(db, "companies", state.companyId, "users", uid), payload);

    if (state._newUserAvatarFile) {
      try {
        setAlert(refs.createUserAlert, "Enviando foto...", "info");
        await waitForCompanyUserDoc(db, state.companyId, uid, 3000);
        const photoURL = await uploadAvatarForUser(deps, uid, state._newUserAvatarFile);
        if (photoURL) {
          await updateDoc(doc(db, "companies", state.companyId, "users", uid), { photoURL });
        }
      } catch (errUp) {
        console.warn("avatar upload failed", errUp);
      }
    }

    closeCreateUserModal(deps);
    await loadUsers(deps);
  } catch (err) {
    console.error(err);
    setAlert(refs.createUserAlert, "Erro ao salvar: " + (err?.message || err));
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
