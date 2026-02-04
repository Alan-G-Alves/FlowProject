// FlowProject - Validadores simples (client-side)
// Mantém validações leves no client. Regras definitivas ficam nas Cloud Functions e Firestore Rules.

import { normalizeCnpj } from "./format.js";

export function isEmailValidBasic(email){
  return /^\S+@\S+\.\S+$/.test((email || "").trim());
}

export function isCnpjValidBasic(cnpj){
  return normalizeCnpj(cnpj).length === 14;
}
