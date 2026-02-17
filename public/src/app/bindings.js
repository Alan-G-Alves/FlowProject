// public/src/app/bindings.js
// Centraliza todos os addEventListener do app.js para reduzir o arquivo principal.

function mapAuthError(err){
  const code = err?.code || "";
  if (code.includes("auth/invalid-email")) return "E-mail inválido.";
  if (code.includes("auth/missing-password")) return "Informe a senha.";
  if (code.includes("auth/invalid-credential")) return "E-mail ou senha incorretos.";
  if (code.includes("auth/user-disabled")) return "Usuário desativado.";
  if (code.includes("auth/user-not-found")) return "Usuário não encontrado.";
  if (code.includes("auth/wrong-password")) return "Senha incorreta.";
  if (code.includes("auth/too-many-requests")) return "Muitas tentativas. Tente novamente mais tarde.";
  return "Não foi possível entrar. Tente novamente.";
}

export function bindUIEvents(deps){
  const { refs, state } = deps;
  const {
    auth, signInWithEmailAndPassword, sendPasswordResetEmail, signOut,
    setView, setAlert, clearAlert, slugify,
  } = deps;

  // -------- LOGIN --------
  refs.loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlert(refs.loginAlert);

    const email = (refs.emailEl?.value || "").trim();
    const password = refs.passwordEl?.value || "";

    if (!email || !password){
      setAlert(refs.loginAlert, "Preencha e-mail e senha.");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setAlert(refs.loginAlert, mapAuthError(err));
    }
  });

  refs.btnForgot?.addEventListener("click", async () => {
    clearAlert(refs.loginAlert);
    const email = (refs.emailEl?.value || "").trim();
    if (!email) return setAlert(refs.loginAlert, "Digite seu e-mail para redefinir a senha.");

    try {
      await sendPasswordResetEmail(auth, email);
      setAlert(refs.loginAlert, "Link de redefinição enviado para seu e-mail.", "info");
    } catch (err) {
      setAlert(refs.loginAlert, mapAuthError(err));
    }
  });

  // Logout (sidebar)
  (refs.navLogout || deps._navLogout)?.addEventListener?.("click", async (e) => {
    e?.preventDefault?.();
    await signOut(auth);
  });

  // -------- DASHBOARD / NAV --------
  refs.btnBackToDashboard?.addEventListener("click", () => setView("dashboard"));
  refs.btnBackFromAdmin?.addEventListener("click", () => setView("dashboard"));
  refs.btnBackFromManagerUsers?.addEventListener("click", () => setView("dashboard"));

  // -------- GESTOR: USERS --------
  refs.btnReloadMgrUsers?.addEventListener("click", () => deps.loadManagerUsers());
  refs.mgrUserSearch?.addEventListener("input", () => deps.loadManagerUsers());
  refs.mgrTeamFilter?.addEventListener("change", () => deps.loadManagerUsers());
  refs.btnOpenCreateTech?.addEventListener("click", async () => {
    await deps.loadTeams();
    deps.openCreateTechModal();
  });

  // Modal técnico
  refs.btnCloseCreateTech?.addEventListener("click", () => deps.closeCreateTechModal());
  refs.btnCancelCreateTech?.addEventListener("click", () => deps.closeCreateTechModal());
  refs.btnCreateTech?.addEventListener("click", () => {
    deps.createTech().catch(err => {
      console.error(err);
      setAlert(refs.createTechAlert, "Erro ao salvar: " + (err?.message || err));
    });
  });
  refs.modalCreateTech?.addEventListener("click", (e) => {
    if (e.target?.dataset?.close === "true") deps.closeCreateTechModal();
  });

  
  // Modal feedback técnico
  refs.btnCloseTechFeedback?.addEventListener("click", () => deps.closeTechFeedbackModal());
  refs.btnCancelTechFeedback?.addEventListener("click", () => deps.closeTechFeedbackModal());
  refs.btnSaveTechFeedback?.addEventListener("click", () => {
    deps.saveTechFeedback().catch(err => {
      console.error(err);
      setAlert(refs.techFeedbackAlert, "Erro ao salvar feedback: " + (err?.message || err));
    });
  });
  refs.modalTechFeedback?.addEventListener("click", (e) => {
    if (e.target?.dataset?.close === "true") deps.closeTechFeedbackModal();
  });

