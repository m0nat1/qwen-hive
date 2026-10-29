// src/gateway/server.js — HTTP-шлюз на порту 8787.
// P3: GET /health, GET /v1/models, POST /v1/messages (stream + non-stream).
import { randomUUID } from "node:crypto";
import { PORT, API_KEY, VERSION, DATA_DIR } from "../config.js";
import { parseIncoming } from "../anthropic/surface.js";
import {
  messageStart,
  contentBlockStart,
  textDelta,
  inputJsonDelta,
  contentBlockStop,
  messageDelta,
  messageStop,
} from "../anthropic/emit.js";
import { createStreamToolParser, parseFullAnswer } from "../tools/parser.js";
import { sseResponse } from "./sse.js";
import { pool } from "../workers/pool.js";
import { log } from "../util/log.js";
import { QWEN_MODEL } from "../config.js";

const startedAt = Date.now();

function json(data, status = 200) {
  return new Response(JSON.stringify(data) + "\n", {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authorized(req) {
  const h = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const key = m ? m[1].trim() : (req.headers.get("x-api-key") || "").trim();
  return key.length > 0 && key === API_KEY;
}

// Подборка финального события: usage от Qwen приоритетнее оценки.
function outTokens(usage, chars) {
  return usage?.output_tokens ?? Math.max(1, Math.round((usage?.total_tokens ?? 0) > 0 ? usage.output_tokens : Math.round(chars / 4)));
}

// Не-стриминговый режим: собрать целиком и вернуть JSON (с tool_use-блоками при наличии).
async function handleNonStream(send, parsed, worker, id, requestModel, inputTokens) {
  const { answer, usage } = await worker.chat({ prompt: parsed.prompt, model: parsed.model });
  const { text, calls } = parseFullAnswer(answer);
  const content = [];
  if (text) content.push({ type: "text", text });
  for (const c of calls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
  if (content.length === 0) content.push({ type: "text", text: "" });
  return {
    id,
    type: "message",
    role: "assistant",
    model: requestModel,
    content,
    stop_reason: calls.length > 0 ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: usage?.output_tokens ?? Math.round(answer.length / 4) },
  };
}

export function startGateway() {
  const server = Bun.serve({
    port: PORT,
    idleTimeout: 255, // макс: Qwen может думать 90с+ до первого чанка — не рвать соединение
    async fetch(req) {
      const url = new URL(req.url);
      const route = url.pathname;

      if (route === "/health" && req.method === "GET") {
        return json({
          ok: true,
          service: "qwen-hive",
          version: VERSION,
          uptimeSec: Math.round((Date.now() - startedAt) / 1000),
          port: PORT,
          accounts: pool.snapshot(),
        });
      }

      if (route === "/v1/models" && req.method === "GET") {
        return json({
          object: "list",
          data: [{ id: QWEN_MODEL, object: "model", owned_by: "qwen-hive" }],
        });
      }

      if (route === "/v1/messages" && req.method === "POST") {
        if (!authorized(req)) {
          return json(
            { type: "error", error: { type: "authentication_error", message: "invalid api key" } },
            401
          );
        }
        const body = await req.json().catch(() => null);
        if (!body) return json({ type: "error", error: { type: "invalid_request_error", message: "bad json" } }, 400);

        const parsed = parseIncoming(body);
        log.info(`/v1/messages: model=${parsed.raw?.model || parsed.model} stream=${parsed.stream} promptChars=${parsed.prompt.length}`);

        const id = "msg_" + randomUUID().replace(/-/g, "").slice(0, 20);
        const requestModel = parsed.raw?.model || parsed.model;
        const inputTokens = Math.max(1, Math.ceil(parsed.prompt.length / 4));

        // Не-стриминговый режим: с прозрачным failover при панише аккаунта (P6).
        if (!parsed.stream) {
          let lastErr = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            const worker = await pool.acquire();
            if (!worker) break;
            try {
              const result = await handleNonStream(null, parsed, worker, id, requestModel, inputTokens);
              return json(result);
            } catch (e) {
              lastErr = e;
              if (!(e?.punished || e?.quota)) {
                log.error("/v1/messages error:", e?.message, e?.qwenBody || "");
                return json({ type: "error", error: { type: "api_error", message: String(e?.message || e).slice(0, 500) } }, 502);
              }
              log.warn(`[failover] ${worker.id} ${e?.punished ? "punished" : "quota-exhausted"} — trying another account`);
            } finally {
              pool.release(worker);
            }
          }
          const e = lastErr || new Error("no free qwen account right now");
          log.error("/v1/messages error:", e?.message, e?.qwenBody || "");
          const overloaded = !lastErr;
          return json(
            { type: "error", error: { type: overloaded ? "overloaded_error" : "api_error", message: String(e?.message || e).slice(0, 500) } },
            overloaded ? 529 : 502
          );
        }

        // Стриминговый режим: точная последовательность Anthropic SSE + tool_use-блоки.
        // P6: при панише аккаунта ДО первого вывода — прозрачный failover на другой воркер.
        return sseResponse(async (send) => {
          try {
            await send(messageStart({ id, model: requestModel, inputTokens }));
            let usage = null;
            let answer = "";
            let lastErr = null;

            for (let attempt = 0; attempt < 2; attempt++) {
              const worker = await pool.acquire();
              if (!worker) break;

              // Состояние эмиссии — на каждую попытку чистое.
              let hasToolUse = false;
              let nextIndex = 0;
              let textOpen = false;
              let textIndex = -1;
              let emittedAny = false;

              const openText = () => {
                if (textOpen) return;
                textIndex = nextIndex++;
                void send(contentBlockStart(textIndex, "text"));
                textOpen = true;
              };
              const closeText = () => {
                if (!textOpen) return;
                void send(contentBlockStop(textIndex));
                textOpen = false;
              };
              const toolParser = createStreamToolParser({
                onText: (t) => {
                  ops.push(() => openText());
                  ops.push(() => send(textDelta(textIndex, t)));
                  void drainOps();
                },
                onToolCall: (c) => {
                  hasToolUse = true;
                  ops.push(() => closeText());
                  const idx = nextIndex++;
                  ops.push(() => send(contentBlockStart(idx, "tool_use", { id: c.id, name: c.name })));
                  ops.push(() => send(inputJsonDelta(idx, JSON.stringify(c.input ?? {}))));
                  ops.push(() => send(contentBlockStop(idx)));
                  void drainOps();
                },
              });
              // ops-очередь: каждый send АВЕЙТИТСЯ строго в порядке поступления событий.
              const ops = [];
              let draining = false;
              const drainOps = async () => {
                if (draining) return;
                draining = true;
                try {
                  while (ops.length > 0) {
                    const op = ops.shift();
                    await op();
                  }
                } catch (e) {
                  // Обрыв SSE-клиента не должен валить шлюз (unhandled rejection фатален в Bun).
                  log.warn("sse drain error:", e?.message || String(e));
                } finally {
                  draining = false;
                }
              };

              try {
                const r = await worker.chat({
                  prompt: parsed.prompt,
                  model: parsed.model,
                  onEvent: (ev) => {
                    if (ev.type === "answer" && ev.text) {
                      emittedAny = true;
                      toolParser.push(ev.text);
                    }
                  },
                });
                answer = r.answer;
                usage = r.usage;
              } catch (e) {
                lastErr = e;
                if ((e?.punished || e?.quota) && !emittedAny) {
                  log.warn(`[failover] ${worker.id} ${e?.punished ? "punished" : "quota-exhausted"} before any output — trying another account`);
                  continue; // чистое состояние, другой воркер
                }
                throw e;
              } finally {
                pool.release(worker);
              }

              toolParser.flush();
              await drainOps();
              closeText();
              await drainOps();
              if (nextIndex === 0) {
                // Пустой ответ — отдаём валидный пустой текстовый блок.
                await send(contentBlockStart(0, "text"));
                await send(contentBlockStop(0));
              }
              const stopReason = hasToolUse ? "tool_use" : "end_turn";
              const outTokens =
                usage?.output_tokens ??
                Math.max(1, Math.round(answer.length / 4));
              await send(messageDelta({ stopReason, outputTokens: outTokens }));
              await send(messageStop());
              lastErr = null;
              break;
            }
            if (lastErr) throw lastErr;
          } finally {
            /* released above */
          }
        });
      }

      return json(
        { type: "error", error: { type: "not_found", message: `no route: ${req.method} ${route}` } },
        404
      );
    },
    error(err) {
      log.error("gateway error:", err?.message || String(err));
      return json({ type: "error", error: { type: "internal_error", message: "internal error" } }, 500);
    },
  });

  log.info(`gateway listening on http://localhost:${PORT} (pid ${process.pid})`);
  return server;
}

