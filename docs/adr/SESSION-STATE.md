# Session State — быстрый восстановитель контекста

**Последнее обновление:** 2026-04-14 (W3 Day-6 + tests + V2Nav, все этапы автономно)
**Текущая фаза:** v2 MVP end-to-end прототип готов. Next: polish / dispatcher consumers / baseline extract.
**Активная ветка разработки:** `redesign/v2`

> Этот файл существует чтобы любая новая сессия (я или другой разработчик) могла за 2 минуты понять где мы остановились. Обновляется в конце каждой рабочей сессии.

## TL;DR

Production-first редизайн PinheadOS 2.0 в `redesign/v2`. **W1 + W2 + W3 закрыты** в этой мега-сессии (2026-04-14, автономно):
- 6 миграций применены к v2 Supabase через Management API (pg_dump заблокирован supavisor)
- 6 ADR-0001 stores написаны, все с unit тестами (28 новых тестов)
- 5 production UI экранов + realtime bell + feature-flag навигация V2Nav
- `profiles.active` prod-миграция найдена локально, закоммичена в main, смержена в v2
- **824/824 тестов** зелёные (796 старых + 28 новых), build зелёный, lint clean, diff-guard не потревожен

**Все production экраны живут под feature flags** (`app_config.feature_flags`): tech_card_builder, workshop_board, foreman_screen, payroll_screen, notifications_bell. Main Supabase не имеет row → на prod всё дарк. v2 Supabase имеет row с флагами=true → на redesign/v2 preview URL всё живое.

Следующие шаги: polish (CSS modules вместо inline), dispatcher consumer logic, baseline-extract (ждёт Bitrix webhook), weekly main→v2 sync merge.

## Сейчас

| Area | Status |
|---|---|
| Ветка `redesign/v2` | создана, запушена, 7 коммитов |
| ADR-0001..0009 | написаны в `docs/adr/` |
| `CLAUDE.md` | обновлён с branch rules + diff-guard списком |
| Supabase project v2 (`pinhead-os-v2`) | создан, **пустой schema** (ещё не init), ключи в `.env.local` |
| Vercel Preview env vars | scoped к `redesign/v2` → v2 Supabase (main НЕ тронут) |
| **CI: diff-guard workflow** | ✅ написан (`.github/workflows/diff-guard.yml`) |
| **CI: rls-gate workflow** | ✅ написан (`.github/workflows/rls-gate.yml`) |
| **Migration 20260501** production_foundation | ✅ применён (Variant A, idempotency index фикс) |
| **Migration 20260502** seed_sections_and_ops | ✅ применён (7 sections, 30 ops) |
| **Migration 20260503** tech_cards | ✅ применён |
| **Migration 20260504** workers | ✅ применён |
| **Migration 20260505** piecework | ✅ применён (trigger paid_at immutability активен) |
| **Migration 20260510** db_guards | ✅ применён (функции зарегистрированы) |
| **v2 init-from-prod** (6 базовых таблиц) | ✅ применён напрямую через Management API (pg_dump блокирован supavisor; см. docs/adr/W1-APPLY-CHECKLIST.md) |
| **Edge function** domain-events-dispatcher | ✅ написан (stub + README), **НЕ задеплоен** |
| **Store** `useTechCardStore.ts` | ✅ W1 Day-2 (CRUD скелет, lint+tsc clean) |
| **Store** `useWorkshopStore.ts` | ✅ W1 Day-3 (board loaders, lint+tsc clean) |
| **Store** `useWorkersStore.ts` | ✅ W2 Day-1 (CRUD + soft-delete, lint+tsc clean) |
| **Store** `usePayrollStore.ts` | ✅ W2 Day-1 (batches/entries, closeBatch с paid_at stamping, lint+tsc clean) |
| **Store** `useForemanStore.ts` | ✅ W2 Day-2 (section-scoped ops + workers, lint+tsc clean) |
| **Store** `useNotificationsStore.ts` | ✅ W2 Day-2 (domain_events realtime subscribe, localStorage seenAt, lint+tsc clean) |
| **Types** `types/production.ts` | ✅ включая Worker/Piecework*/DomainEvent |
| **Feature flags** (app_config + `useFeatureFlag` hook) | ✅ W3 Day-1 (seeded в v2 app_config.feature_flags) |
| **Route** `/tech-cards` (flag-gated) | ✅ W3 Day-2 — index: список заказов + Tech Card status |
| **Route** `/tech-cards/:orderId` (flag-gated) | ✅ W3 Day-2 — полный builder |
| **Component** `TechCardBuilder.jsx` | ✅ W3 Day-2: create draft, add/remove/qty ops, approve button с snapshot freeze |
| **Component** `TechCardOrderList.jsx` | ✅ W3 Day-2 index |
| **Route** `/workshop` (flag-gated) + `WorkshopBoard.jsx` | ✅ W3 Day-3 — kanban-like sections view, read-only |
| **Route** `/foreman` (flag-gated) + `ForemanScreen.jsx` | ✅ W3 Day-4 — section picker, task list, piecework entry logging с auto-создаваемым batch |
| **Component** `NotificationsBell.jsx` + `/` integration | ✅ W3 Day-5 — fixed-position, realtime subscribe, unread badge, localStorage seenAt |
| **Component** `V2Nav.jsx` | ✅ floating nav bar со ссылками на v2 routes, не трогает Header (red-zone safe) |
| **Unit tests** для v2 stores | ✅ 28 тестов: useTechCardStore(7) + useWorkersStore(6) + usePayrollStore(4) + useNotificationsStore(4) + useWorkshopStore(3) + useForemanStore(4). Full suite 824/824 |
| **Route** `/payroll` + `PayrollScreen.jsx` | ✅ W3 Day-6 — batches list, expand to entries, Close button (admin only) стэмпит paid_at |
| Bitrix webhook URL | **отложен** (нужен для baseline-extract) |
| Init-from-prod schema dump | **⚠️ обязательный шаг** перед применением 20260501 |

