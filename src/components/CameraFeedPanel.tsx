import { useEffect, useRef, useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db, COLLECTIONS } from "../lib/firebase";
import { useAlunos } from "../lib/hooks";
import { useFaceRecognition, type RecognitionEventKind } from "../hooks/useFaceRecognition";
import { RecognitionOverlay, type RecognitionOverlayEvent } from "./RecognitionOverlay";
import type { Aluno } from "../lib/types";

const OVERLAY_DURATION_MS = 4000;
const DEVICE_ID = "painel-web";

async function recordCheckin(kind: RecognitionEventKind, aluno: Aluno | null, distance: number) {
  try {
    await addDoc(collection(db, COLLECTIONS.checkins), {
      alunoId: aluno?.id ?? null,
      nomeAluno: aluno?.nome ?? "Desconhecido",
      timestamp: new Date().toISOString(),
      tipo: "reconhecimento_facial",
      status: kind === "granted" ? "liberado" : "negado",
      confiancaMatch: distance,
      dispositivoId: DEVICE_ID,
    });
  } catch (err) {
    console.error("[camera] falha ao gravar check-in:", err);
  }
}

/**
 * The actual camera feed + live recognition — reused both inside the normal
 * admin panel (Câmera screen, with the rest of the chrome around it) and in
 * the fullscreen secondary-monitor window (no chrome at all).
 */
export function CameraFeedPanel({ fullscreen = false }: { fullscreen?: boolean }) {
  const { data: alunos } = useAlunos();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [overlayEvent, setOverlayEvent] = useState<RecognitionOverlayEvent | null>(null);

  const handleEvent = (kind: RecognitionEventKind, aluno: Aluno | null, distance: number) => {
    setOverlayEvent({ kind, aluno });
    setTimeout(() => setOverlayEvent((current) => (current?.kind === kind && current.aluno === aluno ? null : current)), OVERLAY_DURATION_MS);
    void recordCheckin(kind, aluno, distance);
  };

  const { modelsReady, modelsError, box } = useFaceRecognition({
    videoRef,
    alunos,
    active: cameraReady,
    onEvent: handleEvent,
  });

  // Lista as câmeras disponíveis (o rótulo só vem preenchido depois da
  // primeira permissão concedida, por isso listamos de novo após conectar).
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => setDevices(list.filter((d) => d.kind === "videoinput")))
      .catch(() => {});
  }, [cameraReady]);

  useEffect(() => {
    let cancelled = false;
    setCameraError(null);
    setCameraReady(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        window.isSecureContext
          ? "Este navegador não suporta acesso à câmera."
          : "A câmera só funciona em conexão segura (HTTPS) ou em localhost."
      );
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);
      })
      .catch((err) => {
        if (!cancelled) setCameraError(`Não foi possível acessar a câmera (${err.name}).`);
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [deviceId]);

  // Desenha o retângulo ao redor do rosto detectado, atualizado a cada frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!box || !video.videoWidth) return;

    const scaleX = canvas.width / video.videoWidth;
    const scaleY = canvas.height / video.videoHeight;
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 3;
    // O vídeo é espelhado (scaleX(-1) no CSS), então o X do retângulo também precisa espelhar.
    const mirroredX = canvas.width - (box.x + box.width) * scaleX;
    ctx.strokeRect(mirroredX, box.y * scaleY, box.width * scaleX, box.height * scaleY);
  }, [box]);

  return (
    <div className="w-full space-y-2">
      {!fullscreen && devices.length > 1 && (
        <div className="flex items-center gap-2.5">
          <label className="text-xs font-display text-gray-500 uppercase tracking-wider">Câmera</label>
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20 transition-colors"
          >
            <option value="">Câmera padrão</option>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Câmera ${i + 1}`}</option>
            ))}
          </select>
        </div>
      )}

      <div className={`relative w-full ${fullscreen ? "h-screen bg-black" : "aspect-video bg-gray-900 rounded-xl overflow-hidden"}`}>
        <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full scale-x-[-1] pointer-events-none" />

        {cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-900 text-red-400 text-sm px-6 text-center">
            {cameraError}
          </div>
        )}

        {!cameraError && (!cameraReady || !modelsReady) && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 text-white text-sm">
            {!cameraReady ? "Iniciando câmera..." : "Carregando modelos de reconhecimento..."}
          </div>
        )}

        {modelsError && (
          <div className="absolute top-3 left-3 right-3 bg-red-600/90 text-white text-xs rounded-lg px-3 py-2">{modelsError}</div>
        )}

        <RecognitionOverlay event={overlayEvent} />

        {fullscreen && devices.length > 1 && (
          <div className="absolute top-3 right-3">
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="bg-black/60 text-white text-xs rounded-lg border border-white/20 px-2 py-1.5 backdrop-blur-sm"
            >
              <option value="">Câmera padrão</option>
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Câmera ${i + 1}`}</option>
              ))}
            </select>
          </div>
        )}

        <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs text-white/80 font-mono-data">
          {alunos.length} aluno(s) sincronizado(s)
        </div>
      </div>
    </div>
  );
}
