@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo  WhatsApp Chat Recorder - MP4 backend
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found on this computer.
    echo.
    echo Please install it first from https://nodejs.org ^(the "LTS" version^),
    echo then double-click this file again.
    echo.
    pause
    exit /b 1
)

echo Checking dependencies ^(this only takes a while the first time^)...
call npm install
if errorlevel 1 (
    echo.
    echo [ERROR] "npm install" failed - see the messages above for details.
    echo.
    pause
    exit /b 1
)

echo.
echo Starting the MP4 backend...
echo ^(Leave this window open while recording chat videos. Close it when you're done.^)
echo.

call npm start
if errorlevel 1 (
    echo.
    echo [ERROR] The server stopped unexpectedly - see the messages above for details.
    echo.
    pause
    exit /b 1
)

pause
