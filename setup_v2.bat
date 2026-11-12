@echo off
setlocal
cd /d "%~dp0skill1\03_PROJECT\my-editor"
if errorlevel 1 goto fail
if not exist "node_modules\remotion\package.json" (
  echo ERROR: Run this file from the EXISTING D:\editvideochatgpt project after copying the upgrade.
  goto fail
)
for /f "delims=" %%V in ('node -p "require('./node_modules/remotion/package.json').version"') do set "REMOTION_VERSION=%%V"
for /f "delims=" %%V in ('node -p "require('./node_modules/react/package.json').version.split('.')[0]"') do set "REACT_MAJOR=%%V"
if not defined REMOTION_VERSION goto fail
if not defined REACT_MAJOR goto fail
call npm install --save-exact @remotion/player@%REMOTION_VERSION%
if errorlevel 1 goto fail
call npm install --save-dev esbuild @types/react-dom@%REACT_MAJOR%
if errorlevel 1 goto fail
call npx tsc --noEmit
if errorlevel 1 goto fail
echo.
echo Setup complete. Start your existing run_dashboard.bat.
pause
exit /b 0
:fail
echo.
echo Setup failed. Read the error above before continuing.
pause
exit /b 1
