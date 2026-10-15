@echo off
rem Double-click to host a co-op session and get a link for a friend.
rem PowerShell 7 if it is installed, else the one every Windows has.
set PS=powershell
where pwsh >nul 2>nul && set PS=pwsh
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Online
pause
