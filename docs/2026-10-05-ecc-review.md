# Обзор everything-claude-code (ECC) для PinheadOS — 05.10.2026

Источник: `affaan-m/everything-claude-code`, v2.2.3 (01.10.2026), прочитан клоном
`--depth 1`. **Ничего не установлено** — решение владельца: сначала обзор.
Предпочтение владельца на будущее: при аналоге — брать версию ECC вместо нашей.

## Что внутри

| Компонент | Кол-во | Для нас |
|---|---|---|
| Агенты (`agents/`) | 68 | ~12 по нашему стеку, остальное — другие языки/домены |
| Скиллы (`skills/`) | 293 | ~20 по стеку; много Python/Go/Java/Swift/Kotlin, финансы, маркетинг, сети, видео |
| Команды (`commands/`) | 94 | устаревающий слой, ECC сам переводит их в скиллы |
| Хуки (`hooks/hooks.json`) | 24 | `node -e` на PreToolUse/PostToolUse/Stop/SessionStart/SessionEnd — на **каждый** вызов инструмента |
| Правила (`rules/`) | 23 папки | нам: `common`, `typescript`, `react`, `web` |
| MCP (`mcp-configs/`) | 1 файл | дубль уже подключённых supabase/github/vercel/playwright |

## Почему не «всё целиком»

1. **Контекст.** Имя+описание каждого скилла и агента едет в каждый запрос.
   293+68 описаний — это обратный ход к 207k токенов, от которых CLAUDE.md чистили 15.09.
2. **Конфликт триггеров.** Два скилла на «баг»/«добавить» — срабатывает случайный.
3. **Хуки.** 24 скрипта на каждом вызове: замедление, чужой код с правом на всё,
   Stop-хуки (`delivery-gate`) блокируют завершение по своим эвристикам; пересекаются
   с Husky/lint-staged и нашими сторожами.
4. **Чужой стек по умолчанию.** `react-patterns`, `react-performance` написаны во многом
   под Next.js/RSC; у нас Vite SPA без серверных компонентов.

## Замена наших скиллов (если владелец подтверждает «брать ECC»)

| Наш | Аналог ECC | Комментарий |
|---|---|---|
| `test-driven-development` (87 стр.) | `tdd-workflow` (583) + агент `tdd-guide` | ECC требует 80%+ покрытия — у нас такого порога нет; при замене перенести наши пути тестов, «сторож под `@vitest-environment node`», проверку мутацией |
| `systematic-debugging`, `root-cause-tracing` | прямого аналога нет (`agent-introspection-debugging` — про отладку самого агента) | **оставить наши** |
| `finishing-a-development-branch` | `verification-loop` (129) | хорошая замена: build/types/lint/tests/security-grep/diff-ревью; добавить наше правило конца сессии |
| `software-architecture` | агенты `architect`/`code-architect` + скилл `architecture-decision-records` | замена возможна; ADR складываются в `docs/adr/` — у нас решения живут в `docs/rules/`, нужно согласовать |
| `subagent-driven-development` | `parallel-execution-optimizer` (74), `team-agent-orchestration` | ECC-версии завязаны на dmux/tmux и свой каталог агентов; **оставить наш** или взять `parallel-execution-optimizer` |
| `using-git-worktrees` | `git-workflow` (716) | шире (ветки, коммиты, merge vs rebase), но в 8 раз длиннее; рекомендую заменить |
| `changelog-generator`, `zustand-store-ts`, агент `pinhead-qa` | нет | **оставить** — специфика проекта |

## Что добавить (нет у нас, полезно под стек)

| ECC | Зачем |
|---|---|
| агент `database-reviewer` + скилл `postgres-patterns` | Postgres/Supabase: индексы, RLS, производительность — главная зона риска проекта |
| скилл `database-migrations` | безопасные миграции (expand-contract, бэкфиллы) |
| агенты `react-reviewer`, `typescript-reviewer` | ревью хуков/рендеров/типов |
| агент `silent-failure-hunter` | ловит проглоченные ошибки — прямо про наше правило «toast.error при каждой ошибке Supabase» |
| агенты `build-error-resolver` / `react-build-resolver` | Vite/TS-сборка |
| скиллы `react-testing`, `e2e-testing`, `vite-patterns` | Vitest+RTL, Playwright, Vite |
| скилл `frontend-a11y` | доступность (тач-цели, фокус — у нас уже есть правила) |
| скилл `production-scheduling` | доменная экспертиза: планирование производства, узкие места — по теме ERP цехов |
| скиллы `context-budget`, `skill-stocktake` | периодический аудит раздутого контекста — пригодится после переноса |

## Не брать

- Все языковые наборы кроме TS/React (Python, Go, Java, Kotlin, Swift, Rust, C++, C#, PHP, Dart, Perl…).
- Домены: финансы, маркетинг, сети/homelab, видео, медицина, crypto, научные БД.
- Дубли плагинов: агенты `code-reviewer`, `code-simplifier`, `security-reviewer`,
  скилл `security-review` — у нас плагины `code-review`, `code-simplifier`,
  `security-guidance`, `semgrep` и встроенный `/security-review`.
- Хуки (весь `hooks.json`), `delivery-gate`, `gateguard`, `continuous-learning*`.
- `mcp-configs/` — всё уже подключено.

## Лишнее у нас (зачистка)

- Плагин `agents-design-experience@buildwithclaude` — пересекается с
  `frontend-design@claude-plugins-official`; проверить, пользуемся ли.
- При добавлении `react-reviewer`/`typescript-reviewer` не держать параллельно
  ещё и общий `code-reviewer` из ECC.

## Рекомендуемая первая порция (≈10 файлов, без хуков)

`database-reviewer`, `silent-failure-hunter`, `react-reviewer`, `typescript-reviewer`
(агенты); `postgres-patterns`, `database-migrations`, `verification-loop`
(вместо `finishing-a-development-branch`), `react-testing`, `e2e-testing`,
`production-scheduling` (скиллы). Копировать файлами в `.claude/agents` и
`.claude/skills`, дописать в каждый блок «Pinhead-специфика» (русский язык,
стражи, сторожа, правило конца сессии), убрать упоминания Next.js/RSC.
