# WAF & Limits — what to expect and how to behave

chat.qwen.ai is protected by Alibaba **Baxia** anti-bot + per-account quotas.
QWEN HIVE plays nice with it, but you must understand the rules.

## What the WAF sees

- One IP for all your accounts (unless you use proxies)
- Request *bursts* (Claude Code fires main + auxiliary requests per turn)
- Automarathon-like patterns (prompt sizes of 60–90 KB are normal for Claude Code)

## Failure modes we handle

| Signal | Meaning | Gateway behavior |
|---|---|---|
| `RGV587_ERROR` / `_____tmd_____` / `action=captcha` | punish (soft ban) | freeze that account 30 min, failover to another |
| `"reached limit"` / upgrade nags in body | daily quota exhausted | freeze until local midnight |
| 3 punish strikes in a day | account is hot | account marked `dead` (reset manually) |
| `Failed to fetch` from `baxiaCommon.js` | silent client-side fetch kill | retry once, then failover |
| 5 tabs warmed at once | tarpit trigger | staged warmup: worker i starts after `i × 20s` |

## Practical pacing

- 1 request every **6+ seconds** globally (the gateway enforces this automatically)
- per-account cooldown **20–28 s** after each request (also automatic)
- don't run extra test scripts while actively coding
- a punish "quiet hour" typically lasts **15–60 minutes** — it lifts by itself;
  a manual solve requires the captcha flow (see `scripts/captcha-check.sh`)
- daily quota per account resets at midnight (local time)

## If everything is frozen

1. `curl -s localhost:8787/health` — check `frozenUntil` timestamps
2. Wait for the nearest `frozenUntil` to pass (watchdog unfreezes automatically)
3. Worst case: stop the gateway, wait 30–60 min for the IP-level scoring to cool down, restart
4. Optional: use a VPN/proxy — WAF scoring is per-IP; a fresh IP forgets everything

## Never do

- Don't run your own scripts against chat.qwen.ai while the gateway is working
- Don't open the same profile in two places (`SingletonLock` conflict)
- Don't raise concurrency beyond one request per account (by design)
