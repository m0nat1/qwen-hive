#!/usr/bin/env bash
# install.sh — one-shot setup for QWEN HIVE (Linux / WSL2 Ubuntu).
# Checks prerequisites, installs dependencies, prepares data dirs.
set -euo pipefail

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "  ✅ %s\n" "$*"; }
warn() { printf "  ⚠️  %s\n" "$*"; }
fail() { printf "  ❌ %s\n" "$*"; exit 1; }

bold "🐝 QWEN HIVE installer"

# 1. bun
if command -v bun >/dev/null 2>&1; then
  ok "bun $(bun --version)"
else
  warn "bun not found — installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  ok "bun $(bun --version)"
fi

# 2. chrome
if command -v google-chrome >/dev/null 2>&1; then
  ok "google-chrome $(google-chrome --version 2>/dev/null | cut -d' ' -f3)"
else
  fail "google-chrome not found. Install it first (e.g. wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && sudo apt install ./google-chrome-stable_current_amd64.deb)"
fi

# 3. node (for Claude Code itself)
if command -v node >/dev/null 2>&1; then
  ok "node $(node --version)"
else
  warn "node not found — Claude Code needs Node >= 20 (install later or via nvm)"
fi

# 4. deps
bold "Installing dependencies..."
bun install
ok "dependencies installed"

# 5. claude code (optional, if missing)
if ! command -v claude >/dev/null 2>&1; then
  warn "claude CLI not found"
  echo "    Install later, e.g.:"
  echo "      npm_config_registry=https://registry.npmmirror.com npm install -g @anthropic-ai/claude-code"
  echo "    (npmmirror helps if npmjs is unreachable from your network)"
else
  ok "claude $(claude --version 2>/dev/null || echo 'installed')"
fi

# 6. dirs + key (config.js creates them on first run; just verify)
mkdir -p data logs
ok "data/ and logs/ ready"

bold "Next steps:"
cat <<EOF

  1. Log in with a Qwen account (repeat per account, visible window):
       bun run scripts/login.mjs acc-1

  2. Start the gateway:
       bash scripts/start-hive.sh

  3. Code:
       export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
       export ANTHROPIC_API_KEY=\$(cat data/secret.key)
       export PATH="\$HOME/.bun/bin:\$PATH"
       claude

  Docs: README.md · ARCHITECTURE.md · docs/WAF-AND-LIMITS.md
EOF
