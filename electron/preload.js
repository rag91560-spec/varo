const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateAvailable: (cb) => {
    ipcRenderer.on("update-available", (_, data) => cb(data))
    return () => ipcRenderer.removeAllListeners("update-available")
  },
  onUpdateProgress: (cb) => {
    ipcRenderer.on("update-progress", (_, data) => cb(data))
    return () => ipcRenderer.removeAllListeners("update-progress")
  },
  onUpdateDownloaded: (cb) => {
    ipcRenderer.on("update-downloaded", () => cb())
    return () => ipcRenderer.removeAllListeners("update-downloaded")
  },
})
