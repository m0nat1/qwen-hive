# stop-hive.sh — остановить шлюз и воркеры QWEN HIVE.
# Только SIGKILL: SIGTERM bun переживает (порт остаётся занят — EADDRINUSE).
pkill -9 -f "bun run src/main.js" 2>/dev/null || true
pkill -9 -f "user-data-dir=$HOME/qwen-hive/data/profiles" 2>/dev/null || true
sleep 1
if pgrep -f "bun run src/main.js" >/dev/null 2>&1; then
  echo "[stop-hive] WARNING: gateway still alive"
  exit 1
fi
echo "[stop-hive] stopped"
