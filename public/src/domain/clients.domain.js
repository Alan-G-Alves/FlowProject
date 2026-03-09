/**
 * clients.domain.js
 * Cadastro de Clientes (multi-tenant: companies/{companyId}/clients)
 *
 * Regras:
 * - Perfis que podem gerenciar clientes: admin, gestor, coordenador (mesmo grupo de "gerenciar usuários")
 * - UI/UX espelhada da tela de Técnicos
 */

import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

import { show, hide } from "../utils/dom.js";
import { setAlert, clearAlert } from "../ui/alerts.js";

// =====================
// Helpers
// =====================
const ITEMS_PER_PAGE = 20;

function normalizeText(v){
  return (v || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function splitTerms(q){
  const s = normalizeText(q);
  if (!s) return [];
  return s.split(/\s+/).filter(Boolean);
}

function esc(s){
  return (s ?? "").toString()
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

function canManageClients(state){
  const role = (state?.profile?.role || "").toString();
  return ["admin","gestor","coordenador"].includes(role) || !!state?.isSuperAdmin;
}

function initials(name){
  const s = (name || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/);
  const a = parts[0]?.[0] || "";
  const b = parts.length > 1 ? (parts[parts.length-1]?.[0] || "") : "";
  return (a + b).toUpperCase();
}

async function computeNextClientNumber(db, companyId){
  // Estratégia simples (igual projects.domain): busca o maior "number" e soma +1.
  let next = 1;
  try{
    const snap = await getDocs(collection(db, "companies", companyId, "clients"));
    let maxNum = 0;
    snap.forEach(d => {
      const data = d.data() || {};
      const n = data.number ?? data.clientNumber ?? data.seq ?? data.codeNumber;
      const nn = (typeof n === "number") ? n : Number(String(n || "").replace(/[^0-9]/g,""));
      if (!Number.isNaN(nn)) maxNum = Math.max(maxNum, nn);
    });
    next = maxNum + 1;
  }catch(e){
    console.warn("[clients] computeNextClientNumber falhou:", e);
  }
  return next;
}

async function uploadClientPhoto(deps, companyId, clientId, file){
  const { storage } = deps;
  if (!storage || !file) return "";
  const maxMb = 2;
  if (file.size > maxMb * 1024 * 1024) throw new Error("A foto deve ter no máximo 2MB.");
  if (!String(file.type || "").startsWith("image/")) throw new Error("Arquivo inválido. Envie uma imagem.");

  const path = `clientPhotos/${companyId}/${clientId}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type || "image/jpeg" });
  return await getDownloadURL(ref);
}

// =====================
// View entry points
// =====================

/**
 * Garante que o cache de clientes esteja carregado (sem acoplar com UI).
 * Útil para outras telas, como "Criar Projeto", que precisam listar clientes.
 */
export async function ensureClientsCache(deps, { force = false } = {}) {
  const { state, db } = deps || {};
  const companyId = state?.companyId;
  if (!db || !companyId) return [];

  // Se já carregou uma vez (mesmo vazio), não refaz chamada a menos que force=true
  if (!force && state._clientsCacheLoaded) {
    return Array.isArray(state._clientsCache) ? state._clientsCache : [];
  }
  if (!force && Array.isArray(state._clientsCache) && state._clientsCache.length) {
    state._clientsCacheLoaded = true;
    return state._clientsCache;
  }

  try {
    const snap = await getDocs(collection(db, "companies", companyId, "clients"));
    const all = [];
    snap.forEach((d) => all.push({ id: d.id, ...d.data() }));
    state._clientsCache = all;
    const byId = {};
    for (const c of all) byId[c.id] = c;
    state._clientsById = byId;
    state._clientsCacheLoaded = true;
    return all;
  } catch (e) {
    console.warn("[clients] ensureClientsCache falhou:", e);
    state._clientsCacheLoaded = true; // evita loop infinito de tentativas em modais
    state._clientsCache = state._clientsCache || [];
    return state._clientsCache;
  }
}

export function openClientsView(deps){
  const { setView } = deps;
  setView?.("clients");
  loadClients(deps);
}

export async function loadClients(deps){
  const { refs, state, db } = deps;

  if (!refs.viewClients) return;

  // Guard de permissão
  if (!canManageClients(state)){
    alert("Acesso restrito.");
    return;
  }

  state._clientsLoadSeq = (state._clientsLoadSeq || 0) + 1;
  const mySeq = state._clientsLoadSeq;

  // bind listeners 1x
  bindClientsUiOnce(deps);

  // loading (simples): limpa tabela
  if (refs.clientsTbody) refs.clientsTbody.innerHTML = "";
  hide(refs.clientsEmpty);
  if (refs.clientsPagination) refs.clientsPagination.innerHTML = "";

  const companyId = state.companyId;
  if (!companyId) return;

  const snap = await getDocs(collection(db, "companies", companyId, "clients"));
  if (mySeq !== state._clientsLoadSeq) return;

  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // cache
  state._clientsCache = all;
  state._clientsCacheLoaded = true;
  const byId = {};
  for (const c of all) byId[c.id] = c;
  state._clientsById = byId;

  renderClientsTable(deps);
}

function bindClientsUiOnce(deps){
  const { refs, state } = deps;
  if (state._clientsUiBound) return;
  state._clientsUiBound = true;

  refs.btnOpenCreateClient?.addEventListener("click", (e) => {
    e.preventDefault();
    openCreateClientModal(deps);
  });

  refs.clientsSearch?.addEventListener("input", () => {
    state._clientsPage = 1;
    renderClientsTable(deps);
  });

  refs.btnClearClientsSearch?.addEventListener("click", (e) => {
    e.preventDefault();
    if (refs.clientsSearch) refs.clientsSearch.value = "";
    state._clientsPage = 1;
    renderClientsTable(deps);
  });

  // Ações por delegação
  refs.clientsTbody?.addEventListener("click", async (ev) => {
    const btn = ev.target?.closest?.("[data-act]");
    if (!btn) return;

    const act = btn.getAttribute("data-act");
    const tr = btn.closest("tr");
    const clientId = tr?.dataset?.id || "";
    if (!clientId) return;

    const client = (state._clientsById || {})[clientId] || (state._clientsCache || []).find(c => c.id === clientId);
    if (!client) return;

    if (act === "edit"){
      openCreateClientModal(deps, { mode: "edit", client });
      return;
    }

    if (act === "view"){
      openCreateClientModal(deps, { mode: "view", client });
      return;
    }

    if (act === "toggle"){
      await toggleClientActive(deps, clientId, !!client.active);
      return;
    }

    if (act === "projects"){
      await openClientProjectsModal(deps, client);
      return;
    }
  });

  // modal create client close/cancel
  refs.btnCloseCreateClient?.addEventListener("click", (e) => { e.preventDefault(); closeCreateClientModal(deps); });
  refs.btnCancelCreateClient?.addEventListener("click", (e) => { e.preventDefault(); closeCreateClientModal(deps); });

  refs.clientPhotoFile?.addEventListener("change", () => {
    syncClientPhotoPreview(deps);
  });

  refs.btnClientRemovePhoto?.addEventListener("click", (e) => {
    e.preventDefault();
    if (refs.clientPhotoFile) refs.clientPhotoFile.value = "";
    if (refs.clientPhotoUrl) refs.clientPhotoUrl.value = "";
    syncClientPhotoPreview(deps, { clear: true });
  });

  refs.btnCreateClient?.addEventListener("click", async (e) => {
    e.preventDefault();
    await saveClientFromModal(deps);
  });

  // modal projects close
  refs.btnCloseClientProjects?.addEventListener("click", (e) => { e.preventDefault(); closeClientProjectsModal(deps); });
  refs.btnCancelClientProjects?.addEventListener("click", (e) => { e.preventDefault(); closeClientProjectsModal(deps); });
}

function renderClientsTable(deps){
  const { refs, state } = deps;

  const list = Array.isArray(state._clientsCache) ? state._clientsCache.slice() : [];
  const q = refs.clientsSearch?.value || "";
  const terms = splitTerms(q);

  const filtered = list.filter(c => {
    if (!terms.length) return true;
    const hay = normalizeText([
      c.number, c.name, c.cpfCnpj, c.email, c.phone, c.address,
      c.keyUserName, c.keyUserEmail, c.keyUserPhone
    ].filter(Boolean).join(" "));
    return terms.every(t => hay.includes(t));
  });

  // index by id (para delegação)
  const byId = {};
  for (const c of filtered) byId[c.id] = c;
  state._clientsById = byId;

  if (filtered.length === 0){
    if (refs.clientsTbody) refs.clientsTbody.innerHTML = "";
    show(refs.clientsEmpty);
    if (refs.clientsPagination) refs.clientsPagination.innerHTML = "";
    return;
  }
  hide(refs.clientsEmpty);

  // Paginação
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  state._clientsPage = Math.min(Math.max(1, Number(state._clientsPage || 1)), totalPages);

  const startIdx = (state._clientsPage - 1) * ITEMS_PER_PAGE;
  const pageItems = filtered.slice(startIdx, startIdx + ITEMS_PER_PAGE);

  if (refs.clientsPagination){
    const cur = state._clientsPage;
    const windowSize = 7;
    const half = Math.floor(windowSize / 2);
    let from = Math.max(1, cur - half);
    let to = Math.min(totalPages, from + windowSize - 1);
    from = Math.max(1, to - windowSize + 1);

    const parts = [];
    const mkBtn = (label, page, disabled, cls = "") => {
      const dis = disabled ? "disabled" : "";
      return `<button class="page-btn ${cls}" data-page="${page}" ${dis}>${label}</button>`;
    };

    parts.push(`<div class="page-meta"><span>Mostrando <b>${Math.min(startIdx + pageItems.length, filtered.length)}</b> de <b>${filtered.length}</b></span></div>`);
    parts.push(`<div class="page-controls">`);
    parts.push(mkBtn("‹", cur - 1, cur <= 1, "nav"));

    if (from > 1) {
      parts.push(mkBtn("1", 1, false, (cur === 1 ? "active" : "")));
      if (from > 2) parts.push(`<span class="page-ellipsis">…</span>`);
    }

    for (let p = from; p <= to; p++) {
      parts.push(mkBtn(String(p), p, false, (p === cur ? "active" : "")));
    }

    if (to < totalPages) {
      if (to < totalPages - 1) parts.push(`<span class="page-ellipsis">…</span>`);
      parts.push(mkBtn(String(totalPages), totalPages, false, (cur === totalPages ? "active" : "")));
    }

    parts.push(mkBtn("›", cur + 1, cur >= totalPages, "nav"));
    parts.push(`</div>`);

    refs.clientsPagination.innerHTML = parts.join("");

    // bind page buttons
    refs.clientsPagination.querySelectorAll("button[data-page]").forEach(b => {
      b.addEventListener("click", () => {
        const p = Number(b.getAttribute("data-page") || "1");
        if (!Number.isFinite(p)) return;
        state._clientsPage = p;
        renderClientsTable(deps);
      });
    });
  }

  // Render rows
  const rows = pageItems.map(c => renderClientRow(c)).join("");
  if (refs.clientsTbody) refs.clientsTbody.innerHTML = rows;
}

function renderClientRow(c){
  const isActive = c.active !== false;
  const statusLabel = isActive ? "Ativo" : "Bloqueado";
  const photo = (c.photoURL || "").trim();
  const name = c.name || "";
  const keyUser = c.keyUserName || "—";
  const projectsCount = Number(c.projectsCount || 0); // (opcional) cache futuro

  return `
    <tr data-id="${esc(c.id)}">
      <td>${esc(c.number ?? "")}</td>
      <td>
        <div class="cell-user">
          <div class="avatar sm">
            ${photo ? `<img alt="" src="${esc(photo)}" />` : `<span>${esc(initials(name))}</span>`}
          </div>
          <div class="cell-user-meta">
            <div class="cell-user-name">${esc(name)}</div>
            <div class="cell-user-sub muted">${esc(c.cpfCnpj || "")}</div>
          </div>
        </div>
      </td>
      <td>${esc(keyUser)}</td>
      <td>
        <button class="btn sm feedback-badge" data-act="projects" title="Ver projetos">
          ${projectsCount}
        </button>
      </td>
      <td><span class="badge small status-pill ${isActive ? "status-active" : "status-inactive"}">${statusLabel}</span></td>
      <td>
        <div class="table-actions">
          <button class="icon-btn xs btn-edit" data-act="edit" title="Editar" aria-label="Editar">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="icon-btn xs btn-view" data-act="view" title="Visualizar" aria-label="Visualizar">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1.5 12s3.5-7 10.5-7 10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="icon-btn xs ${isActive ? "btn-block" : "btn-activate"}" data-act="toggle" title="${isActive ? "Bloquear" : "Ativar"}" aria-label="${isActive ? "Bloquear" : "Ativar"}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2v10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M7.5 4.5a8 8 0 1 0 9 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  `;
}

async function toggleClientActive(deps, clientId, isActive){
  const { db, state } = deps;
  const companyId = state.companyId;
  if (!companyId) return;

  const ref = doc(db, "companies", companyId, "clients", clientId);
  await updateDoc(ref, {
    active: !isActive,
    updatedAt: serverTimestamp(),
    updatedBy: deps?.auth?.currentUser?.uid || ""
  });

  // atualiza cache local
  const list = Array.isArray(state._clientsCache) ? state._clientsCache : [];
  const idx = list.findIndex(x => x.id === clientId);
  if (idx >= 0) list[idx].active = !isActive;

  renderClientsTable(deps);
}

function setClientModalMode(deps, mode, client){
  const { refs, state } = deps;
  const isEdit = mode === "edit";
  const isView = mode === "view";

  state._clientsModalMode = mode;
  state._editingClientId = (isEdit || isView) ? (client?.id || "") : null;

  if (refs.btnCreateClient){
    refs.btnCreateClient.textContent = isEdit ? "Salvar alterações" : "Salvar";
    refs.btnCreateClient.style.display = isView ? "none" : "";
  }

  const disableAll = isView;
  const setDisabled = (el, v) => { if (el) el.disabled = v; };

  setDisabled(refs.clientNameEl, disableAll);
  setDisabled(refs.clientCpfCnpjEl, disableAll);
  setDisabled(refs.clientAddressEl, disableAll);
  setDisabled(refs.clientPhoneEl, disableAll);
  setDisabled(refs.clientEmailEl, disableAll);
  setDisabled(refs.clientKeyUserNameEl, disableAll);
  setDisabled(refs.clientKeyUserEmailEl, disableAll);
  setDisabled(refs.clientKeyUserPhoneEl, disableAll);
  setDisabled(refs.clientActiveEl, disableAll);
  setDisabled(refs.clientPhotoFile, disableAll);
  if (refs.btnClientRemovePhoto) refs.btnClientRemovePhoto.style.display = isView ? "none" : "";

  // ID sempre readonly
  if (refs.clientIdEl){
    refs.clientIdEl.readOnly = true;
  }
}

export function openCreateClientModal(deps, opts = {}){
  const { refs, state } = deps;
  if (!refs.modalCreateClient) return;

  clearAlert(refs.createClientAlert);

  const mode = opts.mode || "create";
  const client = opts.client || null;

  setClientModalMode(deps, mode, client);

  if (refs.clientIdEl) refs.clientIdEl.value = client?.number ? String(client.number) : "";
  if (refs.clientNameEl) refs.clientNameEl.value = client?.name || "";
  if (refs.clientCpfCnpjEl) refs.clientCpfCnpjEl.value = client?.cpfCnpj || "";
  if (refs.clientAddressEl) refs.clientAddressEl.value = client?.address || "";
  if (refs.clientPhoneEl) refs.clientPhoneEl.value = client?.phone || "";
  if (refs.clientEmailEl) refs.clientEmailEl.value = client?.email || "";
  if (refs.clientKeyUserNameEl) refs.clientKeyUserNameEl.value = client?.keyUserName || "";
  if (refs.clientKeyUserEmailEl) refs.clientKeyUserEmailEl.value = client?.keyUserEmail || "";
  if (refs.clientKeyUserPhoneEl) refs.clientKeyUserPhoneEl.value = client?.keyUserPhone || "";
  if (refs.clientActiveEl) refs.clientActiveEl.checked = client ? (client.active !== false) : true;

  if (refs.clientPhotoUrl) refs.clientPhotoUrl.value = client?.photoURL || "";
  if (refs.clientPhotoFile) refs.clientPhotoFile.value = "";

  syncClientPhotoPreview(deps);

  refs.modalCreateClient.hidden = false;
}

export function closeCreateClientModal(deps){
  const { refs } = deps;
  if (!refs.modalCreateClient) return;
  refs.modalCreateClient.hidden = true;
}

function syncClientPhotoPreview(deps, { clear=false } = {}){
  const { refs } = deps;
  const file = refs.clientPhotoFile?.files?.[0] || null;
  let url = (refs.clientPhotoUrl?.value || "").trim();

  if (clear) url = "";

  const imgEl = refs.clientPhotoImg;
  const fallbackEl = refs.clientPhotoFallback;

  // Helper: show/hide
  const showImg = (src) => {
    if (imgEl){
      imgEl.src = src;
      imgEl.hidden = false;
      // CSS do projeto escondia a imagem (display:none); força inline para garantir preview
      imgEl.style.display = "block";
    }
    if (fallbackEl){
      fallbackEl.hidden = true;
      fallbackEl.style.display = "none";
    }
  };

  const showFallback = () => {
    if (imgEl){
      imgEl.src = "";
      imgEl.hidden = true;
      imgEl.style.display = "none";
    }
    if (fallbackEl){
      fallbackEl.hidden = false;
      fallbackEl.style.display = "flex";
    }
  };

  // Prefer file preview
  if (file){
    const tmp = URL.createObjectURL(file);
    showImg(tmp);
    // não revoga imediatamente; o browser usa enquanto a img carrega
    setTimeout(() => { try { URL.revokeObjectURL(tmp); } catch(_){} }, 30000);
    return;
  }

  // Else URL preview (if any)
  if (url){
    showImg(url);
    return;
  }

  // Nothing selected
  showFallback();
}

async function saveClientFromModal(deps){
  const { refs, state, db, auth } = deps;
  if (!refs.modalCreateClient || refs.modalCreateClient.hidden) return;

  clearAlert(refs.createClientAlert);

  if (!canManageClients(state)){
    setAlert(refs.createClientAlert, "Acesso restrito.", "error");
    return;
  }

  const companyId = state.companyId;
  if (!companyId){
    setAlert(refs.createClientAlert, "Empresa não identificada.", "error");
    return;
  }

  const mode = state._clientsModalMode || "create";
  const isEdit = mode === "edit";
  const clientId = isEdit ? (state._editingClientId || "") : "";

  const name = (refs.clientNameEl?.value || "").trim();
  if (!name){
    setAlert(refs.createClientAlert, "Informe o nome do cliente.", "error");
    return;
  }

  const data = {
    name,
    nameLower: normalizeText(name),
    cpfCnpj: (refs.clientCpfCnpjEl?.value || "").trim(),
    address: (refs.clientAddressEl?.value || "").trim(),
    phone: (refs.clientPhoneEl?.value || "").trim(),
    email: (refs.clientEmailEl?.value || "").trim(),
    keyUserName: (refs.clientKeyUserNameEl?.value || "").trim(),
    keyUserEmail: (refs.clientKeyUserEmailEl?.value || "").trim(),
    keyUserPhone: (refs.clientKeyUserPhoneEl?.value || "").trim(),
    active: !!refs.clientActiveEl?.checked,
    updatedAt: serverTimestamp(),
    updatedBy: auth?.currentUser?.uid || ""
  };

  try{
    let ref;
    let finalId = clientId;

    if (!isEdit){
      // cria doc com id automático
      ref = doc(collection(db, "companies", companyId, "clients"));
      finalId = ref.id;

      const number = await computeNextClientNumber(db, companyId);

      await setDoc(ref, {
        ...data,
        number,
        createdAt: serverTimestamp(),
        createdBy: auth?.currentUser?.uid || "",
        photoURL: "" // pode atualizar depois
      });

      // mostra number no campo ID
      if (refs.clientIdEl) refs.clientIdEl.value = String(number);
    } else {
      ref = doc(db, "companies", companyId, "clients", clientId);
      await updateDoc(ref, data);
    }

    // foto (opcional)
    const file = refs.clientPhotoFile?.files?.[0] || null;
    let photoURL = (refs.clientPhotoUrl?.value || "").trim();

    if (file){
      photoURL = await uploadClientPhoto(deps, companyId, finalId, file);
      await updateDoc(doc(db, "companies", companyId, "clients", finalId), {
        photoURL,
        updatedAt: serverTimestamp(),
        updatedBy: auth?.currentUser?.uid || ""
      });
    }

    // atualiza cache local
    await loadClients(deps);

    closeCreateClientModal(deps);
  }catch(err){
    console.error("[clients] saveClientFromModal error:", err);
    setAlert(refs.createClientAlert, err?.message || "Não foi possível salvar o cliente.", "error");
  }
}

// =====================
// Projetos do Cliente (modal)
// =====================
async function openClientProjectsModal(deps, client){
  const { refs, state, db } = deps;
  if (!refs.modalClientProjects) return;

  // título
  if (refs.clientProjectsTitle){
    refs.clientProjectsTitle.textContent = `Projetos — ${client?.name || ""}`;
  }

  if (refs.clientProjectsTbody) refs.clientProjectsTbody.innerHTML = "";
  hide(refs.clientProjectsEmpty);

  const companyId = state.companyId;
  if (!companyId) return;

  try{
    const qy = query(collection(db, "companies", companyId, "projects"), where("clientId", "==", client.id));
    const snap = await getDocs(qy);
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!items.length){
      show(refs.clientProjectsEmpty);
      refs.modalClientProjects.hidden = false;
      return;
    }

    const rows = items.map(p => {
      const name = p.name || p.title || "";
      const hours = p.totalHours ?? p.hours ?? p.estimatedHours ?? "";
      const value = p.value ?? p.projectValue ?? p.billingValue ?? "";
      const status = p.status || "";
      return `
        <tr>
          <td>${esc(name)}</td>
          <td>${esc(hours === "" ? "—" : hours)}</td>
          <td>${esc(value === "" ? "—" : value)}</td>
          <td>${esc(status || "—")}</td>
        </tr>
      `;
    }).join("");

    if (refs.clientProjectsTbody) refs.clientProjectsTbody.innerHTML = rows;
    refs.modalClientProjects.hidden = false;
  }catch(e){
    console.error("[clients] openClientProjectsModal error:", e);
    show(refs.clientProjectsEmpty);
    refs.modalClientProjects.hidden = false;
  }
}

function closeClientProjectsModal(deps){
  const { refs } = deps;
  if (!refs.modalClientProjects) return;
  refs.modalClientProjects.hidden = true;
}
