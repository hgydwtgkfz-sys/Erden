@echo off
chcp 65001 >nul
setlocal
if exist "%~dp0Emberfall.html" (
  start "" "%~dp0Emberfall.html"
  exit /b 0
)
if exist "%~dp0public\index.html" (
  start "" "%~dp0public\index.html"
  exit /b 0
)
echo Файлы игры не найдены. Распакуйте архив целиком в одну папку.
echo Ожидается Emberfall.html или public\index.html рядом с этим файлом.
pause
exit /b 1