// Modal equipes administradas
  refs.btnCloseManagedTeams?.addEventListener("click", () => deps.closeManagedTeamsModal());
  refs.btnCancelManagedTeams?.addEventListener("click", () => deps.closeManagedTeamsModal());
  refs.btnSaveManagedTeams?.addEventListener("click", () => {
    deps.saveManagedTeams().catch(err => {
      console.error(err);
      setAlert(refs.managedTeamsAlert, "Erro ao salvar: " + (err?.message || err));
    });
  });
  refs.modalManagedTeams?.addEventListener("click", (e) => {
    if (e.target?.dataset?.close === "true") deps.closeManagedTeamsModal();
  });

  // -------- COMPANIES (MASTER) --------
  refs.btnReloadCompanies?.addEventListener("click", () => deps.loadCompanies());
  refs.companySearch?.addEventListener("input", () => deps.loadCompanies());
  refs.btnOpenCreateCompany?.addEventListener("click", () => deps.openCreateCompanyModal());

  refs.companyNameEl?.addEventListener("input", () => {
    const slug = slugify(refs.companyNameEl.value);
    if (!refs.companyIdEl.value.trim() || refs.companyIdEl.dataset.auto !== "false"){
      refs.companyIdEl.value = slug;
      refs.companyIdEl.dataset.auto = "true";
    }
  });
  refs.companyIdEl?.addEventListener("input", () => {
    refs.companyIdEl.dataset.auto = "false";
  });

  refs.btnCloseCreateCompany?.addEventListener("click", () => deps.closeCreateCompanyModal());
  refs.btnCancelCreateCompany?.addEventListener("click", () => deps.closeCreateCompanyModal());
  refs.btnCreateCompany?.addEventListener("click", () => {
    deps.createCompany().catch(err => {
      console.error(err);
      setAlert(refs.createCompanyAlert, "Erro ao salvar: " + (err?.message || err));
    });
  });

  refs.modalCreateCompany?.addEventListener("click", (e) => {
    if (e.target?.dataset?.close === "true") deps.closeCreateCompanyModal();
  });

  refs.modalCompanyDetail?.addEventListener("click", (e) => {
    if (e.target?.dataset?.close === "true") deps.closeCompanyDetailModal();
  });

  refs.btnCloseCompanyDetail?.addEventListener("click", () => deps.closeCompanyDetailModal());

  // -------- TEAMS --------
  refs.btnReloadTeams?.addEventListener("click", () => deps.loadTeams());
  refs.teamSearch?.addEventListener("input", () => deps.loadTeams());
  refs.btnOpenCreateTeam?.addEventListener("click", () => deps.openCreateTeamModal());

  refs.teamNameEl?.addEventListener("input", () => {
    const slug = slugify(refs.teamNameEl.value);
    if (!refs.teamIdEl.value.trim() || refs.teamIdEl.dataset.auto !== "false"){
      refs.teamIdEl.value = slug;
      refs.teamIdEl.dataset.auto = "true";
    }
  });
  refs.teamIdEl?.addEventListener("input", () => {
    refs.teamIdEl.dataset.auto = "false";
  });

  refs.btnCloseCreateTeam?.addEventListener("click", () => deps.closeCreateTeamModal());
  refs.btnCancelCreateTeam?.addEventListener("click", () => deps.closeCreateTeamModal());
  refs.btnCreateTeam?.addEventListener("click", () => {
    deps.createTeam().catch(err => {
      console.error(err);
      setAlert(refs.createTeamAlert, "Erro ao salvar: " + (err?.message || err));
    });
  });

  refs.modalCreateTeam?.addEventListener("click", (e) => {
    if (e.target?.dataset?.close === "true") deps.closeCreateTeamModal();
  });

  // -------- USERS (ADMIN EMPRESA) --------
  refs.btnReloadUsers?.addEventListener("click", () => deps.loadUsers());
  refs.userSearch?.addEventListener("input", () => deps.loadUsers());
  refs.userRoleFilter?.addEventListener("change", () => { deps.loadUsers(); });
  refs.btnOpenCreateUser?.addEventListener("click", async () => {
    await deps.loadTeams(); // garante chips
    deps.openCreateUserModal();
  });

  refs.btnCloseCreateUser?.addEventListener("click", () => deps.closeCreateUserModal());
  refs.btnCancelCreateUser?.addEventListener("click", () => deps.closeCreateUserModal());
  refs.btnCreateUser?.addEventListener("click", () => {
    deps.createUser().catch(err => {
      console.error(err);
      setAlert(refs.createUserAlert, "Erro ao salvar: " + (err?.message || err));
    });
  });

  refs.modalCreateUser?.addEventListener("click", (e) => {
    if (e.target?.dataset?.close === "true") deps.closeCreateUserModal();
  });
}
