@echo off
title Sync — Pull Cloud DB to Local
color 0E
echo.
echo  ==========================================
echo   Life Tracker ^> Pulling cloud to local...
echo  ==========================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pull.ps1"
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  [FAILED] Check errors above.
    echo.
    pause
    exit /b 1
)
echo.
echo  ==========================================
echo   Done! Restart local server to apply.
echo  ==========================================
echo.
pause
