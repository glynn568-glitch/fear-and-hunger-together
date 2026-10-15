@echo off
rem Double-click to play on this PC with an AI partner (see README.md and settings.json).
rem PowerShell 7 if it is installed, else the one every Windows has.
set PS=powershell
where pwsh >nul 2>nul && set PS=pwsh
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Partner
pause
