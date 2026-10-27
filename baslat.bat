@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Salon - Sunucu
where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurup tekrar dene. & pause & exit /b)
if not exist node_modules (echo Ilk calistirma: gerekli paketler kuruluyor... & call npm install --no-audit --no-fund)
node server.js
pause
