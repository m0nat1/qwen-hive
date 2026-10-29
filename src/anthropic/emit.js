// src/anthropic/emit.js — события Anthropic Messages SSE для клиента.
// Точная последовательность: message_start → content_block_start → content_block_delta* →
// content_block_stop → message_delta → message_stop. Плюс ping при тишине.

export function sseEvent(obj) {
  return `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`;
}

export function sseData(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export function messageStart({ id, model, inputTokens = 0 }) {
  return {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  };
}

export function contentBlockStart(index, kind = "text", extra = {}) {
  const block =
    kind === "tool_use"
      ? { type: "tool_use", id: extra?.id || "", name: extra?.name || "", input: {} }
      : { type: "text", text: "" };
  return { type: "content_block_start", index, content_block: block };
}

export function textDelta(index, text) {
  return { type: "content_block_delta", index, delta: { type: "text_delta", text } };
}

export function inputJsonDelta(index, partialJson) {
  return { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: partialJson } };
}

export function contentBlockStop(index) {
  return { type: "content_block_stop", index };
}

export function messageDelta({ stopReason = "end_turn", outputTokens = 0 }) {
  return {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  };
}

export function messageStop() {
  return { type: "message_stop" };
}

export function ping() {
  return { type: "ping" };
}
