import {
  collection,
  getDocs,
  limit,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { hide, show, escapeHtml } from "../utils/dom.js";

let _bound = false;
let _myFeedbacksCache = [];
let _myFeedbacksMode = "received";
let _currentPage = 1;
const NOTE_PREVIEW_LIMIT = 120;
const MY_FEEDBACKS_PAGE_SIZE = 4;

function currentRole(state) {
  return String(state?.profile?.role || "").trim().toLowerCase();
}

function canViewAppliedFeedbacks(state) {
  return ["gestor", "admin", "coordenador"].includes(currentRole(state));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatDateBR(value) {
  if (!value) return "-";
  const raw = String(value).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function scoreTone(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "neutral";
  if (value >= 8) return "good";
  if (value <= 4) return "alert";
  return "mid";
}

function scoreLabel(score) {
  const value = Number(score);
  return Number.isFinite(value) ? String(value) : "-";
}

function avgScore(items) {
  const scores = items.map((item) => Number(item.score)).filter((n) => Number.isFinite(n));
  if (!scores.length) return "0,0";
  const avg = scores.reduce((acc, n) => acc + n, 0) / scores.length;
  return avg.toFixed(1).replace(".", ",");
}

function isLongNote(note) {
  return String(note || "").trim().length > NOTE_PREVIEW_LIMIT;
}

function shortNote(note) {
  const value = String(note || "").trim();
  if (value.length <= NOTE_PREVIEW_LIMIT) return value;
  return `${value.slice(0, NOTE_PREVIEW_LIMIT).trimEnd()}...`;
}

function buildSearchText(item) {
  return normalizeText([
    item.date,
    formatDateBR(item.date),
    item.note,
    item.createdByName,
    item.createdByEmail,
    item.score,
    item.recipientName,
    item.recipientEmail
  ].join(" "));
}

function updateModeUI(refs, state) {
  const appliedAllowed = canViewAppliedFeedbacks(state);
  if (refs.myFeedbacksModeWrap) refs.myFeedbacksModeWrap.hidden = !appliedAllowed;
  refs.btnMyFeedbacksModeReceived?.classList.toggle("is-active", _myFeedbacksMode === "received");
  refs.btnMyFeedbacksModeApplied?.classList.toggle("is-active", _myFeedbacksMode === "applied");

  if (refs.myFeedbacksPageTitle) {
    refs.myFeedbacksPageTitle.textContent = _myFeedbacksMode === "applied" ? "Feedbacks Aplicados" : "Meus Feedbacks";
  }
  if (refs.myFeedbacksPageSubtitle) {
    refs.myFeedbacksPageSubtitle.textContent = _myFeedbacksMode === "applied"
      ? "Acompanhe os feedbacks que voce registrou para a equipe."
      : "Acompanhe suas avaliacoes, reconhecimentos e pontos de evolucao em um painel organizado.";
  }
  if (refs.myFeedbacksSearchInput) {
    refs.myFeedbacksSearchInput.placeholder = _myFeedbacksMode === "applied"
      ? "Nota, destinatario, data ou observacao"
      : "Nota, avaliador, data ou observacao";
  }
  if (refs.myFeedbacksSectionTitle) {
    refs.myFeedbacksSectionTitle.textContent = _myFeedbacksMode === "applied"
      ? "Historico de feedbacks aplicados"
      : "Historico de feedbacks";
  }
}

function updateSummary(refs, items) {
  const total = items.length;
  const positive = items.filter((item) => Number(item.score) >= 8).length;
  const latest = items[0]?.date ? formatDateBR(items[0].date) : "-";

  if (refs.myFeedbacksTotalCount) refs.myFeedbacksTotalCount.textContent = String(total);
  if (refs.myFeedbacksAverageScore) refs.myFeedbacksAverageScore.textContent = avgScore(items);
  if (refs.myFeedbacksPositiveCount) refs.myFeedbacksPositiveCount.textContent = String(positive);
  if (refs.myFeedbacksLatestDate) refs.myFeedbacksLatestDate.textContent = latest;

  if (refs.myFeedbacksHeadline) {
    refs.myFeedbacksHeadline.textContent = _myFeedbacksMode === "applied"
      ? (total
          ? `Voce aplicou ${total} feedback${total > 1 ? "s" : ""} e manteve media ${avgScore(items)} nas notas registradas.`
          : "Voce ainda nao aplicou feedbacks.")
      : (total
          ? `Voce recebeu ${total} feedback${total > 1 ? "s" : ""} e sua media atual e ${avgScore(items)}.`
          : "Voce ainda nao recebeu feedbacks.");
  }
  if (refs.myFeedbacksIntro) {
    refs.myFeedbacksIntro.textContent = _myFeedbacksMode === "applied"
      ? (total
          ? "Use esta visao para revisar orientacoes registradas, reconhecer recorrencias e acompanhar seu historico de avaliacoes aplicadas."
          : "Quando voce registrar feedbacks para a equipe, eles aparecerao aqui em uma linha do tempo simples.")
      : (total
          ? "Use este historico para acompanhar percepcoes recorrentes, celebracoes e orientacoes do seu desenvolvimento."
          : "Quando novos feedbacks forem registrados para o seu usuario, eles aparecerao aqui com um resumo elegante.");
  }
  if (refs.myFeedbacksEmptyTitle) {
    refs.myFeedbacksEmptyTitle.textContent = _myFeedbacksMode === "applied"
      ? "Nenhum feedback aplicado encontrado"
      : "Nenhum feedback encontrado";
  }
  if (refs.myFeedbacksEmptyText) {
    refs.myFeedbacksEmptyText.textContent = _myFeedbacksMode === "applied"
      ? "Assim que voce registrar feedbacks para a equipe, eles aparecerao aqui."
      : "Assim que um gestor ou administrador registrar um feedback para voce, ele aparecera aqui.";
  }
}

function getPageSlice(items) {
  const totalPages = Math.max(1, Math.ceil(items.length / MY_FEEDBACKS_PAGE_SIZE));
  _currentPage = Math.min(Math.max(1, Number(_currentPage || 1)), totalPages);
  const startIndex = (_currentPage - 1) * MY_FEEDBACKS_PAGE_SIZE;
  return {
    totalPages,
    pageItems: items.slice(startIndex, startIndex + MY_FEEDBACKS_PAGE_SIZE),
    startRow: items.length ? startIndex + 1 : 0,
    endRow: Math.min(items.length, startIndex + MY_FEEDBACKS_PAGE_SIZE)
  };
}

function renderPagination(refs, items) {
  if (!refs.myFeedbacksPagination) return;
  const { totalPages, startRow, endRow } = getPageSlice(items);
  refs.myFeedbacksPagination.hidden = items.length === 0;
  refs.myFeedbacksPagination.innerHTML = items.length ? `
    <span>${escapeHtml(String(startRow))}-${escapeHtml(String(endRow))} de ${escapeHtml(String(items.length))} feedback${items.length > 1 ? "s" : ""}</span>
    <div>
      <button type="button" data-my-feedbacks-page="prev" ${_currentPage <= 1 ? "disabled" : ""}>Anterior</button>
      <strong>Pagina ${escapeHtml(String(_currentPage))} de ${escapeHtml(String(totalPages))}</strong>
      <button type="button" data-my-feedbacks-page="next" ${_currentPage >= totalPages ? "disabled" : ""}>Proxima</button>
    </div>
  ` : "";
}

function renderList(refs, items) {
  if (!refs.myFeedbacksList) return;
  refs.myFeedbacksList.innerHTML = "";
  renderPagination(refs, items);
  const { pageItems } = getPageSlice(items);

  if (!pageItems.length) {
    if (refs.myFeedbacksListMeta) refs.myFeedbacksListMeta.textContent = "0 feedbacks encontrados";
    show(refs.myFeedbacksEmpty);
    return;
  }

  hide(refs.myFeedbacksEmpty);
  if (refs.myFeedbacksListMeta) {
    refs.myFeedbacksListMeta.textContent = `${items.length} feedback${items.length > 1 ? "s" : ""} encontrados`;
  }

  const html = pageItems.map((item) => {
    const tone = scoreTone(item.score);
    const by = item.createdByName || item.createdByEmail || "Avaliador nao identificado";
    const recipient = item.recipientName || item.recipientEmail || "Colaborador nao identificado";
    const note = String(item.note || "-");
    const hasMore = isLongNote(note);
    return `
      <article class="my-feedback-entry my-feedback-entry--${tone}">
        <div class="my-feedback-entry-top">
          <div>
            <div class="my-feedback-entry-kicker">Feedback</div>
            <h4>${escapeHtml(formatDateBR(item.date))}</h4>
          </div>
          <span class="my-feedback-score my-feedback-score--${tone}">Nota ${escapeHtml(scoreLabel(item.score))}</span>
        </div>
        <div class="my-feedback-entry-meta">
          <span class="my-feedback-meta-pill">${escapeHtml(_myFeedbacksMode === "applied" ? `Para: ${recipient}` : `Por: ${by}`)}</span>
          ${_myFeedbacksMode === "applied" ? `<span class="my-feedback-meta-pill">Avaliador: ${escapeHtml(by)}</span>` : ""}
          ${item.createdAtLabel ? `<span class="my-feedback-meta-pill">Registrado em ${escapeHtml(item.createdAtLabel)}</span>` : ""}
        </div>
        <div class="my-feedback-entry-note" data-feedback-note data-preview="${escapeHtml(shortNote(note))}" data-full="${escapeHtml(note)}">${escapeHtml(hasMore ? shortNote(note) : note)}</div>
        ${hasMore ? `<button class="my-feedback-entry-more" type="button" data-feedback-toggle aria-expanded="false">Ver mais</button>` : ""}
      </article>
    `;
  }).join("");

  refs.myFeedbacksList.innerHTML = html;
}

function toggleFeedbackNote(button) {
  const entry = button.closest(".my-feedback-entry");
  const note = entry?.querySelector("[data-feedback-note]");
  if (!note) return;

  const expanded = button.getAttribute("aria-expanded") === "true";
  note.textContent = expanded ? note.dataset.preview || "" : note.dataset.full || "";
  button.setAttribute("aria-expanded", expanded ? "false" : "true");
  button.textContent = expanded ? "Ver mais" : "Ver menos";
}

function applySearch(refs) {
  const q = normalizeText(refs.myFeedbacksSearchInput?.value || "");
  const filtered = _myFeedbacksCache.filter((item) => !q || buildSearchText(item).includes(q));
  renderList(refs, filtered);
}

async function loadReceivedFeedbacks(deps) {
  const { state, db, auth } = deps;
  const companyId = state.companyId;
  const currentUid = auth?.currentUser?.uid || "";
  const q = query(
    collection(db, "companies", companyId, "users", currentUid, "feedbacks"),
    orderBy("createdAt", "desc"),
    limit(100)
  );
  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    const createdAtLabel = data.createdAt?.toDate
      ? data.createdAt.toDate().toLocaleDateString("pt-BR")
      : "";
    return {
      id: docSnap.id,
      ...data,
      createdAtLabel
    };
  });
}

async function loadAppliedFeedbacks(deps) {
  const { state, db, auth } = deps;
  const companyId = state.companyId;
  const currentUid = auth?.currentUser?.uid || "";
  let users = Array.isArray(state._usersCache) ? [...state._usersCache] : [];
  if (!users.length) {
    const usersSnap = await getDocs(collection(db, "companies", companyId, "users"));
    users = usersSnap.docs.map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }));
    state._usersCache = users;
  }

  const feedbackByUser = await Promise.all(
    users
      .filter((user) => user?.uid)
      .map(async (user) => {
        const snap = await getDocs(collection(db, "companies", companyId, "users", user.uid, "feedbacks"));
        return snap.docs
          .map((docSnap) => {
            const data = docSnap.data() || {};
            const createdAtLabel = data.createdAt?.toDate
              ? data.createdAt.toDate().toLocaleDateString("pt-BR")
              : "";
            return {
              id: docSnap.id,
              ...data,
              createdAtLabel,
              recipientUid: user.uid,
              recipientName: user.name || user.email || user.uid,
              recipientEmail: user.email || ""
            };
          })
          .filter((item) => String(item.createdBy || "") === currentUid);
      })
  );

  return feedbackByUser
    .flat()
    .sort((a, b) => {
      const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bt - at;
    });
}

