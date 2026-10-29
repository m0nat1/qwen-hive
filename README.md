<div align="center">

# 🐝 QWEN HIVE

**Use free Qwen (chat.qwen.ai) as the model backend for Claude Code — with zero API keys from Anthropic.**

A local gateway that speaks the *Anthropic Messages API* on one side and drives real,
logged-in Chrome tabs on chat.qwen.ai on the other. Account pool, transparent failover,
streaming, tool calling, WAF self-healing.

**English** · [Русский](README.ru.md) · [Architecture](ARCHITECTURE.md) · [WAF & Limits](docs/WAF-AND-LIMITS.md)

![status](https://img.shields.io/badge/status-working-brightgreen) ![tests](https://img.shields.io/badge/tests-39%2F39-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue) ![runtime](https://img.shields.io/badge/runtime-Bun%20%2B%20WSL2-orange) ![version](https://img.shields.io/badge/version-0.1.0-blue)

</div>

---

## Why?

Claude Code is a phenomenal agentic coding harness, but it needs a paid Claude subscription.
**Qwen** (chat.qwen.ai) is free — and `qwen3.8-max` is good enough to drive Claude Code's
whole agentic loop (Bash, Edit, Write, Plan mode, subagents).

QWEN HIVE is the bridge:

```
Claude Code ──(Anthropic /v1/messages)──▶ QWEN HIVE ──(page.evaluate(fetch) inside real Chrome)──▶ chat.qwen.ai
                    ▲                                        │
                    │            account pool: acc-1 … acc-5  │
                    └────────── failover, rotation, WAF ◀─────┘
```

![Architecture](assets/architecture.svg)

> **Rule #1 (non-negotiable):** every request to chat.qwen.ai is executed as
> `page.evaluate(() => fetch(...))` **inside a live Chrome tab** of a real logged-in profile.
> Never from Node/Bun. The page injects anti-bot headers (`bx-ua`, `bx-umidtoken`, `bx-v`)
> and inherits the WAF cookies — that is the whole trick.

## Features

- 🧩 **Full Anthropic Messages API**: streaming + non-stream, complete SSE sequence (`message_start` → `content_block_delta` → … → `message_stop`), `message_delta` usage, stop reasons
- 🔧 **Tool calling round-trip**: `tool_use` / `tool_result`, streamed `input_json_delta`, resilient marker parser that repairs glued/broken tool-call JSON
- 🐝 **Account pool**: N accounts, cooldown rotation, health-based selection, transparent **failover** when an account is punished or out of quota
- 🛡️ **WAF (Baxia) awareness**: punish → 30-min freeze; daily quota → freeze until midnight; 3 strikes → account dead; automatic relaunch
- ♻️ **Self-healing**: proactive JWT refresh before expiry, tab auto-relaunch, watchdog
- ⚡ **Thinking toggle**: `HIVE_THINKING=1` (deep, default) / `=0` (fast)
- 🔀 **Proxy support**: `HIVE_PROXY=http://user:pass@host:port` — fresh IP reputation for the whole pool
- 🧪 39 unit tests (`bun test`), CI via GitHub Actions

## Quick start

> Requirements: **Linux or WSL2 Ubuntu**, [Bun](https://bun.sh) ≥ 1.1, Google Chrome, Node ≥ 20 (for Claude Code itself).

### 1. Install & log in

```bash
```bash
git clone https://github.com/m0nat1/qwen-hive.git && cd qwen-hive
bun install
# Log in with your Qwen account in a visible browser window (repeat per account):
bun run src/accounts/login.js acc-1    # opens chat.qwen.ai, saves session into data/profiles/acc-1
```

Add as many accounts as you like (`acc-2`, `acc-3`, …) — the pool rotates them automatically.

### 2. Start the gateway

```bash
bash scripts/start-hive.sh     # gateway + headless workers + health check
nohup bash scripts/watch-hive.sh > logs/watchdog.out 2>&1 &   # optional watchdog
curl -s localhost:8787/health  # {"ok":true,...}
```

### 3. Run Claude Code

```bash
export PATH="$HOME/.bun/bin:$PATH"
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787      # 127.0.0.1, NOT localhost (IPv6!)
export ANTHROPIC_API_KEY=$(cat data/secret.key)
claude        # interactive coding session, powered by Qwen
```

That's it — Claude Code now runs on free Qwen. On Windows, grab
[`Qwen Hive.bat`](scripts/) (double-click: starts the gateway if needed + opens Claude Code)
— see [docs](docs/).

## What works / what doesn't

| Feature | Status |
|---|---|
| Agentic coding: Bash / Read / Write / Edit / Glob / Grep | ✅ |
| Plan mode, auto mode, subagents, todo lists | ✅ |
| Streaming SSE, tool calling round-trips | ✅ |
| Qwen built-in web search (`auto_search`) | ✅ ask "search the web for …" |
| `WebSearch` / `WebFetch` Anthropic **server-side** tools | ❌ executed on Anthropic's API — impossible with any 3rd-party backend |
| Images / vision | ⚠️ Qwen supports it; gateway file upload is on the roadmap |

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full deep-dive. TL;DR:

- `src/gateway/` — Anthropic-compatible HTTP/SSE server (port 8787), failover, throttling
- `src/anthropic/` — Messages ↔ internal event translation (frames, emit, surface)
- `src/tools/` — robust `[TOOL_CALL]{json}[/TOOL_CALL]` parser (repairs glued/corrupted model output)
- `src/workers/` — one Chrome persistent context per account; JWT exp-watchdog; freezes/strikes
- `src/qwen/` — request bodies copied byte-for-byte from the real Qwen UI
- `src/captcha/` — WAF/Baxia detection (RGV587 punish, quota, captcha states)
- `scripts/` — start/stop/watchdog, login, captcha helper, Windows launchers

## WAF & limits (read before heavy use)

Everything you need to know about rate limits, 30-minute punish freezes, daily quotas and
why *you shouldn't hammer the API* — in [docs/WAF-AND-LIMITS.md](docs/WAF-AND-LIMITS.md).
Short version: keep a human-ish pace; the pool + failover absorb most of it.

## Disclaimer

This is an independent, unofficial tool for **personal, educational use**.
Not affiliated with, endorsed by, or sponsored by Alibaba/Qwen or Anthropic.
Using chat.qwen.ai through automation may violate its Terms of Service — you are
responsible for how you use this software. No credentials are ever stored in logs
(keys and cookies live locally in `data/`, which is never committed).

## License

[MIT](LICENSE) © 2026 m0nat1
