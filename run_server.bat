@echo off
title C++ WASM To-Do App Server
cd /d "%~dp0"
echo ========================================================
echo Starting C++ WebAssembly Productivity App Server
echo ========================================================
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Using Node.js runtime...
    start http://localhost:8080
    node server.js
    goto end
)

where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Using Python runtime...
    start http://localhost:8080
    python server.py
    goto end
)

echo [ERROR] Neither Node.js nor Python was found in your PATH.
pause

:end
