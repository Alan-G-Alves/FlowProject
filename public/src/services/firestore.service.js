// FlowProject - Firestore Service (base)
// Centraliza leituras essenciais para bootstrap (auth listener)

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../config/firebase.js";

// platformUsers/{uid}
export async function fetchPlatformUser(uid){
  const snap = await getDoc(doc(db, "platformUsers", uid));
  return snap.exists() ? snap.data() : null;
}

// userCompanies/{uid} -> { companyId }
export async function fetchCompanyIdForUser(uid){
  const snap = await getDoc(doc(db, "userCompanies", uid));
  return snap.exists() ? (snap.data()?.companyId || null) : null;
}

// companies/{companyId}/users/{uid}
export async function fetchCompanyUserProfile(companyId, uid){
  const snap = await getDoc(doc(db, "companies", companyId, "users", uid));
  return snap.exists() ? snap.data() : null;
}
