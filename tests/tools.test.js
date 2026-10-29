// tests/tools.test.js — юнит-тесты парсера tool-вызовов (P4).
import { describe, test, expect } from "bun:test";
import {
  createStreamToolParser,
  parseFullAnswer,
  repairToolJson,
} from "../src/tools/parser.js";

describe("tools parser", () => {
  test("plain text passes through", () => {
    const { text, calls } = parseFullAnswer("Просто ответ без инструментов.");
    expect(text).toBe("Просто ответ без инструментов.");
    expect(calls.length).toBe(0);
  });

  test("single tool call extracted", () => {
    const raw = '[TOOL_CALL]{"name":"get_weather","arguments":{"city":"Москва"}}[/TOOL_CALL]';
    const { text, calls } = parseFullAnswer(raw);
    expect(text).toBe("");
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("get_weather");
    expect(calls[0].input).toEqual({ city: "Москва" });
    expect(calls[0].id.startsWith("toolu_")).toBe(true);
  });

  test("text + tool call mixed", () => {
    const raw = 'Сейчас проверю погоду.\n[TOOL_CALL]{"name":"get_weather","arguments":{"city":"СПб"}}[/TOOL_CALL]';
    const { text, calls } = parseFullAnswer(raw);
    expect(text).toBe("Сейчас проверю погоду.\n");
    expect(calls.length).toBe(1);
    expect(calls[0].input.city).toBe("СПб");
  });

  test("marker split across stream chunks", () => {
    const chunks = ["Отвечаю. [TO", 'OL_CALL]{"na', 'me":"calc","argumen', 'ts":{"x":1}}[/TOOL', "_CALL] готово"];
    const texts = [];
    const calls = [];
    const p = createStreamToolParser({ onText: (t) => texts.push(t), onToolCall: (c) => calls.push(c) });
    for (const c of chunks) p.push(c);
    p.flush();
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("calc");
    expect(calls[0].input).toEqual({ x: 1 });
    expect(texts.join("")).toContain("Отвечаю.");
  });

  test("hold-back prevents premature text emission", () => {
    // хвост "[TOOL_C" не должен уйти в текст до подтверждения
    const texts = [];
    const p = createStreamToolParser({ onText: (t) => texts.push(t) });
    p.push("привет [TOOL_C");
    expect(texts.join("")).toBe("привет ");
    p.flush();
    expect(texts.join("")).toBe("привет [TOOL_C");
  });

  test("unclosed marker with valid json at stream end completes the call", () => {
    // модель иногда забывает [/TOOL_CALL] — валидный payload на конце потока принимаем
    const { text, calls } = parseFullAnswer('[TOOL_CALL]{"name":"get_weather","arguments":{"city":"Москва"}}');
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("get_weather");
    expect(calls[0].input.city).toBe("Москва");
    expect(text).toBe("");
  });

  test("invalid json in marker falls back to text", () => {
    const raw = '[TOOL_CALL]{name: get_weather}[/TOOL_CALL]';
    const { text, calls } = parseFullAnswer(raw);
    expect(calls.length).toBe(0);
    expect(text).toContain("[TOOL_CALL]");
  });

  test("multiple tool calls in sequence", () => {
    const raw =
      '[TOOL_CALL]{"name":"a","arguments":{}}[/TOOL_CALL][TOOL_CALL]{"name":"b","arguments":{"k":"v"}}[/TOOL_CALL]';
    const { text, calls } = parseFullAnswer(raw);
    expect(calls.length).toBe(2);
    expect(calls[0].name).toBe("a");
    expect(calls[1].name).toBe("b");
  });

  test("markdown-fenced json tolerated", () => {
    const raw = '```json\n[TOOL_CALL]{"name":"t","arguments":{}}[/TOOL_CALL]\n```';
    const { calls } = parseFullAnswer(raw);
    // маркер внутри забора всё равно распознаётся (забор попадает в текст до маркера)
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("t");
  });

  test("unclosed marker at stream end falls back to text", () => {
    const { text, calls } = parseFullAnswer('начал [TOOL_CALL]{"name":"x"');
    expect(calls.length).toBe(0);
    expect(text).toContain("[TOOL_CALL]");
  });

  test("stream parser repairs malformed model tool call", () => {
    const calls = [];
    const p = createStreamToolParser({ onToolCall: (c) => calls.push(c) });
    p.push('[TOOL_CALL]{"name":Bash,arguments":{"command":"echo hi"}}[/TOOL_CALL]');
    p.flush();
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("Bash");
    expect(calls[0].input.command).toBe("echo hi");
  });

  test("model glues two calls without closing the first — both extracted", () => {
    const raw =
      '[TOOL_CALL]{"name":"a","arguments":{"command":"echo 1"}}' +
      '[TOOL_CALL]{"name":"Bash","arguments":{"command":"grep x"}}[/TOOL_CALL]';
    const texts = [];
    const calls = [];
    const p = createStreamToolParser({ onText: (t) => texts.push(t), onToolCall: (c) => calls.push(c) });
    p.push(raw);
    p.flush();
    expect(calls.length).toBe(2);
    expect(calls[0].name).toBe("a");
    expect(calls[1].name).toBe("Bash");
    expect(calls[0].input.command).toBe("echo 1");
  });

  test("repair: unquoted name value", () => {
    const fixed = repairToolJson('{"name":Bash,"arguments":{"command":"ls"}}');
    expect(fixed).not.toBeNull();
    const parsed = JSON.parse(fixed);
    expect(parsed.name).toBe("Bash");
  });

  test("repair: missing opening quote in arguments key", () => {
    const fixed = repairToolJson('{"name":Bash,arguments":{"command":"echo hi"}}');
    const parsed = JSON.parse(fixed);
    expect(parsed.name).toBe("Bash");
    expect(parsed.arguments.command).toBe("echo hi");
  });

  test("repair: trailing commas", () => {
    const repaired = repairToolJson('{"name":"t","arguments":{"a":1,}}');
    expect(repaired).not.toBeNull();
    expect(JSON.parse(repaired).arguments.a).toBe(1);
  });

  test("stream parser repairs malformed model tool call", () => {
    const calls = [];
    const p = createStreamToolParser({ onToolCall: (c) => calls.push(c) });
    p.push('[TOOL_CALL]{"name":Bash,arguments":{"command":"echo hi"}}[/TOOL_CALL]');
    p.flush();
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("Bash");
    expect(calls[0].input.command).toBe("echo hi");
  });
});
