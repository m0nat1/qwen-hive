#!/usr/bin/env bash
# start-hive.sh — поднять шлюз QWEN HIVE (порт 8787, headless-воркеры).
# Использование: bash start-hive.sh [flags]
#   HIVE_HEADLESS=1 по умолчанию (WSLg-окна гибли вместе с сессией пользователя).
#   Лог: logs/hive.out
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -d node_modules ]; then
  echo "[start] installing deps (bun install)…"
  bun install >/dev/null 2>&1 || true
fi

export PATH="$HOME/.bun/bin:$PATH"

# Только SIGKILL надёжен: bun переживает SIGTERM → EADDRINUSE у нового процесса.
pkill -9 -f "bun run src/main.js" 2>/dev/null || true
pkill -9 -f "user-data-dir=$HOME/qwen-hive/data/profiles" 2>/dev/null || true
sleep 2

mkdir -p logs
HIVE_HEADLESS="${HIVE_HEADLESS:-1}" nohup bun run src/main.js > logs/hive.out 2>&1 &
PID=$!
echo "[start-hive] pid $PID"

for i in $(seq 1 60); do
  if curl -sf http://localhost:8787/health >/dev/null 2>&1; then
    echo "[start-hive] up: http://localhost:8787"
    curl -s http://localhost:8787/health
    echo
    exit 0
  fi
  sleep 1
done

echo "[start-hive] FAILED to become healthy in 60s; last log lines:" >&2
tail -20 logs/hive.out >&2
exit 1
