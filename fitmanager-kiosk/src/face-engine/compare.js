/**
 * Pure face-matching helpers — no DOM and no Node APIs, so this same file
 * works both as a CommonJS module (if ever needed from the main process)
 * and as a plain <script> tag in the renderer, which is where face-api.js
 * itself actually runs (it needs a browser's Canvas/WebGL, which the
 * Electron main process does not have — see src/renderer/face-detector.js).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.faceCompare = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  function euclideanDistance(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * Compares a live embedding against every cached student embedding and
   * returns the closest match under the given threshold. Lower distance =
   * more similar; face-api.js's 128-d descriptors typically match the same
   * person below ~0.6 and different people above it.
   */
  function findBestMatch(embedding, cache, threshold) {
    let best = null;
    let bestDistance = Infinity;

    for (const entry of cache) {
      const distance = euclideanDistance(embedding, entry.faceEmbedding);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    }

    if (best && bestDistance <= threshold) {
      return { matched: true, aluno: best, distance: bestDistance };
    }
    return { matched: false, aluno: null, distance: bestDistance };
  }

  return { euclideanDistance, findBestMatch };
});
