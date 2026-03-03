const { app, BrowserWindow, shell, ipcMain } = require("electron")
const path = require("path")
const { spawn, fork } = require("child_process")
const http = require("http")
const { autoUpdater } = require("electron-updater")

const isDev = !app.isPackaged
const ROOT = path.join(__dirname, "..")
const BACKEND_PORT = 8000
const FRONTEND_PORT = 3100

let mainWindow = null
let backendProcess = null
let frontendProcess = null

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
      spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"], {
        stdio: "ignore",
      })
    } else {
      proc.kill("SIGTERM")
    }
  } catch {}
}

// ── Server Management ──

async function startBackend() {
  if (await isPortInUse(BACKEND_PORT)) {
    console.log("[electron] Backend already running on port", BACKEND_PORT)
    return
  }
  console.log("[electron] Starting backend...")
  if (isDev) {
    backendProcess = spawn(
      "python",
      [
        "-m", "uvicorn", "backend.server:app",
        "--host", "127.0.0.1",
        "--port", String(BACKEND_PORT),
        "--reload",
      ],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
    )
  } else {
    // Production: run Python backend from resources
    const resourceBase = path.join(process.resourcesPath)
    backendProcess = spawn(
      "python",
      [
        "-m", "uvicorn", "backend.server:app",
        "--host", "127.0.0.1",
        "--port", String(BACKEND_PORT),
      ],
      {
        cwd: resourceBase,
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
  }
  backendProcess.stdout?.on("data", (d) => process.stdout.write(`[backend] ${d}`))
  backendProcess.stderr?.on("data", (d) => process.stderr.write(`[backend] ${d}`))
  backendProcess.on("error", (err) => console.error("[backend] Error:", err))
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
  frontendProcess.stdout?.on("data", (d) => process.stdout.write(`[frontend] ${d}`))
  frontendProcess.stderr?.on("data", (d) => process.stderr.write(`[frontend] ${d}`))
  frontendProcess.on("error", (err) => console.error("[frontend] Error:", err))
}

// ── Window ──

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0c0c0f",
    show: false,
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

  mainWindow.once("ready-to-show", () => {
    mainWindow.show()
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
    // Mark body so React components can detect Electron + hide Next.js dev tools
    mainWindow.webContents.executeJavaScript(`
      document.documentElement.classList.add('is-electron');
      new MutationObserver(() => {
        document.querySelectorAll('button').forEach(b => {
          if (b.textContent?.includes('Next.js Dev Tools')) b.style.display = 'none';
        });
        document.querySelectorAll('nextjs-portal').forEach(e => e.style.display = 'none');
      }).observe(document.body, { childList: true, subtree: true });
    `)
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
  })
}

// ── Auto Update ──

autoUpdater.autoDownload = false
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

// ── App Lifecycle ──

function cleanup() {
  killProcess(backendProcess)
  killProcess(frontendProcess)
  backendProcess = null
  frontendProcess = null
}

app.whenReady().then(async () => {
  await startBackend()
  await startFrontend()

  console.log("[electron] Waiting for servers...")
  try {
    await Promise.all([
      waitForServer(BACKEND_PORT, 30000),
      waitForServer(FRONTEND_PORT, 30000),
    ])
  } catch (err) {
    console.error("[electron]", err.message)
    cleanup()
    app.quit()
    return
  }

  console.log("[electron] Servers ready, opening window")
  createWindow()
  setupAutoUpdater()
})

app.on("window-all-closed", () => {
  cleanup()
  app.quit()
})

app.on("before-quit", cleanup)