function bindEvents(deps) {
  if (_bound) return;
  _bound = true;
  const { refs } = deps;

  refs.myFeedbacksSearchInput?.addEventListener("input", () => {
    _currentPage = 1;
    applySearch(refs);
  });

  refs.myFeedbacksList?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-feedback-toggle]");
    if (!button) return;
    toggleFeedbackNote(button);
  });

  refs.btnMyFeedbacksModeReceived?.addEventListener("click", () => {
    if (_myFeedbacksMode === "received") return;
    _myFeedbacksMode = "received";
    _currentPage = 1;
    openMyFeedbacksView(deps);
  });

  refs.btnMyFeedbacksModeApplied?.addEventListener("click", () => {
    if (_myFeedbacksMode === "applied" || !canViewAppliedFeedbacks(deps.state)) return;
    _myFeedbacksMode = "applied";
    _currentPage = 1;
    openMyFeedbacksView(deps);
  });

  refs.myFeedbacksPagination?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-my-feedbacks-page]");
    if (!button) return;
    const direction = button.getAttribute("data-my-feedbacks-page");
    _currentPage += direction === "prev" ? -1 : 1;
    applySearch(refs);
  });
}

export function openMyFeedbacksView(deps) {
  bindEvents(deps);
  if (_myFeedbacksMode === "applied" && !canViewAppliedFeedbacks(deps.state)) {
    _myFeedbacksMode = "received";
  }
  updateModeUI(deps.refs, deps.state);
  deps.setView("myFeedbacks");
  loadMyFeedbacks(deps).catch((err) => {
    console.error(err);
    alert("Nao foi possivel carregar seus feedbacks.");
  });
}

export async function loadMyFeedbacks(deps) {
  const { refs, state, db, auth } = deps;
  if (!refs.myFeedbacksList) return;

  bindEvents(deps);
  refs.myFeedbacksList.innerHTML = '<div class="panel subtle"><p class="muted">Carregando feedbacks...</p></div>';
  hide(refs.myFeedbacksEmpty);
  updateModeUI(refs, state);

  const companyId = state.companyId;
  const currentUid = auth?.currentUser?.uid || "";
  if (!companyId || !currentUid) {
    refs.myFeedbacksList.innerHTML = "";
    show(refs.myFeedbacksEmpty);
    return;
  }

  const items = _myFeedbacksMode === "applied"
    ? await loadAppliedFeedbacks(deps)
    : await loadReceivedFeedbacks(deps);

  _currentPage = 1;
  _myFeedbacksCache = items;
  updateSummary(refs, items);
  applySearch(refs);
}
