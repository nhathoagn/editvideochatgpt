@echo off
setlocal
set "ROOT=D:\editvideochatgpt"
set "SERVER=%ROOT%\server"
set "EDITOR=%ROOT%\skill1\03_PROJECT\my-editor"

if not exist "%SERVER%\server.js" (
  echo ERROR: server.js not found.
  pause
  exit /b 1
)

if not exist "%EDITOR%\package.json" (
  echo ERROR: Remotion package.json not found.
  pause
  exit /b 1
)

start "Video Dashboard - Node" /min /D "%SERVER%" cmd /k "node server.js"
start "Video Dashboard - Remotion" /min /D "%EDITOR%" cmd /k "npm run dev -- --port=3000 --no-open"

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:3001"
endlocal