@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo   Ciallo Reader - local preview
echo   ---------------------------------------------
echo.

if not exist "node_modules" (
  echo   node_modules is missing, running npm ci ...
  call npm ci
  if errorlevel 1 goto :fail
)

if not exist "dist\index.html" (
  echo   dist is missing, building production bundle ...
  call npm run build
  if errorlevel 1 goto :fail
)

echo   Starting local server (production build) ...
echo.
node "scripts\serve-web.mjs" --open
goto :eof

:fail
echo.
echo   Build failed. Scroll up for the first error line.
echo.
pause
exit /b 1
