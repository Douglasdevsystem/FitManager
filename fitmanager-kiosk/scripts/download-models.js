/**
 * Downloads the face-api.js pre-trained weight files into /models on first
 * run, so the kiosk never depends on the internet for recognition itself
 * once it has been set up once.
 *
 * Usage:
 *   node scripts/download-models.js                 -> downloads into ./models
 *   node scripts/download-models.js ../functions/models -> custom target dir
 *                                                          (used to mirror the
 *                                                          same weights for
 *                                                          Cloud Functions)
 */
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights";

const MODEL_FILES = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model-shard1",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model-shard1",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model-shard1",
  "face_recognition_model-shard2",
];

async function downloadFile(dir, filename) {
  const dest = path.join(dir, filename);
  if (fs.existsSync(dest)) return false;

  const url = `${BASE_URL}/${filename}`;
  console.log(`[models] baixando ${filename}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar ${filename}: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buffer);
  return true;
}

async function ensureModelsDownloaded(targetDir) {
  const dir = targetDir || path.join(__dirname, "../models");
  fs.mkdirSync(dir, { recursive: true });

  const missing = MODEL_FILES.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length === 0) {
    console.log(`[models] todos os modelos já estão presentes em ${dir}`);
    return;
  }

  console.log(`[models] baixando ${missing.length} arquivo(s) de modelo em ${dir}...`);
  for (const file of missing) {
    await downloadFile(dir, file);
  }
  console.log("[models] download concluído.");
}

module.exports = { ensureModelsDownloaded, MODEL_FILES };

if (require.main === module) {
  const targetArg = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  ensureModelsDownloaded(targetArg).catch((err) => {
    console.error("[models] erro ao baixar modelos:", err.message);
    console.error("[models] verifique sua conexão com a internet — o app tentará novamente na próxima inicialização.");
    process.exitCode = 0; // don't fail `npm install` — the app retries this on startup
  });
}
