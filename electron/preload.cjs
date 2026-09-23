const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("nebula", {
  connect: (server) => ipcRenderer.invoke("connect", server),
  settings: () => ipcRenderer.invoke("settings"),
  setTheme: (theme) => ipcRenderer.invoke("theme", theme),
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
  chooseBackup: () => ipcRenderer.invoke("choose-backup"),
  backups: (name) => ipcRenderer.invoke("backups", name),
  backup: (name) => ipcRenderer.invoke("backup", name),
  restore: (name, file, confirmation) =>
    ipcRenderer.invoke("restore", name, file, confirmation),
  revealFolder: (name) => ipcRenderer.invoke("reveal-folder", name),
  onProgress: (callback) => {
    const listener = (_event, text) => callback(text);
    ipcRenderer.on("progress", listener);
    return () => ipcRenderer.removeListener("progress", listener);
  },
});
