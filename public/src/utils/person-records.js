import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

export const PERSON_ATTACHMENT_MAX_FILES = 6;
export const PERSON_ATTACHMENT_MAX_SIZE = 8 * 1024 * 1024;

const PERSON_ATTACHMENT_ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
]);

const PERSON_ATTACHMENT_ALLOWED_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp"
];

function guessContentTypeFromName(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".doc")) return "application/msword";
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return "";
}

export function normalizeDigits(value, maxLen = 32) {
  return String(value || "").replace(/\D+/g, "").slice(0, maxLen);
}

export function formatCpf(value) {
  const digits = normalizeDigits(value, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export function formatCnpj(value) {
  const digits = normalizeDigits(value, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function bindMaskedInput(inputEl, formatter, key = "boundMask") {
  if (!inputEl || inputEl.dataset[key]) return;
  inputEl.dataset[key] = "1";
  inputEl.addEventListener("input", () => {
    const formatted = formatter(inputEl.value || "");
    if (inputEl.value !== formatted) inputEl.value = formatted;
  });
}

export function calculateAgeFromBirthDate(dateStr) {
  const raw = String(dateStr || "").trim();
  if (!raw) return null;

  const birth = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  const beforeBirthday = monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;

  if (age < 0 || age > 130) return null;
  return age;
}

export function updateAgePreview(inputEl, outputEl) {
  if (!outputEl) return;
  const age = calculateAgeFromBirthDate(inputEl?.value || "");
  outputEl.textContent = age === null ? "Preencha a data" : `${age} anos`;
  outputEl.dataset.empty = age === null ? "1" : "0";
}

export function bindAgePreview(inputEl, outputEl, key = "boundAge") {
  if (!inputEl || !outputEl) return;
  if (!inputEl.dataset[key]) {
    inputEl.dataset[key] = "1";
    inputEl.addEventListener("input", () => updateAgePreview(inputEl, outputEl));
    inputEl.addEventListener("change", () => updateAgePreview(inputEl, outputEl));
  }
  updateAgePreview(inputEl, outputEl);
}

export function sanitizeAddress(value) {
  return String(value || "").trim().slice(0, 300);
}

export function sanitizeAttachments(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => ({
      id: String(item?.id || "").trim(),
      name: String(item?.name || "").trim(),
      size: Number(item?.size || 0),
      contentType: String(item?.contentType || "").trim(),
      path: String(item?.path || "").trim(),
      url: String(item?.url || "").trim(),
      uploadedAt: String(item?.uploadedAt || "").trim()
    }))
    .filter((item) => item.name && item.path)
    .slice(0, PERSON_ATTACHMENT_MAX_FILES);
}

export function toAttachmentDrafts(list) {
  return sanitizeAttachments(list).map((item) => ({
    ...item,
    isNew: false,
    file: null
  }));
}

function isAllowedAttachmentFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  if (PERSON_ATTACHMENT_ALLOWED_TYPES.has(type)) return true;
  return PERSON_ATTACHMENT_ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function addAttachmentFiles(currentItems, fileList) {
  const existing = Array.isArray(currentItems) ? [...currentItems] : [];
  const files = Array.from(fileList || []);

  if (!files.length) return { items: existing, error: "" };
  if (existing.length + files.length > PERSON_ATTACHMENT_MAX_FILES) {
    return { items: existing, error: `Voce pode anexar ate ${PERSON_ATTACHMENT_MAX_FILES} arquivos.` };
  }

  const nextItems = [...existing];
  const seen = new Set(existing.map((item) => `${item.name}__${item.size}`));

  for (const file of files) {
    if (!isAllowedAttachmentFile(file)) {
      return {
        items: existing,
        error: "Use apenas PDF, DOC, DOCX, JPG, PNG ou WEBP."
      };
    }
    if (file.size > PERSON_ATTACHMENT_MAX_SIZE) {
      return {
        items: existing,
        error: `Cada arquivo pode ter no maximo ${formatBytes(PERSON_ATTACHMENT_MAX_SIZE)}.`
      };
    }

    const signature = `${file.name}__${file.size}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    nextItems.push({
      id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: Number(file.size || 0),
      contentType: String(file.type || "").trim(),
      path: "",
      url: "",
      uploadedAt: "",
      isNew: true,
      file
    });
  }

  return { items: nextItems.slice(0, PERSON_ATTACHMENT_MAX_FILES), error: "" };
}

export function renderAttachmentList(container, items, options = {}) {
  if (!container) return;
  container.innerHTML = "";

  const list = Array.isArray(items) ? items : [];
  const emptyText = options.emptyText || "Nenhum arquivo anexado.";
  const readOnly = options.readOnly === true;

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "person-attachment-empty";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  for (const item of list) {
    const row = document.createElement("div");
    row.className = `person-attachment-item${item?.isNew ? " is-new" : ""}`;

    const meta = document.createElement("div");
    meta.className = "person-attachment-meta";

    const title = document.createElement("strong");
    title.textContent = item?.name || "Arquivo";

    const info = document.createElement("span");
    const parts = [formatBytes(item?.size || 0)];
    if (item?.contentType === "application/pdf") parts.push("PDF");
    else if (String(item?.contentType || "").includes("word")) parts.push("DOC");
    else if (String(item?.contentType || "").startsWith("image/")) parts.push("Imagem");
    if (item?.isNew) parts.push("novo");
    info.textContent = parts.join(" • ");

    meta.appendChild(title);
    meta.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "person-attachment-actions";

    if (item?.url) {
      const link = document.createElement("a");
      link.className = "btn ghost sm";
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Abrir";
      actions.appendChild(link);
    }

    if (!readOnly && typeof options.onRemove === "function") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn ghost sm person-attachment-remove";
      btn.textContent = "Remover";
      btn.addEventListener("click", () => options.onRemove(item));
      actions.appendChild(btn);
    }

    row.appendChild(meta);
    row.appendChild(actions);
    container.appendChild(row);
  }
}

function safeAttachmentName(name) {
  const raw = String(name || "arquivo").trim() || "arquivo";
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || `arquivo-${Date.now()}`;
}

export async function uploadAttachmentDrafts({ storage, companyId, uid, draftItems }) {
  const items = Array.isArray(draftItems) ? draftItems : [];
  const uploaded = [];

  for (const item of items.slice(0, PERSON_ATTACHMENT_MAX_FILES)) {
    if (!item?.isNew || !item?.file) {
      if (item?.path && item?.name) {
        uploaded.push({
          id: String(item.id || "").trim() || `att_${Math.random().toString(36).slice(2, 8)}`,
          name: String(item.name || "").trim(),
          size: Number(item.size || 0),
          contentType: String(item.contentType || "").trim(),
          path: String(item.path || "").trim(),
          url: String(item.url || "").trim(),
          uploadedAt: String(item.uploadedAt || "").trim()
        });
      }
      continue;
    }

    const file = item.file;
    if (!isAllowedAttachmentFile(file)) throw new Error("Arquivo anexado com formato invalido.");
    if ((file.size || 0) > PERSON_ATTACHMENT_MAX_SIZE) {
      throw new Error(`Cada arquivo pode ter no maximo ${formatBytes(PERSON_ATTACHMENT_MAX_SIZE)}.`);
    }

    const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const path = `userAttachments/${companyId}/${uid}/${id}_${safeAttachmentName(file.name)}`;
    const ref = storageRef(storage, path);
    const inferredType = (String(file.type || "").trim() || guessContentTypeFromName(file.name) || "application/octet-stream").toLowerCase();

    // Retry a few times because Storage rules may depend on recent Firestore writes.
    let delay = 600;
    let lastErr = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await uploadBytes(ref, file, { contentType: inferredType });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const code = String(err?.code || "");
        const msg = String(err?.message || "").toLowerCase();
        const retryable = code === "storage/unauthorized" || msg.includes("unauthorized") || msg.includes("permission") || msg.includes("forbidden");
        if (!retryable || attempt >= 5) throw err;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(Math.round(delay * 1.6), 4000);
      }
    }
    if (lastErr) throw lastErr;
    const url = await getDownloadURL(ref);

    uploaded.push({
      id,
      name: file.name,
      size: Number(file.size || 0),
      contentType: inferredType,
      path,
      url,
      uploadedAt: new Date().toISOString()
    });
  }

  return uploaded.slice(0, PERSON_ATTACHMENT_MAX_FILES);
}

export async function deleteStoredAttachments({ storage, items }) {
  if (!storage) return;
  for (const item of (Array.isArray(items) ? items : [])) {
    const path = String(item?.path || "").trim();
    if (!path) continue;
    try {
      await deleteObject(storageRef(storage, path));
    } catch (_) {}
  }
}
