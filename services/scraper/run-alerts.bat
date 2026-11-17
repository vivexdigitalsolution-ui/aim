@echo off
rem The 15-minute alert job (bid orders still unplaced when their car is about to close; email / WhatsApp copies). See docs/alerts-setup.md.
cd /d "%~dp0"
node alerts.js --only close,send
