@echo off
cd /d "%~dp0"
node scripts/self-host.mjs stop
if errorlevel 1 pause
