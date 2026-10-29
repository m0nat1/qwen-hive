// src/qwen/protocol.js — тела запросов к chat.qwen.ai.
// ВАЖНО (Правило №1): все функции возвращают ТОЛЬКО описания запросов.
// Исполнять их можно ТОЛЬКО через page.evaluate(() => fetch(...)) внутри живой вкладки.
// Тела сняты с реального UI 2026-10-26: data/fixtures/ui/*chat_completions*.json.

import { randomUUID } from "node:crypto";
import { THINKING_ENABLED } from "../config.js";

export const CHAT_TYPE = "t2t";
export const CHAT_MODE = "normal";
export const QWEN_API_VERSION = "0.3.22"; // заголовок Version реального UI (был 0.3.20 в ТЗ)

export function newChatBody(model) {
  return {
    chatId: "",
    models: [model],
    project_id: "",
    timestamp: Date.now(),
    chat_type: CHAT_TYPE,
    chat_mode: CHAT_MODE,
  };
}

// Точное тело по фиксатуре UI (18:34 МСК). fid/childrenIds — UUID-узлы дерева сообщений UI.
export function chatCompletionsBody({ prompt, chatId, model }) {
  const tsSec = Math.floor(Date.now() / 1000);
  const ts = tsSec;
  return {
    stream: true,
    version: "2.1",
    incremental_output: true,
    chatId,
    parentId: "",
    chat_id: chatId,
    chat_mode: CHAT_MODE,
    model,
    parent_id: null,
    messages: [
      {
        id: null,
        fid: randomUUID(),
        parentId: null,
        childrenIds: [randomUUID()],
        role: "user",
        content: prompt,
        user_action: "chat",
        files: [],
        timestamp: tsSec,
        models: [model],
        model: "",
        chat_type: CHAT_TYPE,
        feature_config: {
          thinking_enabled: THINKING_ENABLED, // HIVE_THINKING=0 — быстро, =1 (дефолт) — с рассуждением
          output_schema: "phase",
          research_mode: "normal",
          auto_thinking: THINKING_ENABLED,
          thinking_mode: "Auto",
          thinking_format: "summary",
          auto_search: true, // встроенный веб-серч Qwen (модель ищет сама при вопросах про интернет)
        },
        extra: { meta: { subChatType: CHAT_TYPE } },
        sub_chat_type: CHAT_TYPE,
        parent_id: null,
      },
    ],
    timestamp: tsSec + 1,
  };
}

// Заголовки для запросов ВНУТРИ страницы (Authorization подставляется из localStorage).
// bx-ua/bx-umidtoken/bx-v инжектятся анти-бот скриптом страницы сами — их не шлём.
export function qwenHeaders(token, { json = true, referer } = {}) {
  const h = {
    accept: "application/json",
    source: "web",
    Version: QWEN_API_VERSION,
    "x-request-id": randomUUID(),
    timezone: new Date().toString(),
    "x-accel-buffering": "no",
  };
  if (json) h["content-type"] = "application/json";
  if (token) h.Authorization = "Bearer " + token;
  if (referer) h.referer = referer;
  return h;
}
