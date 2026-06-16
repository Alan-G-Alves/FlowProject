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
  where,
  limit,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getDownloadURL, ref as storageRef, uploadBytes, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { show, hide } from "../utils/dom.js";
import { setAlert, clearAlert } from "../ui/alerts.js";
import { normalizeRole } from "../utils/roles.js";
import { normalizePhone } from "../utils/format.js";
import { isEmailValidBasic } from "../utils/validators.js";
import { normalizeCompanyPlan } from "../utils/plans.js?v=1779922600";
import {
  bindMaskedInput,
  bindAgePreview,
  calculateAgeFromBirthDate,
  formatCpf,
  formatCnpj,
  sanitizeAddress,
  toAttachmentDrafts,
  addAttachmentFiles,
  renderAttachmentList,
  uploadAttachmentDrafts,
  deleteStoredAttachments,
  PERSON_ATTACHMENT_MAX_FILES
} from "../utils/person-records.js";

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

function sameStringArray(a, b) {
  const left = (Array.isArray(a) ? a : []).map((item) => String(item || "")).filter(Boolean).sort();
  const right = (Array.isArray(b) ? b : []).map((item) => String(item || "")).filter(Boolean).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isPermissionDeniedError(err) {
  const code = String(err?.code || "").toLowerCase();
  const msg = String(err?.message || err || "").toLowerCase();
  return code.includes("permission-denied")
    || code.includes("permission_denied")
    || msg.includes("missing or insufficient permissions")
    || msg.includes("permission");
}

function hasUserAttachmentChanges(state) {
  const draftItems = Array.isArray(state?._newUserAttachmentsDraft) ? state._newUserAttachmentsDraft : [];
  const removedItems = Array.isArray(state?._newUserRemovedAttachments) ? state._newUserRemovedAttachments : [];
  return removedItems.length > 0 || draftItems.some((item) => item?.isNew && item?.file);
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

function updateUserAttachmentsSummary(refs, items) {
  if (!refs?.newUserAttachmentsSummary) return;
  const total = Array.isArray(items) ? items.length : 0;
  refs.newUserAttachmentsSummary.textContent = `${total}/${PERSON_ATTACHMENT_MAX_FILES} arquivos`;
}

function renderUserAttachments(deps) {
  const { refs, state } = deps;
  const items = Array.isArray(state._newUserAttachmentsDraft) ? state._newUserAttachmentsDraft : [];
  updateUserAttachmentsSummary(refs, items);
  renderAttachmentList(refs.newUserAttachmentsList, items, {
    readOnly: state._adminUserModalMode === "view",
    emptyText: "Nenhum arquivo anexado para este usuario.",
    onRemove: (item) => {
      state._newUserAttachmentsDraft = items.filter((entry) => entry.id !== item.id);
      if (!item?.isNew && item?.path) {
        state._newUserRemovedAttachments = [...(state._newUserRemovedAttachments || []), item];
      }
      renderUserAttachments(deps);
    }
  });
}

function preserveModalScrollDuring(deps, fn, prevScrollTop = null) {
  const bodyEl = deps?.refs?.modalCreateUser?.querySelector?.(".modal-body");
  const prev = (typeof prevScrollTop === "number") ? prevScrollTop : (bodyEl ? bodyEl.scrollTop : 0);
  fn();
  if (!bodyEl) return;
  requestAnimationFrame(() => {
    try { bodyEl.scrollTop = prev; } catch (_) {}
  });
}

function collectUserExtraFields(refs) {
  const birthDate = String(refs.newUserBirthDateEl?.value || "").trim();
  const age = calculateAgeFromBirthDate(birthDate);
  return {
    address: sanitizeAddress(refs.newUserAddressEl?.value || ""),
    cpf: formatCpf(refs.newUserCpfEl?.value || ""),
    cnpj: formatCnpj(refs.newUserCnpjEl?.value || ""),
    birthDate,
    ...(age === null ? {} : { age })
  };
}

async function syncUserAttachments(deps, uid) {
  const { state, storage, db, callHttpFunctionWithAuth } = deps;
  const draftItems = Array.isArray(state._newUserAttachmentsDraft) ? state._newUserAttachmentsDraft : [];
  const removedItems = Array.isArray(state._newUserRemovedAttachments) ? state._newUserRemovedAttachments : [];

  const attachments = await uploadAttachmentDrafts({
    storage,
    companyId: state.companyId,
    uid,
    draftItems
  });

  try {
    await updateDoc(doc(db, "companies", state.companyId, "users", uid), { attachments });
  } catch (err) {
    if (!isPermissionDeniedError(err) || typeof callHttpFunctionWithAuth !== "function") throw err;
    await callHttpFunctionWithAuth("adminUpdateCompanyUserHttp", {
      companyId: state.companyId,
      targetUid: uid,
      patch: { attachments }
    });
  }
  await deleteStoredAttachments({ storage, items: removedItems });

  state._newUserAttachmentsDraft = toAttachmentDrafts(attachments);
  state._newUserRemovedAttachments = [];
  return attachments;
}

async function findUserUidByEmailInCompany(db, companyId, email) {
  const emailLower = normalizeText(email);
  if (!companyId || !emailLower) return "";

  const usersCol = collection(db, "companies", companyId, "users");

  try {
    const q1 = query(usersCol, where("emailLower", "==", emailLower), limit(1));
    const snap1 = await getDocs(q1);
    if (!snap1.empty) return snap1.docs[0].id;
  } catch (_) {}

  try {
    const q2 = query(usersCol, where("email", "==", email), limit(1));
    const snap2 = await getDocs(q2);
    if (!snap2.empty) return snap2.docs[0].id;
  } catch (_) {}

  return "";
}

async function assertCompanyUserLimitAvailable(db, companyId, willBeActive = true) {
  if (!willBeActive) return;
  const companySnap = await getDoc(doc(db, "companies", companyId));
  const plan = normalizeCompanyPlan(companySnap.exists() ? companySnap.data() : {});
  const usersSnap = await getDocs(collection(db, "companies", companyId, "users"));
  const activeCount = usersSnap.docs.filter((d) => d.data()?.active === true).length;
  if (activeCount >= plan.userLimit) {
    throw new Error(`Limite do plano atingido: ${activeCount}/${plan.userLimit} usuarios ativos no plano ${plan.label}.`);
  }
}

function isIndividualAccount(state) {
  const company = state?.company || {};
  const accountType = String(company.accountType || company.type || company.customerType || "").trim().toLowerCase();
  const planId = String(company.planId || company.plan || "").trim().toLowerCase();
  const planName = String(company.planName || company.planLabel || company.label || "").trim().toLowerCase();
  const documentType = String(company.documentType || company.docType || "").trim().toLowerCase();
  const companyId = String(state?.companyId || company.id || "").trim().toLowerCase();
  return (
    accountType === "individual" ||
    accountType === "b2c" ||
    accountType === "cpf" ||
    accountType === "gestor" ||
    planId.startsWith("manager-") ||
    planName.startsWith("gestor ") ||
    planName.includes("gestor start") ||
    planName.includes("gestor pro") ||
    planName.includes("gestor plus") ||
    documentType === "cpf" ||
    companyId.startsWith("cpf-")
  );
}

function formatDecimalInput(value){
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseBRDecimalToNumber(raw){
  const s = (raw ?? "").toString().trim().replace(/[^0-9,.-]/g, "");
  if (!s) return null;
  const normalized = s.replace(/\./g, "").replace(/,/g, ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function getCompanyOwnerUid(state) {
  return String(state?.company?.ownerUid || "").trim();
}

function configureUserRoleOptions(deps, mode = "create", user = null) {
  const { refs, state } = deps;
  const select = refs.newUserRoleEl;
  if (!select) return;

  const roleField = select.closest("label");
  const nameField = refs.newUserNameEl?.closest("label");
  const emailField = refs.newUserEmailEl?.closest("label");
  const phoneField = refs.newUserPhoneEl?.closest("label");
  const activeField = refs.newUserActiveEl?.closest("label");
  const hourlyRateField = refs.newUserHourlyRateEl?.closest("label");
  const currentRole = String(user?.role || "tecnico").trim() || "tecnico";
  const individual = isIndividualAccount(state);
  const useIndividualLayout = individual;
  const showHourlyRate = individual && (mode === "create" || currentRole === "tecnico" || currentRole === "recurso");
  const roles = individual
    ? [{ value: "tecnico", label: "Recurso" }]
    : [
        { value: "tecnico", label: "Recurso" },
        { value: "coordenador", label: "Coordenador" },
        { value: "gestor", label: "Gestor" },
        { value: "admin", label: "Admin" },
      ];

  if (individual && mode !== "create" && currentRole !== "tecnico") {
    roles.push({ value: currentRole, label: normalizeRole(currentRole) });
  }

  select.innerHTML = roles.map((role) => `<option value="${role.value}">${role.label}</option>`).join("");
  select.value = mode === "create" ? "tecnico" : currentRole;
  select.disabled = mode === "view" || (individual && mode !== "create" && currentRole !== "tecnico");

  if (roleField) {
    const hideRole = useIndividualLayout;
    roleField.hidden = hideRole;
    roleField.style.display = hideRole ? "none" : "";
  }
  if (nameField) nameField.style.gridColumn = useIndividualLayout ? "span 6" : "";
  if (emailField) emailField.style.gridColumn = useIndividualLayout ? "span 6" : "";
  if (phoneField) phoneField.style.gridColumn = useIndividualLayout ? "span 4" : "";
  if (activeField) activeField.style.gridColumn = useIndividualLayout ? "span 4" : "";
  if (hourlyRateField) {
    hourlyRateField.hidden = !showHourlyRate;
    hourlyRateField.style.display = showHourlyRate ? "" : "none";
  }
}

function initNewUserRichFields(deps) {
  const { refs, state } = deps;

  setupChipInput(refs.newUserSoftSkillInputEl, refs.newUserSoftSkillChips, state, "_newUserSoftSkillsDraft", "soft");
  setupChipInput(refs.newUserHardSkillInputEl, refs.newUserHardSkillChips, state, "_newUserHardSkillsDraft", "hard");
  bindMaskedInput(refs.newUserCpfEl, formatCpf, "boundCpf");
  bindMaskedInput(refs.newUserCnpjEl, formatCnpj, "boundCnpj");
  bindAgePreview(refs.newUserBirthDateEl, refs.newUserAgePreview, "boundUserAge");

  if (refs.newUserNameEl && refs.newUserAvatarPreviewFallback && !refs.newUserNameEl.dataset.boundAvatar) {
    refs.newUserNameEl.dataset.boundAvatar = "1";
    refs.newUserNameEl.addEventListener("input", () => {
      if (refs.newUserAvatarPreviewImg && refs.newUserAvatarPreviewImg.style.display !== "none") return;
      refs.newUserAvatarPreviewFallback.textContent = initialsFromName(refs.newUserNameEl.value);
    });
  }

  if (refs.newUserAvatarFileEl && !refs.newUserAvatarFileEl.dataset.bound) {
    refs.newUserAvatarFileEl.dataset.bound = "1";
    // Captura scroll antes do seletor de arquivo abrir (evita "pular" e deixar o modal branco).
    refs.newUserAvatarFileEl.addEventListener("click", () => {
      const bodyEl = refs.modalCreateUser?.querySelector?.(".modal-body");
      state._newUserModalScrollTop = bodyEl ? bodyEl.scrollTop : 0;
    });
    refs.newUserAvatarFileEl.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const restoreScroll = typeof state._newUserModalScrollTop === "number" ? state._newUserModalScrollTop : null;
      preserveModalScrollDuring(deps, () => {
        setNewUserPhotoFileName(refs, file.name || "Arquivo selecionado");
        state._newUserAvatarFile = file;
        state._newUserPhotoRemoved = false;
        setAlert(refs.createUserAlert, "Enviando foto...", "info");
      }, restoreScroll);

      await deleteTempAvatarIfAny(deps);

      try {
        const { tempAvatarPath, tempAvatarURL } = await uploadTempAvatarForDraft(deps, file);
        state._newUserTempAvatarPath = tempAvatarPath;
        state._newUserTempAvatarURL = tempAvatarURL;
        preserveModalScrollDuring(deps, () => {
          if (refs.newUserAvatarPreviewImg) {
            refs.newUserAvatarPreviewImg.src = tempAvatarURL;
            refs.newUserAvatarPreviewImg.style.display = "block";
          }
          if (refs.newUserAvatarPreviewFallback) refs.newUserAvatarPreviewFallback.textContent = "";
          clearAlert(refs.createUserAlert);
        }, restoreScroll);
      } catch (err) {
        state._newUserTempAvatarPath = "";
        state._newUserTempAvatarURL = "";
        preserveModalScrollDuring(deps, () => {
          setAlert(refs.createUserAlert, "Nao foi possivel enviar a foto: " + (err?.message || err), "error");
        }, restoreScroll);
      } finally {
        state._newUserModalScrollTop = null;
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

  if (refs.newUserAttachmentsEl && !refs.newUserAttachmentsEl.dataset.bound) {
    refs.newUserAttachmentsEl.dataset.bound = "1";
    refs.newUserAttachmentsEl.addEventListener("click", () => {
      const bodyEl = refs.modalCreateUser?.querySelector?.(".modal-body");
      state._newUserModalScrollTop = bodyEl ? bodyEl.scrollTop : 0;
    });
    refs.newUserAttachmentsEl.addEventListener("change", (e) => {
      const result = addAttachmentFiles(state._newUserAttachmentsDraft || [], e.target.files || []);
      const restoreScroll = typeof state._newUserModalScrollTop === "number" ? state._newUserModalScrollTop : null;
      preserveModalScrollDuring(deps, () => {
        if (result.error) {
          setAlert(refs.createUserAlert, result.error, "error");
        } else {
          state._newUserAttachmentsDraft = result.items;
          renderUserAttachments(deps);
        }
      }, restoreScroll);
      state._newUserModalScrollTop = null;
      e.target.value = "";
    });
  }

  renderUserAttachments(deps);
}

/** =========================
 *  USERS DOMAIN (Admin da Empresa)
 *  ========================= */

export function updateAdminSummary(deps) {
  const { refs, state } = deps;
  const allUsers = Array.isArray(state._usersCache) ? state._usersCache : [];
  const allTeams = Array.isArray(state._teamsAllCache) ? state._teamsAllCache : (Array.isArray(state.teams) ? state.teams : []);
  const individual = isIndividualAccount(state);
  const blockedUsers = allUsers.filter((u) => u.active === false).length;
  const managersCount = individual
    ? allUsers.filter((u) => u.role === "gestor" || u.role === "admin").length
    : allUsers.filter((u) => u.role === "gestor").length;
  const techsCount = allUsers.filter((u) => u.role === "tecnico").length;
  const adminsCount = allUsers.filter((u) => u.role === "admin").length;
  const coordinatorsCount = allUsers.filter((u) => u.role === "coordenador").length;

  if (refs.adminUsersCount) refs.adminUsersCount.textContent = String(allUsers.length);
  if (refs.adminManagersCount) refs.adminManagersCount.textContent = String(managersCount);
  if (refs.adminTechsCount) refs.adminTechsCount.textContent = String(techsCount);
  if (refs.adminAdminsCount) refs.adminAdminsCount.textContent = String(adminsCount);
  if (refs.adminCoordinatorsCount) refs.adminCoordinatorsCount.textContent = String(coordinatorsCount);
  const adminPill = refs.adminAdminsCount?.closest?.(".admin-mini-pill");
  const coordinatorPill = refs.adminCoordinatorsCount?.closest?.(".admin-mini-pill");
  [adminPill, coordinatorPill].forEach((pill) => {
    if (!pill) return;
    pill.hidden = individual;
    pill.style.display = individual ? "none" : "";
  });
  if (refs.adminTeamsCount) refs.adminTeamsCount.textContent = String(allTeams.length);
  if (refs.adminBlockedUsersCount) refs.adminBlockedUsersCount.textContent = String(blockedUsers);
}

function getSortableUsers(users, state) {
  const sortKey = state?._usersSortKey || "name";
  const sortDir = state?._usersSortDir === "desc" ? "desc" : "asc";
  const dir = sortDir === "desc" ? -1 : 1;

  const getValue = (u) => {
    switch (sortKey) {
      case "role":
        return normalizeRole(u.role || "");
      case "email":
        return u.email || "";
      case "phone":
        return u.phone || "";
      case "softSkills":
        return Array.isArray(u.softSkills) ? u.softSkills.join(", ") : "";
      case "hardSkills":
        return Array.isArray(u.hardSkills) ? u.hardSkills.join(", ") : "";
      case "feedbackCount":
        return Number(u.feedbackCount || 0);
      case "teams": {
        const teamIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
        const teamArr = teamIds.map((teamId) => {
          const team = (state.teams || []).find((item) => item.id === teamId);
          return team?.name || teamId;
        });
        return teamArr.join(", ");
      }
      case "status":
        return u.active === false ? "Inativo" : "Ativo";
      case "name":
      default:
        return u.name || "";
    }
  };

  return [...users].sort((a, b) => {
    const avRaw = getValue(a);
    const bvRaw = getValue(b);
    if (typeof avRaw === "number" || typeof bvRaw === "number") {
      return ((Number(avRaw) || 0) - (Number(bvRaw) || 0)) * dir;
    }
    const av = String(avRaw || "").toLowerCase();
    const bv = String(bvRaw || "").toLowerCase();
    return av.localeCompare(bv, "pt-BR", { numeric: true, sensitivity: "base" }) * dir;
  });
}

function initUsersTableSorting(deps) {
  const { refs, state, loadUsers } = deps;
  const table = refs.usersTbody?.closest("table");
  if (!table) return;

  const headers = Array.from(table.querySelectorAll("thead th.sortable"));
  for (const th of headers) {
    if (!th.dataset.boundSort) {
      th.dataset.boundSort = "1";
      th.addEventListener("click", () => {
        const key = th.dataset.sort || "name";
        if (state._usersSortKey === key) {
          state._usersSortDir = state._usersSortDir === "desc" ? "asc" : "desc";
        } else {
          state._usersSortKey = key;
          state._usersSortDir = "asc";
        }
        loadUsers(deps);
      });
    }
    th.classList.toggle("is-sorted", state._usersSortKey === th.dataset.sort);
    th.classList.toggle("asc", state._usersSortKey === th.dataset.sort && (state._usersSortDir || "asc") === "asc");
    th.classList.toggle("desc", state._usersSortKey === th.dataset.sort && state._usersSortDir === "desc");
  }
}

function exportUsersToExcel(deps, items) {
  const { state } = deps;
  const companyId = (state.companyId || "empresa").toString();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = `usuarios_${companyId}_${stamp}.xls`;

  const esc = (v) => String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
  const join = (arr) => (Array.isArray(arr) ? arr.join(", ") : "");

  const rows = items.map((u) => {
    const teamIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
    const teamsLabel = teamIds.length
      ? teamIds.map((teamId) => {
          const team = (state.teams || []).find((item) => item.id === teamId);
          return team?.name || teamId;
        }).join(", ")
      : "";
    const statusLabel = (u.active === false) ? "Inativo" : "Ativo";

    return `
      <tr>
        <td>${esc(u.name || "")}</td>
        <td>${esc(normalizeRole(u.role || ""))}</td>
        <td>${esc(u.email || "")}</td>
        <td>${esc(u.phone || "")}</td>
        <td>${esc(join(u.softSkills))}</td>
        <td>${esc(join(u.hardSkills))}</td>
        <td>${esc(u.feedbackCount ?? 0)}</td>
        <td>${esc(teamsLabel)}</td>
        <td>${esc(statusLabel)}</td>
      </tr>
    `;
  }).join("");

  const html = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <table border="1">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Funcao</th>
              <th>E-mail</th>
              <th>Telefone</th>
              <th>Soft Skills</th>
              <th>Hard Skills</th>
              <th>Feedback</th>
              <th>Equipes</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>
  `;

  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function loadUsers(deps) {
  const { refs, state, db, loadTeams, openManagedTeamsModal, openUserFeedbackModal } = deps;
  if (!refs.usersTbody) return;

  state._usersLoadSeq = (state._usersLoadSeq || 0) + 1;
  const mySeq = state._usersLoadSeq;

  hide(refs.usersEmpty);
  if (refs.usersPagination) refs.usersPagination.innerHTML = "";

  const snap = await getDocs(collection(db, "companies", state.companyId, "users"));
  if (mySeq !== state._usersLoadSeq) return;

  refs.usersTbody.innerHTML = "";
  const allRaw = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const allMap = new Map();
  for (const u of allRaw) {
    const key = (u.emailLower || u.email || u.uid || "").toString().toLowerCase();
    if (!key) {
      allMap.set(u.uid, u);
      continue;
    }
    const prev = allMap.get(key);
    if (!prev) {
      allMap.set(key, u);
      continue;
    }
    const score = (x) => (x?.updatedAt ? 4 : 0) + (x?.createdAt ? 2 : 0) + (x?.number ? 1 : 0);
    allMap.set(key, score(u) >= score(prev) ? u : prev);
  }
  const all = Array.from(allMap.values());

  const q = (refs.userSearch?.value || "").toLowerCase().trim();

  state._usersCache = all;
  updateAdminSummary(deps);

  const filtered = all.filter(u => {
    const text = `${u.uid} ${u.name || ""} ${u.email || ""} ${u.phone || ""}`.toLowerCase();
    const okQ = !q || text.includes(q);
    const roleFilter = (refs.userRoleFilter?.value || "").trim();
    const okRole = !roleFilter || (u.role === roleFilter);
    return okQ && okRole;
  });

  const filterKey = `${q}::${(refs.userRoleFilter?.value || "").trim()}`;
  if (state._usersLastFilterKey !== filterKey) {
    state._usersLastFilterKey = filterKey;
    state._usersPage = 1;
  }

  if (!state._usersSortKey) state._usersSortKey = "name";
  if (!state._usersSortDir) state._usersSortDir = "asc";
  const sorted = getSortableUsers(filtered, state);
  initUsersTableSorting(deps);

  if (sorted.length === 0) {
    show(refs.usersEmpty);
    return;
  }

  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE));
  state._usersPage = Math.min(Math.max(1, Number(state._usersPage || 1)), totalPages);

  const startIdx = (state._usersPage - 1) * ITEMS_PER_PAGE;
  const endIdx = startIdx + ITEMS_PER_PAGE;
  const pageItems = sorted.slice(startIdx, endIdx);

  if (refs.usersPagination) {
    const cur = state._usersPage;
    const windowSize = 7;
    const half = Math.floor(windowSize / 2);
    let from = Math.max(1, cur - half);
    let to = Math.min(totalPages, from + windowSize - 1);
    from = Math.max(1, to - windowSize + 1);

    const mkBtn = (label, page, disabled, cls = "") => {
      const dis = disabled ? "disabled" : "";
      return `<button class="page-btn ${cls}" data-page="${page}" ${dis}>${label}</button>`;
    };

    const parts = [];
    parts.push(`<div class="page-meta">
      <span>Mostrando <b>${Math.min(endIdx, sorted.length)}</b> de <b>${sorted.length}</b></span>
      <button class="icon-btn xs btn-download" data-act="export" title="Baixar Excel" aria-label="Baixar Excel">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 3v10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M8 11l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M4 20h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>`);
    parts.push(`<div class="page-controls">`);
    parts.push(mkBtn("‹", cur - 1, cur <= 1, "nav"));

    if (from > 1) {
      parts.push(mkBtn("1", 1, false, (cur === 1 ? "active" : "")));
      if (from > 2) parts.push(`<span class="page-ellipsis">…</span>`);
    }

    for (let p = from; p <= to; p++) {
      parts.push(mkBtn(String(p), p, false, (p === cur ? "active" : "")));
    }

    if (to < totalPages) {
      if (to < totalPages - 1) parts.push(`<span class="page-ellipsis">…</span>`);
      parts.push(mkBtn(String(totalPages), totalPages, false, (cur === totalPages ? "active" : "")));
    }

    parts.push(mkBtn("›", cur + 1, cur >= totalPages, "nav"));
    parts.push(`</div>`);

    refs.usersPagination.innerHTML = parts.join("");
    refs.usersPagination.querySelectorAll("[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = Number(btn.getAttribute("data-page"));
        if (!p || p < 1 || p > totalPages) return;
        state._usersPage = p;
        loadUsers(deps);
      });
    });

    const exportBtn = refs.usersPagination.querySelector('[data-act="export"]');
    if (exportBtn) {
      exportBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          exportUsersToExcel(deps, sorted);
        } catch (err) {
          console.error(err);
          alert("Nao foi possivel exportar.");
        }
      });
    }
  }

  const rowsFragment = document.createDocumentFragment();
  for (const u of pageItems) {
    const tr = document.createElement("tr");

    const teamIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
    const teamObjects = teamIds.map((teamId) => {
      const team = (state.teams || []).find((item) => item.id === teamId);
      return { id: teamId, label: team?.name || teamId };
    });
    const teamArr = teamObjects.map((item) => item.label);
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
        </div>
      </td>
      <td>${normalizeRole(u.role)}</td>
      <td>${u.email || "—"}</td>
      <td>${u.phone || "—"}</td>
      <td>${softSkillsLabel}</td>
      <td>${hardSkillsLabel}</td>
      <td><button class="btn sm feedback-badge" data-act="feedbackCount">${(u.feedbackCount || 0)}</button></td>
      <td>${teamsLabel}</td>
      <td><span class="badge small status-pill ${u.active === false ? "status-inactive" : "status-active"}">${statusLabel}</span></td>
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
    if (rowCells[8]) rowCells[8].innerHTML = '<div class="chips-mini" data-teams></div>';

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

    tr.querySelector('[data-act="feedbackCount"]')?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof openUserFeedbackModal === "function") {
        await openUserFeedbackModal(u);
      }
    });

    const softWrap = tr.querySelector("[data-soft]");
    const hardWrap = tr.querySelector("[data-hard]");
    const teamsWrap = tr.querySelector("[data-teams]");
    const softArr = Array.isArray(u.softSkills) ? u.softSkills : [];
    const hardArr = Array.isArray(u.hardSkills) ? u.hardSkills : [];
    const teamsArr = teamObjects;

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
        const chip = document.createElement(type === "teams" ? "button" : "span");
        chip.className = `chip mini ${type === "hard" ? "chip-hard" : (type === "teams" ? "chip-team removable" : "chip-soft")}`;
        if (type === "teams") {
          chip.type = "button";
          chip.title = `Remover da equipe ${value.label}`;
          chip.innerHTML = `<span>${value.label}</span><span class="chip-removable-x">x</span>`;
          chip.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const currentTeamIds = Array.isArray(u.teamIds) ? u.teamIds.slice() : (u.teamId ? [u.teamId] : []);
            const nextTeamIds = currentTeamIds.filter((teamId) => teamId !== value.id);

            if (u.role !== "admin" && nextTeamIds.length === 0) {
              alert("Este usuario precisa permanecer com pelo menos 1 equipe.");
              return;
            }
            if (!confirm(`Remover "${u.name}" da equipe "${value.label}"?`)) return;

            await updateDoc(doc(db, "companies", state.companyId, "users", u.uid), {
              teamIds: nextTeamIds,
              teamId: nextTeamIds[0] || ""
            });
            await loadUsers(deps);
            if (typeof loadTeams === "function") await loadTeams();
          });
        } else {
          chip.textContent = value;
        }
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
    rowsFragment.appendChild(tr);
  }
  if (mySeq !== state._usersLoadSeq) return;
  refs.usersTbody.replaceChildren(rowsFragment);
}

function setCreateUserModalMode(deps, mode, user = null) {
  const { refs, state } = deps;
  const isView = mode === "view";
  const isEdit = mode === "edit";
  state._adminUserModalMode = mode;
  state._adminEditingUserUid = isEdit ? (user?.uid || "") : null;
  state._adminEditingUserOriginal = isEdit && user ? { ...user } : null;

  const titleEl = refs.modalCreateUser?.querySelector(".modal-header h2");
  const subEl = refs.modalCreateUser?.querySelector(".modal-header p");
  if (titleEl) titleEl.textContent = isView ? "Visualizar Usuario" : (isEdit ? "Editar Usuario" : "Novo Usuario");
  if (subEl) subEl.textContent = isView
    ? "Visualizacao dos dados do usuario."
    : (isEdit ? "Atualize os dados do usuario." : "Cadastre um usuario, selecione equipes e informe foto e skills quando precisar.");

  const uidLabel = refs.newUserUidEl?.closest("label");
  if (uidLabel) {
    uidLabel.hidden = true;
    uidLabel.style.display = "none";
  }

  if (refs.newUserNameEl) refs.newUserNameEl.disabled = isView;
  configureUserRoleOptions(deps, mode, user);
  if (refs.newUserRoleEl && !isIndividualAccount(state)) refs.newUserRoleEl.disabled = isView;
  if (refs.newUserEmailEl) refs.newUserEmailEl.disabled = isEdit || isView;
  if (refs.newUserPhoneEl) refs.newUserPhoneEl.disabled = isView;
  if (refs.newUserActiveEl) refs.newUserActiveEl.disabled = isView;
  if (refs.newUserHourlyRateEl) refs.newUserHourlyRateEl.disabled = isView;
  if (refs.newUserAddressEl) refs.newUserAddressEl.disabled = isView;
  if (refs.newUserBirthDateEl) refs.newUserBirthDateEl.disabled = isView;
  if (refs.newUserCpfEl) refs.newUserCpfEl.disabled = isView;
  if (refs.newUserCnpjEl) refs.newUserCnpjEl.disabled = isView;
  if (refs.newUserSoftSkillInputEl) refs.newUserSoftSkillInputEl.disabled = isView;
  if (refs.newUserHardSkillInputEl) refs.newUserHardSkillInputEl.disabled = isView;
  if (refs.newUserAvatarFileEl) refs.newUserAvatarFileEl.disabled = isView;
  if (refs.newUserAttachmentsEl) refs.newUserAttachmentsEl.disabled = isView;
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
  configureUserRoleOptions(deps, state._adminUserModalMode || "create", user);
  refs.newUserUidEl.value = user?.uid || "";
  refs.newUserNameEl.value = user?.name || "";
  refs.newUserRoleEl.value = user?.role || "tecnico";
  refs.newUserEmailEl.value = user?.email || "";
  refs.newUserPhoneEl.value = user?.phone || "";
  refs.newUserActiveEl.value = (user?.active === false) ? "false" : "true";
  if (refs.newUserHourlyRateEl) refs.newUserHourlyRateEl.value = formatDecimalInput(user?.hourlyRate);
  if (refs.newUserAddressEl) refs.newUserAddressEl.value = user?.address || "";
  if (refs.newUserBirthDateEl) refs.newUserBirthDateEl.value = user?.birthDate || "";
  if (refs.newUserCpfEl) refs.newUserCpfEl.value = formatCpf(user?.cpf || "");
  if (refs.newUserCnpjEl) refs.newUserCnpjEl.value = formatCnpj(user?.cnpj || "");

  state.selectedTeamIds = Array.isArray(user?.teamIds) ? [...user.teamIds] : (user?.teamId ? [user.teamId] : []);
  state._newUserSoftSkillsDraft = Array.isArray(user?.softSkills) ? [...user.softSkills] : [];
  state._newUserHardSkillsDraft = Array.isArray(user?.hardSkills) ? [...user.hardSkills] : [];
  state._newUserAttachmentsDraft = toAttachmentDrafts(user?.attachments);
  state._newUserRemovedAttachments = [];
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
  state._createUserSuccessReadyToClose = false;
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
  if (refs.newUserHourlyRateEl) refs.newUserHourlyRateEl.value = "";
  if (refs.newUserAddressEl) refs.newUserAddressEl.value = "";
  if (refs.newUserBirthDateEl) refs.newUserBirthDateEl.value = "";
  if (refs.newUserCpfEl) refs.newUserCpfEl.value = "";
  if (refs.newUserCnpjEl) refs.newUserCnpjEl.value = "";
  if (refs.newUserSoftSkillInputEl) refs.newUserSoftSkillInputEl.value = "";
  if (refs.newUserHardSkillInputEl) refs.newUserHardSkillInputEl.value = "";

  state._newUserSoftSkillsDraft = [];
  state._newUserHardSkillsDraft = [];
  state._newUserAttachmentsDraft = [];
  state._newUserRemovedAttachments = [];
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
    state._createUserSuccessReadyToClose = false;
    state._newUserAvatarFile = null;
    state._newUserSoftSkillsDraft = [];
    state._newUserHardSkillsDraft = [];
    state._newUserAttachmentsDraft = [];
    state._newUserRemovedAttachments = [];
    state._adminEditingUserUid = null;
    state._adminEditingUserOriginal = null;
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
  if (state._createUserSuccessReadyToClose) {
    closeCreateUserModal(deps);
    return;
  }
  if (state._isCreatingUser) return;
  clearAlert(refs.createUserAlert);

  let uid = (refs.newUserUidEl?.value || "").trim();
  const name = (refs.newUserNameEl?.value || "").trim();
  const role = (refs.newUserRoleEl?.value || "").trim();
  const email = (refs.newUserEmailEl?.value || "").trim();
  const phone = normalizePhone(refs.newUserPhoneEl?.value || "");
  const hourlyRate = refs.newUserHourlyRateEl ? parseBRDecimalToNumber(refs.newUserHourlyRateEl.value) : null;
  const active = (refs.newUserActiveEl?.value || "true") === "true";
  const extraFields = collectUserExtraFields(refs);
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

  if (isIndividualAccount(state) && role !== "tecnico") {
    return setAlert(refs.createUserAlert, "Plano pessoa fisica permite cadastrar apenas Recursos.");
  }

  if (role !== "admin" && teamIds.length === 0) {
    return setAlert(refs.createUserAlert, "Selecione pelo menos 1 equipe para este usuário.");
  }

  state._isCreatingUser = true;
  if (refs.btnCreateUser) {
    refs.btnCreateUser.disabled = true;
    refs.btnCreateUser.textContent = "Salvando...";
  }
  setAlert(refs.createUserAlert, "Salvando...", "info");

  const existingUid = await findUserUidByEmailInCompany(db, state.companyId, email);
  if (existingUid && existingUid !== uid) {
    state._isCreatingUser = false;
    if (refs.btnCreateUser) {
      refs.btnCreateUser.disabled = false;
      refs.btnCreateUser.textContent = "Salvar";
    }
    return setAlert(refs.createUserAlert, "Este e-mail já está cadastrado nesta empresa. Use outro e-mail ou edite o usuário existente.");
  }

  try {
    await assertCompanyUserLimitAvailable(db, state.companyId, active);
  } catch (limitErr) {
    state._isCreatingUser = false;
    if (refs.btnCreateUser) {
      refs.btnCreateUser.disabled = false;
      refs.btnCreateUser.textContent = "Salvar";
    }
    return setAlert(refs.createUserAlert, limitErr?.message || "Limite de usuarios do plano atingido.");
  }

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
            hardSkills,
            ...(hourlyRate === null ? {} : { hourlyRate })
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
            hardSkills,
            ...(hourlyRate === null ? {} : { hourlyRate }),
            ...extraFields
          }, { merge: true });
        } catch (mergeErr) {
          console.warn("merge user extra fields failed", mergeErr);
          setAlert(refs.createUserAlert, "Usuário criado, mas falhou ao salvar campos extras (verifique Firestore Rules).", "error");
        }

        if ((state._newUserAttachmentsDraft || []).length) {
          try {
            setAlert(refs.createUserAlert, "Enviando anexos...", "info");
            await syncUserAttachments(deps, uid);
          } catch (attErr) {
            console.warn("attachments upload failed", attErr);
            setAlert(refs.createUserAlert, "Usuário criado, mas falhou ao enviar anexos: " + (attErr?.message || attErr), "error");
          }
        }

        await loadUsers(deps);

        setAlertWithResetLink(
          refs.createUserAlert,
          `Usuário criado com sucesso!`,
          email,
          resetLink
        );
        state._createUserSuccessReadyToClose = true;
        if (refs.btnCreateUser) {
          refs.btnCreateUser.disabled = false;
          refs.btnCreateUser.textContent = "Fechar";
        }
        
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
      ...(hourlyRate === null ? {} : { hourlyRate }),
      ...extraFields,
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

    if ((state._newUserAttachmentsDraft || []).length) {
      try {
        setAlert(refs.createUserAlert, "Enviando anexos...", "info");
        await syncUserAttachments(deps, uid);
      } catch (attErr) {
        console.warn("attachments upload failed", attErr);
        setAlert(refs.createUserAlert, "Usuário salvo, mas falhou ao enviar anexos: " + (attErr?.message || attErr), "error");
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
    state._isCreatingUser = false;
    state._newUserAvatarFile = null;
    if (refs.btnCreateUser && !state._createUserSuccessReadyToClose) {
      refs.btnCreateUser.disabled = false;
      refs.btnCreateUser.textContent = state._adminEditingUserUid ? "Salvar alteracoes" : "Salvar";
    }
  }
}

async function updateCompanyUser(deps) {
  const { refs, state, db, loadUsers, callHttpFunctionWithAuth } = deps;
  const uid = state._adminEditingUserUid;
  const name = (refs.newUserNameEl?.value || "").trim();
  const role = (refs.newUserRoleEl?.value || "").trim();
  const email = (refs.newUserEmailEl?.value || "").trim();
  const phone = normalizePhone(refs.newUserPhoneEl?.value || "");
  const hourlyRate = refs.newUserHourlyRateEl ? parseBRDecimalToNumber(refs.newUserHourlyRateEl.value) : null;
  const active = (refs.newUserActiveEl?.value || "true") === "true";
  const extraFields = collectUserExtraFields(refs);
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
  if (isIndividualAccount(state) && uid !== getCompanyOwnerUid(state) && role !== "tecnico") {
    return setAlert(refs.createUserAlert, "Plano pessoa fisica permite manter apenas o dono da conta e Recursos.");
  }
  if (role !== "admin" && teamIds.length === 0) {
    return setAlert(refs.createUserAlert, "Selecione pelo menos 1 equipe para este usuario.");
  }

  setAlert(refs.createUserAlert, "Salvando alteracoes...", "info");

  let lastChangedPayload = null;

  try {
    const original = state._adminEditingUserOriginal || {};
    const originalTeamIds = Array.isArray(original.teamIds) ? original.teamIds : (original.teamId ? [original.teamId] : []);
    const changedPayload = {};

    if (name !== String(original.name || "").trim()) changedPayload.name = name;
    if (phone !== String(original.phone || "").trim()) changedPayload.phone = phone;
    if (active !== (original.active === false ? false : true)) changedPayload.active = active;
    if (!sameStringArray(teamIds, originalTeamIds)) {
      changedPayload.teamIds = teamIds;
      changedPayload.teamId = teamIds[0] || "";
    }
    if (!sameStringArray(softSkills, original.softSkills || [])) changedPayload.softSkills = softSkills;
    if (!sameStringArray(hardSkills, original.hardSkills || [])) changedPayload.hardSkills = hardSkills;
    if (hourlyRate !== null && Number(original.hourlyRate) !== hourlyRate) changedPayload.hourlyRate = hourlyRate;
    if (extraFields.address !== String(original.address || "")) changedPayload.address = extraFields.address;
    if (extraFields.cpf !== String(original.cpf || "")) changedPayload.cpf = extraFields.cpf;
    if (extraFields.cnpj !== String(original.cnpj || "")) changedPayload.cnpj = extraFields.cnpj;
    if (extraFields.birthDate !== String(original.birthDate || "")) changedPayload.birthDate = extraFields.birthDate;
    if (extraFields.birthDate) {
      if ("age" in extraFields && Number(original.age) !== extraFields.age) changedPayload.age = extraFields.age;
    } else if (extraFields.birthDate !== String(original.birthDate || "") && "age" in original) {
      changedPayload.age = deleteField();
    }
    if (state._newUserPhotoRemoved) changedPayload.photoURL = "";
    lastChangedPayload = changedPayload;

    if (Object.keys(changedPayload).length) {
      try {
        await updateDoc(doc(db, "companies", state.companyId, "users", uid), changedPayload);
      } catch (directErr) {
        if (!isPermissionDeniedError(directErr) || typeof callHttpFunctionWithAuth !== "function") throw directErr;
        setAlert(refs.createUserAlert, "Salvando com permissao administrativa...", "info");
        await callHttpFunctionWithAuth("adminUpdateCompanyUserHttp", {
          companyId: state.companyId,
          targetUid: uid,
          patch: changedPayload
        });
      }
    }

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

    if (hasUserAttachmentChanges(state)) try {
      setAlert(refs.createUserAlert, "Sincronizando anexos...", "info");
      await syncUserAttachments(deps, uid);
    } catch (attErr) {
      console.warn("attachments upload failed", attErr);
      return setAlert(refs.createUserAlert, "Dados salvos, mas falhou ao enviar anexos: " + (attErr?.message || attErr), "error");
    }

    closeCreateUserModal(deps);
    await loadUsers(deps);
  } catch (err) {
    console.error(err);
    const original = state._adminEditingUserOriginal || {};
    const originalTeamIds = Array.isArray(original.teamIds) ? original.teamIds : (original.teamId ? [original.teamId] : []);
    const onlyTeamsChanged = sameStringArray(originalTeamIds, teamIds) === false
      && name === String(original.name || "").trim()
      && role === String(original.role || "").trim()
      && email === String(original.email || "").trim()
      && phone === String(original.phone || "").trim()
      && active === (original.active === false ? false : true)
      && !state._newUserAvatarFile
      && !state._newUserPhotoRemoved
      && sameStringArray(softSkills, original.softSkills || [])
      && sameStringArray(hardSkills, original.hardSkills || []);

    if (isPermissionDeniedError(err) && onlyTeamsChanged) {
      try {
        setAlert(refs.createUserAlert, "Salvando apenas a alteracao de equipe...", "info");
        await updateDoc(doc(db, "companies", state.companyId, "users", uid), {
          teamIds,
          teamId: teamIds[0] || ""
        });
        closeCreateUserModal(deps);
        await loadUsers(deps);
        return;
      } catch (teamErr) {
        console.error(teamErr);
        return setAlert(refs.createUserAlert, "Erro ao salvar equipes: " + (teamErr?.message || teamErr));
      }
    }

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
