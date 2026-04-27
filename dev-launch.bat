@echo off
rem Dev launcher for 게임번역기 — Electron + Next.js HMR + uvicorn --reload
rem Launched by taskbar shortcut. Keeps console visible for debugging.
title game-translator (dev)
cd /d "%~dp0"

rem Ensure Node/npm are available in PATH
where npm >nul 2>&1
if errorlevel 1 (
  echo [dev-launch] npm not found in PATH. Install Node.js first.
  pause
  exit /b 1
)

rem Ensure Python is available for backend dev
where python >nul 2>&1
if errorlevel 1 (
  echo [dev-launch] WARNING: python not found in PATH. Backend may fail to start.
)

echo [dev-launch] Starting Electron + Next.js dev + uvicorn --reload...
echo [dev-launch] Frontend HMR on :3100, backend reload on :8000
echo [dev-launch] Close this window or press Ctrl+C to stop.
echo.

call npm run electron:dev
echo.
echo [dev-launch] App exited. Press any key to close...
pause >nul
