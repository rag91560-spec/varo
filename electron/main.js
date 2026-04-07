const { app, BrowserWindow, shell, ipcMain, dialog, desktopCapturer, globalShortcut, screen } = require("electron")
const path = require("path")
const { spawn, fork } = require("child_process")
const http = require("http")
const { autoUpdater } = require("electron-updater")

// EPIPE 완전 차단 — Electron에서 부모 파이프 닫힌 후 stdout/stderr write 시 발생
process.stdout?.on("error", () => {})
process.stderr?.on("error", () => {})
process.on("uncaughtException", (err) => {
  if (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED") return
  // console.error도 EPIPE 유발하므로 dialog만 사용
  try { require("electron").dialog.showErrorBox("Error", `${err.stack || err.message}`) } catch {}
})

const isDev = !app.isPackaged
const ROOT = path.join(__dirname, "..")
const BACKEND_PORT = 8000
const FRONTEND_PORT = 3100

// userData 경로를 고정 — NSIS installer와 일치시키기 위해
// app.getPath("userData")는 productName("게임번역기")을 사용하지만
// 영문 경로로 통일하여 한국어 경로 문제 방지
if (!isDev) {
  app.setPath("userData", path.join(app.getPath("appData"), "game-translator"))
}

let mainWindow = null
let backendProcess = null
let frontendProcess = null
const gameWindows = new Map() // gameId -> BrowserWindow
let overlayWindow = null
let regionSelectWindow = null
let autoCaptureInterval = null
let trackingWindowId = null

// ── Helpers ──

function isPortInUse(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, () => resolve(true))
    req.on("error", () => resolve(false))
    req.end()
  })
}

