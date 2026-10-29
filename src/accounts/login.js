// src/accounts/login.js — P1: ручной логин одного аккаунта.
// Открывает headed Chrome (WSLg) с персистентным профилем, ждёт, пока пользователь
// залогинится на chat.qwen.ai, затем сохраняет сессию в профиль навсегда.
// Пароль НЕ автоматизируем (ТЗ §11). Токен печатается только маскированно.
//
// Использование: bun run src/accounts/login.js [acc-1]
import { chromium } from "playwright-core";
import path from "node:path";
import { CHROME_PATH, CHROME_ARGS, QWEN_BASE, DATA_DIR } from "../config.js";
import { profilePath, upsertAccount } from "./registry.js";
import { log } from "../util/log.js";

const accId = process.argv[2] || "acc-1";
const TIMEOUT_MS = Number(process.env.HIVE_LOGIN_TIMEOUT || 30 * 60 * 1000);

const context = await chromium.launchPersistentContext(profilePath(accId), {
  executablePath: CHROME_PATH,
  headless: false,
  args: [...CHROME_ARGS],
  viewport: { width: 1280, height: 900 },
});

context.on("close", () => {
  log.error(`${accId}: browser window closed before login finished`);
});

const page = context.pages()[0] || (await context.newPage());
await page.goto(`${QWEN_BASE}/`, { waitUntil: "domcontentloaded" }).catch(() => {});

// Диагностика: что реально видно в окне.
const shot = (name) =>
  page
    .screenshot({ path: path.join(DATA_DIR, name) })
    .then(() => log.info(`screenshot saved: data/${name}`))
    .catch((e) => log.warn("screenshot failed:", e?.message));
await shot("login-start.png");
log.info(`[${accId}] page url: ${page.url()}, title: ${await page.title().catch(() => "?")}`);
log.info(`[${accId}] Chrome window opened. Log in to chat.qwen.ai manually (email + password).`);
log.info(`[${accId}] Polling localStorage.token every second, timeout ${TIMEOUT_MS / 60000} min.`);

const started = Date.now();
let token = null;
let lastDiag = 0;

while (Date.now() - started < TIMEOUT_MS) {
  if (context.pages().length === 0 || page.isClosed()) {
    log.error(`[${accId}] LOGIN_ABORTED: browser window was closed before login`);
    process.exit(1);
  }
  token = await page.evaluate(() => localStorage.getItem("token")).catch(() => null);
  if (token && token.length > 10) break;

  const elapsed = Date.now() - started;
  if (elapsed > 60000 && elapsed - lastDiag > 30000) {
    lastDiag = elapsed;
    const keys = await page
      .evaluate(() => Object.keys(localStorage).map((k) => `${k}:${String(localStorage.getItem(k) || "").length}`))
      .catch(() => []);
    log.info(`[${accId}] still waiting; localStorage keys:`, JSON.stringify(keys));
  }
  await new Promise((r) => setTimeout(r, 1000));
}

if (!token) {
  log.error(`[${accId}] LOGIN_TIMEOUT after ${TIMEOUT_MS / 60000} min`);
  log.error(`[${accId}] final url: ${page.url()}, title: ${await page.title().catch(() => "?")}`);
  await shot("login-timeout.png");
  await context.close();
  process.exit(1);
}

upsertAccount({
  id: accId,
  profile: profilePath(accId),
  status: "idle",
  healthScore: 100,
  strikesToday: 0,
  cooldownUntil: 0,
  addedAt: new Date().toISOString(),
  tokenSeenLen: token.length,
});

log.info(`LOGIN_OK [${accId}]: token captured (len ${token.length}, prefix ${token.slice(0, 6)}...)`);
log.info(`[${accId}] Session saved in profile ${profilePath(accId)}. Closing browser.`);
await context.close();
log.info(`${accId} registered in data/accounts.json with status idle`);
