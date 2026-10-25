@echo off
setlocal
cd /d "%~dp0"
title Construir Juntos - Configuracao automatica
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0PREPARAR-TUDO.ps1"
