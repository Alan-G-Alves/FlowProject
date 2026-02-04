import { normalizeCnpj } from "../utils/format.js";
import { isCnpjValidBasic, isEmailValidBasic } from "../utils/validators.js";
import { createCompanyDoc, setCompanyBootstrap } from "../services/companies.service.js";

export async function createCompany(input, actorUid){
  const name = (input?.name || "").trim();
  const cnpjRaw = input?.cnpj || "";
  const cnpj = normalizeCnpj(cnpjRaw);

  const adminName = (input?.adminName || "").trim();
  const adminEmail = (input?.adminEmail || "").trim().toLowerCase();

  if (!name) throw new Error("Informe o nome da empresa.");
  if (!isCnpjValidBasic(cnpj)) throw new Error("CNPJ inválido.");
  if (!adminName) throw new Error("Informe o nome do Admin da empresa.");
  if (!isEmailValidBasic(adminEmail)) throw new Error("E-mail do Admin inválido.");

  const companyId = await createCompanyDoc({
    name,
    cnpj,
    status: "active",
    createdBy: actorUid || null,
    updatedBy: actorUid || null,
  });

  // bootstrap (metadados de admin inicial / fluxo de setup)
  await setCompanyBootstrap(companyId, {
    adminName,
    adminEmail,
    createdBy: actorUid || null,
  });

  return companyId;
}
