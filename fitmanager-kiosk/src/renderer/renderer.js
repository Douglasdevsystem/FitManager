const THRESHOLD = 0.6;
const REMATCH_COOLDOWN_MS = 8000; // avoid writing a new checkin every 700ms for the same person
const DENIED_LOG_COOLDOWN_MS = 5000; // avoid flooding "negado" checkins while a stranger lingers

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const matchCard = document.getElementById("matchCard");
const matchPhoto = document.getElementById("matchPhoto");
const matchName = document.getElementById("matchName");
const cacheInfo = document.getElementById("cacheInfo");

let embeddingsCache = [];
let busy = false;
let lastMatchedId = null;
let lastMatchAt = 0;
let lastDeniedAt = 0;

function setStatus(kind, text) {
  statusEl.className = `status status--${kind}`;
  statusText.textContent = text;
}

function showMatchCard(aluno) {
  matchCard.hidden = false;
  matchPhoto.src = aluno.fotoUrl || "";
  matchName.textContent = aluno.nome;
  setTimeout(() => {
    matchCard.hidden = true;
  }, 4000);
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = resolve;
  });
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}

async function refreshCacheLabel() {
  cacheInfo.textContent = `${embeddingsCache.length} aluno(s) sincronizado(s)`;
}

async function recognitionLoop() {
  if (busy) return;
  busy = true;
  try {
    const face = await detectFace(video);
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (!face) {
      setStatus("idle", "Posicione seu rosto na câmera");
      return;
    }

    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2;
    ctx.strokeRect(face.box.x, face.box.y, face.box.width, face.box.height);

    const result = faceCompare.findBestMatch(face.embedding, embeddingsCache, THRESHOLD);

    if (result.matched) {
      setStatus("granted", `Acesso liberado — ${result.aluno.nome}`);
      showMatchCard(result.aluno);

      const now = Date.now();
      if (result.aluno.id !== lastMatchedId || now - lastMatchAt > REMATCH_COOLDOWN_MS) {
        lastMatchedId = result.aluno.id;
        lastMatchAt = now;
        await window.kiosk.recordCheckin({
          alunoId: result.aluno.id,
          nome: result.aluno.nome,
          matched: true,
          distance: result.distance,
        });
      }
    } else {
      setStatus("denied", "Acesso negado — rosto não reconhecido");

      const now = Date.now();
      if (now - lastDeniedAt > DENIED_LOG_COOLDOWN_MS) {
        lastDeniedAt = now;
        await window.kiosk.recordCheckin({ alunoId: null, nome: "Desconhecido", matched: false, distance: result.distance });
      }
    }
  } catch (err) {
    console.error("[renderer] erro no loop de reconhecimento:", err);
  } finally {
    busy = false;
  }
}

async function main() {
  setStatus("idle", "Carregando modelos de reconhecimento...");
  await loadFaceModels();

  setStatus("idle", "Iniciando câmera...");
  await startCamera();

  embeddingsCache = (await window.kiosk.getEmbeddings()) || [];
  refreshCacheLabel();

  window.kiosk.onEmbeddingsUpdated((cache) => {
    embeddingsCache = cache;
    refreshCacheLabel();
  });

  setStatus("idle", "Posicione seu rosto na câmera");
  setInterval(recognitionLoop, 700);
}

main().catch((err) => {
  console.error("[renderer] erro fatal ao iniciar o kiosk:", err);
  setStatus("denied", "Erro ao iniciar o kiosk. Veja o console para detalhes.");
});
