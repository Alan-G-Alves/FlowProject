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
const NOTE_PREVIEW_LIMIT = 180;

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
    item.score
  ].join(" "));
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
    refs.myFeedbacksHeadline.textContent = total
      ? `Voce recebeu ${total} feedback${total > 1 ? "s" : ""} e sua media atual e ${avgScore(items)}.`
      : "Voce ainda nao recebeu feedbacks.";
  }
  if (refs.myFeedbacksIntro) {
    refs.myFeedbacksIntro.textContent = total
      ? "Use este historico para acompanhar percepcoes recorrentes, celebracoes e orientacoes do seu desenvolvimento."
      : "Quando novos feedbacks forem registrados para o seu usuario, eles aparecerao aqui com um resumo elegante.";
  }
}

function renderList(refs, items) {
  if (!refs.myFeedbacksList) return;
  refs.myFeedbacksList.innerHTML = "";

  if (!items.length) {
    if (refs.myFeedbacksListMeta) refs.myFeedbacksListMeta.textContent = "0 feedbacks encontrados";
    show(refs.myFeedbacksEmpty);
    return;
  }

  hide(refs.myFeedbacksEmpty);
  if (refs.myFeedbacksListMeta) {
    refs.myFeedbacksListMeta.textContent = `${items.length} feedback${items.length > 1 ? "s" : ""} encontrados`;
  }

  const html = items.map((item) => {
    const tone = scoreTone(item.score);
    const by = item.createdByName || item.createdByEmail || "Avaliador nao identificado";
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
          <span class="my-feedback-meta-pill">Por: ${escapeHtml(by)}</span>
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

function bindEvents(deps) {
  if (_bound) return;
  _bound = true;
  const { refs } = deps;

  refs.myFeedbacksSearchInput?.addEventListener("input", () => {
    applySearch(refs);
  });

  refs.myFeedbacksList?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-feedback-toggle]");
    if (!button) return;
    toggleFeedbackNote(button);
  });
}

export function openMyFeedbacksView(deps) {
  bindEvents(deps);
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

  const companyId = state.companyId;
  const currentUid = auth?.currentUser?.uid || "";
  if (!companyId || !currentUid) {
    refs.myFeedbacksList.innerHTML = "";
    show(refs.myFeedbacksEmpty);
    return;
  }

  const q = query(
    collection(db, "companies", companyId, "users", currentUid, "feedbacks"),
    orderBy("createdAt", "desc"),
    limit(100)
  );
  const snap = await getDocs(q);

  const items = snap.docs.map((docSnap) => {
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

  _myFeedbacksCache = items;
  updateSummary(refs, items);
  applySearch(refs);
}
