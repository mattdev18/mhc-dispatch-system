@echo off
title May Harvest Corporation - Dispatch Queuing Server
cd /d "%~dp0"
echo ====================================================
echo Starting MHC Dispatch Queuing Server...
echo ====================================================
node server.js
pause
