const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateAvailable: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.on("update-available", handler)
    return () => ipcRenderer.removeListener("update-available", handler)
  },
  onUpdateProgress: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.on("update-progress", handler)
    return () => ipcRenderer.removeListener("update-progress", handler)
  },
  onUpdateDownloaded: (cb) => {
    const handler = () => cb()
    ipcRenderer.on("update-downloaded", handler)
    return () => ipcRenderer.removeListener("update-downloaded", handler)
  },
  selectApkFile: () => ipcRenderer.invoke("select-apk-file"),
  selectApkFolder: () => ipcRenderer.invoke("select-apk-folder"),
  selectSubtitleFiles: () => ipcRenderer.invoke("select-subtitle-files"),
  openHtmlGame: (opts) => ipcRenderer.invoke("open-html-game", opts),
  closeHtmlGame: (opts) => ipcRenderer.invoke("close-html-game", opts),
  showConfirm: (message) => ipcRenderer.invoke("show-confirm-dialog", message),
})
