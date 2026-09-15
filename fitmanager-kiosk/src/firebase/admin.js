/**
 * Firebase Admin SDK — initialized only in the Electron main process
 * (Node.js). The service account credentials never reach the renderer, so
 * a compromised kiosk UI can never read/write Firestore or Storage
 * directly with elevated privileges.
 */
const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

let app = null;

function initFirebaseAdmin() {
  if (app) return app;

  const serviceAccountPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./firebase-service-account.json");

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      `Service account não encontrado em "${serviceAccountPath}". ` +
        `Gere o JSON no Console do Firebase (Configurações do projeto > Contas de serviço > Gerar nova chave privada) ` +
        `e aponte FIREBASE_SERVICE_ACCOUNT_PATH no .env.`
    );
  }

  const serviceAccount = require(serviceAccountPath);

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });

  console.log("[firebase] Admin SDK inicializado para o projeto:", serviceAccount.project_id);
  return app;
}

function getDb() {
  if (!app) throw new Error("Firebase Admin não foi inicializado. Chame initFirebaseAdmin() primeiro.");
  return admin.firestore();
}

function getBucket() {
  if (!app) throw new Error("Firebase Admin não foi inicializado. Chame initFirebaseAdmin() primeiro.");
  return admin.storage().bucket();
}

module.exports = { initFirebaseAdmin, getDb, getBucket };
