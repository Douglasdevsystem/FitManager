// Client-side face detection + matching. Runs entirely in the browser
// (Canvas/WebGL via face-api.js) — the exact same approach the
// fitmanager-kiosk Electron app uses in its renderer process, ported here
// so the web panel's Câmera screen can do live recognition too, with no
// server round-trip for the detection/comparison itself.
import * as faceapi from "face-api.js";
import type { Aluno } from "./types";

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

/**
 * Loads the face-api.js models from /public/models (served as /models).
 * Safe to call repeatedly. Runs entirely offline once loaded — detection and
 * matching never touch the network again (no Firebase involved in the loop).
 * The 3 model files are fetched in parallel instead of one after another,
 * and Vercel serves /models with a long-lived immutable cache (see
 * vercel.json), so this download only really happens once per browser.
 */
export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
  ]).then(() => {
    modelsLoaded = true;
  });
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

/**
 * Detects the face closest to the camera in a live <video> element.
 *
 * Deliberately uses detectAllFaces + picks the LARGEST bounding box instead
 * of face-api.js's own detectSingleFace, which picks the highest-*confidence*
 * detection — not necessarily the person actually standing in front of the
 * camera. At a real entrance, other people walking by in the background are
 * a normal occurrence; without this, a bystander's face can end up being
 * the one that gets matched (and checked in) instead of whoever is actually
 * trying to get in. The closest face to the camera is reliably the largest
 * one in frame, so "biggest box wins" is the right heuristic here.
 */
export async function detectFace(video: HTMLVideoElement): Promise<DetectedFace | null> {
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const results = await faceapi.detectAllFaces(video, options).withFaceLandmarks().withFaceDescriptors();
  if (results.length === 0) return null;

  const closest = results.reduce((largest, current) =>
    current.detection.box.width * current.detection.box.height > largest.detection.box.width * largest.detection.box.height
      ? current
      : largest
  );
  return { embedding: Array.from(closest.descriptor), box: closest.detection.box };
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
