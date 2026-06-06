@echo off
setlocal EnableDelayedExpansion
title Sleep Tracker - Setup

echo ============================================
echo  Sleep Tracker MVP - First-Time Setup
echo ============================================
echo.

set SETUP_OK=1

REM ════════════════════════════════════════════
REM  1. CHECK / INSTALL PYTHON
REM ════════════════════════════════════════════
echo [1/5] Checking Python...
python --version >nul 2>&1
if %errorlevel% equ 0 goto python_ok

echo  Python not found. Trying winget...
winget --version >nul 2>&1
if %errorlevel% equ 0 goto python_winget

:python_download
echo  winget not available. Downloading Python 3.12.4 installer...
set PY_INSTALLER=%TEMP%\python_installer.exe
powershell -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.4/python-3.12.4-amd64.exe' -OutFile '%TEMP%\python_installer.exe'"
echo  Running installer - CHECK the "Add Python to PATH" box if prompted...
"%TEMP%\python_installer.exe" /passive InstallAllUsers=0 PrependPath=1 Include_pip=1
del "%TEMP%\python_installer.exe" >nul 2>&1
goto python_verify

:python_winget
winget install --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements

:python_verify
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Python not detected after install.
    echo  Install manually: https://python.org  ^(check "Add to PATH"^)
    echo  Then re-run setup.bat
    set SETUP_OK=0
    goto node_check
)

:python_ok
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo  Found: %%v

REM ════════════════════════════════════════════
REM  2. CHECK pip
REM ════════════════════════════════════════════
echo.
echo [2/5] Checking pip...
pip --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  Bootstrapping pip...
    python -m ensurepip --upgrade
    python -m pip install --upgrade pip >nul 2>&1
)
for /f "tokens=*" %%v in ('pip --version 2^>^&1') do echo  Found: %%v

REM ════════════════════════════════════════════
REM  3. CHECK / INSTALL NODE.JS
REM ════════════════════════════════════════════
:node_check
echo.
echo [3/5] Checking Node.js...
node --version >nul 2>&1
if %errorlevel% equ 0 goto node_ok

echo  Node.js not found. Trying winget...
winget --version >nul 2>&1
if %errorlevel% equ 0 goto node_winget

:node_download
echo  Downloading Node.js 20 LTS installer...
powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.14.0/node-v20.14.0-x64.msi' -OutFile '%TEMP%\node_installer.msi'"
msiexec /i "%TEMP%\node_installer.msi" /passive /norestart
del "%TEMP%\node_installer.msi" >nul 2>&1
goto node_verify

:node_winget
winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements

:node_verify
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Node.js not detected after install.
    echo  Install manually: https://nodejs.org
    echo  Then re-run setup.bat
    set SETUP_OK=0
    goto deps_python
)

:node_ok
for /f "tokens=*" %%v in ('node --version 2^>^&1') do echo  Found: Node %%v
for /f "tokens=*" %%v in ('npm --version 2^>^&1') do echo  Found: npm  %%v

REM ════════════════════════════════════════════
REM  4. INSTALL PYTHON DEPENDENCIES (venv)
REM ════════════════════════════════════════════
:deps_python
echo.
echo [4/5] Setting up Python virtual environment...
cd /d "%~dp0backend"
if not exist venv (
    python -m venv venv
    if %errorlevel% neq 0 (
        echo  [ERROR] Failed to create venv.
        set SETUP_OK=0
        goto deps_node
    )
    echo  Created venv.
) else (
    echo  venv already exists.
)
venv\Scripts\pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo  [ERROR] pip install failed.
    set SETUP_OK=0
) else (
    echo  Python packages installed into venv.
)

REM ════════════════════════════════════════════
REM  5. INSTALL NODE DEPENDENCIES
REM ════════════════════════════════════════════
echo.
echo [5/5] Installing Node dependencies...
cd /d "%~dp0frontend"
npm install
if %errorlevel% neq 0 (
    echo  [ERROR] npm install failed.
    set SETUP_OK=0
) else (
    echo  Node packages installed.
)

REM ════════════════════════════════════════════
REM  RESULT
REM ════════════════════════════════════════════
echo.
echo ============================================
if %SETUP_OK% equ 1 (
    echo  Setup complete! Run start.bat to launch.
) else (
    echo  Setup finished with errors - see above.
    echo  Fix flagged issues then re-run setup.bat
)
echo ============================================
echo.
pause
