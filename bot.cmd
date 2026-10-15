@echo off
rem Adds an AI partner by hand (F8 in the game does the same). Start the game first.
rem Options: see the top of tools\bot.js (for example --model sonnet).
set NODE=node
if exist "%~dp0tools\node\node.exe" set NODE="%~dp0tools\node\node.exe"
%NODE% "%~dp0tools\bot.js" %*
pause
