// src/checks/transport.js — P2: КРИТИЧЕСКИЙ тест транспорта (Правило №1).
// Открывает залогиненный профиль в реальном Chrome, читает токен из localStorage,
// создаёт чат и отправляет "привет" через page.evaluate(() => fetch(...)) —
// НИКАКИХ запросов к Qwen из Node. Параллельно слушает page.on('request') и
// складывает реальные тела /api/v2/chat/completions в data/fixtures/.
//
// Использование: bun run src/checks/transport.js [acc-1] [--headed]
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { CHROME_PATH, CHROME_ARGS, QWEN_BASE, QWEN_MODEL, FIXTURES_DIR } from "../config.js";
import { profilePath, loadRegistry } from "../accounts/registry.js";
import { newChatBody, chatCompletionsBody, qwenHeaders } from "../qwen/protocol.js";
import { createFrameParser } from "../qwen/frames.js";
import { log } from "../util/log.js";

const accId = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "acc-1";
const headed = process.argv.includes("--headed") || process.env.HIVE_HEADLESS !== "1";
// Модель для теста: реальный дефолт UI — qwen3.7-plus; проверка qwen3.8-max — отдельным прогоном.
const MODEL = process.env.HIVE_TEST_MODEL || "qwen3.7-plus";

const acc = loadRegistry().accounts.find((a) => a.id === accId);
if (!acc) {
  log.error(`account ${accId} not found — run: bun run src/accounts/login.js ${accId}`);
  process.exit(1);
}

const context = await chromium.launchPersistentContext(profilePath(accId), {
  executablePath: CHROME_PATH,
  headless: !headed,
  args: [...CHROME_ARGS],
  viewport: { width: 1280, height: 900 },
});

try {
  const page = context.pages()[0] || (await context.newPage());
  // SPA грузится медленно: "commit" + ретраи, полный domcontentloaded не обязателен.
  let navigated = false;
  for (let i = 0; i < 3 && !navigated; i++) {
    try {
      await page.goto(`${QWEN_BASE}/`, { waitUntil: "commit", timeout: 60000 });
      navigated = true;
    } catch (e) {
      log.warn(`goto attempt ${i + 1} failed: ${String(e?.message).split("\n")[0]}`);
    }
  }
  if (!navigated) {
    log.error("TRANSPORT_FAIL: cannot open chat.qwen.ai after 3 attempts");
    process.exit(1);
  }
  await page.waitForTimeout(5000);

  // Детекция WAF-капчи Aliyun: если страничка — заглушка, ждём пока пользователь
  // решит слайдер в видимом окне (куки доверия сохранятся в профиль).
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
      if (i > 0) log.info("WAF challenge cleared — continuing");
      break;
    }
    if (i % 5 === 0) {
      log.warn(`WAF challenge active (title="${s.title}") — PLEASE SOLVE THE CAPTCHA IN THE CHROME WINDOW`);
    }
    await page.waitForTimeout(2000);
  }

  // Ловушка фиксатур: реальные тела chat/completions (для точных тел запросов).
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/api/v2/chat/completions") && req.method() === "POST") {
      try {
        const file = path.join(FIXTURES_DIR, `chat-completions-${Date.now()}.json`);
        writeFileSync(
          file,
          JSON.stringify({ url: u, headers: req.headers(), body: req.postData() }, null, 2)
        );
        log.info("FIXTURE_CAPTURED", path.basename(file));
      } catch (e) {
        log.warn("fixture save failed:", e?.message);
      }
    }
  });

  const token = await page.evaluate(() => localStorage.getItem("token"));
  if (!token) {
    log.error("TRANSPORT_FAIL: token absent in profile (login first)");
    process.exit(1);
  }
  log.info(`token present (len ${token.length})`);

  log.info("testing model:", MODEL);
  // Шаг 1: создать сессию чата — только изнутри страницы.
  const newChat = await page.evaluate(
    async ({ url, headers, body }) => {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify(body),
        });
        const text = await r.text();
        return { ok: true, status: r.status, text: text.slice(0, 800) };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    { url: `${QWEN_BASE}/api/v2/chats/new`, headers: qwenHeaders(token), body: newChatBody(QWEN_MODEL) }
  );

  log.info("chats/new:", newChat.status ?? newChat.error, "body:", newChat.text ?? "");
  let chatId = null;
  try {
    const j = JSON.parse(newChat.text);
    if (j?.success && j?.data?.id) chatId = j.data.id;
    else log.error("chats/new success=false:", JSON.stringify(j).slice(0, 300));
  } catch {
    /* тело уже напечатано */
  }
  if (!chatId) {
    log.error("TRANSPORT_FAIL: cannot create chat — exact response printed above. STOP.");
    process.exit(1);
  }
  log.info("chat created:", chatId);

  // Шаг 2: отправить "привет" и прочитать ответ целиком (стрим-мост появится в P3).
  const result = await page.evaluate(
    async ({ url, headers, body }) => {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify(body),
        });
        const ct = r.headers.get("content-type") || "";
        const text = await r.text();
        return { ok: true, status: r.status, contentType: ct, text: text.slice(0, 20000) };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    {
      url: `${QWEN_BASE}/api/v2/chat/completions?chat_id=${encodeURIComponent(chatId)}`,
      headers: qwenHeaders(token),
      body: chatCompletionsBody({ prompt: "привет", chatId, model: QWEN_MODEL }),
    }
  );

  log.info("completions status:", result.status ?? result.error, "ct:", result.contentType ?? "");
  if (!result.ok) {
    log.error("TRANSPORT_FAIL fetch error:", result.error);
    process.exit(1);
  }
  if ((result.contentType || "").includes("application/json")) {
    // Ошибки приходят как HTTP 200 + success:false — парсим тело.
    log.info("JSON response:", result.text.slice(0, 800));
    process.exit(1);
  }

  // Диагностика: точный сырой вид SSE (первые 1800 символов).
  log.info("RAW_SSE_HEAD<<<");
  log.info(result.text.slice(0, 1800));
  log.info(">>>RAW_SSE_END (total chars:", result.text.length + ")");

  const parser = createFrameParser();
  const events = [...parser.push(result.text), ...parser.flush()];
  const answer = events.filter((e) => e.type === "answer").map((e) => e.text).join("");
  const think = events.filter((e) => e.type === "think").map((e) => e.text).join("");
  const errors = events.filter((e) => e.type === "error");

  if (errors.length > 0) {
    log.error("TRANSPORT_FAIL qwen error frames:", JSON.stringify(errors[0]).slice(0, 500));
    process.exit(1);
  }
  log.info("think chars:", think.length, "(not shown)");
  log.info("ANSWER_TEXT:", answer || "(EMPTY!)");
  log.info(answer ? "TRANSPORT_OK" : "TRANSPORT_FAIL: empty answer");
  if (!answer) process.exit(1);

  // Сохранить успешные тела как фиксатуру по умолчанию.
  const fx = path.join(FIXTURES_DIR, "working-bodies.json");
  writeFileSync(
    fx,
    JSON.stringify({ newChat: newChatBody(QWEN_MODEL), completions: chatCompletionsBody({ prompt: "привет", chatId, model: QWEN_MODEL }) }, null, 2)
  );
  log.info("working bodies saved:", path.basename(fx));
} finally {
  await context.close().catch(() => {});
}
