@echo off
setlocal EnableExtensions
cd /d "%~dp0..\.."

set "PORT=3110"
set "URL=http://127.0.0.1:%PORT%/tocho-stylized-review-gallery-20261015.html"
set "NODE=%~dp0..\..\.tools\node-v24.20.0-win-x64\node.exe"
if not exist "%NODE%" (
  echo [ERROR] Bundled Node.js not found: "%NODE%"
  pause
  exit /b 1
)

powershell.exe -NoProfile -Command ^
  "try { $s=Invoke-RestMethod -Uri 'http://127.0.0.1:%PORT%/healthz' -TimeoutSec 2; if($s.service -eq 'tocho-review') { exit 0 } } catch {}; exit 1"
if errorlevel 1 (
  start "Tocho Review Server" /min "%NODE%" scripts\serve-tocho-review.mjs %PORT%
  powershell.exe -NoProfile -Command ^
    "$ok=$false; $until=(Get-Date).AddSeconds(20); do { try { $s=Invoke-RestMethod -Uri 'http://127.0.0.1:%PORT%/healthz' -TimeoutSec 2; if($s.service -eq 'tocho-review') {$ok=$true;break} } catch {}; Start-Sleep -Milliseconds 300 } while ((Get-Date) -lt $until); if($ok){exit 0}else{exit 1}"
  if errorlevel 1 (
    echo [ERROR] Tocho review server did not become ready on port %PORT%.
    echo Check that port %PORT% is not used by another application.
    pause
    exit /b 1
  )
)

if /I "%~1"=="--no-open" (
  echo Ready: %URL%
  exit /b 0
)
start "" "%URL%"
exit /b 0
