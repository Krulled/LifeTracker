@echo off
title Sleep Tracker - Install Startup Task
set "ROOT=%~dp0"
:: Strip trailing backslash
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "TASKNAME=SleepTracker"
set "SCRIPT=%ROOT%\start_hidden.vbs"

echo ============================================
echo  Sleep Tracker - Install Startup Task
echo ============================================
echo.
echo Task name : %TASKNAME%
echo Script    : %SCRIPT%
echo Trigger   : On login (1-minute delay)
echo.

schtasks /create ^
  /tn "%TASKNAME%" ^
  /tr "wscript.exe \"%SCRIPT%\"" ^
  /sc onlogon ^
  /delay 0001:00 ^
  /ru "%USERDOMAIN%\%USERNAME%" ^
  /rl limited ^
  /f >nul 2>&1

if %errorlevel% equ 0 (
    echo [OK] Startup task created successfully.
    echo      Sleep Tracker will launch automatically next time you log in.
) else (
    echo [ERROR] Failed to create startup task. Try running as Administrator.
)

echo.
pause
