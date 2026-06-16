const functions = require("firebase-functions");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");
const Stripe = require("stripe");

admin.initializeApp();

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

/**
 * Storage helpers
 */
function buildDownloadURL(bucketName, objectPath, token) {
  const encPath = encodeURIComponent(objectPath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encPath}?alt=media&token=${token}`;
}

async function moveTempAvatarToFinal({ companyId, callerUid, targetUid, tempPath }) {
  if (!tempPath) return "";
  const safeTempPath = String(tempPath || "").trim();
  const expectedPrefix = `tempAvatars/${companyId}/${callerUid}/`;
  if (!safeTempPath.startsWith(expectedPrefix)) {
    throw new functions.https.HttpsError("invalid-argument", "tempAvatarPath inválido.");
  }

  const bucket = admin.storage().bucket();
  const bucketName = bucket.name;

  const src = bucket.file(safeTempPath);
  const [existsSrc] = await src.exists();
  if (!existsSrc) return "";

  const destPath = `avatars/${targetUid}`;
  const dest = bucket.file(destPath);

  await src.copy(dest);
  const token = crypto.randomUUID();
  await dest.setMetadata({
    metadata: { firebaseStorageDownloadTokens: token },
    cacheControl: "public,max-age=31536000",
  });

  await src.delete().catch(() => {});

  return buildDownloadURL(bucketName, destPath, token);
}

async function reserveCompanyUserEmail(db, companyId, emailLower, callerUid) {
  const ref = db.doc(`companies/${companyId}/userEmailIndex/${sha256(emailLower)}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      throw new functions.https.HttpsError("already-exists", "Este e-mail ja esta cadastrado nesta empresa.");
    }
    tx.set(ref, {
      emailLower,
      status: "pending",
      createdBy: callerUid || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  return ref;
}

async function releaseCompanyUserEmailReservation(ref) {
  if (!ref) return;
  await ref.delete().catch(() => {});
}

async function completeCompanyUserEmailReservation(ref, uid) {
  if (!ref) return;
  await ref.set({
    uid,
    status: "active",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Helpers
 */
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeString(v) {
  return String(v || "").trim();
}

function uniqueStrings(arr) {
  const out = [];
  const set = new Set();
  (arr || []).forEach((x) => {
    const s = String(x || "").trim();
    if (s && !set.has(s)) {
      set.add(s);
      out.push(s);
    }
  });
  return out;
}

function sanitizeSkillArray(arr) {
  const raw = Array.isArray(arr) ? arr : [];
  const cleaned = raw
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .map((v) => v.slice(0, 40));
  return cleaned.slice(0, 50);
}

function sanitizeHourlyRate(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n > 1000000) return null;
  return n;
}

const COMPANY_PLANS = [
  { id: "plan-1-20", label: "1 a 20 usuarios", userLimit: 20, price: 147.9, annualPrice: 1419.84 },
  { id: "plan-21-40", label: "21 a 40 usuarios", userLimit: 40, price: 247.9, annualPrice: 2379.84 },
  { id: "plan-41-60", label: "41 a 60 usuarios", userLimit: 60, price: 347.9, annualPrice: 3339.84 },
  { id: "plan-61-80", label: "61 a 80 usuarios", userLimit: 80, price: 0, annualPrice: 0, consultOnly: true },
  { id: "plan-81-100", label: "81 a 100 usuarios", userLimit: 100, price: 0, annualPrice: 0, consultOnly: true },
];

const INDIVIDUAL_MANAGER_PLANS = [
  { id: "manager-start", label: "Gestor Start", includedUsers: 3, participantLimit: 2, projectLimit: 15, price: 19.9, priceCents: 1990 },
  { id: "manager-pro", label: "Gestor Pro", includedUsers: 6, participantLimit: 5, projectLimit: 30, price: 27.9, priceCents: 2790 },
  { id: "manager-plus", label: "Gestor Plus", includedUsers: 11, participantLimit: 10, projectLimit: 50, price: 57.9, priceCents: 5790 },
];

const MANAGER_START_TRIAL_DAYS = 30;
const MANAGER_START_TRIAL_CONSENT_VERSION = "manager-start-trial-v1-2026-05-14";
const MANAGER_START_TRIAL_CONSENT_TEXT = "Declaro que estou contratando o plano Gestor Start com 30 dias gratis. Entendo que, se eu nao cancelar antes do fim do periodo gratuito, sera realizada automaticamente a cobranca mensal de R$ 19,90 no cartao informado. Posso cancelar a qualquer momento antes do fim dos 30 dias para nao ser cobrado.";

function getCompanyPlan(planId) {
  return COMPANY_PLANS.find((plan) => plan.id === planId) || COMPANY_PLANS[0];
}

function getIndividualManagerPlan(planId) {
  return INDIVIDUAL_MANAGER_PLANS.find((plan) => plan.id === planId) || INDIVIDUAL_MANAGER_PLANS[0];
}

function getIndividualPlanTrialConfig(planId) {
  if (planId !== "manager-start") return null;
  return {
    days: MANAGER_START_TRIAL_DAYS,
    consentVersion: MANAGER_START_TRIAL_CONSENT_VERSION,
    consentText: MANAGER_START_TRIAL_CONSENT_TEXT,
  };
}

function getConfigValue(path, fallback = "") {
  const envName = path.toUpperCase().replace(/\./g, "_");
  if (process.env[envName]) return process.env[envName];
  if (envName === "STRIPE_SECRET_KEY") {
    try { return STRIPE_SECRET_KEY.value(); } catch (err) { return fallback; }
  }
  if (envName === "STRIPE_WEBHOOK_SECRET") {
    try { return STRIPE_WEBHOOK_SECRET.value(); } catch (err) { return fallback; }
  }
  return fallback;
}

function getRequestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req.ip || req.connection?.remoteAddress || "");
}

function isStripeAccessActive(status) {
  return ["active", "trialing"].includes(String(status || "").toLowerCase());
}

function isStripeAccessSuspended(status) {
  return ["past_due", "unpaid", "incomplete_expired", "canceled", "paused"].includes(String(status || "").toLowerCase());
}

function getStripeClient() {
  const secretKey = getConfigValue("stripe.secret_key").trim();
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY nao configurada.");
  return new Stripe(secretKey);
}

function setCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Stripe-Signature");
}

function normalizeCpf(value) {
  return String(value || "").replace(/\D/g, "");
}

function isCpfValidBasic(value) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(cpf[i]) * (10 - i);
  let digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(cpf[i]) * (11 - i);
  digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  return digit === Number(cpf[10]);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function buildIndividualCompanyId(cpf) {
  return `cpf-${sha256(normalizeCpf(cpf)).slice(0, 18)}`;
}

function getPublicBaseUrl(req) {
  const configured = getConfigValue("app.public_url", "");
  if (configured) return configured.replace(/\/+$/, "");
  const origin = req.get("origin") || "https://portalprojectflow.com";
  return origin.replace(/\/+$/, "");
}

function getPublicAppBaseUrl() {
  return (getConfigValue("app.public_url", "") || "https://portalprojectflow.com").replace(/\/+$/, "");
}

function buildPasswordResetActionSettings() {
  return {
    url: `${getPublicAppBaseUrl()}/login`,
    handleCodeInApp: false,
  };
}

async function generatePublicPasswordResetLink(email) {
  const link = await admin.auth().generatePasswordResetLink(email, buildPasswordResetActionSettings());
  try {
    const parsed = new URL(link);
    return `${getPublicAppBaseUrl()}/reset-password${parsed.search}${parsed.hash || ""}`;
  } catch (err) {
    return link;
  }
}

function normalizePlanBillingCycle(value) {
  return value === "annual" ? "annual" : "monthly";
}

function normalizePlanInstallments(value, billingCycle = "monthly") {
  if (normalizePlanBillingCycle(billingCycle) !== "annual") return 1;
  const n = Number(value || 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, Math.trunc(n)));
}

