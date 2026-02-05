/**
 * profile.modal.js
 * Módulo de UI para o modal de perfil do usuário
 * 
 * Funcionalidades:
 * - Abertura/fechamento do modal de perfil
 * - Preview de foto do perfil
 * - Upload de foto para Firebase Storage
 * - Salvar dados do perfil (nome, telefone, foto)
 */

import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { setAlert, clearAlert } from "../alerts.js";

export function openProfileModal(deps) {
  const { refs, auth, state } = deps;
  if (!refs.profileModal) return;
  
  clearAlert(refs.profileAlert);

  const user = auth.currentUser;
  const p = state.profile || {};

  // Preenche campos
  if (refs.profileName) refs.profileName.value = (p.name || user?.displayName || "").trim();
  if (refs.profilePhone) refs.profilePhone.value = (p.phone || "").trim();
  if (refs.profileEmail) refs.profileEmail.value = (user?.email || "").trim();

  const url = (p.photoURL || user?.photoURL || "").trim();
  if (refs.profilePhotoUrl) refs.profilePhotoUrl.value = url;
  renderProfilePhotoPreview(deps, url);

  refs.profileModal.hidden = false;
  document.body.classList.add("modal-open");
}

export function closeProfileModal(refs) {
  if (!refs.profileModal) return;
  refs.profileModal.hidden = true;
  document.body.classList.remove("modal-open");
  if (refs.profilePhotoFile) refs.profilePhotoFile.value = "";
}

export function renderProfilePhotoPreview(deps, url) {
  const { refs, auth, state } = deps;
  const user = auth.currentUser;
  const label = ((refs.profileName?.value || state.profile?.name || user?.displayName || user?.email || "Usuário").trim());
  const initials = label.split(/\s+/).slice(0,2).map(p => (p[0] || "").toUpperCase()).join("") || "U";

  const finalUrl = (url || "").trim();
  if (finalUrl){
    if (refs.profilePhotoImg){
      refs.profilePhotoImg.src = finalUrl;
      refs.profilePhotoImg.style.display = "block";
    }
    if (refs.profilePhotoFallback){
      refs.profilePhotoFallback.textContent = initials;
      refs.profilePhotoFallback.style.display = "none";
    }
  } else {
    if (refs.profilePhotoImg) refs.profilePhotoImg.style.display = "none";
    if (refs.profilePhotoFallback){
      refs.profilePhotoFallback.textContent = initials;
      refs.profilePhotoFallback.style.display = "block";
    }
  }
}

export async function saveProfile(deps) {
  const { refs, auth, db, state, renderTopbar } = deps;
  
  clearAlert(refs.profileAlert);
  const user = auth.currentUser;
  if (!user) return;

  const name = (refs.profileName?.value || "").trim();
  const phone = (refs.profilePhone?.value || "").trim();
  const photoURL = (refs.profilePhotoUrl?.value || "").trim();

  if (!name){
    setAlert(refs.profileAlert, "Informe seu nome.");
    return;
  }

  setAlert(refs.profileAlert, "Salvando...", "info");

  try {
    if (state.isSuperAdmin){
      await updateDoc(doc(db, "platformUsers", user.uid), {
        name,
        phone,
        photoURL
      });
    } else {
      await updateDoc(doc(db, "companies", state.companyId, "users", user.uid), {
        name,
        phone,
        photoURL
      });
    }

    // Atualiza estado local e UI
    state.profile = { ...(state.profile || {}), name, phone, photoURL };
    renderTopbar(state.profile, user);

    setAlert(refs.profileAlert, "Perfil atualizado!", "success");
    setTimeout(() => closeProfileModal(refs), 400);
  } catch (err){
    console.error("saveProfile error", err);
    setAlert(refs.profileAlert, "Não foi possível salvar. Verifique permissões no Firestore rules.");
  }
}

export async function handlePhotoUpload(deps, file) {
  const { refs, auth, storage } = deps;
  
  // Regras básicas (evita upload gigante)
  const maxMb = 2; // recomendado: 1–2MB
  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  
  if (!allowed.includes((file.type || "").toLowerCase())){
    setAlert(refs.profileAlert, "Formato inválido. Use PNG ou JPG.");
    return false;
  }
  
  if (file.size > maxMb * 1024 * 1024){
    setAlert(refs.profileAlert, `A imagem é muito grande (máx. ${maxMb}MB).`);
    return false;
  }

  // Upload para Firebase Storage e grava a URL no input
  try{
    setAlert(refs.profileAlert, "Enviando foto...", "info");
    const user = auth.currentUser;
    if (!user) throw new Error("not-auth");

    const ext = (file.type || "").includes("png") ? "png" : "jpg";
    const path = `avatars/${user.uid}.${ext}`;
    const ref = storageRef(storage, path);

    await uploadBytes(ref, file, { contentType: file.type || "image/jpeg" });
    const url = await getDownloadURL(ref);

    if (refs.profilePhotoUrl) refs.profilePhotoUrl.value = url;
    renderProfilePhotoPreview(deps, url);
    clearAlert(refs.profileAlert);
    return true;
  }catch(err){
    console.error("upload avatar error", err);
    setAlert(refs.profileAlert, "Não foi possível enviar a foto. Verifique as regras do Storage.");
    return false;
  }
}

export function bindProfileEvents(deps) {
  const { refs } = deps;
  
  // Listeners do modal
  refs.btnCloseProfile?.addEventListener("click", () => closeProfileModal(refs));
  refs.btnCancelProfile?.addEventListener("click", () => closeProfileModal(refs));

  refs.profileModal?.addEventListener("click", (e) => {
    const target = e.target;
    if (target && target.getAttribute && target.getAttribute("data-close") === "profile"){
      closeProfileModal(refs);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && refs.profileModal && !refs.profileModal.hidden) {
      closeProfileModal(refs);
    }
  });

  refs.btnSaveProfile?.addEventListener("click", () => saveProfile(deps));

  refs.profilePhotoUrl?.addEventListener("input", () => {
    renderProfilePhotoPreview(deps, refs.profilePhotoUrl.value);
  });

  refs.btnProfileRemovePhoto?.addEventListener("click", () => {
    if (refs.profilePhotoUrl) refs.profilePhotoUrl.value = "";
    renderProfilePhotoPreview(deps, "");
  });

  refs.profilePhotoFile?.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    
    const success = await handlePhotoUpload(deps, file);
    // Permite reenviar o mesmo arquivo se quiser
    e.target.value = "";
  });
}
