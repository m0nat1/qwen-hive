// src/workers/worker.js — один воркер: персистентный контекст Chrome, вкладка, токен.
// Держит вкладку живой между запросами; токен перечитывает из localStorage (JWT ~16 мин).
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { CHROME_PATH, CHROME_ARGS, QWEN_BASE, QWEN_MODEL } from "../config.js";
import { profilePath, upsertAccount } from "../accounts/registry.js";
import { waitForWafClear, isPunishBody, isQuotaText } from "../captcha/detect.js";
import { createChatViaPage, streamChatInPage, chatCompletionsBody, qwenHeaders } from "./transport.js";
import { createFrameParser } from "../qwen/frames.js";
import { log } from "../util/log.js";

export class Worker {
  constructor(acc) {
    this.acc = acc;
    this.id = acc.id;
    this.status = acc.status === "frozen" && (acc.cooldownUntil || 0) > Date.now() ? "frozen" : "down";
    this.frozenUntil = this.status === "frozen" ? acc.cooldownUntil : 0;
    this.context = null;
    this.page = null;
    this.token = null;
    this.busyUntil = 0;
    this.inFlight = false;
    this.lastUsedAt = 0;
    this.lastError = null;
    this.watchdog = null;
    this.sinks = new Map(); // reqId -> chunk callback
    this._starting = null;
  }

  get busy() {
    return Date.now() < this.busyUntil;
  }

  // Фриз аккаунта (P6): статус frozen, запись в реестр, авто-разморозка через cooldownMs.
  freeze(cooldownMs, reason) {
    this.frozenUntil = Date.now() + cooldownMs;
    this.status = "frozen";
    log.warn(`[${this.id}] FROZEN for ${Math.round(cooldownMs / 60000)} min: ${reason}`);
    const today = new Date().toISOString().slice(0, 10);
    const acc = this.acc || {};
    const strikes = (acc.lastStrikeDate === today ? acc.strikesToday || 0 : 0) + 1;
    const dead = strikes >= 3; // ТЗ §P7: три страйка за день — аккаунт в автономный карантин
    this.acc = { ...acc, lastStrikeDate: today, strikesToday: strikes, status: "frozen", cooldownUntil: this.frozenUntil };
    upsertAccount({
      id: this.id,
      status: dead ? "dead" : "frozen",
      cooldownUntil: this.frozenUntil,
      lastStrikeDate: today,
      strikesToday: strikes,
    });
    if (dead) log.warn(`[${this.id}] strikes=${strikes} — аккаунт помечен dead (ручное вмешательство)`);
    // Закрываем контекст — не тратим память и не дёргаем WAF понапрасну.
    this.context?.close().catch(() => {});
    this.context = null;
    this.page = null;
    setTimeout(
      () => {
        if (this.status === "frozen") {
          log.info(`[${this.id}] cooldown over — relaunching`);
          this.status = "down";
          this.ensure().catch(() => {});
        }
      },
      cooldownMs + 5000
    );
  }

  // Дедупликация старта: параллельные вызовы ждут один и тот же запуск.
  async ensure() {
    if (this.status === "frozen") {
      if (Date.now() < this.frozenUntil) return; // кулдаун не кончился — не стартуем
      this.status = "down"; // кулдаун истёк — можно подниматься
    }
    if (this.page && !this.page.isClosed() && this.status === "ready") return;
    if (this._starting) return this._starting;
    this._starting = this._start().finally(() => {
      this._starting = null;
    });
    return this._starting;
  }

