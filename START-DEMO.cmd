@echo off
cd /d "%~dp0"
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 exit /b 1
)
echo Open http://127.0.0.1:5173/ and connect the Arduino in Settings.
echo Sample interface only: http://127.0.0.1:5173/?demo=1
call npm.cmd run dev
