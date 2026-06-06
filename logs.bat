@echo off
title Sleep Tracker - Logs
echo ============================================
echo  BACKEND LOG (logs\backend.log)
echo ============================================
type "%~dp0logs\backend.log" 2>nul || echo  (no log yet)
echo.
echo ============================================
echo  FRONTEND LOG (logs\frontend.log)
echo ============================================
type "%~dp0logs\frontend.log" 2>nul || echo  (no log yet)
echo.
pause