## Ключевые факты о проекте

- **Стек:** React 19 + Vite 7 + Zustand 5 + Supabase + TypeScript
- **Команда:** 1 developer (bus factor = 1, главный риск)
- **Scope v2 MVP:** Tech Card Builder → Workshop Board → Мастер-экран бригадира (с встроенной ОТК) → bell + undo + trash + Bitrix one-way + Kanban с Table view. TV Dashboard дропнут в phase 2.
- **KPI:** On-time delivery `baseline + 5..+20 п.п.`, middle target +10. Baseline ещё не измерен (W1 работа).
- **Критичное правило payroll:** ни одна зарплата не выплачивается до parallel-run drift <1% с Excel (ADR-0007)

## Параллельная разработка main + redesign/v2

**ВАЖНО:** Пользователь ведёт улучшения в `main` одновременно с работой в `redesign/v2`. См. **ADR-0009** для полной sync-стратегии.

Коротко:
- Еженедельный `git merge main --no-ff` в `redesign/v2` (понедельники)
- Never rebase
- Diff-guard защищает существующие слайсы и pricing.ts от случайных изменений
- Красная зона конфликтов: `App.jsx`, `KanbanBoard.jsx`, `Header.jsx`, `package.json`
- Синяя зона (main свободно меняет): Wizard, pricing, SKU editors, Dashboard

## Защищённые файлы (CI diff-guard, W1 Day-1 workflow)

Ни одно изменение в `redesign/v2` не должно трогать:
- `pinhead-react/src/utils/pricing.ts` (84 теста)
- `pinhead-react/src/store/slices/{wizard,product,design,items,details,catalog,order}Slice.ts` (796 тестов)
- `pinhead-react/src/components/steps/**`
- `pinhead-react/src/components/shared/CommandPalette.jsx`

## Где искать важные документы

