// src/anthropic/surface.js — разбор входящего Anthropic /v1/messages запроса.
// Вход: { model, max_tokens, system, messages[], tools[], stream }.
// Здесь: нормализация модели, сериализация истории (включая tool_use/tool_result)
// в единый текстовый промпт для Qwen, промпт-инъекция tools (ТЗ §6).

import { mapModel } from "../config.js";

export function parseIncoming(body) {
  const model = mapModel(body.model);
  const maxTokens = Number(body.max_tokens) || 4096;
  const stream = body.stream !== false; // Claude Code по умолчанию стримит
  const system = flattenSystem(body.system);
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const prompt = buildPrompt(body.messages || [], tools, system);
  return { model, maxTokens, stream, prompt, tools, raw: body };
}

function flattenSystem(system) {
  if (!system) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system.map((b) => (typeof b === "string" ? b : b?.text || "")).join("\n");
  }
  return String(system);
}

// Контент-блоки Anthropic → плоский текст для Qwen (t2t-чат не знает tool-ролей).
function renderBlocks(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const out = [];
  for (const b of content) {
    if (!b) continue;
    if (b.type === "text") {
      out.push(b.text);
    } else if (b.type === "tool_use") {
      out.push(`[TOOL_CALL]${JSON.stringify({ name: b.name, arguments: b.input ?? {} })}[/TOOL_CALL]`);
    } else if (b.type === "tool_result") {
      const innerText =
        typeof b.content === "string"
          ? b.content
          : Array.isArray(b.content)
            ? b.content.map((c) => c?.text || JSON.stringify(c)).join("\n")
            : JSON.stringify(b.content ?? "");
      out.push(`[TOOL_RESULT tool_use_id="${b.tool_use_id || ""}"]${innerText}[/TOOL_RESULT]`);
    }
  }
  return out.join("\n");
}

export function buildPrompt(messages, tools, system) {
  const parts = [];
  if (tools.length > 0) {
    const spec = tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      input_schema: t.input_schema || t.inputSchema || {},
    }));
    parts.push(
      [
        "You have access to the following tools.",
        "To call a tool, output EXACTLY this block (always with BOTH opening and closing tags) and nothing else:",
        '[TOOL_CALL]{"name":"<tool_name>","arguments":{...}}[/TOOL_CALL]',
        'Example: [TOOL_CALL]{"name":"get_weather","arguments":{"city":"London"}}[/TOOL_CALL]',
        "IMPORTANT: never omit the closing [/TOOL_CALL] tag. Do not wrap the block in markdown fences.",
        "Use ONLY this format. NEVER use <parameter> tags, <function> blocks, XML or any other tool-calling syntax.",
        "Never repeat tool calls: issue each call exactly once and stop — the results will be provided to you in the next turn.",
        "Do not call tools unless the user's request requires them. For plain questions, reply with plain text only.",
        "If no tool is needed, answer normally in plain text.",
        "Available tools:",
        JSON.stringify(spec),
      ].join("\n")
    );
  }
  if (system) parts.push(`System:\n${system}`);
  for (const m of messages) {
    const role = m.role === "user" ? "User" : "Assistant";
    parts.push(`${role}: ${renderBlocks(m.content)}`);
  }
  parts.push("Assistant:");
  return parts.join("\n\n");
}