function normalizeCompanyPlan(companyData = {}) {
  const plan = getCompanyPlan(companyData.planId || "plan-1-20");
  const userLimit = Number(companyData.planUserLimit || plan.userLimit);
  const billingCycle = normalizePlanBillingCycle(companyData.planBillingCycle);
  const installments = normalizePlanInstallments(companyData.planInstallments, billingCycle);
  const billingPrice = Number(companyData.planBillingPrice || (billingCycle === "annual" ? plan.annualPrice : plan.price));
  return {
    ...plan,
    label: companyData.planName || plan.label,
    userLimit: Number.isFinite(userLimit) && userLimit > 0 ? userLimit : plan.userLimit,
    consultOnly: Boolean(plan.consultOnly),
    price: Number(companyData.planPrice || plan.price),
    annualPrice: Number(companyData.planAnnualPrice || plan.annualPrice),
    billingCycle,
    billingPrice,
    installments,
    installmentValue: billingCycle === "annual" ? billingPrice / installments : billingPrice,
  };
}

function isIndividualCompany(companyData = {}) {
  return String(companyData.accountType || "").trim().toLowerCase() === "individual";
}

async function getCompanyDataOrThrow(db, companyId) {
  const companySnap = await db.doc(`companies/${companyId}`).get();
  if (!companySnap.exists) {
    throw new functions.https.HttpsError("not-found", "Empresa nao encontrada.");
  }
  return companySnap.data() || {};
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDateISO(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseDateISO(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function addMonths(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + Number(months || 0);
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

function normalizeDateString(value, fallbackDate = new Date()) {
  const parsed = parseDateISO(value);
  return formatDateISO(parsed || fallbackDate);
}

function getDueDay(dueDate) {
  const parsed = parseDateISO(dueDate);
  return parsed ? parsed.getUTCDate() : 1;
}

function dateWithDueDay(baseDateString, dueDay) {
  const base = parseDateISO(baseDateString) || new Date();
  const day = Math.min(Math.max(1, Number(dueDay || 1)), new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate());
  return formatDateISO(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day)));
}

function buildBillingRecord({ billingId, companyId, plan, cycle, startDate, dueDate, installmentCount, createdBy, source = "initial" }) {
  const normalizedCycle = normalizePlanBillingCycle(cycle);
  const start = normalizeDateString(startDate);
  const startDateObj = parseDateISO(start) || new Date();
  const end = formatDateISO(addDays(addMonths(startDateObj, normalizedCycle === "annual" ? 12 : 1), -1));
  const due = normalizeDateString(dueDate, startDateObj);
  const installmentsCount = normalizePlanInstallments(installmentCount, normalizedCycle);
  const totalValue = normalizedCycle === "annual" ? plan.annualPrice : plan.price;
  const installmentValue = normalizedCycle === "annual" ? totalValue / installmentsCount : totalValue;
  const dueDay = getDueDay(due);
  const installments = [];

  for (let i = 1; i <= installmentsCount; i += 1) {
    const dueBase = i === 1 ? due : formatDateISO(addMonths(parseDateISO(due) || startDateObj, i - 1));
    installments.push({
      number: i,
      dueDate: dueBase,
      value: installmentValue,
      paid: false,
      paidAt: null,
      status: "pending",
    });
  }

  const billing = {
    id: billingId,
    companyId,
    planId: plan.id,
    planName: plan.label,
    planUserLimit: plan.userLimit,
    cycle: normalizedCycle,
    startDate: start,
    endDate: end,
    dueDate: due,
    dueDay,
    totalValue,
    installmentCount: installmentsCount,
    installmentValue,
    paidInstallments: 0,
    status: "pending",
    source,
    installments,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy,
  };

  const summary = {
    currentBillingId: billingId,
    planId: plan.id,
    planName: plan.label,
    cycle: normalizedCycle,
    status: "pending",
    startDate: start,
    endDate: end,
    dueDate: due,
    dueDay,
    totalValue,
    installmentCount: installmentsCount,
    installmentValue,
    paidInstallments: 0,
  };

  return { billing, summary };
}

async function assertCompanyUserLimitAvailable(db, companyId) {
  const companySnap = await db.doc(`companies/${companyId}`).get();
  const plan = normalizeCompanyPlan(companySnap.exists ? companySnap.data() : {});
  const usersSnap = await db.collection(`companies/${companyId}/users`).where("active", "==", true).get();
  const activeCount = usersSnap.size;
  if (activeCount >= plan.userLimit) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Limite do plano atingido: ${activeCount}/${plan.userLimit} usuarios ativos no plano ${plan.label}.`
    );
  }
}

async function activateIndividualSignup(signupId, stripePayload = {}) {
  const db = admin.firestore();
  const signupRef = db.doc(`individualSignups/${signupId}`);
  const signupSnap = await signupRef.get();
  if (!signupSnap.exists) {
    console.warn("[stripe] individual signup nao encontrado", signupId);
    return null;
  }

  const signup = signupSnap.data() || {};
  if (signup.status === "active" && signup.ownerUid) return signup;

  const plan = getIndividualManagerPlan(signup.planId);
  const email = normalizeEmail(signup.email);
  const name = normalizeString(signup.name);
  const cpf = normalizeCpf(signup.cpf);
  const phone = normalizeString(signup.phone);
  const companyId = signup.companyId || buildIndividualCompanyId(cpf);

  if (!email || !name || !isCpfValidBasic(cpf)) {
    throw new Error("Dados do cadastro individual invalidos.");
  }

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
    const uc = await db.doc(`userCompanies/${userRecord.uid}`).get();
    if (uc.exists && uc.data()?.companyId !== companyId) {
      throw new Error("E-mail ja esta vinculado a outra conta FlowProject.");
    }
  } catch (err) {
    if (err?.code !== "auth/user-not-found") throw err;
    const tempPassword = Math.random().toString(36).slice(-10) + "A1!";
    userRecord = await admin.auth().createUser({
      email,
      password: tempPassword,
      displayName: name,
      disabled: false,
    });
  }

  const uid = userRecord.uid;
  const companyRef = db.doc(`companies/${companyId}`);
  const companySnap = await companyRef.get();
  const resetLink = await generatePublicPasswordResetLink(email);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const companyPayload = {
    name: signup.workspaceName || `Espaco de ${name}`,
    displayName: signup.workspaceName || `Espaco de ${name}`,
    cnpj: "",
    cpf,
    cpfHash: sha256(cpf),
    accountType: "individual",
    documentType: "cpf",
    active: isStripeAccessActive(stripePayload.subscriptionStatus || signup.stripeStatus || "active"),
    ownerUid: uid,
    ownerEmail: email,
    planId: plan.id,
    planName: plan.label,
    planUserLimit: plan.includedUsers,
    planParticipantLimit: plan.participantLimit,
    planProjectLimit: plan.projectLimit,
    planPrice: plan.price,
    planBillingCycle: "monthly",
    planBillingPrice: plan.price,
    expenseReceiptRequired: true,
    trialDays: Number(stripePayload.trialDays || signup.trialDays || 0),
    trialEndsAt: stripePayload.trialEndsAt || signup.trialEndsAt || null,
    trialConsentVersion: signup.trialConsentVersion || "",
    stripeCustomerId: stripePayload.customerId || signup.stripeCustomerId || "",
    stripeSubscriptionId: stripePayload.subscriptionId || signup.stripeSubscriptionId || "",
    stripeCheckoutSessionId: stripePayload.checkoutSessionId || signup.checkoutSessionId || "",
    stripeStatus: stripePayload.subscriptionStatus || "active",
    updatedAt: now,
  };

  if (!companySnap.exists) {
    companyPayload.createdAt = now;
    companyPayload.createdBy = "stripe";
  }

  const batch = db.batch();
  batch.set(companyRef, companyPayload, { merge: true });
  batch.set(db.doc(`userCompanies/${uid}`), { companyId });
  batch.set(db.doc(`companies/${companyId}/users/${uid}`), {
    name,
    role: "admin",
    email,
    emailLower: email,
    phone,
    active: true,
    teamIds: [],
    teamId: "",
    cpf,
    createdAt: now,
    createdBy: "stripe",
  }, { merge: true });
  batch.set(db.doc(`companies/${companyId}/teams/default`), {
    name: "Geral",
    active: true,
    createdAt: now,
    createdBy: uid,
  }, { merge: true });
  batch.set(signupRef, {
    status: isStripeAccessActive(companyPayload.stripeStatus) ? "active" : `subscription_${companyPayload.stripeStatus}`,
    activatedAt: now,
    ownerUid: uid,
    companyId,
    resetLink,
    planSnapshot: plan,
    stripeCustomerId: companyPayload.stripeCustomerId,
    stripeSubscriptionId: companyPayload.stripeSubscriptionId,
    stripeCheckoutSessionId: companyPayload.stripeCheckoutSessionId,
    stripeStatus: companyPayload.stripeStatus,
    trialDays: companyPayload.trialDays,
    trialEndsAt: companyPayload.trialEndsAt,
    updatedAt: now,
  }, { merge: true });

  await batch.commit();
  return { ...signup, status: "active", ownerUid: uid, companyId, resetLink };
}

/**
 * Regras de permissão (alinhadas ao seu projeto)
 * - Admin da empresa: pode criar admin/gestor/coordenador/tecnico
 * - Gestor/Coordenador: pode criar SOMENTE tecnico
 * - Técnico: não cria usuários
 */
async function assertCallerPermission(db, callerUid, companyId, requestedRole) {
  const companyData = await getCompanyDataOrThrow(db, companyId);
  if (isIndividualCompany(companyData) && requestedRole !== "tecnico") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Plano pessoa fisica permite cadastrar apenas Recursos."
    );
  }

  const callerCompanySnap = await db.doc(`userCompanies/${callerUid}`).get();
  const callerCompanyId = callerCompanySnap.exists ? callerCompanySnap.data().companyId : null;

  if (callerCompanyId !== companyId) {
    throw new functions.https.HttpsError("permission-denied", "Você não pertence a esta empresa.");
  }

  const callerUserSnap = await db.doc(`companies/${companyId}/users/${callerUid}`).get();
  if (!callerUserSnap.exists || callerUserSnap.data().active === false) {
    throw new functions.https.HttpsError("permission-denied", "Usuário chamador inválido.");
  }

  const callerRole = callerUserSnap.data().role;

  if (callerRole === "admin") {
    // ok: admin pode criar qualquer role (inclusive admin)
    return { callerRole, callerUserSnap };
  }

  if (callerRole === "gestor" || callerRole === "coordenador") {
    if (requestedRole !== "tecnico") {
      throw new functions.https.HttpsError("permission-denied", "Você só pode criar Técnico.");
    }
    return { callerRole, callerUserSnap };
  }

  throw new functions.https.HttpsError("permission-denied", "Sem permissão para criar usuários.");
}

/**
 * Busca todas as equipes da empresa (IDs) — para técnico pertencer à empresa
 */
async function getAllCompanyTeamIds(db, companyId) {
  const snap = await db.collection(`companies/${companyId}/teams`).get();
  return snap.docs.map((d) => d.id);
}

/**
 * Valida duplicidade por empresa (Firestore) antes de criar no Auth
 */
async function assertEmailNotUsedInCompany(db, companyId, emailLower) {
  const usersRef = db.collection(`companies/${companyId}/users`);
  const q = await usersRef.where("emailLower", "==", emailLower).limit(1).get();
  const qLegacy = await usersRef.where("email", "==", emailLower).limit(1).get();
  if (!qLegacy.empty) {
    throw new functions.https.HttpsError("already-exists", "Este e-mail ja esta cadastrado nesta empresa.");
  }
  if (!q.empty) {
    throw new functions.https.HttpsError("already-exists", "Este e-mail já está cadastrado nesta empresa.");
  }
}

/**
 * Valida duplicidade global no Auth (e checa se pertence à mesma empresa)
 * - Se já existe no Auth e está na mesma empresa: bloqueia (não pode duplicar)
 * - Se já existe no Auth e está em outra empresa: bloqueia também (multi-tenant 1 empresa por usuário)
 */
async function assertEmailNotUsedInAuthOrTenant(db, companyId, emailLower) {
  try {
    const existing = await admin.auth().getUserByEmail(emailLower);
    if (existing && existing.uid) {
      const uc = await db.doc(`userCompanies/${existing.uid}`).get();
      const existingCompanyId = uc.exists ? uc.data().companyId : null;

      if (existingCompanyId === companyId) {
        throw new functions.https.HttpsError("already-exists", "Este e-mail já está cadastrado nesta empresa.");
      }
      throw new functions.https.HttpsError("already-exists", "Este e-mail já está em uso em outra empresa.");
    }
  } catch (e) {
    // getUserByEmail lança auth/user-not-found quando não existe — isso é OK.
    if (e?.code === "auth/user-not-found") return;
    // Se for um HttpsError re-lançado, propaga
    if (e instanceof functions.https.HttpsError) throw e;
    // Qualquer outro erro inesperado
    throw new functions.https.HttpsError("internal", "Erro ao validar e-mail no Authentication.");
  }
}

/**
 * Gera número sequencial por empresa para técnicos
 */
async function nextTechNumber(db, companyId) {
  const counterRef = db.doc(`companies/${companyId}/counters/techs`);
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    if (!snap.exists) {
      tx.set(counterRef, { next: 2 }); // primeiro número = 1
      return 1;
    }
    const next = snap.data().next || 1;
    tx.update(counterRef, { next: next + 1 });
    return next;
  });
}

/**
 * createUserInTenant (callable)
 * Payload:
 * { companyId, name, email, phone, role }
 * Returns: { uid, resetLink, number }
 */
exports.createUserInTenant = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Não autenticado.");
  }

  const callerUid = context.auth.uid;
  const { companyId, name, email, phone, role, tempAvatarPath, softSkills, hardSkills, hourlyRate } = data || {};

  const safeCompanyId = normalizeString(companyId);
  const safeName = normalizeString(name);
  const safeEmailLower = normalizeEmail(email);
  const safeRole = normalizeString(role);
  const safePhone = normalizeString(phone);

  if (!safeCompanyId) throw new functions.https.HttpsError("invalid-argument", "companyId inválido.");
  if (!safeName) throw new functions.https.HttpsError("invalid-argument", "Nome inválido.");
  if (!safeEmailLower) throw new functions.https.HttpsError("invalid-argument", "E-mail inválido.");
  if (!safeRole) throw new functions.https.HttpsError("invalid-argument", "Role inválida.");

  const allowedRoles = ["admin", "gestor", "coordenador", "tecnico"];
  if (!allowedRoles.includes(safeRole)) {
    throw new functions.https.HttpsError("permission-denied", "Role não permitida.");
  }

  const db = admin.firestore();

  // 1) Permissão do chamador (multi-tenant + role)
  await assertCallerPermission(db, callerUid, safeCompanyId, safeRole);

  // 2) Bloqueia e-mail repetido na mesma empresa (Firestore)
  await assertEmailNotUsedInCompany(db, safeCompanyId, safeEmailLower);

  // 3) Bloqueia se e-mail já existir no Auth (e também se estiver em outra empresa)
  await assertEmailNotUsedInAuthOrTenant(db, safeCompanyId, safeEmailLower);
  await assertCompanyUserLimitAvailable(db, safeCompanyId);
  const emailReservationRef = await reserveCompanyUserEmail(db, safeCompanyId, safeEmailLower, callerUid);

  // 4) TeamIds do técnico = todas as equipes da empresa
  let teamIds = [];
  if (safeRole === "tecnico") {
    teamIds = await getAllCompanyTeamIds(db, safeCompanyId);
    teamIds = uniqueStrings(teamIds);
  }

  // 4b) Campos extras do técnico (skills e valor/hora)
  const safeSoftSkills = sanitizeSkillArray(softSkills);
  const safeHardSkills = sanitizeSkillArray(hardSkills);
  const safeHourlyRate = sanitizeHourlyRate(hourlyRate);

  // 5) Número sequencial por empresa para técnico
  let techNumber = null;
  if (safeRole === "tecnico") {
    techNumber = await nextTechNumber(db, safeCompanyId);
  }

  // 6) Agora sim cria o usuário no Auth (evita “Auth criado + Firestore negado”)
  const tempPassword = Math.random().toString(36).slice(-10) + "A1!";
  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email: safeEmailLower,
      password: tempPassword,
      displayName: safeName,
    });
  } catch (e) {
    await releaseCompanyUserEmailReservation(emailReservationRef);
    // Se por algum motivo já existir (corrida), devolve mensagem amigável
    throw new functions.https.HttpsError("already-exists", "Este e-mail já está em uso.");
  }

  const uid = userRecord.uid;

  // 7) Escreve no Firestore (Admin SDK)
  await db.doc(`userCompanies/${uid}`).set({ companyId: safeCompanyId });

  const userDoc = {
    name: safeName,
    role: safeRole,
    email: safeEmailLower,
    emailLower: safeEmailLower,
    phone: safePhone || "",
    active: true,
    teamIds,
    teamId: teamIds[0] || "",
    ...(safeRole === "tecnico"
      ? {
          number: techNumber,
          feedbackCount: 0,
          softSkills: safeSoftSkills,
          hardSkills: safeHardSkills,
          ...(safeHourlyRate === null ? {} : { hourlyRate: safeHourlyRate }),
        }
      : {}),
  };

  await db.doc(`companies/${safeCompanyId}/users/${uid}`).set(userDoc);
  await completeCompanyUserEmailReservation(emailReservationRef, uid);

  // 7b) Se veio avatar temporário, move para /avatars/{uid} (Admin SDK) e grava photoURL
  if (tempAvatarPath) {
    try {
      const photoURL = await moveTempAvatarToFinal({ companyId: safeCompanyId, callerUid, targetUid: uid, tempPath: tempAvatarPath });
      if (photoURL) {
        await db.doc(`companies/${safeCompanyId}/users/${uid}`).set({ photoURL }, { merge: true });
        // best-effort no Auth
        await admin.auth().updateUser(uid, { photoURL }).catch(() => {});
      }
    } catch (e) {
      console.warn("moveTempAvatarToFinal (callable) failed:", e);
    }
  }

  // 8) Gera link de reset
  const resetLink = await generatePublicPasswordResetLink(safeEmailLower);

  return { uid, resetLink, number: techNumber };
});

/**
 * createUserInTenantHttp (HTTP) - Fallback quando callable não funciona
 * Header: Authorization: Bearer <idToken>
 * Body: { companyId, name, email, phone, role }
 * Returns: { uid, resetLink, number }
 */
exports.createUserInTenantHttp = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "method-not-allowed" });

  try {
    const authHeader = req.get("Authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ error: { message: "Não autenticado." } });

    const decoded = await admin.auth().verifyIdToken(match[1]);
    const callerUid = decoded.uid;

    const body = req.body || {};
    const safeCompanyId = normalizeString(body.companyId);
    const safeName = normalizeString(body.name);
    const safeEmailLower = normalizeEmail(body.email);
    const safeRole = normalizeString(body.role);
    const safePhone = normalizeString(body.phone);
    const tempAvatarPath = normalizeString(body.tempAvatarPath);
    const safeSoftSkills = sanitizeSkillArray(body.softSkills);
    const safeHardSkills = sanitizeSkillArray(body.hardSkills);
    const safeHourlyRate = sanitizeHourlyRate(body.hourlyRate);

    if (!safeCompanyId) return res.status(400).json({ error: { message: "companyId inválido." } });
    if (!safeName) return res.status(400).json({ error: { message: "Nome inválido." } });
    if (!safeEmailLower) return res.status(400).json({ error: { message: "E-mail inválido." } });
    if (!safeRole) return res.status(400).json({ error: { message: "Role inválida." } });

    if (!["admin", "gestor", "coordenador", "tecnico"].includes(safeRole)) {
      return res.status(403).json({ error: { message: "Role não permitida." } });
    }

    const db = admin.firestore();

    // Permissão do chamador
    try {
      await assertCallerPermission(db, callerUid, safeCompanyId, safeRole);
    } catch (e) {
      const msg = e?.message || "Sem permissão.";
      return res.status(403).json({ error: { message: msg } });
    }

    // E-mail duplicado na empresa (Firestore)
    try {
      await assertEmailNotUsedInCompany(db, safeCompanyId, safeEmailLower);
    } catch (e) {
      return res.status(409).json({ error: { message: e.message || "Este e-mail já está cadastrado nesta empresa." } });
    }

    // E-mail já existe no Auth / outra empresa
    try {
      await assertEmailNotUsedInAuthOrTenant(db, safeCompanyId, safeEmailLower);
    } catch (e) {
      return res.status(409).json({ error: { message: e.message || "Este e-mail já está em uso." } });
    }

    // teamIds do técnico = todas as equipes
    try {
      await assertCompanyUserLimitAvailable(db, safeCompanyId);
    } catch (e) {
      return res.status(429).json({ error: { message: e.message || "Limite de usuarios do plano atingido." } });
    }
    let emailReservationRef;
    try {
      emailReservationRef = await reserveCompanyUserEmail(db, safeCompanyId, safeEmailLower, callerUid);
    } catch (e) {
      return res.status(409).json({ error: { message: e.message || "Este e-mail ja esta cadastrado nesta empresa." } });
    }
    let teamIds = [];
    if (safeRole === "tecnico") {
      teamIds = await getAllCompanyTeamIds(db, safeCompanyId);
      teamIds = uniqueStrings(teamIds);
    }

    // número sequencial por empresa
    let techNumber = null;
    if (safeRole === "tecnico") {
      techNumber = await nextTechNumber(db, safeCompanyId);
    }

    // cria no Auth
    const tempPassword = Math.random().toString(36).slice(-10) + "A1!";
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: safeEmailLower,
        password: tempPassword,
        displayName: safeName,
      });
    } catch (e) {
      await releaseCompanyUserEmailReservation(emailReservationRef);
      return res.status(409).json({ error: { message: "Este e-mail já está em uso." } });
    }

    const uid = userRecord.uid;

    // grava Firestore
    await db.doc(`userCompanies/${uid}`).set({ companyId: safeCompanyId });

    const userDoc = {
      name: safeName,
      role: safeRole,
      email: safeEmailLower,
      emailLower: safeEmailLower,
      phone: safePhone || "",
      active: true,
      teamIds,
      teamId: teamIds[0] || "",
      ...(safeRole === "tecnico"
        ? {
            number: techNumber,
            feedbackCount: 0,
            softSkills: safeSoftSkills,
            hardSkills: safeHardSkills,
            ...(safeHourlyRate === null ? {} : { hourlyRate: safeHourlyRate }),
          }
        : {}),
    };

    await db.doc(`companies/${safeCompanyId}/users/${uid}`).set(userDoc);
    await completeCompanyUserEmailReservation(emailReservationRef, uid);

    // avatar temporário -> final
    if (tempAvatarPath) {
      try {
        const photoURL = await moveTempAvatarToFinal({ companyId: safeCompanyId, callerUid, targetUid: uid, tempPath: tempAvatarPath });
        if (photoURL) {
          await db.doc(`companies/${safeCompanyId}/users/${uid}`).set({ photoURL }, { merge: true });
          await admin.auth().updateUser(uid, { photoURL }).catch(() => {});
        }
      } catch (e) {
        console.warn("moveTempAvatarToFinal (http) failed:", e);
      }
    }

    const resetLink = await generatePublicPasswordResetLink(safeEmailLower);
    return res.status(200).json({ uid, resetLink, number: techNumber });
  } catch (e) {
    console.error("createUserInTenantHttp:", e);
    return res.status(500).json({ error: { message: "Erro interno." } });
  }
});

/**
 * setUserAvatarFromTempHttp (HTTP)
 * Header: Authorization: Bearer <idToken>
 * Body: { companyId, targetUid, tempAvatarPath }
 * Returns: { photoURL }
 */
exports.setUserAvatarFromTempHttp = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "method-not-allowed" });

  try {
    const authHeader = req.get("Authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ error: { message: "Não autenticado." } });

    const decoded = await admin.auth().verifyIdToken(match[1]);
    const callerUid = decoded.uid;

    const body = req.body || {};
    const safeCompanyId = normalizeString(body.companyId);
    const targetUid = normalizeString(body.targetUid);
    const tempAvatarPath = normalizeString(body.tempAvatarPath);

    if (!safeCompanyId) return res.status(400).json({ error: { message: "companyId inválido." } });
    if (!targetUid) return res.status(400).json({ error: { message: "targetUid inválido." } });
    if (!tempAvatarPath) return res.status(400).json({ error: { message: "tempAvatarPath inválido." } });

    const db = admin.firestore();

    // Permissão (admin/gestor/coordenador conseguem editar técnico)
    try {
      await assertCallerPermission(db, callerUid, safeCompanyId, "tecnico");
    } catch (e) {
      return res.status(403).json({ error: { message: e?.message || "Sem permissão." } });
    }

    // Target existe na empresa
    const targetSnap = await db.doc(`companies/${safeCompanyId}/users/${targetUid}`).get();
    if (!targetSnap.exists) return res.status(404).json({ error: { message: "Usuário não encontrado." } });

    const photoURL = await moveTempAvatarToFinal({ companyId: safeCompanyId, callerUid, targetUid, tempPath: tempAvatarPath });
    if (photoURL) {
      await db.doc(`companies/${safeCompanyId}/users/${targetUid}`).set({ photoURL }, { merge: true });
      await admin.auth().updateUser(targetUid, { photoURL }).catch(() => {});
    }

    return res.status(200).json({ photoURL });
  } catch (e) {
    console.error("setUserAvatarFromTempHttp:", e);
    return res.status(500).json({ error: { message: "Erro interno." } });
  }
});

/**
 * adminUpdateCompanyUserHttp (HTTP)
 * Header: Authorization: Bearer <idToken>
 * Body: { companyId, targetUid, patch }
 * Atualiza campos administrativos permitidos de companies/{companyId}/users/{targetUid}.
 */
exports.adminUpdateCompanyUserHttp = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "method-not-allowed" });

  try {
    const authHeader = req.get("Authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ error: { message: "Nao autenticado." } });

    const decoded = await admin.auth().verifyIdToken(match[1]);
    const callerUid = decoded.uid;
    const body = req.body || {};
    const companyId = normalizeString(body.companyId);
    const targetUid = normalizeString(body.targetUid);
    const rawPatch = body.patch || {};

    if (!companyId) return res.status(400).json({ error: { message: "companyId invalido." } });
    if (!targetUid) return res.status(400).json({ error: { message: "targetUid invalido." } });
    if (!rawPatch || typeof rawPatch !== "object" || Array.isArray(rawPatch)) {
      return res.status(400).json({ error: { message: "patch invalido." } });
    }

    const db = admin.firestore();
    const callerCompanySnap = await db.doc(`userCompanies/${callerUid}`).get();
    if (!callerCompanySnap.exists || callerCompanySnap.data().companyId !== companyId) {
      return res.status(403).json({ error: { message: "Voce nao pertence a esta empresa." } });
    }

    const callerSnap = await db.doc(`companies/${companyId}/users/${callerUid}`).get();
    if (!callerSnap.exists || callerSnap.data().active === false) {
      return res.status(403).json({ error: { message: "Usuario chamador invalido." } });
    }

    const callerRole = String(callerSnap.data().role || "");
    const targetRef = db.doc(`companies/${companyId}/users/${targetUid}`);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) return res.status(404).json({ error: { message: "Usuario alvo nao encontrado." } });

    const targetRole = String(targetSnap.data().role || "");
    const canUpdate = callerRole === "admin"
      || ((callerRole === "gestor" || callerRole === "coordenador") && targetRole === "tecnico");
    if (!canUpdate) return res.status(403).json({ error: { message: "Sem permissao para editar este usuario." } });

    const patch = {};
    const allowed = new Set([
      "name", "phone", "active",
      "teamId", "teamIds",
      "softSkills", "hardSkills",
      "photoURL", "hourlyRate",
      "address", "cpf", "cnpj", "birthDate", "age",
      "attachments"
    ]);

    for (const key of Object.keys(rawPatch)) {
      if (!allowed.has(key)) continue;
      const value = rawPatch[key];

      if (key === "name") {
        const name = normalizeString(value).slice(0, 120);
        if (!name) return res.status(400).json({ error: { message: "Nome invalido." } });
        patch.name = name;
      } else if (key === "phone") {
        patch.phone = normalizeString(value).slice(0, 40);
      } else if (key === "active") {
        if (typeof value !== "boolean") return res.status(400).json({ error: { message: "Status invalido." } });
        patch.active = value;
      } else if (key === "teamIds") {
        const teamIds = uniqueStrings(Array.isArray(value) ? value : []).slice(0, 50);
        if (targetRole !== "admin" && teamIds.length === 0) {
          return res.status(400).json({ error: { message: "Selecione pelo menos 1 equipe." } });
        }
        patch.teamIds = teamIds;
      } else if (key === "teamId") {
        patch.teamId = normalizeString(value).slice(0, 120);
      } else if (key === "softSkills") {
        patch.softSkills = sanitizeSkillArray(value);
      } else if (key === "hardSkills") {
        patch.hardSkills = sanitizeSkillArray(value);
      } else if (key === "photoURL") {
        patch.photoURL = normalizeString(value).slice(0, 2000);
      } else if (key === "hourlyRate") {
        const hourlyRate = sanitizeHourlyRate(value);
        if (hourlyRate === null) return res.status(400).json({ error: { message: "Valor/hora invalido." } });
        patch.hourlyRate = hourlyRate;
      } else if (key === "address") {
        patch.address = normalizeString(value).slice(0, 300);
      } else if (key === "cpf") {
        patch.cpf = normalizeString(value).slice(0, 20);
      } else if (key === "cnpj") {
        patch.cnpj = normalizeString(value).slice(0, 24);
      } else if (key === "birthDate") {
        const birthDate = normalizeString(value).slice(0, 10);
        if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
          return res.status(400).json({ error: { message: "Data de nascimento invalida." } });
        }
        patch.birthDate = birthDate;
      } else if (key === "age") {
        const age = Number(value);
        if (!Number.isInteger(age) || age < 0 || age > 130) {
          return res.status(400).json({ error: { message: "Idade invalida." } });
        }
        patch.age = age;
      } else if (key === "attachments") {
        patch.attachments = Array.isArray(value) ? value.slice(0, 6) : [];
      }
    }

    if (!Object.keys(patch).length) return res.status(200).json({ ok: true, skipped: true });

    await targetRef.set(patch, { merge: true });
    if ("photoURL" in patch) await admin.auth().updateUser(targetUid, { photoURL: patch.photoURL }).catch(() => {});

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("adminUpdateCompanyUserHttp:", e);
    return res.status(500).json({ error: { message: "Erro interno." } });
  }
});

/**
 * createCompanyWithAdmin (callable) - SUPERADMIN
 * Payload:
 * {
 *   companyId, companyName, cnpj,
 *   admin: { name, email, phone, active }
 * }
 * Returns: { companyId, uid, resetLink }
 */
exports.createCompanyWithAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Não autenticado.");
  }

  const callerUid = context.auth.uid;
  const { companyId, companyName, cnpj, admin: adminPayload, financial: financialPayload = {} } = data || {};
  const plan = getCompanyPlan(data?.planId || "plan-1-20");
  const planBillingCycle = normalizePlanBillingCycle(data?.planBillingCycle);
  const planBillingPrice = planBillingCycle === "annual" ? plan.annualPrice : plan.price;
  const planInstallments = normalizePlanInstallments(data?.planInstallments, planBillingCycle);
  const planInstallmentValue = planBillingCycle === "annual" ? planBillingPrice / planInstallments : planBillingPrice;
  const adminName = (adminPayload?.name || "").trim();
  const adminEmail = (adminPayload?.email || "").trim();
  const adminPhone = (adminPayload?.phone || "").trim();
  const adminActive = adminPayload?.active !== false;
  const financialContactName = normalizeString(financialPayload.name);
  const financialContactEmail = normalizeEmail(financialPayload.email);
  const financialContactPhone = normalizeString(financialPayload.phone);
  const billingStartDate = normalizeDateString(financialPayload.billingStartDate);
  const billingDueDate = normalizeString(financialPayload.billingDueDate);

  if (!companyId || typeof companyId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "companyId inválido.");
  }
  if (!companyName || typeof companyName !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "Nome da empresa inválido.");
  }
  if (!cnpj || typeof cnpj !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "CNPJ inválido.");
  }
  if (!adminName) {
    throw new functions.https.HttpsError("invalid-argument", "Nome do admin inválido.");
  }
  if (!adminEmail || typeof adminEmail !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "E-mail do admin inválido.");
  }

  const db = admin.firestore();

  // ===== Permissão: somente SUPERADMIN (platformUsers/{uid})
  const platformSnap = await db.doc(`platformUsers/${callerUid}`).get();
  const isSuper =
    platformSnap.exists &&
    platformSnap.data()?.role === "superadmin" &&
    platformSnap.data()?.active === true;

  if (!isSuper) {
    throw new functions.https.HttpsError("permission-denied", "Apenas Super Admin pode criar empresas.");
  }

  // ===== Evita sobrescrever empresa existente
  const companyRef = db.doc(`companies/${companyId}`);
  const companySnap = await companyRef.get();
  if (companySnap.exists) {
    throw new functions.https.HttpsError("already-exists", "Já existe uma empresa com este ID.");
  }

  // ===== Cria usuário admin no Auth (senha temporária)
  const tempPassword = Math.random().toString(36).slice(-10) + "A1!";
  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email: adminEmail,
      password: tempPassword,
      displayName: adminName,
    });
  } catch (e) {
    throw new functions.https.HttpsError("already-exists", "Já existe usuário com este e-mail no Authentication.");
  }

  const uid = userRecord.uid;

  // ===== Escreve Firestore (transação simples)
  const batch = db.batch();
  const billingRef = companyRef.collection("billings").doc();
  const { billing, summary: billingSummary } = buildBillingRecord({
    billingId: billingRef.id,
    companyId,
    plan,
    cycle: planBillingCycle,
    startDate: billingStartDate,
    dueDate: billingDueDate || billingStartDate,
    installmentCount: planInstallments,
    createdBy: callerUid,
    source: "initial",
  });

  batch.set(companyRef, {
    name: companyName,
    cnpj,
    active: true,
    planId: plan.id,
    planName: plan.label,
    planUserLimit: plan.userLimit,
    planPrice: plan.price,
    planAnnualPrice: plan.annualPrice,
    planBillingCycle,
    planBillingPrice,
    planInstallments,
    planInstallmentValue,
    billing: billingSummary,
    billingStartDate: billing.startDate,
    billingEndDate: billing.endDate,
    financialContactName,
    financialContactEmail,
    financialContactPhone,
    billingDueDate: billing.dueDate,
    expenseReceiptRequired: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: callerUid,
  });

  batch.set(billingRef, billing);

  batch.set(db.doc(`userCompanies/${uid}`), { companyId });

  batch.set(db.doc(`companies/${companyId}/users/${uid}`), {
    name: adminName,
    role: "admin",
    email: adminEmail,
    phone: adminPhone || "",
    active: adminActive,
    teamIds: [],
    teamId: "",
  });

  await batch.commit();

  // ===== Link de reset de senha (para enviar ao admin)
  const resetLink = await generatePublicPasswordResetLink(adminEmail);

  return { companyId, uid, resetLink };
});

/**
 * createCompanyWithAdminHttp (HTTP) - SUPERADMIN (robusto para localhost)
 * Header: Authorization: Bearer <idToken>
 * Body:
 * {
 *   companyId, companyName, cnpj,
 *   admin: { name, email, phone, active }
 * }
 * Returns JSON: { companyId, uid, resetLink }
 */
exports.createCompanyWithAdminHttp = functions
  .https
  .onRequest(async (req, res) => {
    // CORS simples para browser
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "method-not-allowed" });
    }

    try {
      const authHeader = req.get("Authorization") || "";
      const match = authHeader.match(/^Bearer (.+)$/);
      if (!match) {
        return res.status(401).json({ error: { message: "Não autenticado." } });
      }

      const decoded = await admin.auth().verifyIdToken(match[1]);
      const callerUid = decoded.uid;

      // Verifica SUPERADMIN no Firestore (platformUsers)
      const puRef = admin.firestore().doc(`platformUsers/${callerUid}`);
      const puSnap = await puRef.get();
      const pu = puSnap.exists ? puSnap.data() : null;

      if (!pu || pu.role !== "superadmin" || pu.active !== true) {
        return res.status(403).json({ error: { message: "Sem permissão." } });
      }

      const body = req.body || {};
      const companyId = body.companyId;
      const companyName = body.companyName;
      const cnpj = body.cnpj;
      const plan = getCompanyPlan(body.planId || "plan-1-20");
      const planBillingCycle = normalizePlanBillingCycle(body.planBillingCycle);
      const planBillingPrice = planBillingCycle === "annual" ? plan.annualPrice : plan.price;
      const planInstallments = normalizePlanInstallments(body.planInstallments, planBillingCycle);
      const planInstallmentValue = planBillingCycle === "annual" ? planBillingPrice / planInstallments : planBillingPrice;
      const financialPayload = body.financial || {};
      const adminPayload = body.admin || {};

      const adminName = String(adminPayload.name || "").trim();
      const adminEmail = String(adminPayload.email || "").trim();
      const adminPhone = String(adminPayload.phone || "").trim();
      const adminActive = adminPayload.active !== false;
      const financialContactName = normalizeString(financialPayload.name);
      const financialContactEmail = normalizeEmail(financialPayload.email);
      const financialContactPhone = normalizeString(financialPayload.phone);
      const billingStartDate = normalizeDateString(financialPayload.billingStartDate);
      const billingDueDate = normalizeString(financialPayload.billingDueDate);

      if (!companyId || typeof companyId !== "string") {
        return res.status(400).json({ error: { message: "companyId inválido." } });
      }
      if (!companyName || typeof companyName !== "string") {
        return res.status(400).json({ error: { message: "Nome da empresa inválido." } });
      }
      if (!cnpj || typeof cnpj !== "string") {
        return res.status(400).json({ error: { message: "CNPJ inválido." } });
      }
      if (!adminName) {
        return res.status(400).json({ error: { message: "Nome do admin inválido." } });
      }
      if (!adminEmail || typeof adminEmail !== "string") {
        return res.status(400).json({ error: { message: "E-mail do admin inválido." } });
      }

      const db = admin.firestore();
      const companyRef = db.doc(`companies/${companyId}`);
      const existing = await companyRef.get();
      if (existing.exists) {
        return res.status(409).json({ error: { message: "Empresa já existe." } });
      }

      const billingRef = companyRef.collection("billings").doc();
      const { billing, summary: billingSummary } = buildBillingRecord({
        billingId: billingRef.id,
        companyId,
        plan,
        cycle: planBillingCycle,
        startDate: billingStartDate,
        dueDate: billingDueDate || billingStartDate,
        installmentCount: planInstallments,
        createdBy: callerUid,
        source: "initial",
      });

      // 1) cria empresa
      await companyRef.set({
        name: companyName,
        cnpj,
        active: true,
        planId: plan.id,
        planName: plan.label,
        planUserLimit: plan.userLimit,
        planPrice: plan.price,
        planAnnualPrice: plan.annualPrice,
        planBillingCycle,
        planBillingPrice,
        planInstallments,
        planInstallmentValue,
        billing: billingSummary,
        billingStartDate: billing.startDate,
        billingEndDate: billing.endDate,
        financialContactName,
        financialContactEmail,
        financialContactPhone,
        billingDueDate: billing.dueDate,
        expenseReceiptRequired: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: callerUid
      });
      await billingRef.set(billing);

      // 2) cria usuário admin no Auth
      const userRecord = await admin.auth().createUser({
        email: adminEmail,
        displayName: adminName,
        disabled: !adminActive
      });

      const uid = userRecord.uid;

      // 3) vincula userCompanies
      await db.doc(`userCompanies/${uid}`).set({ companyId });

      // 4) cria doc companies/{companyId}/users/{uid}
      await db.doc(`companies/${companyId}/users/${uid}`).set({
        name: adminName,
        role: "admin",
        email: adminEmail,
        phone: adminPhone,
        active: adminActive,
        teamIds: []
      });

      // 5) gera link de redefinição de senha
      const resetLink = await generatePublicPasswordResetLink(adminEmail);

      return res.status(200).json({ companyId, uid, resetLink });

    } catch (e) {
      console.error("createCompanyWithAdminHttp error:", e);
      return res.status(500).json({ error: { message: "Erro interno ao criar empresa." } });
    }
  });

exports.createIndividualCheckoutSession = onRequest({ secrets: [STRIPE_SECRET_KEY] }, async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Metodo nao permitido." } });

  try {
    const body = req.body || {};
    const plan = getIndividualManagerPlan(body.planId);
    const name = normalizeString(body.name);
    const email = normalizeEmail(body.email);
    const phone = normalizeString(body.phone);
    const cpf = normalizeCpf(body.cpf);
    const workspaceName = normalizeString(body.workspaceName) || (name ? `Espaco de ${name}` : "");
    const trialConfig = getIndividualPlanTrialConfig(plan.id);
    const trialConsentAccepted = body.trialConsentAccepted === true || body.trialConsentAccepted === "true";
    const trialConsentVersion = normalizeString(body.trialConsentVersion);
    const trialEndsAtDate = trialConfig ? new Date(Date.now() + (trialConfig.days * 24 * 60 * 60 * 1000)) : null;

    if (!name) return res.status(400).json({ error: { message: "Informe seu nome." } });
    if (!email) return res.status(400).json({ error: { message: "Informe um e-mail valido." } });
    if (!isCpfValidBasic(cpf)) return res.status(400).json({ error: { message: "Informe um CPF valido." } });
    if (trialConfig && (!trialConsentAccepted || trialConsentVersion !== trialConfig.consentVersion)) {
      return res.status(400).json({ error: { message: "Para contratar o Gestor Start com 30 dias gratis, aceite os termos do periodo gratuito e da cobranca apos o trial." } });
    }

    const db = admin.firestore();
    const companyId = buildIndividualCompanyId(cpf);
    const companySnap = await db.doc(`companies/${companyId}`).get();
    if (companySnap.exists && companySnap.data()?.active !== false) {
      return res.status(409).json({ error: { message: "Este CPF ja possui uma conta ativa no FlowProject." } });
    }

    try {
      const existingUser = await admin.auth().getUserByEmail(email);
      const existingCompany = await db.doc(`userCompanies/${existingUser.uid}`).get();
      if (existingCompany.exists && existingCompany.data()?.companyId !== companyId) {
        return res.status(409).json({ error: { message: "Este e-mail ja esta em uso em outra conta FlowProject." } });
      }
    } catch (err) {
      if (err?.code !== "auth/user-not-found") throw err;
    }

    const signupRef = db.collection("individualSignups").doc();
    const successToken = crypto.randomBytes(18).toString("hex");
    const baseUrl = getPublicBaseUrl(req);
    const stripe = getStripeClient();

    await signupRef.set({
      id: signupRef.id,
      status: "checkout_created",
      accountType: "individual",
      documentType: "cpf",
      planId: plan.id,
      planSnapshot: plan,
      name,
      email,
      phone,
      cpf,
      cpfHash: sha256(cpf),
      companyId,
      workspaceName,
      trialDays: trialConfig?.days || 0,
      trialEndsAt: trialEndsAtDate ? admin.firestore.Timestamp.fromDate(trialEndsAtDate) : null,
      trialConsentAccepted: Boolean(trialConfig),
      trialConsentVersion: trialConfig?.consentVersion || "",
      trialConsentText: trialConfig?.consentText || "",
      trialConsentAcceptedAt: trialConfig ? admin.firestore.FieldValue.serverTimestamp() : null,
      trialConsentIp: trialConfig ? getRequestIp(req) : "",
      trialConsentUserAgent: trialConfig ? String(req.headers["user-agent"] || "") : "",
      trialMonthlyPrice: trialConfig ? plan.price : null,
      trialCurrency: trialConfig ? "BRL" : "",
      successTokenHash: sha256(successToken),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      client_reference_id: signupRef.id,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "brl",
          unit_amount: plan.priceCents,
          recurring: { interval: "month" },
          product_data: {
            name: `FlowProject ${plan.label}`,
            description: trialConfig
              ? `${trialConfig.days} dias gratis. Depois, R$ ${plan.price.toFixed(2).replace(".", ",")}/mes se nao cancelar antes do fim do periodo gratuito. ${plan.includedUsers} usuarios: 1 Gestor, ${plan.participantLimit} Participantes e ${plan.projectLimit} projetos`
              : `${plan.includedUsers} usuarios: 1 Gestor, ${plan.participantLimit} Participantes e ${plan.projectLimit} projetos`,
          },
        },
      }],
      payment_method_collection: "always",
      metadata: {
        signupId: signupRef.id,
        planId: plan.id,
        accountType: "individual",
        trialDays: String(trialConfig?.days || 0),
        trialConsentVersion: trialConfig?.consentVersion || "",
      },
      subscription_data: {
        ...(trialConfig ? {
          trial_period_days: trialConfig.days,
          trial_settings: {
            end_behavior: {
              missing_payment_method: "cancel",
            },
          },
        } : {}),
        metadata: {
          signupId: signupRef.id,
          planId: plan.id,
          accountType: "individual",
          trialDays: String(trialConfig?.days || 0),
          trialConsentVersion: trialConfig?.consentVersion || "",
        },
      },
      custom_text: trialConfig ? {
        submit: {
          message: `${trialConfig.days} dias gratis. Se voce nao cancelar antes do fim do periodo gratuito, sera cobrado R$ ${plan.price.toFixed(2).replace(".", ",")}/mes no cartao informado.`,
        },
      } : undefined,
      success_url: `${baseUrl}/venda?checkout=success&session_id={CHECKOUT_SESSION_ID}&token=${successToken}`,
      cancel_url: `${baseUrl}/venda?checkout=cancelled`,
      allow_promotion_codes: true,
    });

    await signupRef.set({
      checkoutSessionId: session.id,
      checkoutUrl: session.url,
      stripeStatus: "checkout_created",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("createIndividualCheckoutSession:", err);
    return res.status(500).json({ error: { message: err?.message || "Erro ao iniciar checkout." } });
  }
});

exports.getIndividualCheckoutResult = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Metodo nao permitido." } });

  try {
    const sessionId = normalizeString(req.body?.sessionId);
    const token = normalizeString(req.body?.token);
    if (!sessionId || !token) return res.status(400).json({ error: { message: "Sessao invalida." } });

    const db = admin.firestore();
    const snap = await db.collection("individualSignups").where("checkoutSessionId", "==", sessionId).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: { message: "Checkout nao encontrado." } });

    const docSnap = snap.docs[0];
    const data = docSnap.data() || {};
    if (data.successTokenHash !== sha256(token)) {
      return res.status(403).json({ error: { message: "Token de checkout invalido." } });
    }

    if (data.status !== "active") {
      return res.status(200).json({ status: data.status || "pending", message: "Pagamento confirmado, ativacao em processamento." });
    }

    return res.status(200).json({
      status: "active",
      email: data.email,
      companyId: data.companyId,
      resetLink: data.resetLink || "",
    });
  } catch (err) {
    console.error("getIndividualCheckoutResult:", err);
    return res.status(500).json({ error: { message: err?.message || "Erro ao consultar checkout." } });
  }
});

exports.createCustomerPortalSession = onRequest({ secrets: [STRIPE_SECRET_KEY] }, async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Metodo nao permitido." } });

  try {
    const authHeader = req.headers.authorization || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: { message: "Nao autenticado." } });

    const decoded = await admin.auth().verifyIdToken(match[1]);
    const db = admin.firestore();
    const ucSnap = await db.doc(`userCompanies/${decoded.uid}`).get();
    const companyId = normalizeString(ucSnap.data()?.companyId);
    if (!companyId) return res.status(404).json({ error: { message: "Empresa nao encontrada." } });

    const userSnap = await db.doc(`companies/${companyId}/users/${decoded.uid}`).get();
    const role = String(userSnap.data()?.role || "").toLowerCase();
    if (role !== "admin" && role !== "gestor") {
      return res.status(403).json({ error: { message: "Somente o titular ou administrador pode gerenciar a assinatura." } });
    }

    const companySnap = await db.doc(`companies/${companyId}`).get();
    const company = companySnap.exists ? companySnap.data() : {};
    if (String(company?.accountType || "").toLowerCase() !== "individual") {
      return res.status(400).json({ error: { message: "Portal disponivel apenas para planos de gestor individual." } });
    }
    if (!company?.stripeCustomerId) {
      return res.status(400).json({ error: { message: "Assinatura Stripe nao encontrada para esta conta." } });
    }

    const baseUrl = getPublicBaseUrl(req);
    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: company.stripeCustomerId,
      return_url: `${baseUrl}/`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("createCustomerPortalSession:", err);
    return res.status(500).json({ error: { message: err?.message || "Nao foi possivel abrir o portal de assinatura." } });
  }
});

exports.stripeWebhook = onRequest({ secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  const stripe = getStripeClient();
  const endpointSecret = getConfigValue("stripe.webhook_secret").trim();
  const signature = req.headers["stripe-signature"];
  let event;

  try {
    if (!endpointSecret) throw new Error("STRIPE_WEBHOOK_SECRET nao configurado.");
    event = stripe.webhooks.constructEvent(req.rawBody, signature, endpointSecret);
  } catch (err) {
    console.error("[stripeWebhook] assinatura invalida:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || err}`);
  }

  try {
    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const signupId = session.client_reference_id || session.metadata?.signupId;
      if (signupId) {
        let subscriptionStatus = "active";
        let trialEndsAt = null;
        let trialDays = 0;
        if (session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          subscriptionStatus = subscription.status || "active";
          trialDays = Number(subscription.metadata?.trialDays || 0);
          trialEndsAt = subscription.trial_end ? admin.firestore.Timestamp.fromMillis(subscription.trial_end * 1000) : null;
        }
        await activateIndividualSignup(signupId, {
          customerId: session.customer || "",
          subscriptionId: session.subscription || "",
          checkoutSessionId: session.id,
          subscriptionStatus,
          trialDays,
          trialEndsAt,
        });
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const signupId = subscription.metadata?.signupId || "";
      const status = subscription.status || (event.type === "customer.subscription.deleted" ? "canceled" : "");
      if (signupId) {
        const signupRef = db.doc(`individualSignups/${signupId}`);
        const signupSnap = await signupRef.get();
        const signup = signupSnap.exists ? signupSnap.data() : {};
        const companyId = signup?.companyId || "";
        await signupRef.set({
          stripeStatus: status,
          status: isStripeAccessActive(status) ? "active" : "subscription_" + status,
          stripeCancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
          stripeCurrentPeriodEnd: subscription.current_period_end ? admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000) : null,
          trialEndsAt: subscription.trial_end ? admin.firestore.Timestamp.fromMillis(subscription.trial_end * 1000) : (signup?.trialEndsAt || null),
          updatedAt: now,
        }, { merge: true });
        if (companyId) {
          await db.doc(`companies/${companyId}`).set({
            stripeStatus: status,
            active: isStripeAccessActive(status),
            billingSuspended: isStripeAccessSuspended(status),
            stripeCancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
            stripeCurrentPeriodEnd: subscription.current_period_end ? admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000) : null,
            trialEndsAt: subscription.trial_end ? admin.firestore.Timestamp.fromMillis(subscription.trial_end * 1000) : null,
            updatedAt: now,
          }, { merge: true });
        }
      }
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : "";
      if (subscriptionId) {
        const [companies, signups] = await Promise.all([
          db.collection("companies").where("stripeSubscriptionId", "==", subscriptionId).limit(1).get(),
          db.collection("individualSignups").where("stripeSubscriptionId", "==", subscriptionId).limit(1).get(),
        ]);
        if (!companies.empty) {
          await companies.docs[0].ref.set({
            stripeStatus: "past_due",
            active: false,
            billingSuspended: true,
            lastPaymentFailureAt: now,
            updatedAt: now,
          }, { merge: true });
        }
        if (!signups.empty) {
          await signups.docs[0].ref.set({
            stripeStatus: "past_due",
            status: "subscription_past_due",
            lastPaymentFailureAt: now,
            updatedAt: now,
          }, { merge: true });
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[stripeWebhook] processamento falhou:", err);
    return res.status(500).send("Webhook processing failed");
  }
});

