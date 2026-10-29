# captcha-check.sh — открыть аккаунт в HEADLED-окне для решения капчи Baxia.
# Юзер решает слайдер (если вылезет); скрипт проверяет состояние и выходит.
# Использование: captcha-check.sh [acc-4]
set -uo pipefail
export PATH="$HOME/.bun/bin:$PATH"
ACC="${1:-acc-4}"
cd "$HOME/qwen-hive"
exec bun run scripts/captcha-check.mjs "$ACC"
