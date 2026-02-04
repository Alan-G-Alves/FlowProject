// FlowProject - UI Alerts
// Centraliza mensagens de erro/sucesso para manter consistência visual.

import { show, hide } from "../utils/dom.js";

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
}
