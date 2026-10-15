@echo off
rem Double-click to host a session in which your friend's browser never learns your IP address.
rem PowerShell 7 if it is installed, else the one every Windows has.
set PS=powershell
where pwsh >nul 2>nul && set PS=pwsh
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Online -Private
pause
