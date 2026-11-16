@echo off
echo ========================================================
echo Building C++ To-Do WebAssembly Engine with Emscripten
echo ========================================================

call C:\emsdk\emsdk_env.bat >nul 2>&1

if not exist public mkdir public

echo Compiling C++ source files to WebAssembly with em++...
call em++ -O2 -std=c++17 --bind ^
    -s WASM=1 ^
    -s ALLOW_MEMORY_GROWTH=1 ^
    -s FORCE_FILESYSTEM=1 ^
    -lidbfs.js ^
    -s MODULARIZE=1 ^
    -s EXPORT_NAME="createTaskModule" ^
    -s EXPORTED_RUNTIME_METHODS=[FS,IDBFS] ^
    src/DateUtils.cpp src/TaskManager.cpp src/bindings.cpp ^
    -o public/task_engine.js

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] WebAssembly module built successfully in public/
    copy /Y public\task_engine.* . >nul
    dir public\task_engine.*
) else (
    echo.
    echo [ERROR] WebAssembly compilation failed!
    exit /b 1
)
