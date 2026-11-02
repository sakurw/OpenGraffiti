@echo off
setlocal EnableExtensions

cd /d "%~dp0..\.."

set "PORT=3100"
set "URL=http://127.0.0.1:%PORT%/universal-texture-demo.html"
set "NODE=%~dp0..\..\.tools\node-v24.20.0-win-x64\node.exe"

if not exist "%NODE%" (
  echo [ERROR] Node.js runtime not found:
  echo %NODE%
  pause
  exit /b 1
)

powershell.exe -NoProfile -Command ^
  "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"

if errorlevel 1 (
  start "OpenGraffiti Server" /min "%NODE%" server\index.mjs

  powershell.exe -NoProfile -Command ^
    "$deadline=(Get-Date).AddSeconds(15); do { if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 }; Start-Sleep -Milliseconds 250 } while ((Get-Date) -lt $deadline); exit 1"

  if errorlevel 1 (
    echo [ERROR] OpenGraffiti server did not start on port %PORT%.
    pause
    exit /b 1
  )
)

if /I "%~1"=="--no-open" exit /b 0

start "" "%URL%"
exit /b 0
