@echo off
rem Starts the campaign manager on this PC and opens it in the browser.
rem Close this window to stop it.
cd /d "%~dp0"
if not exist node_modules call npm install
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:5173"
call npm run dev
pause
