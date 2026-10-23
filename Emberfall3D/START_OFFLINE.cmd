@echo off
chcp 65001 >nul
setlocal
if exist "%~dp0Emberfall3D.html" (
  start "" "%~dp0Emberfall3D.html"
  exit /b 0
)
if exist "%~dp0public\index.html" (
  start "" "%~dp0public\index.html"
  exit /b 0
)
echo Файлы игры не найдены. Распакуйте архив целиком в одну папку.
echo Ожидается Emberfall3D.html или public\index.html рядом с этим файлом.
pause
exit /b 1
