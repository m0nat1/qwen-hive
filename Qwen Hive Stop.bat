@echo off
title QWEN HIVE - Stop
echo Останавливаю шлюз и вотчдод...
wsl.exe -e bash -c "pkill -f watch-hive.sh 2>/dev/null; bash ~/qwen-hive/scripts/stop-hive.sh"
echo Готово.
pause