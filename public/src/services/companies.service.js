import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { db } from "../config/firebase.js";

export async function createCompanyDoc(companyData){
  const ref = await addDoc(collection(db, "companies"), {
    ...companyData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function setCompanyBootstrap(companyId, bootstrapData){
  await setDoc(doc(db, "companies", companyId, "meta", "bootstrap"), {
    ...bootstrapData,
    createdAt: serverTimestamp(),
  }, { merge: true });
}

export async function getCompanyDoc(companyId){
  const snap = await getDoc(doc(db, "companies", companyId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() }) : null;
}

export async function listCompaniesDocs(){
  const snap = await getDocs(query(collection(db, "companies"), orderBy("createdAt", "desc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function listCompanyUsersDocs(companyId){
  const ref = collection(db, "companies", companyId, "users");
  const snap = await getDocs(query(ref, orderBy("createdAt", "desc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