function waitForServer(port, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      const req = http.get(`http://localhost:${port}`, () => resolve(true))
      req.on("error", () => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Timeout waiting for port ${port}`))
        } else {
          setTimeout(check, 500)
        }
      })
      req.end()
    }
    check()
  })
}

function killProcess(proc) {
  if (!proc || proc.killed) return
  try {
    if (process.platform === "win32") {
      const { execSync } = require("child_process")
      try {
        execSync(`taskkill /pid ${proc.pid} /f /t`, { stdio: "ignore", timeout: 5000 })
      } catch {}
    } else {
      proc.kill("SIGTERM")
    }
  } catch {}
}

/** Kill any process listening on a port (fallback for orphaned children) */
function killByPort(port) {
  if (process.platform !== "win32") return
  const { execSync } = require("child_process")
  try {
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { stdio: "pipe", timeout: 3000 }).toString()
    const match = out.match(/LISTENING\s+(\d+)/)
    if (match) {
      execSync(`taskkill /pid ${match[1]} /f /t`, { stdio: "ignore", timeout: 3000 })
    }
  } catch {}
}

let _cachedPython = null
function findPython() {
  if (_cachedPython) return _cachedPython
  const { execSync } = require("child_process")
  for (const cmd of ["python", "python3", "py"]) {
    try {
      // Get the full path to python executable so DLL resolution works correctly
      const fullPath = execSync(`${cmd} -c "import sys; print(sys.executable)"`, { encoding: "utf-8" }).trim()
      if (fullPath) {
        _cachedPython = fullPath
        return fullPath
      }
    } catch {}
  }
  return null
}

// ── Server Management ──

async function startBackend() {
  if (await isPortInUse(BACKEND_PORT)) {
    console.log("[electron] Backend already running on port", BACKEND_PORT)
    return
  }
  console.log("[electron] Starting backend...")
  if (isDev) {
    const pythonCmd = findPython()
    if (!pythonCmd) {
      dialog.showErrorBox(
        "Python Not Found",
        "Python is required to run the backend in dev mode.\nPlease install Python 3.10+ from https://python.org and restart the app."
      )
      return
    }
    backendProcess = spawn(
      pythonCmd,
      [
        "-m", "uvicorn", "backend.server:app",
        "--host", "127.0.0.1",
        "--port", String(BACKEND_PORT),
        "--reload",
      ],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } }
    )
  } else {
    // Production: run PyInstaller-built backend.exe
    // Use userData for persistent data (survives app updates)
    const backendExe = path.join(process.resourcesPath, "backend-dist", "backend.exe")
    const dataDir = path.join(app.getPath("userData"), "data")
    const fs = require("fs")
    fs.mkdirSync(dataDir, { recursive: true })

    // One-time migration: copy DB from old location to userData
    const userDb = path.join(dataDir, "library.db")
    if (!fs.existsSync(userDb) || fs.statSync(userDb).size < 1024) {
      const copyRecursive = (src, dest) => {
        if (fs.statSync(src).isDirectory()) {
          fs.mkdirSync(dest, { recursive: true })
          for (const item of fs.readdirSync(src)) {
            copyRecursive(path.join(src, item), path.join(dest, item))
          }
        } else {
          fs.copyFileSync(src, dest)
        }
      }

      // Search order for old DB:
      // 1. resources/data/ (bundled with older builds)
      // 2. Previous install paths (NSIS overwrites resources/ on update)
      const oldCandidates = [
        // 이전 버전의 userData (한국어 경로 사용하던 시절)
        path.join(app.getPath("appData"), "게임번역기", "data"),
        path.join(process.resourcesPath, "data"),
        // Common install locations where previous version may have stored data
        path.join(path.dirname(process.resourcesPath), "..", "resources", "data"),
        path.join(app.getPath("home"), "AppData", "Local", "Programs", "game-translator", "resources", "data"),
        path.join("C:\\Program Files", "게임번역기", "resources", "data"),
        path.join("C:\\Program Files (x86)", "게임번역기", "resources", "data"),
      ]

      for (const oldDataDir of oldCandidates) {
        const oldDb = path.join(oldDataDir, "library.db")
        try {
          if (fs.existsSync(oldDb) && fs.statSync(oldDb).size > 1024) {
            console.log("[migration] Found old DB at:", oldDataDir)
            copyRecursive(oldDataDir, dataDir)
            break
          }
        } catch {}
      }
    }

    backendProcess = spawn(
      backendExe,
      [
        "--host", "127.0.0.1",
        "--port", String(BACKEND_PORT),
        "--data-dir", dataDir,
      ],
      {
        cwd: path.join(process.resourcesPath, "backend-dist"),
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
  }
  backendProcess.stdout?.on("data", () => {})
  backendProcess.stderr?.on("data", () => {})
  backendProcess.stdout?.on("error", () => {})
  backendProcess.stderr?.on("error", () => {})
  backendProcess.on("error", (err) => {
    if (!isDev) {
      try {
        dialog.showErrorBox(
          "Backend Error",
          `백엔드 실행 실패: ${err.message}\n\nWindows Defender나 백신이 backend.exe를 차단했을 수 있습니다.\n앱 폴더를 백신 예외에 추가해주세요.`
        )
      } catch {}
    }
  })
  backendProcess.on("exit", (code) => {
    if (code !== null && code !== 0 && !isDev) {
      try {
        dialog.showErrorBox(
          "Backend Crashed",
          `백엔드가 비정상 종료되었습니다 (코드: ${code}).\n앱을 재시작해주세요.`
        )
      } catch {}
    }
  })
}

async function startFrontend() {
  if (await isPortInUse(FRONTEND_PORT)) {
    console.log("[electron] Frontend already running on port", FRONTEND_PORT)
    return
  }
  console.log("[electron] Starting frontend...")
  if (isDev) {
    frontendProcess = spawn(
      "npm", ["run", "dev", "--", "--port", String(FRONTEND_PORT)],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], shell: true }
    )
  } else {
    // Production: run Next.js standalone server
    const serverJs = path.join(process.resourcesPath, "frontend", "server.js")
    frontendProcess = fork(serverJs, [], {
      env: {
        ...process.env,
        PORT: String(FRONTEND_PORT),
        HOSTNAME: "localhost",
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    })
  }
  // 파이프 읽되 에러 무시 (EPIPE 방지)
  frontendProcess.stdout?.on("data", () => {})
  frontendProcess.stderr?.on("data", () => {})
  frontendProcess.stdout?.on("error", () => {})
  frontendProcess.stderr?.on("error", () => {})
  frontendProcess.on("error", () => {})
}

// ── Window ──

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0c0c0f",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    show: false,
    acceptFirstMouse: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0c0c0f",
      symbolColor: "#9898a3",
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.loadURL(`http://localhost:${FRONTEND_PORT}`)

  // Show window when ready, with timeout fallback
  let shown = false
  const showOnce = () => {
    if (shown || !mainWindow) return
    shown = true
    mainWindow.show()
  }

  mainWindow.once("ready-to-show", showOnce)

  // Fallback: force show after 15s even if page fails to load
  setTimeout(showOnce, 15000)

  // Handle load failure — show error page instead of staying hidden
  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDesc, validatedURL) => {
    console.error(`[electron] Page load failed: ${errorCode} ${errorDesc} (${validatedURL})`)
    showOnce()
    mainWindow.webContents.loadURL(`data:text/html;charset=utf-8,
      <html><body style="background:#0c0c0f;color:#e0e0e0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px">
        <h2>서버 시작 실패</h2>
        <p style="color:#888;font-size:14px">프론트엔드 서버에 연결할 수 없습니다 (${errorDesc})</p>
        <p style="color:#666;font-size:12px">Python이 설치되어 있는지 확인하고, 앱을 재시작해주세요.</p>
        <button onclick="location.href='http://localhost:${FRONTEND_PORT}'"
          style="margin-top:8px;padding:8px 20px;background:#6366f1;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px">
          다시 시도
        </button>
      </body></html>
    `)
  })

  // Inject Electron-specific CSS (drag region, titlebar padding)
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.insertCSS(`
      /* Electron drag region — sidebar header becomes the drag handle */
      .sidebar-drag-region {
        -webkit-app-region: drag;
      }
      .sidebar-drag-region a,
      .sidebar-drag-region button {
        -webkit-app-region: no-drag;
      }
      /* Push sidebar down for titlebar overlay */
      .electron-titlebar-pad {
        padding-top: 8px;
      }
      /* Reserve space for titlebar overlay buttons (close/min/max) */
      html.is-electron main {
        padding-right: 140px;
      }
      /* Hide Next.js dev tools button */
      button[data-nextjs-dev-tools-button],
      [data-nextjs-dev-tools],
      body > button:last-of-type[style*="position"] {
        display: none !important;
      }
      nextjs-portal { display: none !important; }
    `)
    // Mark body so React components can detect Electron
    mainWindow.webContents.executeJavaScript(`
      document.documentElement.classList.add('is-electron');
    `)
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: "detach" })
      mainWindow.webContents.executeJavaScript(`
        new MutationObserver(() => {
          document.querySelectorAll('button').forEach(b => {
            if (b.textContent?.includes('Next.js Dev Tools')) b.style.display = 'none';
          });
          document.querySelectorAll('nextjs-portal').forEach(e => e.style.display = 'none');
        }).observe(document.body, { childList: true, subtree: true });
      `)
    }
  })

  // External links open in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) {
      shell.openExternal(url)
      return { action: "deny" }
    }
    return { action: "allow" }
  })

  mainWindow.on("closed", () => {
    mainWindow = null
    // Main window closed = user wants to quit. Force cleanup and exit.
    cleanup()
    app.quit()
  })
}

