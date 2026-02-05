// public/src/domain/companies.domain.js
// Lógica de negócio para gerenciamento de empresas (Master Admin)

import { doc, getDoc, collection, getDocs, updateDoc, writeBatch, query } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { show, hide, escapeHtml } from "../utils/dom.js";
import { setAlert, clearAlert, showInlineAlert, clearInlineAlert } from "../ui/alerts.js";
import { setView } from "../ui/router.js";
import { listCompaniesDocs } from "../services/companies.service.js";
import { isEmailValidBasic, isCnpjValidBasic } from "../utils/validators.js";
import { normalizePhone, normalizeCnpj } from "../utils/format.js";

/** =========================
 *  COMPANIES DOMAIN
 *  ========================= */

export function openCompaniesView(deps) {
  const { loadCompanies } = deps;
  setView("companies");
  loadCompanies().catch(err => {
    console.error(err);
    alert("Erro ao carregar empresas: " + (err?.message || err));
  });
}

export async function loadCompanies(deps) {
  const { refs, openCompanyDetailModal } = deps;
  
  if (!refs.companiesGrid) return;
  refs.companiesGrid.innerHTML = "";
  hide(refs.companiesEmpty);

  const all = await listCompaniesDocs();

  const qtxt = (refs.companySearch?.value || "").toLowerCase().trim();
  const filtered = !qtxt ? all : all.filter(c =>
    (c.name || "").toLowerCase().includes(qtxt) ||
    (c.cnpj || "").toLowerCase().includes(qtxt) ||
    (c.id || "").toLowerCase().includes(qtxt)
  );

  if (filtered.length === 0) {
    show(refs.companiesEmpty);
    return;
  }

  for (const c of filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""))) {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <h3 class="title">${c.name || c.id}</h3>
      <p class="desc">CNPJ: <b>${c.cnpj || "-"}</b></p>
      <div class="meta">
        <span class="badge">ID: ${c.id}</span>
        <span class="badge">${c.active === false ? "Inativa" : "Ativa"}</span>
      </div>
    `;
    el.style.cursor = "pointer";
    el.addEventListener("click", () => openCompanyDetailModal(c.id));
    refs.companiesGrid.appendChild(el);
  }
}

export function clearCompanyCreateSuccess() {
  const el = document.getElementById("createCompanySuccess");
  if (!el) return;
  el.hidden = true;
  el.innerHTML = "";
}

export function showCompanyCreateSuccess({ adminEmail, uid, resetLink } = {}) {
  const el = document.getElementById("createCompanySuccess");
  if (!el) return;

  const email = (adminEmail || "").trim();
  const safeEmail = (typeof escapeHtml === "function") ? escapeHtml(email) : email;

  let html = `<div><strong>Empresa criada com sucesso ✅</strong></div>`;
  if (safeEmail) html += `<div style="margin-top:6px">Admin: <strong>${safeEmail}</strong></div>`;

  if (resetLink) {
    const safeLink = (typeof escapeHtml === "function") ? escapeHtml(resetLink) : resetLink;
    html += `<div style="margin-top:6px"><a href="${safeLink}" target="_blank" rel="noopener">Definir senha do Admin</a></div>`;
  } else if (uid) {
    const safeUid = (typeof escapeHtml === "function") ? escapeHtml(uid) : uid;
    html += `<div style="margin-top:6px; opacity:.8">UID do Admin: ${safeUid}</div>`;
  }

  el.hidden = false;
  el.innerHTML = html;
}

export function closeCreateCompanyModal(refs) {
  if (refs.modalCreateCompany) refs.modalCreateCompany.hidden = true;
}

export function closeCompanyDetailModal(deps) {
  const { refs, currentCompanyDetailId } = deps;
  if (!refs.modalCompanyDetail) return;
  refs.modalCompanyDetail.hidden = true;
  deps.currentCompanyDetailId = null;
  if (refs.companyUsersTbody) refs.companyUsersTbody.innerHTML = "";
}

export function openCreateCompanyModal(deps) {
  const { state, refs } = deps;
  if (!state.isSuperAdmin) return;
  if (!refs.modalCreateCompany) return;

  clearAlert(refs.createCompanyAlert);
  clearCompanyCreateSuccess();

  if (refs.companyNameEl) refs.companyNameEl.value = "";
  if (refs.companyCnpjEl) refs.companyCnpjEl.value = "";
  if (refs.companyIdEl) refs.companyIdEl.value = "";
  if (refs.adminNameEl) refs.adminNameEl.value = "";
  if (refs.adminEmailEl) refs.adminEmailEl.value = "";
  if (refs.adminPhoneEl) refs.adminPhoneEl.value = "";
  if (refs.adminActiveEl) refs.adminActiveEl.value = "true";

  refs.modalCreateCompany.hidden = false;
}

export async function openCompanyDetailModal(companyId, deps) {
  const { state, refs, loadCompanyDetail } = deps;
  if (!state.isSuperAdmin) return;
  if (!refs.modalCompanyDetail) return;

  clearInlineAlert(refs.companyUsersAlert);
  if (refs.companyUsersTbody) refs.companyUsersTbody.innerHTML = "";
  if (refs.companyUsersEmpty) refs.companyUsersEmpty.hidden = true;

  refs.modalCompanyDetail.hidden = false;
  deps.currentCompanyDetailId = companyId;
  await loadCompanyDetail(companyId);
}

export async function loadCompanyDetail(companyId, deps) {
  const { state, refs, db, renderCompanyUsersTable, toggleCompanyBlock } = deps;
  if (!state.isSuperAdmin) return;

  try {
    const cRef = doc(db, "companies", companyId);
    const cSnap = await getDoc(cRef);
    if (!cSnap.exists()) {
      showInlineAlert(refs.companyUsersAlert, "Empresa não encontrada.", "error");
      return;
    }
    const cData = cSnap.data();
    const active = cData.active === true;

    if (refs.companyDetailTitle) refs.companyDetailTitle.textContent = cData.name || companyId;
    if (refs.companyDetailMeta) refs.companyDetailMeta.textContent = `CNPJ: ${cData.cnpj || "-"} • ID: ${companyId}`;
    if (refs.companyDetailStatus) {
      refs.companyDetailStatus.textContent = active ? "ATIVA" : "BLOQUEADA";
      refs.companyDetailStatus.className = `badge ${active ? "badge-success" : "badge-danger"}`;
    }
    if (refs.btnToggleCompanyBlock) {
      refs.btnToggleCompanyBlock.textContent = active ? "Bloquear empresa" : "Desbloquear empresa";
      refs.btnToggleCompanyBlock.className = active ? "btn btn-danger" : "btn btn-secondary";
      refs.btnToggleCompanyBlock.onclick = () => toggleCompanyBlock(companyId, active);
    }

    const uCol = collection(db, "companies", companyId, "users");
    const uSnap = await getDocs(uCol);
    const users = [];
    uSnap.forEach(d => users.push({ id: d.id, ...d.data() }));
    users.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    renderCompanyUsersTable(companyId, users);
  } catch (err) {
    console.error("Erro ao carregar detalhes da empresa:", err);
    showInlineAlert(refs.companyUsersAlert, "Erro ao carregar detalhes da empresa.", "error");
  }
}

export function renderCompanyUsersTable(companyId, users, deps) {
  const { refs, setCompanyUserActive, setCompanyUserRole, loadCompanyDetail } = deps;
  if (!refs.companyUsersTbody) return;
  refs.companyUsersTbody.innerHTML = "";

  if (!users || users.length === 0) {
    if (refs.companyUsersEmpty) refs.companyUsersEmpty.hidden = false;
    return;
  }
  if (refs.companyUsersEmpty) refs.companyUsersEmpty.hidden = true;

  for (const u of users) {
    const active = u.active === true;
    const role = u.role || "tecnico";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="cell-main">${escapeHtml(u.name || "(sem nome)")}</div>
        <div class="cell-sub">${escapeHtml(u.id)}</div>
      </td>
      <td>${escapeHtml(u.email || "-")}</td>
      <td>${escapeHtml(u.phone || "-")}</td>
      <td>
        <select class="input small js-role">
          ${["admin", "gestor", "coordenador", "tecnico"].map(r => `<option value="${r}" ${r === role ? "selected" : ""}>${r}</option>`).join("")}
        </select>
      </td>
      <td>
        <span class="badge ${active ? "badge-success" : "badge-danger"}">${active ? "ATIVO" : "BLOQUEADO"}</span>
      </td>
      <td class="actions">
        <button class="btn btn-ghost js-toggle">${active ? "Bloquear" : "Desbloquear"}</button>
        <button class="btn btn-ghost js-save">Salvar perfil</button>
      </td>
    `;

    const btnToggle = tr.querySelector(".js-toggle");
    const selRole = tr.querySelector(".js-role");
    const btnSave = tr.querySelector(".js-save");

    btnToggle.addEventListener("click", async (e) => {
      e.preventDefault();
      await setCompanyUserActive(companyId, u.id, !active);
      await loadCompanyDetail(companyId);
    });

    btnSave.addEventListener("click", async (e) => {
      e.preventDefault();
      const newRole = selRole.value;
      await setCompanyUserRole(companyId, u.id, newRole);
      await loadCompanyDetail(companyId);
    });

    refs.companyUsersTbody.appendChild(tr);
  }

  if (refs.companyUsersEmpty) {
    refs.companyUsersEmpty.style.display = users.length ? "none" : "block";
  }
}

