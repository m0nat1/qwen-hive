// src/qwen/frames.js — парсер SSE-фреймов Qwen (text/event-stream, `data: {...}`).
// Реальный формат (по фиксатуре 2026-10-26):
//   data: {"response.created":{...}}
//   data: {"choices":[{"delta":{"role":"assistant","content":"...","phase":"thinking_summary|answer","extra":{...},"status":"typing"}}],"response_id":"...","usage":{...}}
// Фреймы с phase:"thinking" / "thinking_summary" помечаются think — наверх идут только phase:"answer".
// Ответы-ошибки приходят как HTTP 200 + {"success":false,...} — парсим тело всегда.

export function createFrameParser() {
  let buf = "";

  function classify(obj) {
    if (obj && obj.success === false) {
      return { type: "error", error: obj };
    }
    if (obj && obj["response.created"]) {
      return { type: "created", obj };
    }
    const delta = obj?.choices?.[0]?.delta;
    if (delta) {
      const content = typeof delta.content === "string" ? delta.content : "";
      if (delta.phase === "answer") return { type: "answer", text: content };
      // thinking / thinking_summary — рассуждения, наверх не стримим.
      return { type: "think", text: "" };
    }
    // Легаси-формат из ТЗ: {"phase":"answer","content":"..."}
    const phase = obj?.phase ?? obj?.data?.phase;
    const content = obj?.content ?? obj?.data?.content ?? "";
    if (phase === "think") return { type: "think", text: String(content) };
    if (phase === "answer") return { type: "answer", text: String(content) };
    if (obj && obj.success === false) return { type: "error", error: obj };
    return { type: "raw", obj };
  }

  function feed(rawBlock, out) {
    for (const line of rawBlock.split("\n")) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const payload = l.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch {
        continue; // не-JSON мусор игнорируем
      }
      out.push(classify(obj));
    }
  }

  return {
    // Подать chunk (строка). Возвращает массив событий:
    //   { type:"answer", text } | { type:"think", text } | { type:"error", error } | { type:"raw"/"created", obj }
    push(chunk) {
      buf += String(chunk).replace(/\r\n/g, "\n");
      const events = [];
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        feed(raw, events);
      }
      return events;
    },
    flush() {
      const rest = buf;
      buf = "";
      const out = [];
      for (const line of rest.split("\n")) {
        const l = line.trim();
        if (!l.startsWith("data:")) continue;
        const payload = l.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          out.push(classify(JSON.parse(payload)));
        } catch {
          /* ignore */
        }
      }
      return out;
    },
  };
}
