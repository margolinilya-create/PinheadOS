# Session State — быстрый восстановитель контекста

**Последнее обновление:** 2026-04-13 (конец Day-0)
**Текущая фаза:** Day-0 завершён, W1 Day-1 следующая сессия
**Активная ветка разработки:** `redesign/v2`

> Этот файл существует чтобы любая новая сессия (я или другой разработчик) могла за 2 минуты понять где мы остановились. Обновляется в конце каждой рабочей сессии.

## TL;DR

Идёт 3-месячный production-first редизайн PinheadOS 2.0 в параллельной ветке `redesign/v2`. Менеджеры продолжают работать на `main` в prod. Day-0 закрыт: ветка + ADR + Supabase v2 project + Vercel Preview scoping. Следующая сессия — W1 Day-1: CI workflows + первая миграция + edge function stub.

## Сейчас

| Area | Status |
|---|---|
| Ветка `redesign/v2` | создана, запушена, 4 коммита (+ этот) |
| ADR-0001..0009 | написаны в `docs/adr/` |
| `CLAUDE.md` | обновлён с branch rules + diff-guard списком |
| Supabase project v2 (`pinhead-os-v2`) | создан, пустой schema, ключи в `.env.local` |
| Vercel Preview env vars | scoped к `redesign/v2` → v2 Supabase (main НЕ тронут) |
| Migrations 20260501..20260510 | **НЕ написаны** (W1 Day-1 работа) |
| Production screens (Tech Card / Workshop / Foreman) | **НЕ написаны** (W3+) |
| Bitrix webhook URL | **отложен** (нужен для baseline-extract в W1 Day-1) |

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
0eb4a93 chore(redesign/v2): gitignore .vercel/
0e5c791 chore(redesign/v2): trigger rebuild with new v2 env vars
387b87e docs(redesign/v2): Day-0 manual steps checklist
e024ebd docs(redesign/v2): W1 foundation — ADR-0001..0008 + CLAUDE.md notes
```

## Следующая сессия — W1 Day-1 план

Задачи для меня (в порядке):

1. **`.github/workflows/diff-guard.yml`** — CI job проверяет что коммиты на `redesign/v2` не меняют защищённые файлы (паттерн выше)
2. **`.github/workflows/rls-gate.yml`** — CI job проверяет что каждая новая миграция имеет `ENABLE ROW LEVEL SECURITY` + минимум 2 policy
3. **`supabase/migrations/20260501_production_foundation.sql`**:
   - ALTER `profiles` ADD `sub_role`, `assigned_section_id`
   - CREATE TABLE `sections` (должна быть перед role predicate functions — критичный fix из code-review)
   - CREATE SECURITY DEFINER functions: `auth_is_foreman_of()`, `auth_is_technologist()`, `auth_is_production()`, `auth_is_senior_foreman()`
   - CREATE TABLE `domain_events` PARTITION BY RANGE (created_at) + `processed_at` колонка + индексы
   - Ежемесячная partition auto-rollover (первая партиция создаётся руками)
   - ENABLE RLS + 2+ policies на все новые таблицы
4. **`supabase/migrations/20260510_db_guards.sql`** — заготовки:
   - `piecework_forbid_update_if_paid()` функция (триггер применится когда появится таблица в 20260505)
   - `tech_operation_order_id_consistent()` функция (триггер применится когда появится таблица в 20260504)
   - CHECK constraints объявляются в месте где таблицы создаются, не здесь
5. **`supabase/functions/domain-events-dispatcher/index.ts`** — stub:
   - Deno + Supabase JS
   - Read `domain_events where processed_at is null`
   - Pseudo consumer logic (log only, не writing в notifications пока той таблицы нет)
   - Mark processed
   - pg_cron scheduling командой (пользователь применяет в Supabase Dashboard SQL editor)

**НЕ ДЕЛАТЬ автоматически:**
- Не применять миграции к Supabase (только писать файлы)
- Не устанавливать дополнительные npm packages (Radix, Framer, dnd-kit — в W2+, не W1 Day-1)
- Не менять `package.json` в W1 Day-1
- Не трогать существующий код — только новые файлы в `.github/workflows/`, `supabase/migrations/`, `supabase/functions/`

**Перед стартом W1 Day-1 спросить у пользователя:**
- Готов ли Bitrix webhook URL (если да — добавить в `.env.local` и написать `scripts/baseline-extract.js`)
- Если нет — пропустить baseline-extract, остальное W1 Day-1 не блокируется

## Проверки перед закрытием каждой сессии

Прогнать чек-лист:

- [ ] `git status` чист (нет случайных изменений)
- [ ] Коммиты внятно описывают что сделано
- [ ] `SESSION-STATE.md` обновлён с «где остановились»
- [ ] MEMORY.md файлы в `~/.claude/projects/.../memory/` отражают текущее состояние
- [ ] Если был merge main → redesign/v2 — все 796 тестов зелёные
- [ ] `git push origin redesign/v2` выполнен
