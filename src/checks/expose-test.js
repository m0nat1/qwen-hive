// src/checks/expose-test.js — изолированная проверка: context.exposeFunction + page.evaluate.
import { chromium } from "playwright-core";
import { CHROME_PATH, CHROME_ARGS, QWEN_BASE } from "../config.js";
import { profilePath } from "../accounts/registry.js";
import { log } from "../util/log.js";

const context = await chromium.launchPersistentContext("data/profiles/probe-expose", {
  executablePath: CHROME_PATH,
  headless: true,
  args: [...CHROME_ARGS],
});

try {
  await context.exposeFunction("__hiveChunk", (reqId, s) => {
    log.info("GOT_CHUNK:", reqId, s.slice(0, 80));
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto("about:blank");
  const t1 = await page.evaluate(() => typeof window.__hiveChunk);
  log.info("typeof on about:blank:", t1);

  await page.goto(`${QWEN_BASE}/`, { waitUntil: "commit", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const t2 = await page.evaluate(() => typeof window.__hiveChunk);
  log.info("typeof after goto:", t2);

  // Вызовем биндинг изнутри страницы и дождёмся колбэка.
  let got = null;
  const p = page.evaluate(() => window.__hiveChunk?.("probe", "hello-from-page"));
  await p;
  await page.waitForTimeout(500);
  log.info("EXPOSE_TEST_DONE");
} finally {
  await context.close().catch(() => {});
}
