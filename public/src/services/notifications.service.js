import {
  collection,
  serverTimestamp,
  addDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

function uniqueRecipients(recipients){
  return Array.from(new Set((Array.isArray(recipients) ? recipients : [])
    .map((uid) => String(uid || "").trim())
    .filter(Boolean)));
}

export async function createNotification(db, companyId, recipientUid, payload = {}){
  if (!db || !companyId || !recipientUid) return null;
  const ref = await addDoc(collection(db, "companies", companyId, "notifications"), {
    recipientUid,
    type: payload.type || "info",
    title: payload.title || "Notificacao",
    message: payload.message || "",
    entityType: payload.entityType || "",
    entityId: payload.entityId || "",
    projectId: payload.projectId || "",
    activityId: payload.activityId || "",
    taskId: payload.taskId || "",
    read: false,
    createdAt: serverTimestamp(),
    createdBy: payload.createdBy || "system",
    createdByName: payload.createdByName || "",
    createdByEmail: payload.createdByEmail || ""
  });
  return ref.id;
}

export async function createNotifications(db, companyId, recipientUids, payload = {}){
  const recipients = uniqueRecipients(recipientUids).filter((uid) => uid !== payload.createdBy);
  await Promise.all(recipients.map((uid) => createNotification(db, companyId, uid, payload)));
}
