@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Не найден Node.js. Установите Node.js 22 или новее и заново откройте этот файл.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
  echo Нужен Node.js 22 или новее. Текущая версия:
  node --version
  pause
  exit /b 1
)
echo Emberfall — локальный сервер
echo Откройте в браузере: http://127.0.0.1:4173
echo Оставьте это окно открытым. Остановка: Ctrl+C.
echo Для второго игрока используйте другой браузер или отдельный профиль.
node "%~dp0server\node-server.mjs" --port 4173
if errorlevel 1 (
  echo Сервер завершился с ошибкой. Проверьте, что порт 4173 свободен и архив распакован целиком.
  pause
  exit /b 1
)
exit /b 0