  async _start() {
    this.status = "starting";
    this.context?.close().catch(() => {});
    // Прокси (опционально): HIVE_PROXY=http://user:pass@host:port — WAF-скоринг per-IP,
    // поэтому прокси даёт свежую репутацию всем аккаунтам пула.
    const proxyOpts = {};
    if (process.env.HIVE_PROXY) {
      proxyOpts.proxy = { server: process.env.HIVE_PROXY };
    }
    this.context = await chromium.launchPersistentContext(profilePath(this.id), {
      executablePath: CHROME_PATH,
      headless: process.env.HIVE_HEADLESS === "1",
      args: [...CHROME_ARGS],
      viewport: { width: 1280, height: 900 },
      ...proxyOpts,
    });
    this.page = this.context.pages()[0] || (await this.context.newPage());
    // Восстановленная сессия: закрываем все прежние вкладки и открываем свежую,
    // иначе восстановленные страницы (в т.ч. зависшие WAF-заглушки) душат навигацию.
    for (const p of this.context.pages()) {
      if (p !== this.page) await p.close().catch(() => {});
    }

    // exposeFunction привязан к КОНТЕКСТУ — повторяем для каждого нового контекста.
    await this.context.exposeFunction("__hiveChunk", (reqId, s) => {
      const cb = this.sinks.get(reqId);
      if (cb) cb(s);
    });
    // Проверка биндинга: молчаливый пропуск экспозиции превращаем в понятную ошибку.
    const bt = await this.page.evaluate(() => typeof window.__hiveChunk).catch(() => "evalfail");
    if (bt !== "function") {
      log.warn(`[${this.id}] context binding missing (${bt}) — retrying per-page expose`);
      await this.page.exposeFunction("__hiveChunk", (reqId, s) => {
        const cb = this.sinks.get(reqId);
        if (cb) cb(s);
      });
      const bt2 = await this.page.evaluate(() => typeof window.__hiveChunk);
      if (bt2 !== "function") throw new Error(`[${this.id}] __hiveChunk binding not installed`);
    }

    this.page.on("close", () => {
      log.warn(`[${this.id}] page closed by browser — worker will relaunch on next request`);
      if (this.status === "ready") this.status = "down";
      this.page = null;
      // Автоперезапуск: держим живую вкладку постоянной.
      setTimeout(() => {
        this.ensure().catch(() => {});
      }, 3000);
    });

    let navigated = false;
    for (let i = 0; i < 5 && !navigated; i++) {
      try {
        await this.page.goto(`${QWEN_BASE}/`, { waitUntil: "commit", timeout: 90000 });
        navigated = true;
      } catch {
        log.warn(`[${this.id}] goto attempt ${i + 1} failed, retrying...`);
      }
    }
    if (!navigated) {
      this.status = "frozen";
      throw new Error(`[${this.id}] cannot open chat.qwen.ai after 5 attempts`);
    }
    await this.page.waitForTimeout(5000);
    const cleared = await waitForWafClear(this.page, { maxMs: 5 * 60 * 1000 });
    if (!cleared) {
      this.status = "frozen";
      throw new Error(`[${this.id}] WAF challenge not cleared`);
    }
    this.token = (await this.page.evaluate(() => localStorage.getItem("token")).catch(() => null)) || "";
    if (!this.token) {
      this.status = "frozen";
      throw new Error(`[${this.id}] no token in profile — run login for this account`);
    }
    this.status = "ready";
    this.startTokenWatchdog();
    log.info(`[${this.id}] worker ready (token len ${this.token.length})`);
  }

