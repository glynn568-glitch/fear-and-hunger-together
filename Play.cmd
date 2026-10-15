@echo off
rem Double-click to play. Asks whether you want an AI partner, a friend over the internet, or both.
rem PowerShell 7 if it is installed, else the one every Windows has.
set PS=powershell
where pwsh >nul 2>nul && set PS=pwsh
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Menu
pause
