// src/config.js — конфигурация Qwen Hive. Ключ генерируется один раз и хранится в data/secret.key.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dir, "..");
export const DATA_DIR = path.join(ROOT, "data");
export const LOGS_DIR = path.join(ROOT, "logs");
export const PROFILES_DIR = path.join(DATA_DIR, "profiles");
export const FIXTURES_DIR = path.join(DATA_DIR, "fixtures");

for (const d of [DATA_DIR, LOGS_DIR, PROFILES_DIR, FIXTURES_DIR]) {
  mkdirSync(d, { recursive: true });
}

export const PORT = Number(process.env.HIVE_PORT || 8787);
export const VERSION = "0.1.0";

export const QWEN_BASE = "https://chat.qwen.ai";
export const QWEN_MODEL = process.env.HIVE_QWEN_MODEL || "qwen3.8-max";
export const QWEN_VERSION_HEADER = "0.3.20";

// Режим рассуждений Qwen: HIVE_THINKING=0 — быстро (без thinking), 1 — глубже, но медленнее.
// По умолчанию ВКЛ (юзер просил качество); при наказаниях WAF можно временно глушить.
export const THINKING_ENABLED = (process.env.HIVE_THINKING ?? "1").trim() !== "0";

// modelMap: любое имя модели клиента -> qwen3.8-max (правило "*").
export const modelMap = { "*": QWEN_MODEL };
export function mapModel(name) {
  return modelMap[name] || modelMap["*"];
}

export const CHROME_PATH = process.env.HIVE_CHROME_PATH || "/usr/bin/google-chrome";
// Аргументы Chrome обязательны (см. ТЗ §1).
export const CHROME_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-blink-features=AutomationControlled",
];

// API-ключ моста: env HIVE_API_KEY > data/secret.key > сгенерировать и сохранить.
function loadApiKey() {
  if (process.env.HIVE_API_KEY && process.env.HIVE_API_KEY.length > 0) {
    return process.env.HIVE_API_KEY;
  }
  const f = path.join(DATA_DIR, "secret.key");
  if (existsSync(f)) {
    const k = readFileSync(f, "utf8").trim();
    if (k) return k;
  }
  const key = "hive_" + randomBytes(24).toString("hex");
  writeFileSync(f, key + "\n", { mode: 0o600 });
  return key;
}
export const API_KEY = loadApiKey();