// ── Auto Update ──

autoUpdater.autoDownload = true
autoUpdater.setFeedURL({
  provider: "generic",
  url: "https://api.closedclaws.com/api/update",
})

function setupAutoUpdater() {
  // Check for updates 5 seconds after window loads
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)

  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("update-available", {
      version: info.version,
      releaseDate: info.releaseDate,
    })
  })

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("update-progress", {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update-downloaded")
  })

  autoUpdater.on("error", (err) => {
    console.error("[updater] Error:", err.message)
  })
}

// ── IPC Handlers ──

ipcMain.handle("get-app-version", () => app.getVersion())
ipcMain.handle("check-for-updates", async () => {
  try {
    const result = await autoUpdater.checkForUpdates()
    return result?.updateInfo ?? null
  } catch {
    return null
  }
})
ipcMain.handle("download-update", () => autoUpdater.downloadUpdate())
ipcMain.handle("install-update", () => autoUpdater.quitAndInstall())

// Confirm dialog (native)
ipcMain.handle("show-confirm-dialog", async (event, message) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showMessageBox(win || mainWindow, {
    type: "warning",
    buttons: ["Cancel", "OK"],
    defaultId: 0,
    cancelId: 0,
    message: typeof message === "string" ? message : "Are you sure?",
  })
  return result.response === 1
})

// Game folder / ZIP dialog
ipcMain.handle("select-game-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select game folder or ZIP",
    properties: ["openDirectory", "openFile"],
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  })
  return result.filePaths[0] || ""
})

