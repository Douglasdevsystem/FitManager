/**
 * The only bridge between the sandboxed renderer (camera UI) and the main
 * process (Firebase Admin, filesystem). Deliberately exposes a tiny,
 * specific API instead of raw Node/Firebase access — the renderer can never
 * read the service account, the .env, or the filesystem directly.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kiosk", {
  getEmbeddings: () => ipcRenderer.invoke("kiosk:get-embeddings"),

  recordCheckin: (payload) => ipcRenderer.invoke("kiosk:record-checkin", payload),

  onEmbeddingsUpdated: (callback) => {
    const handler = (_event, cache) => callback(cache);
    ipcRenderer.on("kiosk:embeddings-updated", handler);
    return () => ipcRenderer.removeListener("kiosk:embeddings-updated", handler);
  },
});
