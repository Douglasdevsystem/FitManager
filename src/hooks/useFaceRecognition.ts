import { useEffect, useRef, useState, type RefObject } from "react";
import { loadFaceModels, detectFace, findBestMatch, type FaceBox } from "../lib/faceRecognition";
import type { Aluno } from "../lib/types";

export type RecognitionEventKind = "granted" | "denied";

interface UseFaceRecognitionOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  alunos: Aluno[];
  active: boolean;
  threshold?: number;
  cooldownMs?: number;
  intervalMs?: number;
  onEvent?: (kind: RecognitionEventKind, aluno: Aluno | null, distance: number) => void;
}

/**
 * Encapsulates the detection loop: capture a frame → detect a face →
 * compare against the alunos' cached embeddings → emit a cooldown-gated
 * event when a person (recognized or not) is confidently seen. The visual
 * "ENTRADA PERMITIDA" banner lives in RecognitionOverlay, driven by onEvent
 * — this hook only ever deals with detection/matching, not UI.
 */
export function useFaceRecognition({
  videoRef,
  alunos,
  active,
  threshold = 0.6,
  cooldownMs = 8000,
  intervalMs = 700,
  onEvent,
}: UseFaceRecognitionOptions) {
  const [modelsReady, setModelsReady] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [box, setBox] = useState<FaceBox | null>(null);
  const lastEventRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadFaceModels()
      .then(() => {
        if (!cancelled) setModelsReady(true);
      })
      .catch((err) => {
        console.error("[useFaceRecognition] falha ao carregar modelos:", err);
        if (!cancelled) setModelsError(err instanceof Error ? err.message : "Falha ao carregar modelos de reconhecimento.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active || !modelsReady) {
      setBox(null);
      return;
    }

    const interval = setInterval(async () => {
      if (busyRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      busyRef.current = true;
      try {
        const face = await detectFace(video);
        if (!face) {
          setBox(null);
          return;
        }
        setBox(face.box);

        const match = findBestMatch(face.embedding, alunos, threshold);
        const key = match.aluno?.id ?? "denied";
        const now = Date.now();
        if (lastEventRef.current.key !== key || now - lastEventRef.current.at > cooldownMs) {
          lastEventRef.current = { key, at: now };
          onEvent?.(match.matched ? "granted" : "denied", match.aluno, match.distance);
        }
      } catch (err) {
        console.error("[useFaceRecognition] erro no loop de detecção:", err);
      } finally {
        busyRef.current = false;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, intervalMs);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, modelsReady, alunos, threshold, cooldownMs, intervalMs]);

  return { modelsReady, modelsError, box };
}