// APK file dialogs
ipcMain.handle("select-apk-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select APK files",
    filters: [{ name: "APK", extensions: ["apk"] }],
    properties: ["openFile", "multiSelections"],
  })
  return result.filePaths
})

ipcMain.handle("select-apk-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select folder containing APK files",
    properties: ["openDirectory"],
  })
  return result.filePaths[0] || ""
})

// Subtitle/text file dialog
ipcMain.handle("select-subtitle-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select subtitle/text files",
    filters: [{ name: "Subtitle", extensions: ["srt", "ass", "ssa", "vtt", "txt"] }],
    properties: ["openFile", "multiSelections"],
  })
  return result.filePaths
})

// Video file dialogs
ipcMain.handle("select-video-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select video files",
    filters: [{ name: "Video", extensions: ["mp4", "mkv", "webm", "avi", "mov"] }],
    properties: ["openFile", "multiSelections"],
  })
  return result.filePaths
})

ipcMain.handle("select-video-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select folder containing video files",
    properties: ["openDirectory"],
  })
  return result.filePaths[0] || ""
})

// HTML game window
ipcMain.handle("open-html-game", (event, { gameId, title, serveUrl }) => {
  const existing = gameWindows.get(gameId)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    title: title || "Game",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  win.loadURL(`http://localhost:${BACKEND_PORT}${serveUrl}`)

  // F11 fullscreen toggle, ESC to exit fullscreen
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown") {
      if (input.key === "F11") {
        win.setFullScreen(!win.isFullScreen())
        e.preventDefault()
      } else if (input.key === "Escape" && win.isFullScreen()) {
        win.setFullScreen(false)
        e.preventDefault()
      }
    }
  })

  win.on("closed", () => {
    gameWindows.delete(gameId)
  })

  gameWindows.set(gameId, win)
})

ipcMain.handle("close-html-game", (event, { gameId }) => {
  const win = gameWindows.get(gameId)
  if (win && !win.isDestroyed()) {
    win.close()
  }
  gameWindows.delete(gameId)
})

// ── Live Translation IPC ──

// List available capture sources (windows/screens)
ipcMain.handle("live:list-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  })
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    icon: s.appIcon ? s.appIcon.toDataURL() : null,
    isScreen: s.id.startsWith("screen:"),
  }))
})

// Capture a specific source and return base64 image
ipcMain.handle("live:capture-screen", async (event, { sourceId, region }) => {
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    thumbnailSize: { width: 1920, height: 1080 },
  })
  const source = sources.find((s) => s.id === sourceId)
  if (!source) return { error: "Source not found" }

  let image = source.thumbnail
  if (region && region.x != null) {
    image = image.crop({
      x: Math.round(region.x),
      y: Math.round(region.y),
      width: Math.round(region.width),
      height: Math.round(region.height),
    })
  }
  return { image: image.toPNG().toString("base64") }
})

// Overlay window management
ipcMain.handle("live:show-overlay", (event, { bounds }) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show()
    if (bounds) overlayWindow.setBounds(bounds)
    return
  }

  // Default: full primary display (transparent except for text blocks)
  const display = screen.getPrimaryDisplay()
  const overlayBounds = bounds || {
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
  }

  overlayWindow = new BrowserWindow({
    ...overlayBounds,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    focusable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Windows: setIgnoreMouseEvents(true) makes all clicks pass through
  overlayWindow.setIgnoreMouseEvents(true)
  overlayWindow.loadURL(`http://localhost:${FRONTEND_PORT}/overlay`)

  // Inject transparent background override (ensure no white flash)
  overlayWindow.webContents.on("did-finish-load", () => {
    overlayWindow.webContents.insertCSS(`
      html, body { background: transparent !important; margin: 0; padding: 0; overflow: hidden; }
    `)
  })

  overlayWindow.on("closed", () => { overlayWindow = null })
})

ipcMain.handle("live:hide-overlay", () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide()
  }
})

ipcMain.handle("live:update-overlay", (event, { data }) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("live:overlay-data", data)
  }
})

ipcMain.handle("live:set-overlay-bounds", (event, bounds) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setBounds(bounds)
  }
})

