const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

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

/**
 * Regras de permissão (alinhadas ao seu projeto)
 * - Admin da empresa: pode criar admin/gestor/coordenador/tecnico
 * - Gestor/Coordenador: pode criar SOMENTE tecnico
 * - Técnico: não cria usuários
 */
async function assertCallerPermission(db, callerUid, companyId, requestedRole) {
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
  const { companyId, name, email, phone, role } = data || {};

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

  // 4) TeamIds do técnico = todas as equipes da empresa
  let teamIds = [];
  if (safeRole === "tecnico") {
    teamIds = await getAllCompanyTeamIds(db, safeCompanyId);
    teamIds = uniqueStrings(teamIds);
  }

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
    ...(safeRole === "tecnico" ? { number: techNumber, feedbackCount: 0, softSkills: [], hardSkills: [] } : {}),
  };

  await db.doc(`companies/${safeCompanyId}/users/${uid}`).set(userDoc);

  // 8) Gera link de reset
  const resetLink = await admin.auth().generatePasswordResetLink(safeEmailLower);

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
      ...(safeRole === "tecnico" ? { number: techNumber, feedbackCount: 0, softSkills: [], hardSkills: [] } : {}),
    };

    await db.doc(`companies/${safeCompanyId}/users/${uid}`).set(userDoc);

    const resetLink = await admin.auth().generatePasswordResetLink(safeEmailLower);
    return res.status(200).json({ uid, resetLink, number: techNumber });
  } catch (e) {
    console.error("createUserInTenantHttp:", e);
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
      const adminPayload = body.admin || {};

      const adminName = String(adminPayload.name || "").trim();
      const adminEmail = String(adminPayload.email || "").trim();
      const adminPhone = String(adminPayload.phone || "").trim();
      const adminActive = adminPayload.active !== false;

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

      // 1) cria empresa
      await companyRef.set({
        name: companyName,
        cnpj,
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: callerUid
      });

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
      const resetLink = await admin.auth().generatePasswordResetLink(adminEmail);

      return res.status(200).json({ companyId, uid, resetLink });

    } catch (e) {
      console.error("createCompanyWithAdminHttp error:", e);
      return res.status(500).json({ error: { message: "Erro interno ao criar empresa." } });
    }
  });
