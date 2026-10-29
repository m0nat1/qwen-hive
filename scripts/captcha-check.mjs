// scripts/captcha-check.mjs — решить капчу Baxia в HEADLED-окне аккаунта.
// Юзер отправляет сообщение в чат Qwen; WAF при необходимости показывает слайдер;
// после решения API-запросы из страницы снова проходят.
// Критерий успеха: тестовый fetch chats/new из страницы возвращает chatId.
// Использование: bun run scripts/captcha-check.mjs [acc-4]
import { chromium } from "playwright-core";
import { CHROME_PATH, CHROME_ARGS, QWEN_BASE } from "../src/config.js";
import { profilePath } from "../src/accounts/registry.js";
import { wafState } from "../src/captcha/detect.js";
import { log } from "../src/util/log.js";

const acc = process.argv[2] || "acc-4";
const context = await chromium.launchPersistentContext(profilePath(acc), {
  executablePath: CHROME_PATH,
  headless: false,
  args: [...CHROME_ARGS],
  viewport: { width: 1280, height: 900 },
});
const page = context.pages()[0] || (await context.newPage());
for (const p of context.pages()) if (p !== page) await p.close().catch(() => {});
await page.goto(`${QWEN_BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
log.info(`[${acc}] окно открыто. Отправь ЛЮБОЕ сообщение в чат Qwen. Если всплывёт капча-слайдер — реши её.`);
log.info(`[${acc}] ИИ должен ответить. Ждём до 10 минут, проверяю API каждые ~10с…`);

// Тестовый запрос к API изнутри страницы (Правило №1): проходит => WAF пропустил.
const testApiFetch = () =>
  page
    .evaluate(async () => {
      const token = localStorage.getItem("token") || "";
      try {
        const r = await fetch("https://chat.qwen.ai/api/v2/chats/new", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            "x-request-id": crypto.randomUUID(),
            "x-source": "web",
            Version: "0.3.22",
          },
          body: JSON.stringify({
            chatId: "",
            models: ["qwen3.8-max"],
            project_id: "",
            timestamp: Date.now(),
            chat_type: "t2t",
            chat_mode: "normal",
          }),
        });
        const j = await r.json().catch(() => null);
        return !!(j && (j.chatId || (j.data && j.data.chatId)));
      } catch {
        return false;
      }
    })
    .catch(() => false);

let ok = false;
for (let i = 0; i < 200; i++) {
  const s = await wafState(page);
  if (i % 3 === 0) log.info(`[${acc}] проверка ${Math.floor(i / 3) + 1}/67: captcha=${s.captcha} title="${s.title}"`);
  if (!s.captcha && s.title === "Qwen" && (await testApiFetch())) {
    ok = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 3000));
}

console.log(ok ? `CAPTCHA_CLEARED [${acc}]` : `CAPTCHA_STILL_BLOCKED [${acc}]`);
await context.close().catch(() => {});
process.exit(ok ? 0 : 1);
