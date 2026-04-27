@echo off
rem Fast dev launcher — Next.js dev를 별도 창에서 먼저 띄우고, electron은 그 후 실행
rem 이렇게 하면 electron이 spawn한 dev의 stdio:ignore 문제로 인한 hang을 회피
title game-translator (launcher)
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo [launcher] npm not found in PATH. Install Node.js first.
  pause
  exit /b 1
)

rem 포트 3100이 이미 listen 중이면 dev 띄우지 않음 (재실행 시)
netstat -ano | findstr ":3100 " | findstr LISTENING >nul
if not errorlevel 1 (
  echo [launcher] Frontend already running on port 3100, skipping dev start.
  goto :launch_electron
)

echo [launcher] Starting Next.js dev in separate window...
start "game-translator (next dev)" cmd /k "cd /d %~dp0 && npm run dev"

echo [launcher] Waiting for frontend to be ready on port 3100...
:wait_loop
timeout /t 1 /nobreak >nul
netstat -ano | findstr ":3100 " | findstr LISTENING >nul
if errorlevel 1 goto :wait_loop
echo [launcher] Frontend ready.

:launch_electron
echo [launcher] Starting Electron...
call npx electron .

echo.
echo [launcher] Electron exited. Next.js dev window remains open.
echo [launcher] Press any key to close this launcher window...
pause >nul
