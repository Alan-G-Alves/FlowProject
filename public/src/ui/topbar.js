/**
 * topbar.js
 * Módulo de UI para a topbar (avatar e menu do usuário)
 * 
 * Funcionalidades:
 * - Renderização do avatar (foto ou iniciais)
 * - Menu dropdown do usuário
 * - Navegação para editar perfil e logout
 */

import { signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { show } from "../utils/dom.js";

export function renderTopbar(deps, profile, user){
  const { refs } = deps;
  
  // Topbar minimal: apenas avatar no canto direito
  show(refs.btnAvatar);

  // Avatar: tenta foto (perfil -> auth), senão usa iniciais
  const photoUrl = profile?.photoURL || user?.photoURL || "";

  // OBS: no CSS o .avatar-img começa com display:none; aqui controlamos via display
  if (photoUrl && refs.userAvatarImg){
    // Cache-bust leve (evita manter imagem antiga após trocar foto)
    const bust = photoUrl.includes("?") ? "&t=" : "?t=";
    refs.userAvatarImg.src = photoUrl + bust + Date.now();

    refs.userAvatarImg.hidden = false;
    refs.userAvatarImg.style.display = "block";

    if (refs.userAvatarFallback){
      refs.userAvatarFallback.hidden = true;
      refs.userAvatarFallback.style.display = "none";
    }
  }else{
    if (refs.userAvatarImg){
      refs.userAvatarImg.hidden = true;
      refs.userAvatarImg.style.display = "none";
      refs.userAvatarImg.removeAttribute("src");
    }

    const label = (profile?.name || user?.displayName || user?.email || "Usuário").trim();
    const initials = label.split(/\s+/).slice(0,2).map(p => (p[0] || "").toUpperCase()).join("") || "U";
    if (refs.userAvatarFallback){
      refs.userAvatarFallback.textContent = initials;
      refs.userAvatarFallback.hidden = false;
      refs.userAvatarFallback.style.display = "grid";
    }
  }
}

export function initUserMenu(deps){
  const { refs, auth, openProfileModal } = deps;
  
  // Estrutura vem do index.html (refs.userMenu/avatarBtn/refs.avatarDropdown)
  if (!refs.btnAvatar || !refs.avatarDropdown) return;

  const closeDropdown = () => {
    refs.avatarDropdown.classList.remove("open");
    refs.btnAvatar.setAttribute("aria-expanded", "false");
  };

  const toggleDropdown = () => {
    const isOpen = refs.avatarDropdown.classList.contains("open");
    if (isOpen) closeDropdown();
    else {
      refs.avatarDropdown.classList.add("open");
      refs.btnAvatar.setAttribute("aria-expanded", "true");
    }
  };

  // Toggle ao clicar no avatar
  refs.btnAvatar.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDropdown();
  });

  // Fecha ao clicar fora
  document.addEventListener("click", (e) => {
    if (!refs.avatarDropdown.classList.contains("open")) return;
    const target = e.target;
    if (refs.userMenu && refs.userMenu.contains(target)) return;
    closeDropdown();
  });

  // Fecha no ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDropdown();
  });

  // Ações do menu
  refs.btnEditProfile?.addEventListener("click", (e) => {
    e.preventDefault();
    closeDropdown();
    openProfileModal();
  });

  refs.btnUserLogout?.addEventListener("click", async (e) => {
    e.preventDefault();
    closeDropdown();
    await signOut(auth);
  });
}
