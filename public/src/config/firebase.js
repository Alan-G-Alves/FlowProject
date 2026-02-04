// FlowProject - Firebase bootstrap (centralizado)
// Mantém 1 única inicialização do Firebase no frontend.

import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyDDwKotSJLioYxaTdu0gf30U-haoT5wiyo",
  authDomain: "flowproject-17930.firebaseapp.com",
  projectId: "flowproject-17930",
  storageBucket: "flowproject-17930.firebasestorage.app",
  messagingSenderId: "254792794709",
  appId: "1:254792794709:web:fae624d7c4227b0c398adc"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

// Exporta httpsCallable pois o app usa em alguns fluxos
export { httpsCallable };

// Opcional: auth secundário para criação de usuário sem deslogar o admin.
export const secondaryApp = getApps().some(a => a.name === "secondary") ? getApp("secondary") : initializeApp(firebaseConfig, "secondary");
export const secondaryAuth = getAuth(secondaryApp);
