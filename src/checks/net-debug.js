// src/checks/net-debug.js — диагностика: почему Chrome не грузит chat.qwen.ai,
// хотя curl из WSL ходит нормально. Перебирает комбинации сетевых флагов.
import dns from "node:dns/promises";
import { chromium } from "playwright-core";
import { CHROME_PATH, CHROME_ARGS, QWEN_BASE } from "../config.js";
import { log } from "../util/log.js";

let ip = null;
try {
  ip = (await dns.resolve4("chat.qwen.ai"))[0];
  log.info("dns resolve:", ip);
} catch (e) {
  log.warn("resolve4 failed:", e?.message);
}

const combos = [
  ["baseline", []],
  ["async-dns-off", ["--disable-async-dns"]],
  ["quic-off", ["--disable-quic"]],
  ["both", ["--disable-async-dns", "--disable-quic"]],
];
if (process.argv[2]) {
  combos.push(["host-resolver-rules", [`--host-resolver-rules=MAP chat.qwen.ai ${process.argv[2]}`]]);
}

for (const [name, extra] of combos) {
  const t0 = Date.now();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: false,
      args: [...CHROME_ARGS, ...extra],
    });
    const page = await browser.newPage();
    await page.goto("https://chat.qwen.ai/", { waitUntil: "commit", timeout: 20000 });
    const ms = Date.now() - t0;
    log.info(`OK [${name}] commit in ${ms}ms (${page.url()}) args=[${extra.join(" ")}]`);
    await page.waitForTimeout(1500);
    log.info(`  title now: ${await page.title().catch(() => "?")}`);
    await browser.close();
  } catch (e) {
    log.warn(`FAIL [${name}] ${String(e?.message).split("\n")[0]}`);
    await browser?.close().catch(() => {});
  }
}
log.info("NET_DEBUG_DONE");
