@echo off
rem The daily CIMB exchange rates (AUD, GBP, JPY). Started by Windows Task Scheduler at 9:30 am and every 30 minutes after that until 12:30 pm
rem (see docs/automation-setup.md). Double-click it to run it by hand too. Every run adds a line to logs\fx.log.
cd /d "%~dp0"
if not exist logs mkdir logs
node fx.js >> logs\fx.log 2>&1
