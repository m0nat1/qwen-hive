// src/checks/chrome.js — P0: проверка запуска настоящего системного Chrome через playwright-core.
// Никаких скачиваний браузеров Playwright (правило ТЗ).
import { chromium } from "playwright-core";
import { CHROME_PATH, CHROME_ARGS } from "../config.js";
import { log } from "../util/log.js";

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  headless: true,
  // --remote-debugging-* Playwright добавляет сам; свои флаги передавать нельзя.
  args: [...CHROME_ARGS],
});

try {
  log.info(`chrome launched, version: ${browser.version()}`);
  const page = await browser.newPage();
  await page.goto("about:blank");
  const ua = await page.evaluate(() => navigator.userAgent);
  log.info("userAgent:", ua);
  log.info("CHROME_CHECK_OK");
} finally {
  await browser.close();
}
