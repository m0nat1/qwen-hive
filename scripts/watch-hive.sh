# watch-hive.sh — вотчдок: держит шлюз живым (Пуск при падении).
# Запуск: nohup bash scripts/watch-hive.sh > logs/watchdog.out 2>&1 &
# Остановка: pkill -f watch-hive.sh
BASE_URL="${HIVE_BASE_URL:-http://localhost:8787}"
INTERVAL="${HIVE_WATCH_INTERVAL:-60}"

echo "[watchdog] started, checking $BASE_URL every ${INTERVAL}s"
while true; do
  if curl -sf --max-time 5 "$BASE_URL/health" >/dev/null 2>&1; then
    : # жив
  else
    echo "[watchdog] $(date '+%F %T') gateway down — restarting"
    bash "$(dirname "$0")/start-hive.sh" || true
  fi
  sleep "$INTERVAL"
done
