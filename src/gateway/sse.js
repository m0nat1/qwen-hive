// src/gateway/sse.js — утилиты SSE для Anthropic-клиента + ping при тишине 10с.
import { ping } from "../anthropic/emit.js";

export function sseData(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

// Универсальный SSE-ответ: асинхронная работа в фоне, ping при тишине, аккуратное закрытие.
export function sseResponse(run, { pingEveryMs = 2000 } = {}) {
  const ts = new TransformStream();
  const writer = ts.writable.getWriter();
  const enc = new TextEncoder();

  (async () => {
    let lastWrite = Date.now();
    let open = true;
    const send = async (obj) => {
      if (!open) return; // клиент уже отвалился — тихо игнорируем (иначе unhandled rejection валит Bun)
      lastWrite = Date.now();
      try {
        await writer.write(enc.encode(sseData(obj)));
      } catch (e) {
        // Обрыв соединения клиента — не валим процесс (Bun считает unhandled rejection фатальным).
        open = false;
        console.log(`[WARN] sse write aborted: ${String(e?.message || e).slice(0, 120)}`);
      }
    };
    let pingTimer = null;
    try {
      // Пинг каждую секунду (по условию ≥1.9с от последней записи): пока Qwen думает
      // (thinking до 90с), поток должен оставаться активным, иначе Bun idleTimeout
      // рвёт соединение до первого содержательного чанка.
      pingTimer = setInterval(() => {
        if (Date.now() - lastWrite >= pingEveryMs - 100) {
          send({ type: "ping" }).catch(() => {});
        }
      }, 1000);
      await run(send);
      await writer.close();
    } catch (e) {
      try {
        if (open) {
          await writer.write(
            enc.encode(
              sseData({ type: "error", error: { type: "api_error", message: String(e?.message || e).slice(0, 500) } })
            )
          );
          await writer.close();
        }
      } catch {
        /* client gone */
      }
    }
    if (pingTimer) clearInterval(pingTimer);
  })();

  return new Response(ts.readable, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
