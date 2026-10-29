<div align="center">

# 🐝 QWEN HIVE

**Бесплатный Qwen (chat.qwen.ai) как движок для Claude Code — без API-ключей Anthropic.**

Локальный шлюз: с одной стороны — полноценный Anthropic Messages API, с другой — реальные
залогиненные вкладки Chrome на chat.qwen.ai. Пул аккаунтов, прозрачный failover,
стриминг, tool calling, самолечение после WAF.

[English](README.md) · **Русский** · [Архитектура](ARCHITECTURE.md) · [WAF и лимиты](docs/WAF-AND-LIMITS.md)

![status](https://img.shields.io/badge/status-работает-brightgreen) ![tests](https://img.shields.io/badge/тесты-39%2F39-brightgreen) ![license](https://img.shields.io/badge/лицензия-MIT-blue) ![runtime](https://img.shields.io/badge/рантайм-Bun%20%2B%20WSL2-orange)

</div>

---

## Зачем?

Claude Code — лучший агентный кодинг-харнесс, но требует платную подписку Claude.
**Qwen** (chat.qwen.ai) бесплатен — и `qwen3.8-max` уверенно тянет весь агентный цикл
Claude Code (Bash, Edit, Write, Plan mode, суб-агенты).

QWEN HIVE — мост между ними:

```
Claude Code ──(Anthropic /v1/messages)──▶ QWEN HIVE ──(page.evaluate(fetch) внутри реального Chrome)──▶ chat.qwen.ai
                    ▲                                        │
                    │            пул аккаунтов: acc-1 … acc-5 │
                    └────────── failover, ротация, WAF ◀──────┘
```

> **Правило №1 (нерушимое):** каждый запрос к chat.qwen.ai исполняется как
> `page.evaluate(() => fetch(...))` **внутри живой вкладки Chrome** реального залогиненного
> профиля. Никогда из Node/Bun. Страница сама инжектит анти-бот заголовки (`bx-ua`,
> `bx-umidtoken`, `bx-v`) и наследует куки WAF — в этом вся магия.

## Возможности

- 🧩 **Полный Anthropic Messages API**: стриминг + non-stream, полная SSE-последовательность, usage, stop reasons
- 🔧 **Tool calling round-trip**: `tool_use` / `tool_result`, `input_json_delta`, живучий парсер маркеров, чинящий склеенный/битый JSON модели
- 🐝 **Пул аккаунтов**: ротация по кулдаунам, выбор по health, прозрачный **failover** при понише/квоте
- 🛡️ **Знание WAF (Baxia)**: punish → фриз 30 мин; дневная квота → фриз до полуночи; 3 страйка → аккаунт dead; автоперезапуск
- ♻️ **Самолечение**: превентивное обновление JWT до истечения, автоперезапуск вкладок, вотчдог
- ⚡ **Тумблер рассуждений**: `HIVE_THINKING=1` (глубоко, по умолчанию) / `=0` (быстро)
- 🧪 39 юнит-тестов (`bun test`), CI через GitHub Actions

## Быстрый старт

> Требуется: **Linux или WSL2 Ubuntu**, [Bun](https://bun.sh) ≥ 1.1, Google Chrome, Node ≥ 20 (для самого Claude Code).

### 1. Установка и логин

```bash
git clone https://github.com/m0nat1/qwen-hive.git && cd qwen-hive
bun install
# Логин с аккаунтом Qwen в видимом окне (повторить для каждого аккаунта):
bun run src/accounts/login.js acc-1    # открывает chat.qwen.ai, сессия сохранится в data/profiles/acc-1
```

Добавь сколько нужно аккаунтов (`acc-2`, `acc-3`, …) — пул ротирует их автоматически.

### 2. Запуск шлюза

```bash
bash scripts/start-hive.sh     # шлюз + headless-воркеры + health
nohup bash scripts/watch-hive.sh > logs/watchdog.out 2>&1 &   # опционально вотчдод
curl -s localhost:8787/health  # {"ok":true,...}
```

### 3. Запуск Claude Code

```bash
export PATH="$HOME/.bun/bin:$PATH"
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787      # именно 127.0.0.1, НЕ localhost (IPv6!)
export ANTHROPIC_API_KEY=$(cat data/secret.key)
claude        # интерактивная сессия кодинга на бесплатном Qwen
```

Готово — Claude Code работает на бесплатном Qwen. На Windows используй
[`Qwen Hive.bat`](scripts/) (двойной клик: поднимает шлюз, если нужно, + открывает Claude Code).

## Что работает / что нет

| Возможность | Статус |
|---|---|
| Агентный кодинг: Bash / Read / Write / Edit / Glob / Grep | ✅ |
| Plan mode, auto mode, суб-агенты, todo-списки | ✅ |
| Стриминг SSE, тул-циклы | ✅ |
| Встроенный веб-серч Qwen (`auto_search`) | ✅ попроси «поищи в интернете…» |
| `WebSearch` / `WebFetch` (серверные тула Anthropic) | ❌ исполняются на API Anthropic — невозможно с любым сторонним бэкендом |
| Картинки / vision | ⚠️ Qwen умеет; загрузка файлов через шлюз — в планах |

## Архитектура

Подробно — в [ARCHITECTURE.md](ARCHITECTURE.md). Кратко:

- `src/gateway/` — HTTP/SSE сервер, совместимый с Anthropic (порт 8787), failover, троттлинг
- `src/anthropic/` — перевод Messages ↔ внутренние события (frames, emit, surface)
- `src/tools/` — живучий парсер `[TOOL_CALL]{json}[/TOOL_CALL]` (чинит склеенный/битый вывод модели)
- `src/workers/` — по одному Chrome persistent context на аккаунт; JWT-вотчдог; фризы/страйки
- `src/qwen/` — тела запросов, снятые байт-в-байт с реального UI Qwen
- `src/captcha/` — детект WAF/Baxia (RGV587 punish, квота, капча)
- `scripts/` — старт/стоп/вотчдог, логин, капча-помощник, Windows-лаунчеры

## WAF и лимиты (читай до активного использования)

Всё про лимиты, 30-минутные punish-фризы, дневные квоты и почему **нельзя бомбить API** —
в [docs/WAF-AND-LIMITS.md](docs/WAF-AND-LIMITS.md). Коротко: держи «человеческий» темп;
пул и failover сглаживают большую часть.

## Дисклеймер

Независимый неофициальный инструмент для **личного и образовательного использования**.
Не аффилирован с Alibaba/Qwen или Anthropic и не одобрен ими. Автоматизация chat.qwen.ai
может нарушать его Terms of Service — ответственность за использование на тебе. Учетные
данные никогда не пишутся в логи (ключи и куки живут локально в `data/` и не коммитятся).

## Лицензия

[MIT](LICENSE) © 2026 m0nat1
