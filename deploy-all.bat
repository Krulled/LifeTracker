@echo off
title Deploy ALL — Life Tracker
color 0A
echo.
echo  ==========================================
echo   Life Tracker ^> Deploying to BOTH sites...
echo  ==========================================
echo.

set FLY=%USERPROFILE%\.fly\bin\flyctl.exe
set PROJECT=%~dp0

cd /d "%PROJECT%"

echo  --- [1/2] Deploying life-tracker-zach ---
"%FLY%" deploy --config fly.toml --remote-only
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  [FAILED] zach deploy did not complete. Check errors above.
    echo.
    pause
    exit /b 1
)

echo.
echo  --- [2/2] Deploying life-tracker-nev ---
"%FLY%" deploy --config fly.nev.toml --remote-only
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  [FAILED] nev deploy did not complete. Check errors above.
    echo.
    pause
    exit /b 1
)

echo.
echo  ==========================================
echo   Done! Both sites live:
echo   https://life-tracker-zach.fly.dev
echo   https://life-tracker-nev.fly.dev
echo  ==========================================
echo.
pause
