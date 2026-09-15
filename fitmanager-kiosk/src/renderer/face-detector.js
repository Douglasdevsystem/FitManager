/**
 * Thin wrapper around face-api.js. Runs entirely in the renderer (browser)
 * context — this is a regular Chromium page, so face-api.js's Canvas/WebGL
 * backend works exactly like it would in any web app, no polyfills needed.
 */
const MODELS_URL = "../../models";

async function loadFaceModels() {
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL);
  await faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL);
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL);
  console.log("[face-detector] modelos carregados");
}

async function detectFace(videoEl) {
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const result = await faceapi.detectSingleFace(videoEl, options).withFaceLandmarks().withFaceDescriptor();
  if (!result) return null;
  return {
    embedding: Array.from(result.descriptor),
    box: result.detection.box,
  };
}
