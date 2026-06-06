@echo off
title Sleep Tracker - Stop
echo Stopping Sleep Tracker...

for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3030 "') do (
    taskkill /F /PID %%p >nul 2>&1
)
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":9999 "') do (
    taskkill /F /PID %%p >nul 2>&1
)

echo Done.
timeout /t 2 /nobreak >nul
