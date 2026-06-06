@echo off
title Deploy — Life Tracker
color 0A
echo.
echo  ==========================================
echo   Life Tracker ^> Deploying to Fly.io...
echo  ==========================================
echo.

set FLY=%USERPROFILE%\.fly\bin\flyctl.exe
set PROJECT=%~dp0

cd /d "%PROJECT%"

"%FLY%" deploy --remote-only
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  [FAILED] Deploy did not complete. Check errors above.
    echo.
    pause
    exit /b 1
)

echo.
echo  ==========================================
echo   Done! Live at:
echo   https://life-tracker-zach.fly.dev
echo  ==========================================
echo.
pause
