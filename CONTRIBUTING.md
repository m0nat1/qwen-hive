# Contributing to QWEN HIVE

Thanks for helping! Quick rules:

## Setup

```bash
git clone https://github.com/m0nat1/qwen-hive.git && cd qwen-hive
bun install
bun test          # must be 39+ passing before any PR
```

## Ground rules

1. **Rule #1 of the codebase:** requests to chat.qwen.ai only happen via
   `page.evaluate(() => fetch(...))` inside a live Chrome tab (`src/workers/worker.js`).
   Any PR that calls Qwen from Node/Bun directly will be rejected.
2. Never commit anything from `data/` — keys, cookies, profiles. `.gitignore` covers it;
   double-check `git status` before committing.
3. Never log tokens, cookies or the gateway API key; diagnostics must mask them.
4. Keep the Anthropic surface byte-compatible: changes in `src/anthropic/` or `src/tools/`
   must come with unit tests (`bun test`).
5. WAF-friendly: don't add code paths that increase request rate; the global throttle in
   `src/workers/pool.js` is a feature, not a bug.

## Style

- Plain modern JavaScript (ESM) for Bun, no build step
- Comments explain *why*, not *what*
- Scripts in `scripts/` must be idempotent and safe to re-run

## PR checklist

- [ ] `bun test` passes locally
- [ ] No secrets in diff (run: `grep -rn "hive_[0-9a-f]\{20\}" src/ scripts/`)
- [ ] Docs updated if behavior changed
- [ ] Commits are small and described
