const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * createUserInTenant (callable)
 * Payload:
 * { companyId, name, email, phone, role, teamIds }
 * Returns: { uid, resetLink }
 */
exports.createUserInTenant = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Não autenticado.");
  }

  const callerUid = context.auth.uid;
  const { companyId, name, email, phone, role, teamIds } = data || {};

  if (!companyId || typeof companyId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "companyId inválido.");
  }
  if (!name || typeof name !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "Nome inválido.");
  }
  if (!email || typeof email !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "E-mail inválido.");
  }
  if (!role || typeof role !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "Role inválida.");
  }

  const allowedRoles = ["admin", "gestor", "coordenador", "tecnico"];
  if (!allowedRoles.includes(role)) {
    throw new functions.https.HttpsError("permission-denied", "Role não permitida.");
  }

  // ===== Permissão: somente Admin da empresa pode criar admin/gestor/coordenador/tecnico
  // Gestor pode criar SOMENTE técnico e SOMENTE nas equipes que administra
  const db = admin.firestore();

  // Carrega company do caller (userCompanies)
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

  const normalizedTeamIds = Array.isArray(teamIds) ? teamIds.filter(x => typeof x === "string" && x.trim()) : [];

  if (callerRole === "admin") {
    // ok: admin pode criar qualquer role (inclusive admin)
  } else if (callerRole === "gestor") {
    if (role !== "tecnico") {
      throw new functions.https.HttpsError("permission-denied", "Gestor só pode criar Técnico.");
    }

    const managed = Array.isArray(callerUserSnap.data().managedTeamIds) ? callerUserSnap.data().managedTeamIds : [];
    const managedSet = new Set(managed);

    if (normalizedTeamIds.length < 1) {
      throw new functions.https.HttpsError("invalid-argument", "Selecione pelo menos 1 equipe.");
    }
    const outOfScope = normalizedTeamIds.some(t => !managedSet.has(t));
    if (outOfScope) {
      throw new functions.https.HttpsError("permission-denied", "Equipe fora do seu escopo (managedTeamIds).");
    }
  } else {
    throw new functions.https.HttpsError("permission-denied", "Sem permissão para criar usuários.");
  }

  // ===== Cria usuário no Auth (sem senha definida)
  // Cria com senha aleatória e envia link de reset
  const tempPassword = Math.random().toString(36).slice(-10) + "A1!";

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      password: tempPassword,
      displayName: name,
    });
  } catch (e) {
    // Se já existir com esse email, retorna erro amigável
    throw new functions.https.HttpsError("already-exists", "Já existe usuário com este e-mail no Auth.");
  }

  const uid = userRecord.uid;

  // ===== Escreve Firestore
  await db.doc(`userCompanies/${uid}`).set({ companyId });

  const userDoc = {
    name,
    role,
    email,
    phone: phone || "",
    active: true,
  };

  // Equipes
  if (role === "admin") {
    // admin pode nascer sem equipe
    userDoc.teamIds = normalizedTeamIds; // opcional
    userDoc.teamId = normalizedTeamIds[0] || "";
  } else {
    userDoc.teamIds = normalizedTeamIds;
    userDoc.teamId = normalizedTeamIds[0] || "";
  }

  await db.doc(`companies/${companyId}/users/${uid}`).set(userDoc);

  // ===== Gera link de reset de senha
  const resetLink = await admin.auth().generatePasswordResetLink(email);

  return { uid, resetLink };
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
  const { companyId, companyName, cnpj, admin: adminPayload } = data || {};
  const adminName = (adminPayload?.name || "").trim();
  const adminEmail = (adminPayload?.email || "").trim();
  const adminPhone = (adminPayload?.phone || "").trim();
  const adminActive = adminPayload?.active !== false;

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

  batch.set(companyRef, {
    name: companyName,
    cnpj,
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: callerUid,
  });

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
  const resetLink = await admin.auth().generatePasswordResetLink(adminEmail);

  return { companyId, uid, resetLink };
});

