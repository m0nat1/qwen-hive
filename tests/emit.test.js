// tests/emit.test.js — проверка эмitters Anthropic SSE (защита от ReferenceError-регрессов).
import { describe, test, expect } from "bun:test";
import {
  contentBlockStart,
  textDelta,
  inputJsonDelta,
  contentBlockStop,
  messageDelta,
  messageStop,
} from "../src/anthropic/emit.js";

describe("anthropic emit", () => {
  test("contentBlockStart tool_use carries id and name", () => {
    const ev = contentBlockStart(1, "tool_use", { id: "toolu_x", name: "get_weather" });
    expect(ev.content_block.type).toBe("tool_use");
    expect(ev.content_block.id).toBe("toolu_x");
    expect(ev.content_block.name).toBe("get_weather");
  });

  test("inputJsonDelta emits partial_json without throwing", () => {
    const ev = inputJsonDelta(0, '{"city":"Москва"}');
    expect(ev.delta.type).toBe("input_json_delta");
    expect(ev.delta.partial_json).toBe('{"city":"Москва"}');
  });

  test("messageDelta stop_reason tool_use", () => {
    const ev = messageDelta({ stopReason: "tool_use", outputTokens: 5 });
    expect(ev.delta.stop_reason).toBe("tool_use");
    expect(ev.usage.output_tokens).toBe(5);
  });

  test("contentBlockStop / messageStop shapes", () => {
    expect(contentBlockStop(2).type).toBe("content_block_stop");
    expect(messageStop().type).toBe("message_stop");
  });
});
