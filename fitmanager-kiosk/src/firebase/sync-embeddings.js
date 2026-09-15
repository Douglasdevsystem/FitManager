/**
 * Keeps a local cache (JSON on disk + in-memory) of every student's face
 * embedding, fed by a live Firestore listener. This is what lets the kiosk
 * keep recognizing faces even when the internet connection drops — it never
 * hits Firestore during the actual recognition loop, only on startup and
 * whenever the "alunos" collection changes.
 */
const fs = require("fs");
const path = require("path");
const { getDb } = require("./admin");

const CACHE_PATH = path.join(__dirname, "../cache/embeddings-cache.json");

// This Firebase project is shared with another system — every FitManager
// collection is prefixed so it can never collide with or overwrite that
// system's data. Must match VITE_FIRESTORE_PREFIX in the admin panel's .env.
const COLLECTION = `${process.env.FIRESTORE_PREFIX || "fitmanager_"}alunos`;

let cache = []; // [{ id, nome, fotoUrl, faceEmbedding: number[], status }]
let unsubscribe = null;

function loadCacheFromDisk() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    cache = JSON.parse(raw);
    console.log(`[sync] ${cache.length} embedding(s) carregado(s) do cache local (fallback offline)`);
  } catch {
    cache = [];
  }
}

function saveCacheToDisk() {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[sync] falha ao gravar o cache de embeddings em disco:", err.message);
  }
}

function getEmbeddingsCache() {
  return cache;
}

/**
 * Subscribes to the "alunos" collection and keeps the local cache up to
 * date in real time. `onUpdate` is called once immediately with whatever is
 * already on disk (so the kiosk can recognize faces right away, even before
 * Firestore responds), and again every time the collection changes.
 */
async function startEmbeddingsSync(onUpdate) {
  loadCacheFromDisk();
  onUpdate?.(cache);

  const db = getDb();
  unsubscribe = db.collection(COLLECTION).onSnapshot(
    (snapshot) => {
      cache = snapshot.docs
        .map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            nome: data.nome,
            fotoUrl: data.fotoUrl,
            faceEmbedding: data.faceEmbedding,
            status: data.status, // "ativo" | "inativo" | "vencido" (ver schema em fitmanager-kiosk/README.md)
          };
        })
        .filter((aluno) => Array.isArray(aluno.faceEmbedding) && aluno.faceEmbedding.length > 0 && aluno.status !== "inativo");

      saveCacheToDisk();
      console.log(`[sync] cache atualizado — ${cache.length} aluno(s) com rosto cadastrado`);
      onUpdate?.(cache);
    },
    (err) => {
      console.error("[sync] erro no onSnapshot — mantendo o último cache local conhecido:", err.message);
    }
  );
}

function stopEmbeddingsSync() {
  unsubscribe?.();
  unsubscribe = null;
}

module.exports = { startEmbeddingsSync, stopEmbeddingsSync, getEmbeddingsCache };
