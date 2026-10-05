@echo off
rem Starts Seventh Leaf on this computer and opens it in your browser.
rem Close the window that opens to stop it. Nothing is installed or changed on the computer.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launcher\serve.ps1" %*
if errorlevel 1 pause
