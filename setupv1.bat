@echo off
setlocal
title editvideochatgpt - Setup

set "BASE_DIR=%~dp0"
set "ROOT=%BASE_DIR%skill1\03_PROJECT"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: May tinh chua cai Node.js. Vui long tai va cai dat Node.js truoc!
  pause
  exit /b 1
)

echo ====================================================
echo      CAI DAT THU VIEN CHO EDITVIDEOCHATGPT
echo ====================================================

echo.
echo [1/3] Dang cai dat Server API...
cd /d "%ROOT%\server-api"
call npm install
if errorlevel 1 goto :error

echo.
echo [2/3] Dang cai dat Web Dashboard...
cd /d "%ROOT%\web-dashboard"
call npm install
if errorlevel 1 goto :error

echo.
echo [3/3] Dang cai dat Remotion Engine...
cd /d "%ROOT%\remotion-engine"
call npm install
if errorlevel 1 goto :error

echo.
echo ====================================================
echo CAI DAT THANH CONG!
echo Hay dong cua so nay va mo file run_dashboard.bat de su dung.
echo ====================================================
pause
exit /b 0

:error
echo.
echo ERROR: Qua trinh cai dat gap loi. Vui long kiem tra lai ket noi mang!
pause
exit /b 1