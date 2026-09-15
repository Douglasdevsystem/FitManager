/**
 * Records checkins to Firestore. If the write fails (offline, Firestore
 * unreachable, etc.) the checkin is queued locally on disk and retried by
 * flushPendingCheckins() — called on an interval from main.js — so no
 * access event is ever lost, only delayed.
 */
const fs = require("fs");
const path = require("path");
const { getDb } = require("./admin");

const PENDING_PATH = path.join(__dirname, "../cache/pending-checkins.json");

// Shared Firebase project — prefixed to never collide with the other
// system's data. Must match VITE_FIRESTORE_PREFIX in the admin panel's .env.
const COLLECTION = `${process.env.FIRESTORE_PREFIX || "fitmanager_"}checkins`;
const DEVICE_ID = process.env.KIOSK_DEVICE_ID || "kiosk-entrada-01";

function loadPending() {
  try {
    return JSON.parse(fs.readFileSync(PENDING_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function savePending(list) {
  try {
    fs.mkdirSync(path.dirname(PENDING_PATH), { recursive: true });
    fs.writeFileSync(PENDING_PATH, JSON.stringify(list, null, 2));
  } catch (err) {
    console.error("[checkins] falha ao gravar a fila de checkins pendentes:", err.message);
  }
}

async function recordCheckin(payload) {
  const doc = {
    alunoId: payload.alunoId ?? null,
    nomeAluno: payload.nome ?? "Desconhecido",
    timestamp: new Date().toISOString(),
    tipo: "reconhecimento_facial",
    status: payload.matched ? "liberado" : "negado",
    // Distância euclidiana entre o rosto capturado e o embedding cadastrado
    // (NÃO é "confiança" no sentido usual — menor valor = mais parecido).
    confiancaMatch: payload.distance ?? null,
    dispositivoId: DEVICE_ID,
  };

  try {
    const db = getDb();
    await db.collection(COLLECTION).add(doc);
    console.log("[checkins] registrado:", doc.nomeAluno, doc.status);
    return { ok: true, queued: false };
  } catch (err) {
    console.warn("[checkins] escrita no Firestore falhou, enfileirando localmente:", err.message);
    const pending = loadPending();
    pending.push(doc);
    savePending(pending);
    return { ok: true, queued: true };
  }
}

/** Retries any checkins that were queued locally while offline. */
async function flushPendingCheckins() {
  const pending = loadPending();
  if (pending.length === 0) return;

  let db;
  try {
    db = getDb();
  } catch {
    return; // Firebase ainda não inicializado — tenta de novo no próximo tick
  }

  const remaining = [];
  for (const doc of pending) {
    try {
      await db.collection(COLLECTION).add(doc);
    } catch {
      remaining.push(doc);
    }
  }

  if (remaining.length !== pending.length) {
    console.log(`[checkins] ${pending.length - remaining.length} checkin(s) pendente(s) sincronizado(s)`);
  }
  savePending(remaining);
}

module.exports = { recordCheckin, flushPendingCheckins };
