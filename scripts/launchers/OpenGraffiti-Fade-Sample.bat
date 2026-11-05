@echo off
setlocal EnableExtensions
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\start-opengraffiti.ps1" -Mural -Art guardian %*
if errorlevel 1 (
  echo OpenGraffiti fade sample could not start.
  pause
  exit /b 1
)
exit /b 0
