// src/checks/capture-ui.js — захват РЕАЛЬНОГО тела запроса chat/completions:
// открывает окно с залогиненным профилем, пользователь отправляет сообщение
// руками в UI, скрипт записывает все POST/PUT /api/v2/* в data/fixtures/ui/.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { CHROME_PATH, CHROME_ARGS, QWEN_BASE, FIXTURES_DIR } from "../config.js";
import { profilePath, loadRegistry } from "../accounts/registry.js";
import { log } from "../util/log.js";

const accId = process.argv[2] || "acc-1";
const acc = loadRegistry().accounts.find((a) => a.id === accId);
if (!acc) {
  log.error(`account ${accId} not found`);
  process.exit(1);
}

const context = await chromium.launchPersistentContext(profilePath(accId), {
  executablePath: CHROME_PATH,
  headless: false,
  args: [...CHROME_ARGS],
  viewport: { width: 1280, height: 900 },
});

try {
  const page = context.pages()[0] || (await context.newPage());
  let navigated = false;
  for (let i = 0; i < 5 && !navigated; i++) {
    try {
      await page.goto(`${QWEN_BASE}/`, { waitUntil: "commit", timeout: 90000 });
      navigated = true;
    } catch {
      log.warn(`goto attempt ${i + 1} failed`);
      await page.waitForTimeout(4000);
    }
  }
  if (!navigated) {
    log.error("cannot open chat.qwen.ai after 3 attempts");
    process.exit(1);
  }
  await page.waitForTimeout(5000);

  const wafState = () =>
    page
      .evaluate(() => {
        const html = document.body ? document.body.innerHTML : "";
        return {
          title: document.title,
          captcha:
            html.includes("aliyun_waf_aa") ||
            html.includes("aliyunCaptcha") ||
            !!document.querySelector(".nc-container, #aliyunCaptcha-window-slider, .aliyun-captcha"),
        };
      })
      .catch(() => ({ title: "?", captcha: true }));

  for (let i = 0; i < 150; i++) {
    const s = await wafState();
    if (!s.captcha && s.title === "Qwen") {
      if (i > 0) log.info("WAF cleared");
      break;
    }
    if (i % 5 === 0) log.warn(`WAF challenge — SOLVE THE CAPTCHA IN THE WINDOW (title="${s.title}")`);
    await page.waitForTimeout(2000);
  }

  const outDir = path.join(FIXTURES_DIR, "ui");
  mkdirSync(outDir, { recursive: true });

  let total = 0;
  let completionsAt = 0;
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/api/v2/") && ["POST", "PUT"].includes(req.method())) {
      try {
        const tail = u.split("/api/v2/")[1] || "";
        const slug = tail.split("?")[0].replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
        const file = path.join(outDir, `${Date.now()}-${req.method()}-${slug}.json`);
        writeFileSync(
          file,
          JSON.stringify({ url: u, method: req.method(), headers: req.headers(), body: req.postData() }, null, 2)
        );
        total++;
        if (u.includes("chat/completions")) completionsAt = Date.now();
        log.info("UI_FIXTURE:", slug);
      } catch (e) {
        log.warn("fixture save failed:", e?.message);
      }
    }
  });

  log.info("CAPTURE_READY: type 'привет' in the chat window and send it. Waiting up to 6 min...");
  const t0 = Date.now();
  for (;;) {
    await page.waitForTimeout(2000);
    if (context.pages().length === 0 || page.isClosed()) {
      log.error("window closed before capture finished");
      process.exit(1);
    }
    if (completionsAt > 0 && Date.now() - completionsAt > 15000) break; // 15с тишины после completions
    if (Date.now() - t0 > 360000) {
      log.error("capture timeout: no UI completions request captured");
      process.exit(1);
    }
  }

  log.info(`CAPTURE_DONE: ${total} fixtures in data/fixtures/ui/`);
} finally {
  await context.close().catch(() => {});
}
