// tests/surface.test.js — юнит-тесты Anthropic-поверхности (чистая логика).
import { describe, test, expect } from "bun:test";
import { parseIncoming, buildPrompt } from "../src/anthropic/surface.js";
import { messageStart, textDelta, messageDelta, messageStop } from "../src/anthropic/emit.js";

describe("anthropic surface", () => {
  test("any model maps to qwen3.8-max", () => {
    const p = parseIncoming({ model: "claude-sonnet-4-5", messages: [] });
    expect(p.model).toBe("qwen3.8-max");
  });

  test("system + messages flatten into prompt", () => {
    const p = parseIncoming({
      model: "x",
      system: "be brief",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
        { role: "user", content: [{ type: "text", text: "go on" }] },
      ],
    });
    expect(p.prompt).toContain("System:\nbe brief");
    expect(p.prompt).toContain("User: hello");
    expect(p.prompt).toContain("Assistant: hi");
    expect(p.prompt.endsWith("Assistant:")).toBe(true);
  });

  test("tool_use history serializes to [TOOL_CALL]", () => {
    const prompt = buildPrompt(
      [
        { role: "user", content: "list files" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "ls", input: { path: "." } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "a.txt\nb.txt" }],
        },
      ],
      [],
      ""
    );
    expect(prompt).toContain('[TOOL_CALL]{"name":"ls","arguments":{"path":"."}}[/TOOL_CALL]');
    expect(prompt).toContain('[TOOL_RESULT tool_use_id="t1"]a.txt\nb.txt[/TOOL_RESULT]');
  });

  test("tools are injected into system prompt", () => {
    const p = parseIncoming({
      model: "x",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "get_weather", description: "w", input_schema: { type: "object" } }],
    });
    expect(p.prompt).toContain("Available tools:");
    expect(p.prompt).toContain("get_weather");
  });

  test("emit events shape", () => {
    const ms = messageStart({ id: "msg_1", model: "qwen3.8-max", inputTokens: 11 });
    expect(ms.type).toBe("message_start");
    expect(ms.message.usage.input_tokens).toBe(11);
    expect(textDelta(0, "x").delta.type).toBe("text_delta");
    expect(messageDelta({ stopReason: "tool_use", outputTokens: 5 }).delta.stop_reason).toBe("tool_use");
    expect(messageStop().type).toBe("message_stop");
  });
});
