@echo off
chcp 65001 >nul
title QWEN HIVE - Claude Code
echo.
echo   ================= QWEN HIVE =================
echo    Шлюз: WSL :8787   Кодинг: Claude Code
echo ==============================================
echo.
if "%~1"=="" (
  wsl.exe -e bash -c "bash ~/qwen-hive/scripts/claude-hive.sh"
) else (
  wsl.exe -e bash -c "bash ~/qwen-hive/scripts/claude-hive.sh '%~f1'"
)
echo.
echo Шлюз остаётся работать в фоне (порт 8787).
echo Остановить всё: Qwen Hive Stop.bat
pause