// Region selection window
ipcMain.handle("live:select-region", async () => {
  return new Promise((resolve) => {
    if (regionSelectWindow && !regionSelectWindow.isDestroyed()) {
      regionSelectWindow.focus()
      return resolve(null)
    }

    const display = screen.getPrimaryDisplay()
    regionSelectWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      fullscreen: true,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    regionSelectWindow.loadURL(`http://localhost:${FRONTEND_PORT}/region-select`)

    ipcMain.once("live:region-selected", (e, region) => {
      if (regionSelectWindow && !regionSelectWindow.isDestroyed()) {
        regionSelectWindow.close()
      }
      regionSelectWindow = null
      resolve(region)
    })

    regionSelectWindow.on("closed", () => {
      regionSelectWindow = null
      resolve(null)
    })
  })
})

ipcMain.handle("live:confirm-region", (event, region) => {
  ipcMain.emit("live:region-selected", event, region)
})

// Window tracking (for overlay sync when game window moves)
ipcMain.handle("live:track-window", (event, { sourceId }) => {
  trackingWindowId = sourceId
})

ipcMain.handle("live:get-window-bounds", async (event, { sourceId }) => {
  // desktopCapturer doesn't provide window bounds directly;
  // we use a lightweight re-capture to track position changes
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 1, height: 1 },
  })
  const source = sources.find((s) => s.id === sourceId)
  return source ? { found: true, name: source.name } : { found: false }
})

// Auto capture control
ipcMain.handle("live:start-auto-capture", (event, { sourceId, intervalMs, region }) => {
  if (autoCaptureInterval) clearInterval(autoCaptureInterval)

  autoCaptureInterval = setInterval(async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["window", "screen"],
        thumbnailSize: { width: 1920, height: 1080 },
      })
      const source = sources.find((s) => s.id === sourceId)
      if (!source) return

      let image = source.thumbnail
      if (region && region.x != null) {
        image = image.crop({
          x: Math.round(region.x),
          y: Math.round(region.y),
          width: Math.round(region.width),
          height: Math.round(region.height),
        })
      }

      const b64 = image.toPNG().toString("base64")
      mainWindow?.webContents.send("live:auto-capture-frame", { image: b64 })
    } catch (err) {
      console.error("[live] Auto capture error:", err.message)
    }
  }, intervalMs || 2000)
})

ipcMain.handle("live:stop-auto-capture", () => {
  if (autoCaptureInterval) {
    clearInterval(autoCaptureInterval)
    autoCaptureInterval = null
  }
})

// Global hotkeys for live translation
ipcMain.handle("live:register-hotkeys", () => {
  // Ctrl+Shift+T: Toggle live translation capture
  globalShortcut.register("CommandOrControl+Shift+T", () => {
    mainWindow?.webContents.send("live:hotkey-capture")
  })
  // Ctrl+Shift+O: Toggle overlay
  globalShortcut.register("CommandOrControl+Shift+O", () => {
    mainWindow?.webContents.send("live:hotkey-overlay")
  })
  // Ctrl+Shift+R: Select region
  globalShortcut.register("CommandOrControl+Shift+R", () => {
    mainWindow?.webContents.send("live:hotkey-region")
  })
})

ipcMain.handle("live:unregister-hotkeys", () => {
  globalShortcut.unregister("CommandOrControl+Shift+T")
  globalShortcut.unregister("CommandOrControl+Shift+O")
  globalShortcut.unregister("CommandOrControl+Shift+R")
})

// ── Kill Hotkey ──

let currentKillHotkey = null

ipcMain.handle("register-kill-hotkey", (event, accelerator) => {
  // Unregister previous kill hotkey if any
  if (currentKillHotkey) {
    try { globalShortcut.unregister(currentKillHotkey) } catch {}
  }
  try {
    const ok = globalShortcut.register(accelerator, () => {
      console.log("[electron] Kill hotkey triggered:", accelerator)
      cleanup()
      app.quit()
    })
    if (ok) {
      currentKillHotkey = accelerator
      console.log("[electron] Kill hotkey registered:", accelerator)
    }
    return ok
  } catch (err) {
    console.error("[electron] Failed to register kill hotkey:", err.message)
    return false
  }
})

ipcMain.handle("unregister-kill-hotkey", () => {
  if (currentKillHotkey) {
    try { globalShortcut.unregister(currentKillHotkey) } catch {}
    currentKillHotkey = null
  }
})

