// FlowProject - Utils DOM
// Funções pequenas e reutilizáveis para manipular UI sem framework.

export function show(el){ if (el) el.hidden = false; }
export function hide(el){ if (el) el.hidden = true; }

export function escapeHtml(str){
  return (str ?? "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
