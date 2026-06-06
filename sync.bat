@echo off
title Sync — Push Local DB to Cloud
color 0B
echo.
echo  ==========================================
echo   Life Tracker ^> Syncing local to cloud...
echo  ==========================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync.ps1"
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
echo   Done! https://life-tracker-zach.fly.dev
echo  ==========================================
echo.
pause
