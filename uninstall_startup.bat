@echo off
title Sleep Tracker - Remove Startup Task
set "TASKNAME=SleepTracker"

echo Removing startup task "%TASKNAME%"...
schtasks /delete /tn "%TASKNAME%" /f >nul 2>&1

if %errorlevel% equ 0 (
    echo [OK] Startup task removed. Sleep Tracker will no longer launch at login.
) else (
    echo [INFO] Task not found - may already have been removed.
)

echo.
pause
