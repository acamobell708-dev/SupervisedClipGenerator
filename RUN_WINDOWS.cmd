@echo off
cd /d "%~dp0"
echo === SupervisedClipGenerator localhost ===
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 20+ is required. Install from https://nodejs.org/
  pause
  exit /b 1
)
where yt-dlp >nul 2>&1
if errorlevel 1 (
  echo yt-dlp not found on PATH.
  echo Install with: winget install yt-dlp.yt-dlp
  echo Then close and reopen your terminal before starting SupervisedClipGenerator.
  echo If YT_DLP_PATH is set in .env to a custom executable, this warning can be ignored.
)
if not exist "node_modules" (
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)
call npm start
if errorlevel 1 pause
