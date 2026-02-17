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
  } else if (callerRole === "gestor" || callerRole === "coordenador") {
    if (role !== "tecnico") {
      throw new functions.https.HttpsError("permission-denied", "Você só pode criar Técnico.");
    }

    // FlowProject: Técnico pertence à EMPRESA (aparece para todos os gestores/coordenadores)
    // Se a empresa tiver equipes, usamos as equipes informadas (normalmente todas as ativas).
    // Se não tiver nenhuma equipe ainda, permitimos criar técnico com teamIds vazio.
    if (normalizedTeamIds.length < 1) {
      const teamsSnap = await db.collection(`companies/${companyId}/teams`).limit(1).get();
      if (!teamsSnap.empty) {
        throw new functions.https.HttpsError("invalid-argument", "Selecione pelo menos 1 equipe.");
      }
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

  // ===== Sequência numérica por empresa (técnicos)
  let techNumber = null;
  if (role === "tecnico") {
    const counterRef = db.doc(`companies/${companyId}/counters/techs`);
    techNumber = await db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      if (!snap.exists) {
        // padrão: create next=2 => primeiro número gerado é 1
        tx.set(counterRef, { next: 2 });
        return 1;
      }
      const next = snap.data().next || 1;
      tx.update(counterRef, { next: next + 1 });
      return next;
    });
  }


  const userDoc = {
    name,
    role,
    email,
    phone: phone || "",
    active: true,
    ...(techNumber ? { number: techNumber } : {}),
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

  return { uid, resetLink, number: techNumber };
});

/**
 * createUserInTenantHttp (HTTP) - Fallback quando callable não funciona
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
    const { companyId, name, email, phone, role, teamIds } = req.body || {};

    if (!companyId) return res.status(400).json({ error: { message: "companyId inválido." } });
    if (!name) return res.status(400).json({ error: { message: "Nome inválido." } });
    if (!email) return res.status(400).json({ error: { message: "E-mail inválido." } });
    if (!role) return res.status(400).json({ error: { message: "Role inválida." } });
    if (!["admin", "gestor", "coordenador", "tecnico"].includes(role)) {
      return res.status(403).json({ error: { message: "Role não permitida." } });
    }

    const db = admin.firestore();
    const callerCompanySnap = await db.doc(`userCompanies/${callerUid}`).get();
    if (!callerCompanySnap.exists || callerCompanySnap.data().companyId !== companyId) {
      return res.status(403).json({ error: { message: "Você não pertence a esta empresa." } });
    }

    const callerUserSnap = await db.doc(`companies/${companyId}/users/${callerUid}`).get();
    if (!callerUserSnap.exists || !callerUserSnap.data().active) {
      return res.status(403).json({ error: { message: "Usuário inválido." } });
    }

    const callerRole = callerUserSnap.data().role;
    const normalizedTeamIds = Array.isArray(teamIds) ? teamIds.filter(x => x && x.trim()) : [];

    if (callerRole !== "admin" && callerRole !== "gestor") {
      return res.status(403).json({ error: { message: "Sem permissão." } });
    }

    if (callerRole === "gestor") {
      if (role !== "tecnico") return res.status(403).json({ error: { message: "Gestor só cria Técnico." } });
      const managed = callerUserSnap.data().managedTeamIds || [];
      if (normalizedTeamIds.some(t => !managed.includes(t))) {
        return res.status(403).json({ error: { message: "Equipe fora do escopo." } });
      }
    }

    const tempPassword = Math.random().toString(36).slice(-10) + "A1!";
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({ email, password: tempPassword, displayName: name });
    } catch (e) {
      return res.status(409).json({ error: { message: "Email já existe." } });
    }

    const uid = userRecord.uid;
    await db.doc(`userCompanies/${uid}`).set({ companyId });
    await db.doc(`companies/${companyId}/users/${uid}`).set({
      name, role, email, phone: phone || "", active: true,
      teamIds: normalizedTeamIds, teamId: normalizedTeamIds[0] || ""
    });

    const resetLink = await admin.auth().generatePasswordResetLink(email);
    return res.status(200).json({ uid, resetLink });
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