export async function setCompanyUserActive(companyId, uid, active, deps) {
  const { state, refs, db } = deps;
  if (!state.isSuperAdmin) return;
  try {
    const uRef = doc(db, "companies", companyId, "users", uid);
    await updateDoc(uRef, { active: !!active });
  } catch (err) {
    console.error("Erro ao atualizar usuário:", err);
    showInlineAlert(refs.companyUsersAlert, "Não foi possível atualizar o usuário.", "error");
  }
}

export async function setCompanyUserRole(companyId, uid, role, deps) {
  const { state, refs, db } = deps;
  if (!state.isSuperAdmin) return;
  try {
    if (!["admin", "gestor", "coordenador", "tecnico"].includes(role)) return;
    const uRef = doc(db, "companies", companyId, "users", uid);
    await updateDoc(uRef, { role });
  } catch (err) {
    console.error("Erro ao trocar perfil:", err);
    showInlineAlert(refs.companyUsersAlert, "Não foi possível trocar o perfil.", "error");
  }
}

export async function toggleCompanyBlock(companyId, currentlyActive, deps) {
  const { state, refs, db, loadCompanyDetail, loadCompanies } = deps;
  if (!state.isSuperAdmin) return;
  try {
    const cRef = doc(db, "companies", companyId);

    if (currentlyActive) {
      const uCol = collection(db, "companies", companyId, "users");
      const uSnap = await getDocs(query(uCol));
      const batch = writeBatch(db);
      batch.update(cRef, { active: false });

      uSnap.forEach(d => {
        batch.update(d.ref, { active: false });
      });

      await batch.commit();
      showInlineAlert(refs.companyUsersAlert, "Empresa bloqueada e usuários bloqueados.", "success");
    } else {
      await updateDoc(cRef, { active: true });
      showInlineAlert(refs.companyUsersAlert, "Empresa desbloqueada. (Usuários permanecem com o status atual.)", "success");
    }

    await loadCompanyDetail(companyId);
    if (typeof loadCompanies === "function") loadCompanies();
  } catch (err) {
    console.error("Erro ao bloquear/desbloquear empresa:", err);
    showInlineAlert(refs.companyUsersAlert, "Não foi possível alterar o status da empresa.", "error");
  }
}

