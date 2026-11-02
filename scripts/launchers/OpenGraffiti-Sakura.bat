@echo off
setlocal EnableExtensions
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\start-opengraffiti.ps1" -Terrain flat -Mural -Art sakura %*
if errorlevel 1 (
  echo.
  echo OpenGraffiti could not start. See the error above.
  pause
  exit /b 1
)
exit /b 0