// ── App Lifecycle ──

function cleanup() {
  // Close all game windows
  for (const [id, win] of gameWindows) {
    if (!win.isDestroyed()) win.close()
  }
  gameWindows.clear()

  // Close overlay and region select windows
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
  if (regionSelectWindow && !regionSelectWindow.isDestroyed()) regionSelectWindow.close()
  overlayWindow = null
  regionSelectWindow = null

  // Stop auto capture
  if (autoCaptureInterval) {
    clearInterval(autoCaptureInterval)
    autoCaptureInterval = null
  }

  // Unregister hotkeys
  globalShortcut.unregisterAll()

  killProcess(backendProcess)
  killProcess(frontendProcess)
  // Fallback: kill orphaned processes by port (handles shell-spawned children)
  if (isDev) {
    killByPort(BACKEND_PORT)
    killByPort(FRONTEND_PORT)
  }
  backendProcess = null
  frontendProcess = null
}

// ── OCR Language Pack Auto-Install ──

async function ensureOcrLanguagePacks() {
  const needed = ["ja", "en-US", "ko", "zh-Hans-CN"]

  try {
    // Single elevated PowerShell: check + install missing packs
    const script = `
      $needed = @(${needed.map((l) => `'${l}'`).join(",")})
      $missing = @()
      foreach ($lang in $needed) {
        $cap = Get-WindowsCapability -Online -Name "Language.OCR~~~$lang~0.0.1.0"
        if ($cap.State -ne 'Installed') { $missing += $lang }
      }
      if ($missing.Count -eq 0) { Write-Host 'ALL_INSTALLED'; exit 0 }
      foreach ($lang in $missing) {
        Write-Host "Installing OCR: $lang"
        Add-WindowsCapability -Online -Name "Language.OCR~~~$lang~0.0.1.0" | Out-Null
      }
      Write-Host 'INSTALL_DONE'
    `.replace(/\n/g, " ")

    const result = await new Promise((resolve, reject) => {
      const ps = spawn("powershell", [
        "-Command",
        `Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -Command ${script.replace(/'/g, "'''")}' -Verb RunAs -Wait`
      ], { stdio: "pipe" })
      let out = ""
      ps.stdout?.on("data", (d) => { out += d.toString() })
      ps.on("close", (code) => resolve({ code, out }))
      ps.on("error", (err) => reject(err))
    })

    console.log("[electron] OCR language pack result:", result.code, result.out.trim())
  } catch (err) {
    console.warn("[electron] OCR language pack install failed:", err.message)
  }
}

app.whenReady().then(async () => {
  // Install OCR language packs in background (non-blocking)
  ensureOcrLanguagePacks().catch(() => {})

  await startBackend()
  await startFrontend()

  console.log("[electron] Waiting for servers...")
  try {
    await Promise.all([
      waitForServer(BACKEND_PORT, 30000),
      waitForServer(FRONTEND_PORT, 30000),
    ])
  } catch (err) {
    console.error("[electron] Server startup failed:", err.message)
    // Still create window to show error instead of silently quitting
    createWindow()
    setupAutoUpdater()
    return
  }

  console.log("[electron] Servers ready, opening window")
  createWindow()
  setupAutoUpdater()

  // Load kill hotkey from settings
  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.get(`http://localhost:${BACKEND_PORT}/api/settings`, (resp) => {
        let data = ""
        resp.on("data", (chunk) => { data += chunk })
        resp.on("end", () => {
          try { resolve(JSON.parse(data)) } catch { resolve({}) }
        })
      })
      req.on("error", () => resolve({}))
      req.setTimeout(3000, () => { req.destroy(); resolve({}) })
    })
    const hotkey = res.hotkey_kill
    if (hotkey && typeof hotkey === "string") {
      const ok = globalShortcut.register(hotkey, () => {
        console.log("[electron] Kill hotkey triggered:", hotkey)
        cleanup()
        app.quit()
      })
      if (ok) {
        currentKillHotkey = hotkey
        console.log("[electron] Kill hotkey auto-registered:", hotkey)
      }
    }
  } catch (err) {
    console.warn("[electron] Failed to load kill hotkey from settings:", err.message)
  }
})

app.on("window-all-closed", () => {
  cleanup()
  app.quit()
})

app.on("before-quit", cleanup)
