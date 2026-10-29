// tests/frames.test.js — юнит-тесты парсера SSE-фреймов Qwen (чистая логика).
import { describe, test, expect } from "bun:test";
import { createFrameParser } from "../src/qwen/frames.js";

describe("qwen frames", () => {
  test("answer frame passes through", () => {
    const p = createFrameParser();
    const ev = p.push('data: {"phase":"answer","content":"при"}\n\ndata: {"phase":"answer","content":"вет"}\n\n');
    expect(ev.map((e) => e.type + ":" + e.text)).toEqual(["answer:при", "answer:вет"]);
  });

  test("think frame is classified, not answer", () => {
    const p = createFrameParser();
    const ev = p.push('data: {"phase":"think","content":"размышляю"}\n\n');
    expect(ev[0].type).toBe("think");
  });

  test("real UI format: choices/delta answer frames", () => {
    const p = createFrameParser();
    const ev = p.push(
      'data: {"choices":[{"delta":{"role":"assistant","content":"При","phase":"answer","status":"typing"}}],"response_id":"r1","usage":{"output_tokens":1}}\n\n' +
        'data: {"choices":[{"delta":{"role":"assistant","content":"вет","phase":"answer","status":"typing"}}],"response_id":"r1"}\n\n'
    );
    expect(ev.map((e) => e.type + ":" + e.text)).toEqual(["answer:При", "answer:вет"]);
  });

  test("real UI format: thinking_summary frames go to think, empty text", () => {
    const p = createFrameParser();
    const ev = p.push(
      'data: {"choices":[{"delta":{"role":"assistant","content":"","phase":"thinking_summary","extra":{"summary_title":{"content":["t"]},"summary_thought":{"content":["s"]}},"status":"typing"}}],"usage":{"output_tokens":63}}\n\n'
    );
    expect(ev[0].type).toBe("think");
    expect(ev[0].text).toBe("");
  });

  test("response.created frame classified as created", () => {
    const p = createFrameParser();
    const ev = p.push('data: {"response.created":{"chat_id":"x"}}\n\n');
    expect(ev[0].type).toBe("created");
  });

  test("success:false is an error event", () => {
    const p = createFrameParser();
    const ev = p.push('data: {"success":false,"code":"NO_AUTH"}\n\n');
    expect(ev[0].type).toBe("error");
    expect(ev[0].error.code).toBe("NO_AUTH");
  });

  test("frames split across chunks", () => {
    const p = createFrameParser();
    const a = p.push('data: {"phase":"ans');
    const b = p.push('wer","content":"ok"}\n\ndata: {"phase":"answer","content":"!"}\n\n');
    expect(a).toEqual([]);
    expect(b.map((e) => e.text)).toEqual(["ok", "!"]);
  });

  test("CRLF line endings", () => {
    const p = createFrameParser();
    const ev = p.push('data: {"phase":"answer","content":"x"}\r\n\r\n');
    expect(ev[0].text).toBe("x");
  });

  test("[DONE] and non-data lines ignored", () => {
    const p = createFrameParser();
    const ev = p.push(': ping\n\ndata: [DONE]\n\ndata: {"phase":"answer","content":"y"}\n\n');
    expect(ev.map((e) => e.text)).toEqual(["y"]);
  });

  test("flush emits trailing frame", () => {
    const p = createFrameParser();
    p.push('data: {"phase":"answer","content":"tail"}\n');
    const ev = p.flush();
    expect(ev[0].text).toBe("tail");
  });
});
