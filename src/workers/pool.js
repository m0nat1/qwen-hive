// src/workers/pool.js — пул воркеров. P3: минимум — аккаунты из реестра,
// один запрос на аккаунт одновременно, кулдаун после запроса. Ротация — P5.
import { loadRegistry } from "../accounts/registry.js";
import { Worker } from "./worker.js";
import { log } from "../util/log.js";

class Pool {
  constructor() {
    this.workers = [];
    this._gate = Promise.resolve(); // глобальный «шлагбаум» частоты запросов
    this.lastRequestAt = 0;
  }

  // Глобальный троттлинг: WAF наказывает IP за СЕРИИ запросов — держим минимальный
  // зазор между ЛЮБЫМИ двумя запросами к Qwen (независимо от аккаунта).
  async _passGate({ gapMs = 6000 } = {}) {
    const run = this._gate.then(async () => {
      const wait = this.lastRequestAt + gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
    });
    this._gate = run.catch(() => {});
    return run;
  }

  init() {
    const accounts = loadRegistry().accounts.filter((a) => a.status !== "dead");
    this.workers = accounts.map((acc) => new Worker(acc));
    log.info(`pool: ${this.workers.length} account worker(s)`);
    return this;
  }

  // Прогрев: поднимаем вкладки ПОЭТАПНО — одновременный старт N вкладок с одного IP
  // триггерит WAF-тарпит (5 голов хором = burst). Разносим старты по 20 секунд.
  warm() {
    this.workers.forEach((w, i) => {
      setTimeout(() => {
        w.ensure().catch((e) => log.warn(`[${w.id}] warmup failed:`, e?.message));
      }, i * 20000);
    });
  }

  // Взять свободного воркера (лучший health, не busy, кулдаун истёк). Ждёт до waitMs.
  async acquire({ waitMs = 120000 } = {}) {
    const t0 = Date.now();
    for (;;) {
      const now = Date.now();
      const candidates = this.workers
        .filter((x) => x.status === "ready" && !x.busy && x.busyUntil <= now)
        .sort((a, b) => (b.acc.healthScore || 0) - (a.acc.healthScore || 0) || a.lastUsedAt - b.lastUsedAt);
      if (candidates.length > 0) {
        await this._passGate(); // глобальный зазор 6с между любыми запросами к Qwen
        const w = candidates[0];
        w.inFlight = true;
        return w;
      }
      // Никого нет — будим упавших ("down") и размороженных после кулдауна.
      for (const w of this.workers) {
        if (w.inFlight || w._starting) continue;
        if (w.status === "down") {
          w.ensure().catch((e) => log.warn(`[${w.id}] relaunch failed:`, e?.message));
        } else if (w.status === "frozen" && w.frozenUntil <= now) {
          w.status = "down";
          w.ensure().catch((e) => log.warn(`[${w.id}] unfreeze relaunch failed:`, e?.message));
        }
      }
      if (Date.now() - t0 > 120000) return null;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  release(w) {
    w.inFlight = false;
    w.lastUsedAt = Date.now();
    // Кулдаун 20с + джиттер после запроса (WAF наказывает за серии — держим паузу).
    w.busyUntil = Date.now() + 20000 + Math.floor(Math.random() * 8000);
  }

  snapshot() {
    return this.workers.map((w) => ({
      id: w.id,
      status: w.status,
      busy: w.busy,
      frozenUntil: w.frozenUntil || 0,
      lastUsedAt: w.lastUsedAt,
      lastError: w.lastError,
    }));
  }
}

export const pool = new Pool();