async function assertSuperAdminRequest(req) {
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("UNAUTHENTICATED");
  const decoded = await admin.auth().verifyIdToken(match[1]);
  const platformSnap = await admin.firestore().doc(`platformUsers/${decoded.uid}`).get();
  const platformUser = platformSnap.exists ? platformSnap.data() : null;
  if (!platformUser || platformUser.role !== "superadmin" || platformUser.active === false) {
    throw new Error("PERMISSION_DENIED");
  }
  return decoded;
}

async function deleteDocumentTree(docRef) {
  const collections = await docRef.listCollections();
  for (const col of collections) {
    const snap = await col.get();
    for (const child of snap.docs) {
      await deleteDocumentTree(child.ref);
    }
  }
  await docRef.delete();
}

exports.deleteTestCompanySignup = onRequest({ secrets: [STRIPE_SECRET_KEY] }, async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Metodo nao permitido." } });

  try {
    const decoded = await assertSuperAdminRequest(req);
    const companyId = normalizeString(req.body?.companyId);
    const confirmCompanyId = normalizeString(req.body?.confirmCompanyId);
    if (!companyId || companyId !== confirmCompanyId) {
      return res.status(400).json({ error: { message: "Confirme o ID da empresa para excluir este teste." } });
    }

    const db = admin.firestore();
    const companyRef = db.doc(`companies/${companyId}`);
    const companySnap = await companyRef.get();
    if (!companySnap.exists) return res.status(404).json({ error: { message: "Empresa nao encontrada." } });

    const company = companySnap.data() || {};
    const isTestSignup = company.accountType === "individual" || company.createdBy === "stripe" || !!company.stripeCustomerId || companyId.startsWith("cpf-");
    if (!isTestSignup) {
      return res.status(400).json({ error: { message: "Esta acao e permitida apenas para cadastros individuais/teste criados pelo checkout." } });
    }

    const stripe = getStripeClient();
    const stripeSubscriptionIds = new Set();
    const stripeCustomerIds = new Set();
    if (company.stripeSubscriptionId) stripeSubscriptionIds.add(company.stripeSubscriptionId);
    if (company.stripeCustomerId) stripeCustomerIds.add(company.stripeCustomerId);

    const signupRefs = new Map();
    const byCompany = await db.collection("individualSignups").where("companyId", "==", companyId).get();
    byCompany.docs.forEach((docSnap) => signupRefs.set(docSnap.id, docSnap));
    if (company.ownerEmail) {
      const byEmail = await db.collection("individualSignups").where("email", "==", normalizeEmail(company.ownerEmail)).get();
      byEmail.docs.forEach((docSnap) => signupRefs.set(docSnap.id, docSnap));
    }
    for (const signupSnap of signupRefs.values()) {
      const signup = signupSnap.data() || {};
      if (signup.stripeSubscriptionId) stripeSubscriptionIds.add(signup.stripeSubscriptionId);
      if (signup.stripeCustomerId) stripeCustomerIds.add(signup.stripeCustomerId);
    }

    const usersSnap = await db.collection(`companies/${companyId}/users`).get();
    const userIds = new Set(usersSnap.docs.map((docSnap) => docSnap.id));
    if (company.ownerUid) userIds.add(company.ownerUid);

    for (const subscriptionId of stripeSubscriptionIds) {
      try {
        await stripe.subscriptions.cancel(subscriptionId);
      } catch (err) {
        if (err?.code !== "resource_missing") console.warn("[deleteTestCompanySignup] subscription:", subscriptionId, err?.message || err);
      }
    }

    for (const customerId of stripeCustomerIds) {
      try {
        await stripe.customers.del(customerId);
      } catch (err) {
        if (err?.code !== "resource_missing") console.warn("[deleteTestCompanySignup] customer:", customerId, err?.message || err);
      }
    }

    for (const uid of userIds) {
      await db.doc(`userCompanies/${uid}`).delete().catch(() => {});
      await admin.auth().deleteUser(uid).catch((err) => {
        if (err?.code !== "auth/user-not-found") throw err;
      });
    }

    for (const signupSnap of signupRefs.values()) {
      await signupSnap.ref.delete();
    }
    await deleteDocumentTree(companyRef);

    return res.status(200).json({
      ok: true,
      message: "Cadastro de teste excluido.",
      companyId,
      deletedBy: decoded.uid,
      removedUsers: userIds.size,
      removedSignups: signupRefs.size,
      canceledSubscriptions: stripeSubscriptionIds.size,
      removedCustomers: stripeCustomerIds.size,
    });
  } catch (err) {
    console.error("deleteTestCompanySignup:", err);
    if (err?.message === "UNAUTHENTICATED") return res.status(401).json({ error: { message: "Voce precisa estar logado." } });
    if (err?.message === "PERMISSION_DENIED") return res.status(403).json({ error: { message: "Apenas Super Admin pode excluir cadastros de teste." } });
    return res.status(500).json({ error: { message: err?.message || "Nao foi possivel excluir o cadastro de teste." } });
  }
});
