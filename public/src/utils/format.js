// FlowProject - Formatadores
// Funções pequenas e reutilizáveis para padronizar dados.

export function normalizePhone(phone){
  return (phone || "").toString().replace(/\D/g, "");
}

export function normalizeCnpj(cnpj){
  return (cnpj || "").toString().replace(/\D/g, "");
}

export function slugify(str){
  return (str || "")
    .toString()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
