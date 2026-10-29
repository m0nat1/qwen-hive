#!/usr/bin/env bash
# claude-hive.sh — интерактивный Claude Code через мост QWEN HIVE.
# Использование: claude-hive.sh [папка_проекта]
#   Без аргумента — открывается в домашней папке.
#   Батник на Windows передаёт папку, если перетащили её на ярлык.
set -uo pipefail

export PATH="$HOME/.bun/bin:$HOME/.local/node/bin:$HOME/.local/bin:$PATH"

# Ключ моста
if [ -f "$HOME/qwen-hive/data/secret.key" ]; then
  export ANTHROPIC_API_KEY="$(cat "$HOME/qwen-hive/data/secret.key")"
else
  echo "[hive] НЕТ КЛЮЧА: ~/qwen-hive/data/secret.key — сначала запусти шлюз"; read -r -p "Enter…"; exit 1
fi
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"

# Меньше фоновых запросов Claude Code -> меньше WAF-punish'ей
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export DISABLE_AUTOUPDATER=1
export DISABLE_TELEMETRY=1
export DISABLE_ERROR_REPORTING=1

# Шлюз жив?  Нет — поднимаем.
if ! curl -sf --max-time 5 http://127.0.0.1:8787/health >/dev/null 2>&1; then
  echo "[hive] поднимаю шлюз…"
  bash "$HOME/qwen-hive/scripts/start-hive.sh" || { echo "[hive] шлюз не поднялся, см. ~/qwen-hive/logs/hive.out"; read -r -p "Enter…"; exit 1; }
fi

# Рабочая папка (аргумент 1 или $HOME)
TARGET="${1:-$HOME}"
[ -d "$TARGET" ] || TARGET="$HOME"
cd "$TARGET" || exit 1

echo "[hive] Claude Code запускается (модель = Qwen через мост). Выход: Ctrl+C или /exit"

# --test: проверить цепочку без интерактивного TUI
if [ "${1:-}" = "--test" ] || [ "${2:-}" = "--test" ]; then
  claude -p "Say ok" --model claude-sonnet-4-5 --output-format text
  exit $?
fi

exec claude
