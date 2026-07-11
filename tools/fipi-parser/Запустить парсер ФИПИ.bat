@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Парсер банка заданий ФИПИ
cd /d "%~dp0"

set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"

set "BUNDLED_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if "%NODE_EXE%"=="" if exist "%BUNDLED_NODE%" set "NODE_EXE=%BUNDLED_NODE%"

if "%NODE_EXE%"=="" (
  echo Не удалось запустить: не найден Node.js.
  echo Установите Node.js LTS с https://nodejs.org и запустите этот файл снова.
  pause
  exit /b 1
)

echo Запускаю парсер... Браузер откроется после старта сервера.
"%NODE_EXE%" server.js
if errorlevel 1 (
  echo.
  echo Не удалось запустить. Проверьте сообщение выше.
  pause
)
