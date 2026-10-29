// src/util/log.js — логгер с маскированием секретов (правило: токены не печатать целиком).
function stamp() {
  return new Date().toISOString();
}

export function redact(s) {
  let out = String(s);
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer ***");
  out = out.replace(/(token"?\s*[:=]\s*"?)([A-Za-z0-9._\-]{8,})/gi, "$1***");
  // Длинные непрерывные строки (>=32) — потенциальные токены/ключи.
  out = out.replace(/\b[A-Za-z0-9._\-]{32,}\b/g, "***");
  return out;
}

function fmt(a) {
  const s = typeof a === "string" ? a : JSON.stringify(a);
  return redact(s);
}

export const log = {
  info: (...args) => console.log(`[${stamp()}] [INFO]`, args.map(fmt).join(" ")),
  warn: (...args) => console.log(`[${stamp()}] [WARN]`, args.map(fmt).join(" ")),
  error: (...args) => console.error(`[${stamp()}] [ERR ]`, args.map(fmt).join(" ")),
};
