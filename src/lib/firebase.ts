// Firebase client SDK setup for the FitManager admin panel.
//
// IMPORTANT — shared Firebase project: this project (appfood-e25bb) already
// runs another system. Every FitManager collection/path below is prefixed
// (VITE_FIRESTORE_PREFIX / VITE_STORAGE_PREFIX) so it can never collide with
// or overwrite that other system's data. Never remove the prefix, and never
// read/write a Firestore collection or Storage path that isn't listed here.
//
// The apiKey/authDomain/etc. below are NOT secrets — Firebase web apps embed
// them in the client bundle by design. Actual access control is enforced by
// Firestore/Storage security rules plus Firebase Authentication (not yet
// wired into this panel — see README/CLAUDE.md for the current gap).
import { initializeApp, deleteApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

// Firestore with offline persistence (IndexedDB): reads fall back to the
// local cache and writes queue automatically when there's no connection,
// then sync once it comes back — no custom sync code needed.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const storage = getStorage(app);
export const auth = getAuth(app);
// "us-central1" — mesma região onde as Cloud Functions do FitManager (ex.:
// regenerateEmbedding) foram publicadas.
export const functions = getFunctions(app);

// Every FitManager collection/path, already prefixed for isolation inside
// the shared project. Import COLLECTIONS instead of hardcoding a Firestore
// collection name anywhere else in the app.
const FS_PREFIX = import.meta.env.VITE_FIRESTORE_PREFIX || "fitmanager_";
const STORAGE_PREFIX = import.meta.env.VITE_STORAGE_PREFIX || "fitmanager";

export const COLLECTIONS = {
  alunos: `${FS_PREFIX}alunos`,
  checkins: `${FS_PREFIX}checkins`,
  usuarios: `${FS_PREFIX}usuarios`,
  planos: `${FS_PREFIX}planos`,
  notificacoes: `${FS_PREFIX}notificacoes`,
  logsAuditoria: `${FS_PREFIX}logsAuditoria`,
  // Biblioteca de exercícios compartilhada entre todos os treinos — coleção
  // de nível raiz (não aninhada em alunos/{id}), então um exercício só
  // precisa ser cadastrado uma vez e é reutilizado em quantos treinos quiser.
  exerciciosBiblioteca: `${FS_PREFIX}exerciciosBiblioteca`,
  // Subcoleções de alunos/{alunoId}/... — prefixadas mesmo sendo aninhadas,
  // porque collectionGroup() casa pelo nome da coleção no banco INTEIRO,
  // não pelo caminho do pai. Um nome genérico aqui colidiria com qualquer
  // subcoleção de mesmo nome do outro sistema.
  treinos: `${FS_PREFIX}Treinos`,
  execucoesTreino: `${FS_PREFIX}ExecucoesTreino`,
} as const;

export const STORAGE_PATHS = {
  fotosAlunos: `${STORAGE_PREFIX}/fotos-alunos`,
  checkinsFotos: `${STORAGE_PREFIX}/checkins-fotos`,
  documentosAcademia: `${STORAGE_PREFIX}/documentos-academia`,
  exerciciosMidia: `${STORAGE_PREFIX}/exercicios-midia`,
} as const;

/**
 * Creates a new Firebase Auth account WITHOUT touching the current session.
 * `createUserWithEmailAndPassword` on the default `auth` instance signs the
 * browser into the newly created account — a well-known Firebase gotcha
 * that would kick the logged-in admin out while creating a student's login.
 * A throwaway secondary app instance sidesteps that entirely.
 */
export async function createAuthAccountWithoutSignIn(email: string, password: string): Promise<string> {
  const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
  try {
    const secondaryAuth = getAuth(secondaryApp);
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    return credential.user.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
}
