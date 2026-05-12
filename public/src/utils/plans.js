export const COMPANY_PLANS = [
  { id: "plan-1-20", label: "1 a 20 usuarios", userLimit: 20, price: 257, annualPrice: 2467.2 },
  { id: "plan-21-40", label: "21 a 40 usuarios", userLimit: 40, price: 387, annualPrice: 3715.2 },
  { id: "plan-41-60", label: "41 a 60 usuarios", userLimit: 60, price: 497, annualPrice: 4771.2 },
  { id: "plan-61-80", label: "61 a 80 usuarios", userLimit: 80, price: 697, annualPrice: 6691.2 },
  { id: "plan-81-100", label: "81 a 100 usuarios", userLimit: 100, price: 847, annualPrice: 8131.2 }
];

export const INDIVIDUAL_MANAGER_PLANS = [
  {
    id: "manager-start",
    label: "Gestor Start",
    accountType: "individual",
    documentType: "cpf",
    ownerLimit: 1,
    ownerRole: "admin",
    includedUsers: 3,
    participantLimit: 2,
    techLimit: 2,
    projectLimit: 10,
    price: 29.9,
    annualPrice: 287.04
  },
  {
    id: "manager-pro",
    label: "Gestor Pro",
    accountType: "individual",
    documentType: "cpf",
    ownerLimit: 1,
    ownerRole: "admin",
    includedUsers: 6,
    participantLimit: 5,
    techLimit: 5,
    projectLimit: 20,
    price: 57.9,
    annualPrice: 555.84
  },
  {
    id: "manager-plus",
    label: "Gestor Plus",
    accountType: "individual",
    documentType: "cpf",
    ownerLimit: 1,
    ownerRole: "admin",
    includedUsers: 11,
    participantLimit: 10,
    techLimit: 10,
    projectLimit: 40,
    price: 87.9,
    annualPrice: 843.84
  }
];

export const DEFAULT_COMPANY_PLAN_ID = "plan-1-20";
export const DEFAULT_INDIVIDUAL_MANAGER_PLAN_ID = "manager-start";
export const DEFAULT_COMPANY_BILLING_CYCLE = "monthly";

export function getCompanyPlan(planId) {
  return COMPANY_PLANS.find((plan) => plan.id === planId) || COMPANY_PLANS[0];
}

export function getIndividualManagerPlan(planId) {
  return INDIVIDUAL_MANAGER_PLANS.find((plan) => plan.id === planId) || INDIVIDUAL_MANAGER_PLANS[0];
}

export function normalizeIndividualManagerPlan(account = {}) {
  const byId = getIndividualManagerPlan(account.planId || DEFAULT_INDIVIDUAL_MANAGER_PLAN_ID);
  const techLimit = Number(account.planTechLimit || byId.techLimit);
  const projectLimit = Number(account.planProjectLimit || byId.projectLimit);
  const price = Number(account.planPrice || byId.price);
  const annualPrice = Number(account.planAnnualPrice || byId.annualPrice || calculateCompanyAnnualPrice(price));
  return {
    id: byId.id,
    label: account.planName || byId.label,
    accountType: "individual",
    documentType: "cpf",
    ownerLimit: 1,
    ownerRole: byId.ownerRole,
    includedUsers: byId.includedUsers,
    participantLimit: byId.participantLimit,
    techLimit: Number.isFinite(techLimit) && techLimit >= 0 ? techLimit : byId.techLimit,
    projectLimit: Number.isFinite(projectLimit) && projectLimit > 0 ? projectLimit : byId.projectLimit,
    price,
    annualPrice
  };
}

export function normalizeCompanyPlan(company = {}) {
  const byId = getCompanyPlan(company.planId || DEFAULT_COMPANY_PLAN_ID);
  const userLimit = Number(company.planUserLimit || byId.userLimit);
  const price = Number(company.planPrice || byId.price);
  const annualPrice = Number(company.planAnnualPrice || byId.annualPrice || calculateCompanyAnnualPrice(price));
  const billingCycle = company.planBillingCycle === "annual" ? "annual" : DEFAULT_COMPANY_BILLING_CYCLE;
  const rawInstallments = Number(company.planInstallments || 1);
  const installments = billingCycle === "annual" && Number.isFinite(rawInstallments)
    ? Math.min(5, Math.max(1, Math.trunc(rawInstallments)))
    : 1;
  const billingPrice = billingCycle === "annual" ? annualPrice : price;
  return {
    id: byId.id,
    label: company.planName || byId.label,
    userLimit: Number.isFinite(userLimit) && userLimit > 0 ? userLimit : byId.userLimit,
    price,
    annualPrice,
    billingCycle,
    billingPrice,
    installments,
    installmentValue: billingCycle === "annual" ? billingPrice / installments : billingPrice
  };
}

export function calculateCompanyAnnualPrice(price) {
  return Number(price || 0) * 12 * 0.8;
}

export function formatCompanyPlanPrice(price) {
  const value = Number(price || 0);
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2
  });
}
