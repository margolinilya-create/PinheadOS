# Скиллы проекта PinheadOS

Каталог `.claude/skills/` — навыки, которые Claude Code подхватывает автоматически
по полю `description` в `SKILL.md`. Ничего вызывать вручную не нужно: скилл
срабатывает, когда задача попадает под его триггеры.

## 1. Внешние скиллы (подключены 27.07.2026)

Отобраны из подборки скиллов по критерию «применимо к стеку Pinhead»
(React 19 + Vite SPA, TypeScript, Supabase, Vercel, Vitest/Playwright).

### Разработка — процесс

| Скилл | Источник | Зачем в Pinhead |
|---|---|---|
| `brainstorming` | [obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/brainstorming) | Вытягивает нормальное ТЗ до кода. Спеки → `docs/superpowers/specs/` |
| `writing-plans` | [obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/writing-plans) | Большая задача → шаги по 2–5 минут с путями к файлам. Планы → `docs/plans/` |
| `executing-plans` | [obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/executing-plans) | Обязательная пара к `writing-plans` (исполнение плана с чекпойнтами) |
| `dispatching-parallel-agents` | [obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/dispatching-parallel-agents) | 2+ независимых задачи — параллельно, а не по очереди |
| `requesting-code-review` | [obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/requesting-code-review) | Чек-лист перед ревью/мержем |
| `receiving-code-review` | [obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/receiving-code-review) | Разбор замечаний: принять / обсудить / отклонить с аргументами |

### Разработка — фронтенд

| Скилл | Источник | Зачем в Pinhead |
|---|---|---|
| `react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) | ~70 правил производительности React. **Pinhead — Vite SPA, не Next.js**: применимы `rerender-*`, `js-*`, `bundle-*`, `rendering-*`, `client-*`; `server-*`/RSC — пропускать |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | Аудит вёрстки и доступности (a11y, типографика, фокус, состояния) |

### Безопасность

| Скилл | Источник | Зачем в Pinhead |
|---|---|---|
| `vibesec` | [BehiSecc/VibeSec-Skill](https://github.com/BehiSecc/VibeSec-Skill) | XSS/SQLi/IDOR/SSRF в вебе. Точки риска у нас: RLS-политики Supabase, роли, загрузка фото в `sku-photos` |
| `security-threat-model` | [openai/skills](https://github.com/openai/skills/tree/main/skills/.curated/security-threat-model) | Модель угроз по репозиторию перед выкаткой в прод |

### GitHub

| Скилл | Источник | Зачем в Pinhead |
|---|---|---|
| `gh-fix-ci` | [openai/skills](https://github.com/openai/skills/tree/main/skills/.curated/gh-fix-ci) | Красные чеки GitHub Actions — читает логи и чинит. Требует `gh` CLI |
| `gh-address-comments` | [openai/skills](https://github.com/openai/skills/tree/main/skills/.curated/gh-address-comments) | Правки по комментариям ревью в открытом PR. Требует `gh` CLI |

### Мета

| Скилл | Источник | Зачем в Pinhead |
|---|---|---|
| `review-claudemd` | [ykdojo/claude-code-tips](https://github.com/ykdojo/claude-code-tips/tree/main/skills/review-claudemd) | Анализ прошлых сессий → что дописать в `CLAUDE.md` |

## 2. Локальные правки внешних скиллов

Скиллы скопированы в репозиторий (vendored), а не подтянуты пакетным менеджером,
и адаптированы под проект:

- **Пути к артефактам** приведены к структуре Pinhead: планы — `docs/plans/`,
  спеки — `docs/superpowers/specs/` (там уже лежит спека сессии 10).
- **Ссылки между скиллами** — убран префикс `superpowers:`; ссылки ведут на
  скиллы, которые реально есть в проекте (`using-git-worktrees`,
  `subagent-driven-development`, `finishing-a-development-branch`).
- **Описания дополнены русскими триггерами** — общение в проекте на русском,
  без этого скиллы не срабатывали бы на фразы вроде «упал CI» или «проверь вёрстку».
- **Имена приведены к именам папок** (`vercel-react-best-practices` →
  `react-best-practices`, `VibeSec-Skill` → `vibesec`).
- Удалено лишнее: Codex-манифесты `agents/openai.yaml`, ассеты-картинки, `.zip`.

Поэтому **обновлять их через `npx skills update` нельзя** — правки затрутся.
Обновление вручную: скачать новую версию из источника и повторно применить
пункты выше. В `skills-lock.json` эти скиллы не заносятся намеренно
(файл к тому же в `.gitignore`).

## 3. Что из подборки сознательно не бралось

| Скилл | Причина |
|---|---|
| `google-labs-code/shadcn-ui` | В проекте vanilla CSS + CSS Modules, shadcn/Tailwind нет; тянуть зависимости без обсуждения запрещено правилами |
| `getsentry/sentry-workflow` | Sentry в проекте не подключён |
| `postgres` (read-only SELECT) | Дублирует Supabase MCP, который уже настроен |
| `openai/yeet` | Конфликтует с собственным `finishing-a-development-branch` и conventional commits |
| `mcp-builder`, `skill-creator` | Уже доступны глобально; MCP-серверы в проекте не пишем |
| `agnix` | Это npm-линтер (CLI), а не скилл — ставится отдельно, если понадобится |
| Контент / маркетинг / автоматизация | YouTube, X/Twitter, блоги, Telegram, Obsidian, NotebookLM, Firecrawl, typefully, courier, remotion, pinme и т.п. — внутренняя ERP типографии, не медиапроект |

## 4. Собственные скиллы проекта

`systematic-debugging`, `test-driven-development`, `software-architecture`,
`zustand-store-ts`, `changelog-generator`, `root-cause-tracing`,
`finishing-a-development-branch`, `using-git-worktrees`,
`subagent-driven-development` — написаны под Pinhead (на русском, с путями к
файлам проекта). Остальные каталоги — из ruflo/claude-flow.
