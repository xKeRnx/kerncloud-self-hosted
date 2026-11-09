@echo off
cd /d "%~dp0"
node scripts/self-host.mjs start
if errorlevel 1 pause
