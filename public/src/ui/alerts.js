// FlowProject - UI Alerts
// Centraliza mensagens de erro/sucesso para manter consistência visual.

import { show, hide } from "../utils/dom.js";

function revealAlert(el, options = {}){
  if (!el) return;
  el.setAttribute("tabindex", "-1");

  const insideModal = !!el.closest(".modal, .modal-card, .modal-body");
  const shouldScroll = options.scroll !== false && !insideModal;
  if (shouldScroll) {
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    } catch (_) {}
  }

  if (!insideModal) {
    try {
      el.focus({ preventScroll: true });
    } catch (_) {}
  }

  el.style.boxShadow = "0 0 0 4px rgba(37,99,235,.10)";
  setTimeout(() => {
    if (!el) return;
    el.style.boxShadow = "";
  }, 1800);
}

export function clearAlert(el){
  if (!el) return;
  el.textContent = "";
  hide(el);
}

export function setAlert(el, msg, type = "error"){
  if (!el) return;

  el.textContent = msg || "";

  // Estilos inline mínimos (mantém compat com seu CSS atual)
  if (type === "success" || type === "info"){
    el.style.borderColor = "rgba(37,99,235,.25)";
    el.style.background = "rgba(37,99,235,.08)";
    el.style.color = "rgba(12,18,32,.85)";
  } else {
    el.style.borderColor = "rgba(239,68,68,.22)";
    el.style.background = "rgba(239,68,68,.08)";
    el.style.color = "#991b1b";
  }

  show(el);
  revealAlert(el, { scroll: type !== "info" });
}


export function clearInlineAlert(el){
  if(!el) return;
  el.style.display = "none";
  el.textContent = "";
}

export function showInlineAlert(el, msg, type="error"){
  if(!el) return;
  el.style.display = "block";
  el.textContent = msg || "";

  if(type === "success"){
    el.style.borderColor = "rgba(46, 204, 113, .35)";
    el.style.background = "rgba(46, 204, 113, .08)";
    el.style.color = "rgba(12,18,32,.92)";
  } else {
    el.style.borderColor = "rgba(239,68,68,.22)";
    el.style.background = "rgba(239,68,68,.08)";
    el.style.color = "#991b1b";
  }

  revealAlert(el);
}