export async function createCompany(deps) {
  const { refs, auth, callHttpFunctionWithAuth, loadCompanies } = deps;
  clearAlert(refs.createCompanyAlert);

  try {
    if (!auth.currentUser) {
      return setAlert(refs.createCompanyAlert, "Você precisa estar logado como Admin Master.");
    }

    await auth.currentUser.getIdToken(true);

    const companyId = (refs.companyIdEl?.value || "").trim();
    const companyName = (refs.companyNameEl?.value || "").trim();
    const cnpj = (refs.companyCnpjEl?.value || "").trim();

    const adminName = (refs.adminNameEl?.value || "").trim();
    const adminEmail = (refs.adminEmailEl?.value || "").trim();
    const adminPhone = (refs.adminPhoneEl?.value || "").trim();
    const adminActive = (refs.adminActiveEl?.value || "true") === "true";

    if (!companyId) return setAlert(refs.createCompanyAlert, "Informe o ID da empresa (slug).");
    if (!companyName) return setAlert(refs.createCompanyAlert, "Informe o nome da empresa.");
    if (!cnpj || !isCnpjValidBasic(cnpj)) return setAlert(refs.createCompanyAlert, "Informe um CNPJ válido (14 dígitos).");
    if (!adminName) return setAlert(refs.createCompanyAlert, "Informe o nome do Admin da empresa.");
    if (!adminEmail || !isEmailValidBasic(adminEmail)) return setAlert(refs.createCompanyAlert, "Informe um e-mail válido para o Admin.");

    setAlert(refs.createCompanyAlert, "Criando empresa e Admin...", "info");

    const payload = {
      companyId,
      companyName,
      cnpj: normalizeCnpj(cnpj),
      admin: {
        name: adminName,
        email: adminEmail,
        phone: normalizePhone(adminPhone),
        active: adminActive
      }
    };

    const data = await callHttpFunctionWithAuth("createCompanyWithAdminHttp", payload);

    const uid = data?.uid;
    const resetLink = data?.resetLink;
    await loadCompanies();

    clearAlert(refs.createCompanyAlert);
    showCompanyCreateSuccess({ adminEmail, uid, resetLink });

  } catch (err) {
    console.error("Erro ao criar empresa:", err);
    clearCompanyCreateSuccess();
    setAlert(refs.createCompanyAlert, err?.message || "Erro ao criar empresa");
  }
}
