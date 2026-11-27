@echo off
setlocal
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%build-win-exe.ps1"

where pwsh >nul 2>nul
if %errorlevel%==0 (
    set "PS_EXE=pwsh"
) else if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" (
    set "PS_EXE=%ProgramFiles%\PowerShell\7\pwsh.exe"
) else (
    set "PS_EXE=powershell.exe"
)

if "%~1"=="" (
    "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"
) else (
    "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -Version "%~1" %2 %3 %4 %5
)

set "EXIT_CODE=%errorlevel%"
echo.
if %EXIT_CODE% neq 0 (
    echo [ERROR] Build failed with exit code %EXIT_CODE%.
) else (
    echo [DONE] Build completed successfully.
)
pause
exit /b %EXIT_CODE%
