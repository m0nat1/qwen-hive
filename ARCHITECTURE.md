# Architecture

QWEN HIVE turns a pool of free chat.qwen.ai accounts into an Anthropic Messages API
endpoint that Claude Code (or any Anthropic-protocol client) can use.

```
┌──────────────────┐        Anthropic /v1/messages           ┌──────────────────────────┐
│   Claude Code    │ ──────────────────────────────────────▶ │  QWEN HIVE gateway :8787 │
│  (terminal/IDE)  │ ◀──────────  Anthropic SSE  ─────────── │  src/gateway/server.js   │
└──────────────────┘                                         └───────────┬──────────────┘
                                                                       │ pool.acquire()
                                              ┌────────────────────────┼────────────────────────┐
                                              ▼                        ▼                        ▼
                                       ┌─────────────┐         ┌─────────────┐          ┌─────────────┐
                                       │ worker acc-1│         │ worker acc-2│  …  acc-5│  Chrome tab  │
                                       │ (headless   │  …      │ headless    │  headless│  headless    │
                                       │ Chrome tab) │         │             │          │              │
                                       └──────┬──────┘         └─────────────┘          └──────────────┘
                                              │  page.evaluate(() => fetch(...))   ◀── Rule #1
                                              ▼
                                        chat.qwen.ai (Qwen UI backend, WAF/Baxia inherits cookies)
```

## Rule #1 — the core invariant

Every outbound request to chat.qwen.ai is executed as `page.evaluate(() => fetch(...))`
**inside a live Chrome tab** backed by a real logged-in profile (`launchPersistentContext`).
We never call Qwen from Node/Bun directly:

- the SPA page injects anti-bot headers (`bx-ua`, `bx-umidtoken`, `bx-v`) computed by its
  own JS (Baxia);
- the request inherits the profile's TLS fingerprint and WAF cookies;
- therefore the API sees "the browser", not a bot.

## Request lifecycle

1. Claude Code `POST /v1/messages` (streaming or not).
2. Gateway validates the bearer key (`data/secret.key`), maps any model name → `qwen3.8-max`.
3. `pool.acquire()` picks the healthiest free worker honoring per-account cooldowns and a
   global request gap (throttle, keeps the WAF calm).
4. The prompt is compiled by `surface.buildPrompt`: system+messages are flattened into a
   single prompt; tool definitions are taught as text markers
   `[TOOL_CALL]{...json...}[/TOOL_CALL]`.
5. Worker opens/creates a chat (`chats/new`) and POSTs `chat/completions` with
   `incremental_output: true` **from inside the page**.
6. Qwen SSE phases (`thinking_summary`, `answer`) are translated on the fly:
   - thinking (if `HIVE_THINKING=1`) → folded away or surfaced depending on config;
   - answer text → `content_block_delta` text deltas;
   - `[TOOL_CALL]` markers → `tool_use` blocks (parser repairs glued markers & JSON);
   - `ping` SSE frames keep the connection alive during long thinking.
7. Tool results come back as the next `/v1/messages` turn with `tool_result` content —
   fed into the same prompt and streamed again.
8. Errors: punish/quota → freeze account, **transparent failover** to another worker
   (stream: only if nothing was emitted yet; non-stream: always).

## Resilience model

| Failure | Reaction |
|---|---|
| JWT expired (headless SPA doesn't tick) | exp-watchdog reloads page proactively; `chats/new` 401 → reload + retry |
| Tab closed / browser died | worker relaunch on next acquire |
| WAF punish (RGV587) | freeze 30 min, failover to another account |
| Daily quota exhausted | freeze until local midnight |
| 3 punish strikes in a day | account marked `dead`, excluded from pool |
| Gateway crash | watchdog restarts every 60s if `/health` fails |
| Client disconnect mid-stream | SSE writer swallows write errors; unhandled rejections are contained (Bun) |

## Anthropic ↔ Qwen translation

- `system` + `messages` → single prompt with explicit tool-schema teaching block
- `tools` definitions → taught in-prompt; model answers with `[TOOL_CALL]{json}[/TOOL_CALL]`
- `tool_result` messages → inlined back into the next prompt
- Streaming: `message_start`, `content_block_start/delta/stop`, `message_delta` (usage),
  `message_stop`; tool args streamed as `input_json_delta`
- Models map: any requested model → `qwen3.8-max` (`HIVE_QWEN_MODEL` overrides)

## Key invariants

1. Qwen requests **only** from inside live tabs (page.evaluate).
2. No secrets in logs; `data/` is never committed.
3. Tokens/keys are masked in any diagnostics output.
4. One in-flight request per account; global 6s gap between Qwen calls.
5. Failover must be invisible to the client whenever possible.
