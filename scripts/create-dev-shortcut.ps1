# Create a Desktop shortcut for the dev-mode launcher.
# Target = electron.exe directly so Win11 "Pin to taskbar" works cleanly.
# Run: powershell -ExecutionPolicy Bypass -File scripts\create-dev-shortcut.ps1

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$electronExe = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
$iconPath    = Join-Path $projectRoot 'build\icon.ico'
$desktop     = [Environment]::GetFolderPath('Desktop')
$shortcut    = Join-Path $desktop 'Game-Translator-Dev.lnk'

if (-not (Test-Path $electronExe)) {
    Write-Error "electron.exe not found at: $electronExe`nRun 'npm install' first."
}

$wsh = New-Object -ComObject WScript.Shell
$link = $wsh.CreateShortcut($shortcut)
$link.TargetPath       = $electronExe
$link.Arguments        = '.'
$link.WorkingDirectory = $projectRoot
$link.IconLocation     = "$iconPath,0"
$link.Description      = '게임번역기 개발 모드 (HMR + uvicorn reload)'
$link.WindowStyle      = 1  # Normal window
$link.Save()

Write-Host ""
Write-Host "✓ Shortcut created:" -ForegroundColor Green
Write-Host "    $shortcut"
Write-Host ""
Write-Host "  Target:            $electronExe ."
Write-Host "  Working Directory: $projectRoot"
Write-Host "  Icon:              $iconPath"
Write-Host ""
Write-Host "To pin to taskbar:" -ForegroundColor Cyan
Write-Host "  1. Right-click the shortcut on Desktop"
Write-Host "  2. Click 'Show more options' (Win11)"
Write-Host "  3. Click 'Pin to taskbar'"
Write-Host ""
Write-Host "Test loop:" -ForegroundColor Cyan
Write-Host "  - Edit code → save → HMR applies automatically (frontend)"
Write-Host "  - Backend (.py) → uvicorn --reload picks up changes"
Write-Host "  - Need full restart? Close app → click taskbar icon"
