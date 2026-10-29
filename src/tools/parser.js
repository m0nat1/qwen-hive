// src/tools/parser.js — извлечение tool-вызовов из потока/строки ответа Qwen (P4).
// Протокол: модель выводит [TOOL_CALL]{"name":"...","arguments":{...}}[/TOOL_CALL].
// Парсер инкрементальный: текст вне маркеров уходит onText сразу (с удержанием хвоста,
// который может оказаться началом маркера), завершённый маркер → onToolCall с валидным JSON.
// Если JSON внутри маркера невалиден — маркер возвращается в текст как есть (fallback).

import { randomUUID } from "node:crypto";

const OPEN = "[TOOL_CALL]";
const CLOSE = "[/TOOL_CALL]";
const HOLD = OPEN.length - 1; // сколько хвостовых символов может быть началом маркера

export function newToolCallId() {
  return "toolu_" + randomUUID().replace(/-/g, "").slice(0, 24);
}

// Убираем markdown-заборы, если модель их добавила вокруг JSON.
function stripFences(s) {
  let t = String(s ?? "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "");
  }
  return t.trim();
}

// Лёгкий ремонт типичных ошибок модели в tool-JSON (P9-опыт):
//  1) "name":Bash   → "name":"Bash"        (незакавыченное значение)
//  2) arguments":{  → "arguments":{        (потерянная открывающая кавычка)
//  3) хвостовые запятые перед } или ]
// Возвращает строку или null, если ремонт не помог.
export function repairToolJson(raw) {
  let s = String(raw ?? "").trim();
  // 2) потерянная открывающая кавычка у ключей аргументов: arguments" / input" / parameters"
  s = s.replace(/(?<=[{,]\s*)(arguments|input|parameters)"(\s*:)/g, '"$1"$2');
  // 1) незакавыченное скалярное значение name: "name":Bash,
  s = s.replace(/"name"\s*:\s*([A-Za-z_][\w\-]*)\s*(?=[,}])/g, '"name":"$1"');
  // 3) хвостовые запятые: ,} → }  ,] → ]
  s = s.replace(/,\s*([}\]])/g, "$1");
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === "object") return s;
  } catch {
    /* ремонт не удался */
  }
  return null;
}

export function createStreamToolParser({ onText, onToolCall } = {}) {
  let buf = "";
  let inCall = false;
  let callBuf = "";

  const emitText = (t) => {
    if (t && onText) onText(t);
  };

  const emitCall = (raw) => {
    const body = stripFences(raw);
    let obj;
    try {
      obj = JSON.parse(body); // только JSON-валидация под catch — ошибки колбэков не маскируем
    } catch {
      const repaired = repairToolJson(body); // типичные ошибки модели — чиним
      if (!repaired) return false;
      try {
        obj = JSON.parse(repaired);
      } catch {
        return false;
      }
    }
    const name = typeof obj?.name === "string" ? obj.name : "";
    if (!name) return false;
    const input = obj.arguments ?? obj.input ?? obj.parameters ?? {};
    if (onToolCall) onToolCall({ id: newToolCallId(), name, input });
    return true;
  };

  const closeCall = (raw, rest) => {
    inCall = false;
    callBuf = "";
    const ok = emitCall(raw);
    if (!ok) emitText(OPEN + raw + CLOSE);
    if (rest) this.push(rest);
  };

  // Тело одного или НЕСКОЛЬКИХ склеенных вызовов: разлепляем по вложенным OPEN.
  // hadClose — был ли в конце [/TOOL_CALL] (для честного fallback-текста).
  const emitBody = (raw, hadClose) => {
    const parts = raw.split(OPEN);
    if (parts.length > 1) {
      for (const part of parts) {
        if (!part.trim()) continue;
        const ok = emitCall(part);
        if (!ok) emitText(OPEN + part + (hadClose ? CLOSE : ""));
      }
      return;
    }
    if (!raw.trim()) return;
    const ok = emitCall(raw);
    if (!ok) emitText(OPEN + raw + (hadClose ? CLOSE : ""));
  };

  return {
    push(chunk) {
      if (!chunk) return;
      if (inCall) {
        callBuf += chunk;
        const ci = callBuf.indexOf(CLOSE);
        if (ci === -1) {
          // Модель склеила вызовы: второй [TOOL_CALL] без закрытия первого.
          const nested = callBuf.indexOf(OPEN);
          if (nested !== -1) {
            const raw1 = callBuf.slice(0, nested);
            const rest = callBuf.slice(nested + OPEN.length);
            inCall = true; // следующий вызов уже начался
            callBuf = rest;
            if (raw1.length > 0) {
              const ok = emitCall(raw1);
              if (!ok) emitText(OPEN + raw1);
            }
          }
          return;
        }
        // CLOSE найден: тело может содержать склеенные вызовы (модель забыла закрыть первый).
        const raw = callBuf.slice(0, ci);
        const rest = callBuf.slice(ci + CLOSE.length);
        callBuf = "";
        inCall = false;
        emitBody(raw, true);
        if (rest) this.push(rest);
        return;
      }
      buf += chunk;
      const oi = buf.indexOf(OPEN);
      if (oi === -1) {
        // держим только тот хвост, который реально может быть началом маркера
        let safe = buf.length;
        const li = buf.lastIndexOf("[");
        if (li !== -1 && OPEN.startsWith(buf.slice(li))) {
          safe = li; // суффикс может оказаться началом маркера — придерживаем
        }
        if (safe > 0) {
          emitText(buf.slice(0, safe));
          buf = buf.slice(safe);
        }
        return;
      }
      emitText(buf.slice(0, oi));
      callBuf = buf.slice(oi + OPEN.length);
      buf = "";
      inCall = true;
      const ci2 = callBuf.indexOf(CLOSE);
      if (ci2 !== -1) {
        const raw = callBuf.slice(0, ci2);
        const rest = callBuf.slice(ci2 + CLOSE.length);
        callBuf = "";
        inCall = false;
        emitBody(raw, true);
        if (rest) this.push(rest);
      }
    },
    flush() {
      if (inCall) {
        // маркер не закрылся до конца потока: если payload валиден — считаем вызов завершённым
        // (модель иногда забывает [/TOOL_CALL]); иначе возвращаем как текст.
        const raw = callBuf;
        inCall = false;
        callBuf = "";
        emitBody(raw, false);
      }
      if (buf) {
        emitText(buf);
        buf = "";
      }
    },
  };
}

// Разбор готового полного ответа (non-stream и тесты).
export function parseFullAnswer(answer) {
  const texts = [];
  const calls = [];
  const p = createStreamToolParser({
    onText: (t) => texts.push(t),
    onToolCall: (c) => calls.push(c),
  });
  p.push(answer || "");
  p.flush();
  return { text: texts.join(""), calls };
}
