// src/workers/transport.js — стрим-мост: выполнение запросов к Qwen ВНУТРИ вкладки.
// Правило №1: fetch выполняется только внутри живой вкладки реального Chrome.
// Чанки SSE идут в Node через page.exposeFunction("__hiveChunk", ...) по reqId.

import { QWEN_BASE } from "../config.js";
import { newChatBody, chatCompletionsBody, qwenHeaders } from "../qwen/protocol.js";

// Создаёт чат и возвращает chatId (только изнутри страницы).
export async function createChatViaPage(page, token, model) {
  const res = await page.evaluate(
    async ({ url, headers, body }) => {
      const r = await fetch(url, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(body),
      });
      return { status: r.status, text: (await r.text()).slice(0, 1000) };
    },
    { url: `${QWEN_BASE}/api/v2/chats/new`, headers: qwenHeaders(token), body: newChatBody(model) }
  );
  let chatId = null;
  try {
    const j = JSON.parse(res.text);
    if (j?.success && j?.data?.id) chatId = j.data.id;
  } catch {
    /* ignore */
  }
  if (!chatId) {
    const err = new Error(`chats/new failed: ${res.status} ${res.text.slice(0, 300)}`);
    err.qwenResponse = res.text;
    throw err;
  }
  return chatId;
}

// Стрим-мост (ТЗ §4): fetch читается через response.body.getReader() ВНУТРИ страницы,
// каждый чанк уходит в Node через заранее зарегистрированный window.__hiveChunk(reqId, s).
// Резолвится, когда поток страницы дочитан. Чанки вылетают в onChunk по мере прихода.
export async function streamChatInPage({ page, reqId, url, headers, body }) {
  return page.evaluate(
    async ({ url, headers, body, reqId }) => {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify(body),
        });
        const ct = r.headers.get("content-type") || "";
        if (!r.ok || ct.includes("application/json")) {
          const text = await r.text();
          await window.__hiveChunk(reqId, "__JSON__" + ct + "|" + text.slice(0, 5000));
          return "done";
        }
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          window.__hiveChunk(reqId, dec.decode(value, { stream: true }));
        }
        window.__hiveChunk(reqId, "__END__");
        return "done";
      } catch (e) {
        await window.__hiveChunk(reqId, "__PAGEERROR__" + String(e)).catch(() => {});
        return "pageerror";
      }
    },
    { url, headers, body, reqId }
  );
}

export { newChatBody, chatCompletionsBody, qwenHeaders, QWEN_BASE };
