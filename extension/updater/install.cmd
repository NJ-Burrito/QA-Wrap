@echo off
chcp 65001 >nul
rem Run once after "Load unpacked": turns on the automatic updater for your Windows user. No admin rights, never asks a question.
rem Optional: -Token <t> (private fork only), -Quiet (no output, no pause, exit code 0 on success).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-host.ps1" %*
set RC=%ERRORLEVEL%
echo %* | find /i "-Quiet" >nul && exit /b %RC%
echo.
pause
exit /b %RC%
