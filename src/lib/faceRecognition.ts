// Client-side face detection + matching. Runs entirely in the browser
// (Canvas/WebGL via face-api.js) — the exact same approach the
// fitmanager-kiosk Electron app uses in its renderer process, ported here
// so the web panel's Câmera screen can do live recognition too, with no
// server round-trip for the detection/comparison itself.
import * as faceapi from "face-api.js";
import type { Aluno } from "./types";

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

/** Loads the face-api.js models from /public/models (served as /models). Safe to call repeatedly. */
export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
    await faceapi.nets.faceLandmark68Net.loadFromUri("/models");
    await faceapi.nets.faceRecognitionNet.loadFromUri("/models");
    modelsLoaded = true;
  })();
  return loadingPromise;
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedFace {
  embedding: number[];
  box: FaceBox;
}

/** Detects the single most prominent face in a live <video> element. */
export async function detectFace(video: HTMLVideoElement): Promise<DetectedFace | null> {
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const result = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();
  if (!result) return null;
  return { embedding: Array.from(result.descriptor), box: result.detection.box };
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export interface MatchResult {
  matched: boolean;
  aluno: Aluno | null;
  distance: number;
}

/**
 * Compares a live embedding against every aluno's cached faceEmbedding and
 * returns the closest match under the threshold. Lower distance = more
 * similar; face-api.js's 128-d descriptors typically match the same person
 * below ~0.6 and different people above it.
 */
export function findBestMatch(embedding: number[], alunos: Aluno[], threshold: number): MatchResult {
  let best: Aluno | null = null;
  let bestDistance = Infinity;

  for (const aluno of alunos) {
    if (!aluno.faceEmbedding || aluno.faceEmbedding.length === 0) continue;
    const distance = euclideanDistance(embedding, aluno.faceEmbedding);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = aluno;
    }
  }

  if (best && bestDistance <= threshold) return { matched: true, aluno: best, distance: bestDistance };
  return { matched: false, aluno: null, distance: bestDistance };
}
