// FlowProject - UI Alerts
// Centraliza mensagens de erro/sucesso para manter consistência visual.

import { show, hide } from "../utils/dom.js";

let _dialogEls = null;
let _dialogResolver = null;

function ensureDialog(){
  if (_dialogEls) return _dialogEls;
  if (typeof document === "undefined") return null;

  const root = document.createElement("div");
  root.className = "modal app-message-dialog";
  root.hidden = true;
  root.innerHTML = `
    <div class="modal-backdrop" data-app-dialog-close="true"></div>
    <div class="modal-card app-message-dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="appMessageDialogTitle" aria-describedby="appMessageDialogText">
      <div class="modal-header app-message-dialog-header">
        <div>
          <h2 id="appMessageDialogTitle">Aviso</h2>
        </div>
        <button class="btn ghost" data-app-dialog-close="true" type="button" aria-label="Fechar">X</button>
      </div>
      <div class="modal-body app-message-dialog-body">
        <p id="appMessageDialogText"></p>
      </div>
      <div class="modal-footer">
        <button class="btn primary" data-app-dialog-confirm="true" type="button">OK</button>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  const title = root.querySelector("#appMessageDialogTitle");
  const text = root.querySelector("#appMessageDialogText");
  const confirm = root.querySelector("[data-app-dialog-confirm='true']");

  const closeDialog = () => {
    root.hidden = true;
    document.body.classList.remove("has-app-message-dialog");
    const resolve = _dialogResolver;
    _dialogResolver = null;
    if (typeof resolve === "function") resolve();
  };

  root.addEventListener("click", (event) => {
    const trigger = event.target?.closest?.("[data-app-dialog-close='true'], [data-app-dialog-confirm='true']");
    if (!trigger) return;
    closeDialog();
  });

  document.addEventListener("keydown", (event) => {
    if (!_dialogResolver) return;
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault();
      closeDialog();
    }
  });

  _dialogEls = { root, title, text, confirm, closeDialog };
  return _dialogEls;
}

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

export function showDialogAlert(msg, options = {}){
  const dialog = ensureDialog();
  if (!dialog) return Promise.resolve();

  dialog.title.textContent = options.title || "Aviso";
  dialog.text.textContent = msg || "";
  dialog.confirm.textContent = options.confirmLabel || "OK";
  dialog.root.dataset.tone = options.type || "info";
  dialog.root.hidden = false;
  document.body.classList.add("has-app-message-dialog");

  return new Promise((resolve) => {
    _dialogResolver = resolve;
    setTimeout(() => {
      try { dialog.confirm.focus({ preventScroll: true }); } catch (_) {}
    }, 0);
  });
}
