export const COMPANY_PLANS = [
  { id: "plan-1-20", label: "1 a 20 usuarios", userLimit: 20, price: 257, annualPrice: 2467.2 },
  { id: "plan-21-40", label: "21 a 40 usuarios", userLimit: 40, price: 387, annualPrice: 3715.2 },
  { id: "plan-41-60", label: "41 a 60 usuarios", userLimit: 60, price: 497, annualPrice: 4771.2 },
  { id: "plan-61-80", label: "61 a 80 usuarios", userLimit: 80, price: 697, annualPrice: 6691.2 },
  { id: "plan-81-100", label: "81 a 100 usuarios", userLimit: 100, price: 847, annualPrice: 8131.2 }
];

export const DEFAULT_COMPANY_PLAN_ID = "plan-1-20";
export const DEFAULT_COMPANY_BILLING_CYCLE = "monthly";

export function getCompanyPlan(planId) {
  return COMPANY_PLANS.find((plan) => plan.id === planId) || COMPANY_PLANS[0];
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