  // Вотчдог токена: JWT живёт ~16 минут, SPA сама обновляет его в localStorage.
  startTokenWatchdog() {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      if (!this.page || this.page.isClosed()) return;
      this.page
        .evaluate(() => localStorage.getItem("token"))
        .then((t) => {
          if (t && t !== this.token) {
            log.info(`[${this.id}] token refreshed (len ${t.length})`);
            this.token = t;
            return;
          }
          // SPA в headless может не обновлять JWT: если истекает — перезагружаем вкладку.
          const exp = Worker.jwtExpMs(this.token);
          if (exp && Date.now() > exp - 180000) {
            log.info(`[${this.id}] watchdog: JWT expiring soon — proactive reload`);
            this.reload().catch((e) => log.warn(`[${this.id}] refresh reload failed:`, e?.message));
          }
        })
        .catch(() => {});
    }, 60000);
  }

  async reload() {
    if (!this.page || this.page.isClosed()) {
      await this.ensure();
      return;
    }
    await this.page.reload({ waitUntil: "commit", timeout: 90000 }).catch(() => {});
    await this.page.waitForTimeout(3000);
    await waitForWafClear(this.page, { maxMs: 60000 });
    this.token = (await this.page.evaluate(() => localStorage.getItem("token")).catch(() => null)) || "";
  }

  // JWT exp (мс) или 0, если разобрать не удалось.
  static jwtExpMs(token) {
    try {
      const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64").toString("utf8"));
      return typeof payload?.exp === "number" ? payload.exp * 1000 : 0;
    } catch {
      return 0;
    }
  }

  // Токен истекает (< 2 мин) — SPA в headless-вкладке может не обновлять JWT (троттлинг
  // таймеров), поэтому принудительно перезагружаем страницу: SPA получит свежий JWT.
  async refreshTokenIfNeeded() {
    const exp = Worker.jwtExpMs(this.token);
    if (exp && Date.now() > exp - 120000) {
      log.info(`[${this.id}] JWT expiring — reloading page for a fresh token`);
      await this.reload();
    }
  }

  // Один запрос: создать чат + стрим ответа.
  // События через onEvent: {type:"answer",text} | {type:"think"} | {type:"raw"/"created"} | {usage}
  // Возвращает { answer, usage }.
  async chat({ prompt, model = QWEN_MODEL, onEvent }) {
    await this.ensure();
    const fresh = await this.page.evaluate(() => localStorage.getItem("token")).catch(() => null);
    if (fresh && fresh.length > 10) this.token = fresh;
    await this.refreshTokenIfNeeded();

    for (let attempt = 1; attempt <= 2; attempt++) {
      const reqId = "rq-" + randomUUID().slice(0, 8);
      try {
        let chatId;
        try {
          chatId = await createChatViaPage(this.page, this.token, model);
        } catch (e) {
          // JWT протух между проверкой и запросом: перезагружаем страницу и пробуем снова.
          if (attempt === 1 && /unauthorized|token has expired/i.test(String(e?.message || e))) {
            log.warn(`[${this.id}] chats/new unauthorized — reloading page for fresh JWT`);
            await this.reload();
            continue;
          }
          throw e;
        }
        const url = `${QWEN_BASE}/api/v2/chat/completions?chat_id=${encodeURIComponent(chatId)}`;
        const headers = qwenHeaders(this.token);
        const body = chatCompletionsBody({ prompt, chatId, model });

        const queue = [];
        let wake = null;
        let done = false;
        let failure = null; // { kind, body }

        this.sinks.set(reqId, (s) => {
          if (s === "__END__") done = true;
          else if (s.startsWith("__JSON__")) {
            failure = { kind: "json", body: s.slice(8) };
            done = true;
          } else if (s.startsWith("__PAGEERROR__")) {
            failure = { kind: "pageerror", body: s.slice(13) };
            done = true;
          } else if (s.startsWith("__HTTP__")) {
            failure = { kind: "http", body: s.slice(8) };
            done = true;
          } else queue.push(s);
          if (wake) {
            const n = wake;
            wake = null;
            n();
          }
        });

        const evalPromise = streamChatInPage({ page: this.page, reqId, url, headers, body })
          .catch((e) => {
            failure = { kind: "pageerror", body: String(e?.message || e) };
            done = true;
            if (wake) {
              const n = wake;
              wake = null;
              n();
            }
          })
          .finally(() => {
            done = true;
            if (wake) {
              const n = wake;
              wake = null;
              n();
            }
          });

        const parser = createFrameParser();
        let answer = "";
        let usage = null;
        const tReq = Date.now(); // старт потока completions
        const FIRST_CHUNK_TIMEOUT_MS = 90000; // до первого чанка
        const TOTAL_DEADLINE_MS = 180000; // на весь запрос

        while (true) {
          while (queue.length > 0) {
            const s = queue.shift();
            if (s === "__END__") {
              done = true;
              continue;
            }
            if (s.startsWith("__JSON__")) {
              failure = { kind: "json", body: s.slice(8) };
              break;
            }
            for (const ev of parser.push(s)) {
              if (ev.usage) usage = ev.usage;
              if (ev.type === "answer") {
                answer += ev.text;
                if (isQuotaText(answer)) {
                  // Дневная квота модели исчерпана: текст клиенту не эммитим,
                  // аккаунт уйдёт в фриз до полуночи, шлюз переключится на другой.
                  failure = { kind: "quota", body: answer };
                  done = true;
                  break;
                }
                if (onEvent) onEvent(ev);
              }
            }
          }
          if (done) break;
          const now = Date.now();
          const gotFirstChunk = answer.length > 0 || usage !== null;
          if (!gotFirstChunk && now - tReq > FIRST_CHUNK_TIMEOUT_MS) {
            failure = { kind: "timeout", body: "no stream data in 90s" };
            break;
          }
          if (now - tReq > TOTAL_DEADLINE_MS) {
            failure = { kind: "timeout", body: "overall request deadline exceeded" };
            break;
          }
          await new Promise((r) => {
            wake = r;
            setTimeout(r, 25);
          });
        }

        for (const ev of parser.flush()) {
          if (ev.usage) usage = ev.usage;
          if (ev.type === "answer") {
            answer += ev.text;
            if (onEvent) onEvent(ev);
          }
        }

        if (failure) {
          const body = String(failure.body || "");
          // Паниш WAF на уровне API (RGV587/челлендж) — мгновенный ретрай бессмысленен.
          const punished = failure.kind === "json" && isPunishBody(body);
          if (punished) {
            this.freeze(30 * 60 * 1000, "WAF punish on API request");
            const err = new Error("qwen request failed (punish)");
            err.punished = true;
            err.qwenBody = body.slice(0, 1000);
            throw err;
          }
          if (failure.kind === "quota") {
            // Дневная квота исчерпана — аккаунт спит до полуночи (страйк не считается).
            const midnight = new Date();
            midnight.setHours(24, 0, 0, 0);
            this.freeze(Math.max(60000, midnight.getTime() - Date.now()), "daily model quota exhausted");
            const err = new Error("qwen daily quota exhausted for this account");
            err.quota = true;
            throw err;
          }
          if (attempt === 1) {
            // Частая причина — устаревший JWT или подвисшая вкладка: перезагрузить и повторить.
            log.warn(`[${this.id}] request failed (${failure.kind}) — reloading page, retrying once`);
            log.warn(`[${this.id}] upstream body: ${String(failure.body).slice(0, 200)}`);
            await this.reload();
            continue;
          }
          const err = new Error(`qwen request failed (${failure.kind})`);
          err.qwenBody = (failure.body || "").slice(0, 1000);
          throw err;
        }

        log.info(`[${this.id}] chat ok (${answer.length} chars, out_tokens ${usage?.output_tokens ?? "?"})`);
        return { answer, usage };
      } finally {
        this.sinks.delete(reqId);
      }
    }
    throw new Error(`[${this.id}] unreachable`);
  }

  async close() {
    if (this.watchdog) clearInterval(this.watchdog);
    await this.context?.close().catch(() => {});
    this.status = "down";
  }
}
