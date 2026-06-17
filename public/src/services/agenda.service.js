import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

function withId(docSnap, idKey = "id"){
  const data = docSnap.data() || {};
  return { [idKey]: docSnap.id, ...data };
}

export async function loadAgendaContext(db, companyId){
  if (!db || !companyId) throw new Error("Empresa nao identificada.");
  const [projectsSnap, tasksSnap, activitiesSnap, clientsSnap, usersSnap, absencesSnap] = await Promise.all([
    getDocs(collection(db, `companies/${companyId}/projects`)),
    getDocs(collection(db, `companies/${companyId}/tasks`)),
    getDocs(collection(db, `companies/${companyId}/activities`)),
    getDocs(collection(db, `companies/${companyId}/clients`)),
    getDocs(collection(db, `companies/${companyId}/users`)),
    getDocs(collection(db, `companies/${companyId}/resourceAbsences`)).catch(() => ({ docs: [] }))
  ]);

  return {
    projects: projectsSnap.docs.map((item) => withId(item)),
    tasks: tasksSnap.docs.map((item) => withId(item)),
    activities: activitiesSnap.docs.map((item) => withId(item)),
    clients: clientsSnap.docs.map((item) => withId(item)),
    users: usersSnap.docs.map((item) => withId(item, "uid")),
    absences: absencesSnap.docs.map((item) => withId(item))
  };
}

export async function createAgendaActivity(db, companyId, activityId, payload){
  await setDoc(doc(db, `companies/${companyId}/activities`, activityId), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function deleteAgendaActivity(db, companyId, activityId){
  await deleteDoc(doc(db, `companies/${companyId}/activities`, activityId));
}

export async function createAbsence(db, companyId, absenceId, payload){
  await setDoc(doc(db, `companies/${companyId}/resourceAbsences`, absenceId), {
    ...payload,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function getCompanySettings(db, companyId){
  const snap = await getDoc(doc(db, "companies", companyId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function findActivitiesByFilters(db, companyId, filters = {}){
  const clauses = [];
  if (filters.projectId) clauses.push(where("projectId", "==", filters.projectId));
  if (filters.taskId) clauses.push(where("taskId", "==", filters.taskId));
  if (filters.resourceId) clauses.push(where("techUids", "array-contains", filters.resourceId));
  const ref = collection(db, `companies/${companyId}/activities`);
  const snap = await getDocs(clauses.length ? query(ref, ...clauses) : ref);
  const start = String(filters.startDate || "").slice(0, 10);
  const end = String(filters.endDate || "").slice(0, 10);
  return snap.docs
    .map((item) => withId(item))
    .filter((item) => {
      const workDate = String(item.workDate || "").slice(0, 10);
      if (start && workDate < start) return false;
      if (end && workDate > end) return false;
      return true;
    });
}
