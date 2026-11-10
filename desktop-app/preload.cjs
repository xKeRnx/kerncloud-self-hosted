const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("kernLocal", {
  action: (command, input) =>
    ipcRenderer.invoke("local:action", command, input),
  ready: () => ipcRenderer.send("local:renderer-ready"),
  onLog: (callback) =>
    ipcRenderer.on("local:log", (_event, text) => callback(text)),
  onProgress: (callback) =>
    ipcRenderer.on("local:progress", (_event, state) => callback(state)),
  onUpdates: (callback) =>
    ipcRenderer.on("local:updates", (_event, state) => callback(state)),
});
