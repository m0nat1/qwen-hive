// src/checks/login-persist.js — P1 критерий: перезапуск воркера, логин сохранился.
// Открывает тот же профиль в headless и читает localStorage.token.
import { chromium } from "playwright-core";
import { CHROME_PATH, CHROME_ARGS, QWEN_BASE } from "../config.js";
import { loadRegistry, profilePath } from "../accounts/registry.js";
import { log } from "../util/log.js";

const accId = process.argv[2] || "acc-1";
const acc = loadRegistry().accounts.find((a) => a.id === accId);
if (!acc) {
  log.error(`account ${accId} not found in data/accounts.json — run login first`);
  process.exit(1);
}

const context = await chromium.launchPersistentContext(profilePath(accId), {
  executablePath: CHROME_PATH,
  headless: true,
  args: [...CHROME_ARGS],
});

try {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${QWEN_BASE}/`, { waitUntil: "commit", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const token = await page.evaluate(() => localStorage.getItem("token")).catch(() => null);
  if (token && token.length > 10) {
    log.info(`LOGIN_PERSIST_OK [${accId}]: token present after restart (len ${token.length})`);
  } else {
    log.error("LOGIN_PERSIST_FAIL: token absent after worker restart");
    process.exitCode = 1;
  }
} finally {
  await context.close();
}
