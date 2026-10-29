// src/captcha/detect.js — детекция WAF/капчи Aliyun (Baxia) в живой вкладке и на уровне API.
// Возврат: { title, captcha, cleared }.

// Паниш WAF на уровне API-ответа (не страницы): RGV587/челлендж-URL.
export function isPunishBody(body) {
  return /RGV587|FAIL_SYS_USER_VALIDATE|_____tmd_____|action=captcha|aliyun_captcha/i.test(String(body || ""));
}

// Исчерпание дневной квоты модели на аккаунте — приходит как обычный текстовый ответ.
export function isQuotaText(text) {
  return /you'?ve reached (today'?s|a |the )?[^.]{0,80}limit/i.test(String(text || "")) ||
    /upgrade your membership/i.test(String(text || ""));
}

export function makeWafStateFn() {
  return `
  () => {
    const html = document.body ? document.body.innerHTML : "";
    return {
      title: document.title,
      captcha:
        html.includes("aliyun_waf_aa") ||
        html.includes("aliyunCaptcha") ||
        !!document.querySelector(".nc-container, #aliyunCaptcha-window-slider, .aliyun-captcha"),
    };
  }`;
}

export async function wafState(page) {
  return page
    .evaluate(
      () => {
        const html = document.body ? document.body.innerHTML : "";
        return {
          title: document.title,
          captcha:
            html.includes("aliyun_waf_aa") ||
            html.includes("aliyunCaptcha") ||
            !!document.querySelector(".nc-container, #aliyunCaptcha-window-slider, .aliyun-captcha"),
        };
      }
    )
    .catch(() => ({ title: "?", captcha: true }));
}

// Ждёт, пока WAF-заглушка будет снята (пользователь решает капчу в видимом окне).
// Возвращает true, если страница чистая. maxWaitMs по умолчанию 5 минут.
export async function waitForWafClear(page, { maxMs = 5 * 60 * 1000, onPoll } = {}) {
  for (let i = 0; i < Math.floor(maxMs / 2000); i++) {
    const s = await wafState(page);
    if (!s.captcha && s.title === "Qwen") return true;
    if (i % 5 === 0) {
      console.log(
        `[${new Date().toISOString()}] [WARN] WAF challenge active (title="${s.title}") — solve the captcha in the window`
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