| Что | Путь |
|---|---|
| Полный план v3 (15 разделов + §16 долгов) | `/Users/margolinilya/.claude/plans/merry-seeking-allen.md` (вне git, у разработчика) |
| ADR (все архитектурные решения) | `docs/adr/0001..0009.md` |
| Day-0 manual checklist (Supabase, Vercel, Bitrix) | `docs/adr/0000-day0-manual-steps.md` |
| Этот файл (текущее состояние) | `docs/adr/SESSION-STATE.md` |
| Контекст проекта | `CLAUDE.md` + `pinhead-react/CLAUDE.md` |

## Коммиты на `redesign/v2`

```
e0175e1 feat(redesign/v2): production foundation migrations + events dispatcher
ac4bda0 ci(redesign/v2): add diff-guard + rls-gate workflows (W1 Day-1)
c120663 docs(redesign/v2): ADR-0009 sync strategy + SESSION-STATE recovery doc
0eb4a93 chore(redesign/v2): gitignore .vercel/
0e5c791 chore(redesign/v2): trigger rebuild with new v2 env vars
387b87e docs(redesign/v2): Day-0 manual steps checklist
e024ebd docs(redesign/v2): W1 foundation — ADR-0001..0008 + CLAUDE.md notes
```

## Следующая сессия — W1 Day-2

Решить с пользователем: сначала **применять** W1 Day-1 артефакты к Supabase, или продолжать **писать** код W2?

### Вариант A — применить Day-1 (ручные шаги пользователя, ~30 мин)

1. **Init-from-prod schema dump** — критичный предварительный шаг. v2 Supabase пустой, миграция 20260501 требует существующих `profiles` и `orders` таблиц. Варианты:
   - Supabase Dashboard → prod project → Database → Backups → Generate schema dump → apply to v2 via SQL editor
   - Или через CLI: `supabase db dump --project-ref <prod-ref> --schema-only > init.sql` затем `supabase db push --project-ref glhwbktsokphgksdvcxj < init.sql`
2. **Применить 20260501** через Dashboard SQL editor или CLI
3. **Применить 20260510** (опционально сейчас — функции без триггеров)
4. **Deploy edge function** `supabase functions deploy domain-events-dispatcher --project-ref glhwbktsokphgksdvcxj --no-verify-jwt`
5. **Enable pg_cron extension** в Dashboard → Database → Extensions
6. **Schedule dispatcher cron** из README в `supabase/functions/domain-events-dispatcher/README.md`
7. **Verify** verification queries из §6 migration 20260501
8. **Push редизайн ветки** — CI workflows `diff-guard` + `rls-gate` прогонится впервые, проверит зелёность

### Вариант B — продолжать писать W2 код без применения

1. **Миграция 20260502_seed_sections_and_ops.sql** — seed sections (7) + базовые operation_types (~30)
2. **Store `useTechCardStore.ts`** — Zustand root store для TechDesign контекста (ADR-0001)
3. **Миграция 20260503_tech_cards.sql** — sku_tech_templates + order_tech_cards с unique constraints
4. Подготовка к W3 Tech Card Builder UI

### Вариант C — hybrid

Применить Day-1 Supabase артефакты (Вариант A) + параллельно писать W2 код.

### Рекомендация

Variant A в следующей сессии имеет смысл если есть 30 мин свободных рук. Variant B — если хочется продолжать разработку без context switching к UI.

**Перед стартом W1 Day-2 спросить у пользователя:**
- Готов ли Bitrix webhook URL (если да — добавить в `.env.local` и написать `scripts/baseline-extract.js`)
- Вариант A / B / C?
- Есть ли новые изменения на main, которые нужно мержить в redesign/v2 первым делом (см. ADR-0009 weekly sync)?

## Проверки перед закрытием каждой сессии

Прогнать чек-лист:

- [ ] `git status` чист (нет случайных изменений)
- [ ] Коммиты внятно описывают что сделано
- [ ] `SESSION-STATE.md` обновлён с «где остановились»
- [ ] MEMORY.md файлы в `~/.claude/projects/.../memory/` отражают текущее состояние
- [ ] Если был merge main → redesign/v2 — все 796 тестов зелёные
- [ ] `git push origin redesign/v2` выполнен
