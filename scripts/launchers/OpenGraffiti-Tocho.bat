@echo off
powershell.exe -NoProfile -File "%~dp0..\..\scripts\start-tocho-review.ps1" %*
if errorlevel 1 pause
