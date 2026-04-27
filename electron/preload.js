const { contextBridge, ipcRenderer, webUtils } = require("electron")

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
  getPathForFile: (file) => webUtils.getPathForFile(file),
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
  selectGameFolder: () => ipcRenderer.invoke("select-game-folder"),
  selectApkFile: () => ipcRenderer.invoke("select-apk-file"),
  selectApkFolder: () => ipcRenderer.invoke("select-apk-folder"),
  selectSubtitleFiles: () => ipcRenderer.invoke("select-subtitle-files"),
  selectVideoFiles: () => ipcRenderer.invoke("select-video-files"),
  selectVideoFolder: () => ipcRenderer.invoke("select-video-folder"),
  selectAudioFolder: () => ipcRenderer.invoke("select-audio-folder"),
  openHtmlGame: (opts) => ipcRenderer.invoke("open-html-game", opts),
  closeHtmlGame: (opts) => ipcRenderer.invoke("close-html-game", opts),
  showConfirm: (message) => ipcRenderer.invoke("show-confirm-dialog", message),
  registerKillHotkey: (key) => ipcRenderer.invoke("register-kill-hotkey", key),
  unregisterKillHotkey: () => ipcRenderer.invoke("unregister-kill-hotkey"),

  // Live Translation
  liveTranslation: {
    listSources: () => ipcRenderer.invoke("live:list-sources"),
    captureScreen: (opts) => ipcRenderer.invoke("live:capture-screen", opts),
    showOverlay: (opts) => ipcRenderer.invoke("live:show-overlay", opts || {}),
    hideOverlay: () => ipcRenderer.invoke("live:hide-overlay"),
    updateOverlay: (data) => ipcRenderer.invoke("live:update-overlay", { data }),
    setOverlayBounds: (bounds) => ipcRenderer.invoke("live:set-overlay-bounds", bounds),
    selectRegion: () => ipcRenderer.invoke("live:select-region"),
    confirmRegion: (region) => ipcRenderer.invoke("live:confirm-region", region),
    trackWindow: (sourceId) => ipcRenderer.invoke("live:track-window", { sourceId }),
    getWindowBounds: (sourceId) => ipcRenderer.invoke("live:get-window-bounds", { sourceId }),
    startAutoCapture: (opts) => ipcRenderer.invoke("live:start-auto-capture", opts),
    stopAutoCapture: () => ipcRenderer.invoke("live:stop-auto-capture"),
    registerHotkeys: () => ipcRenderer.invoke("live:register-hotkeys"),
    unregisterHotkeys: () => ipcRenderer.invoke("live:unregister-hotkeys"),
    // Events
    onOverlayData: (cb) => {
      const handler = (_, data) => cb(data)
      ipcRenderer.on("live:overlay-data", handler)
      return () => ipcRenderer.removeListener("live:overlay-data", handler)
    },
    onAutoCaptureFrame: (cb) => {
      const handler = (_, data) => cb(data)
      ipcRenderer.on("live:auto-capture-frame", handler)
      return () => ipcRenderer.removeListener("live:auto-capture-frame", handler)
    },
    onHotkeyCapture: (cb) => {
      const handler = () => cb()
      ipcRenderer.on("live:hotkey-capture", handler)
      return () => ipcRenderer.removeListener("live:hotkey-capture", handler)
    },
    onHotkeyOverlay: (cb) => {
      const handler = () => cb()
      ipcRenderer.on("live:hotkey-overlay", handler)
      return () => ipcRenderer.removeListener("live:hotkey-overlay", handler)
    },
    onHotkeyRegion: (cb) => {
      const handler = () => cb()
      ipcRenderer.on("live:hotkey-region", handler)
      return () => ipcRenderer.removeListener("live:hotkey-region", handler)
    },
  },
})
