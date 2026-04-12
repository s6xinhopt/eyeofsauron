@echo off
title Eye of Sauron - Installer
color 0F
mode con: cols=65 lines=30
chcp 65001 >nul
powershell -ExecutionPolicy Bypass -Command "try { irm 'https://raw.githubusercontent.com/s6xinhopt/eyeofsauron/beta/installer/Install-EyeOfSauron.ps1' | iex } catch { Write-Host ''; Write-Host '  Erro: Nao foi possivel carregar o instalador.' -ForegroundColor Red; Write-Host \"  $_\" -ForegroundColor DarkGray; Write-Host ''; pause }"
if %errorlevel% neq 0 pause
exit /b
