// tests/captcha.test.js — детект WAF-паниша на уровне API (P6).
import { describe, test, expect } from "bun:test";
import { isPunishBody } from "../src/captcha/detect.js";

describe("waf punish detection", () => {
  test("detects RGV587 punish page", () => {
    expect(isPunishBody("哎哟喂,被挤爆啦~请稍等片刻再试哦 RGV587 standby")).toBe(true);
  });

  test("detects FAIL_SYS_USER_VALIDATE challenge", () => {
    expect(isPunishBody('{"code":"FAIL_SYS_USER_VALIDATE","value":"_____tmd_____|punish"}')).toBe(true);
  });

  test("detects captcha action url", () => {
    expect(isPunishBody("https://ynuf.alipay.com/uv.htm?action=captcha")).toBe(true);
  });

  test("normal payloads are not punished", () => {
    expect(isPunishBody('{"choices":[{"delta":{"content":"hi"}}]}')).toBe(false);
    expect(isPunishBody("")).toBe(false);
    expect(isPunishBody(null)).toBe(false);
  });
});
