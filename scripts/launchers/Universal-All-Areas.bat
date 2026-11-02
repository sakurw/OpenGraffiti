@echo off
setlocal
cd /d "%~dp0..\.."
set "NODE=%~dp0..\..\.tools\node-v24.20.0-win-x64\node.exe"
if not exist "%NODE%" set "NODE=node"
powershell.exe -NoProfile -Command "if(Get-NetTCPConnection -LocalPort 3111 -State Listen -ErrorAction SilentlyContinue){exit 0}else{exit 1}"
if errorlevel 1 start "Universal All Areas Server" /min "%NODE%" "%~dp0..\..\scripts\serve-universal-all-areas.mjs"
if /I "%~1"=="--no-open" exit /b 0
start "" "http://127.0.0.1:3111/universal-all-areas.html"
