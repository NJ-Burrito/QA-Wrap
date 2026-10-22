@echo off
chcp 65001 >nul
rem Run once after "Load unpacked": turns on the automatic updater for your Windows user. No admin rights.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-host.ps1"
echo.
pause
