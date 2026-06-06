@echo off
title Sleep Tracker
set "ROOT=%~dp0"

echo ============================================
echo  Sleep Tracker MVP - Starting up...
echo ============================================
echo.

if not exist "%ROOT%logs" mkdir "%ROOT%logs"

echo [1/2] Starting Flask backend (port 3030)...
netstat -ano | findstr ":3030 " >nul 2>&1
if %errorlevel% equ 0 (
    echo  [SKIP] Backend already running on port 3030.
) else (
    if exist "%ROOT%backend\venv\Scripts\python.exe" (
        start /B /D "%ROOT%backend" "" cmd /c "venv\Scripts\python.exe app.py > ..\logs\backend.log 2>&1"
    ) else (
        start /B /D "%ROOT%backend" "" cmd /c "python app.py > ..\logs\backend.log 2>&1"
    )
)


timeout /t 3 /nobreak >nul

echo [2/2] Starting Vite frontend (port 9999)...
netstat -ano | findstr ":9999 " >nul 2>&1
if %errorlevel% equ 0 (
    echo  [SKIP] Frontend already running on port 9999.
) else (
    start /B /D "%ROOT%frontend" "" cmd /c "npm run dev > ..\logs\frontend.log 2>&1"
)

echo.
echo ============================================
echo  Both servers running in the background.
echo  Frontend : http://localhost:9999
echo  Backend  : http://localhost:3030
echo  Logs     : logs\backend.log / frontend.log
echo.
echo  Run stop.bat to shut everything down.
echo ============================================
echo.
pause
