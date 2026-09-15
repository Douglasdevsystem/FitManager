/**
 * Generates a face embedding from a student's stored photo. Runs the same
 * face-api.js models used by the kiosk, but here in a Cloud Function (plain
 * Node.js, no browser) — so it needs a Canvas/Image polyfill, unlike the
 * kiosk's renderer, which already has a real one.
 *
 * Uses @napi-rs/canvas (prebuilt native binary, no compiler needed) instead
 * of the classic "canvas" package — "canvas" requires a C++ toolchain to
 * build from source and has no prebuild for recent Node versions, which
 * made local development painful on this machine (and could just as easily
 * fail during a Cloud Build). @napi-rs/canvas ships prebuilt binaries for
 * every supported Node/OS combination instead.
 *
 * No @tensorflow/tfjs-node here either — face-api.js already bundles
 * TensorFlow.js and runs fine on its plain CPU backend for a single-image,
 * occasional Cloud Function call. tfjs-node would only matter for
 * high-throughput/real-time inference, which this isn't.
 *
 * Requires the same weight files the kiosk uses to be copied into
 * functions/models before deploying — see the README for the command.
 */
const faceapi = require("face-api.js");
const { Canvas, Image, ImageData, loadImage } = require("@napi-rs/canvas");
const path = require("path");

// face-api.js's own env glue calls `new Canvas()` with ZERO arguments, then
// sets canvas.width/height as plain property assignments afterwards (that's
// how node-canvas's Canvas allows being constructed). @napi-rs/canvas's
// Canvas constructor requires (width, height) up front and throws on
// undefined — so `new Canvas()` alone crashes with "Failed to convert napi
// value Undefined into rust type `i32`". Supplying our own
// createCanvasElement (which monkeyPatch happily accepts as an override)
// sidesteps that: construct with dummy dimensions, then let face-api.js's
// own createCanvas() reassign the real width/height right after — Canvas
// instances stay mutable, so that works fine.
faceapi.env.monkeyPatch({ Canvas, Image, ImageData, createCanvasElement: () => new Canvas(1, 1) });

const MODELS_DIR = path.join(__dirname, "models");

let modelsLoaded = false;

async function ensureModelsLoaded() {
  if (modelsLoaded) return;
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_DIR);
  modelsLoaded = true;
}

async function generateEmbeddingFromPhoto(photoUrl) {
  await ensureModelsLoaded();

  const res = await fetch(photoUrl);
  if (!res.ok) throw new Error(`Não foi possível baixar a foto (HTTP ${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const img = await loadImage(buffer);

  const detection = await faceapi
    .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) throw new Error("Nenhum rosto detectado na foto enviada");

  return Array.from(detection.descriptor);
}

module.exports = { generateEmbeddingFromPhoto };
