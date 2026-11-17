@echo off
rem The daily refresh, started by Windows Task Scheduler (see docs/automation-setup.md). Double-click it to run it by hand too.
cd /d "%~dp0"
node daily.js --scheduled
