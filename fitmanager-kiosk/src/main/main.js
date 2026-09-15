/**
 * Electron entry point. Runs in Node.js (no DOM) — this is where the
 * privileged work happens: Firebase Admin SDK, the local embeddings cache,
 * and the checkin write path. Face DETECTION itself happens in the renderer
 * (see src/renderer/face-detector.js), because that's the process with a
 * real browser Canvas/WebGL context, which face-api.js needs.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const { app, BrowserWindow, ipcMain } = require("electron");
const { ensureModelsDownloaded } = require("../../scripts/download-models");
const { initFirebaseAdmin } = require("../firebase/admin");
const { startEmbeddingsSync, getEmbeddingsCache } = require("../firebase/sync-embeddings");
const { recordCheckin, flushPendingCheckins } = require("../firebase/checkins");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    fullscreen: process.env.KIOSK_FULLSCREEN === "true",
    autoHideMenuBar: true,
    backgroundColor: "#050d1a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle("kiosk:get-embeddings", () => getEmbeddingsCache());
  ipcMain.handle("kiosk:record-checkin", (_event, payload) => recordCheckin(payload));
}

app.whenReady().then(async () => {
  console.log("[main] iniciando FitManager Kiosk...");

  try {
    await ensureModelsDownloaded();
  } catch (err) {
    console.error("[main] falha ao baixar modelos do face-api.js:", err.message);
  }

  registerIpcHandlers();
  createWindow();

  try {
    initFirebaseAdmin();
    await startEmbeddingsSync((cache) => {
      mainWindow?.webContents.send("kiosk:embeddings-updated", cache);
    });
    setInterval(flushPendingCheckins, 30_000);
  } catch (err) {
    console.error("[main] inicialização do Firebase falhou — rodando apenas com o cache local existente:", err.message);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
