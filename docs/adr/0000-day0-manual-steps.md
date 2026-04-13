# Day-0 Manual Steps — что должен сделать ты (не код)

**Ветка:** `redesign/v2` (создана, коммит `e024ebd`)
**Дата:** 2026-04-13
**Контекст:** Менеджеры завтра тестят main в prod. Не трогаем их workflow.

Эти шаги нельзя сделать из кода — они требуют твоих действий в UI Vercel/Supabase или коммуникации с командой.

## 1. Push ветки в origin (✅ если готов)

```bash
git push -u origin redesign/v2
```

После push:
- Vercel автоматически создаст preview deployment для `redesign/v2`
- URL будет что-то вроде `pinhead-os-git-redesign-v2-<username>.vercel.app`
- **prod `pinhead-os.vercel.app` продолжает ходить на main** — менеджеры ничего не замечают

## 2. Vercel — проверить настройки (5 минут, UI)

1. Открой Vercel Dashboard → PinheadOS project → Settings → Git
2. Убедись что **Production Branch = `main`** (не трогаем)
3. Settings → Domains: проверь что `pinhead-os.vercel.app` → main
4. Можно добавить удобный alias для preview:
   - Domains → Add → `redesign-v2.pinhead-os.vercel.app`
   - Attach to branch `redesign/v2`
   - (Это не обязательно — можно пользоваться автоматическим preview URL)

## 3. Supabase — создать branch (критично для изоляции данных)

**Цель:** у redesign/v2 должна быть **своя копия схемы Supabase**, чтобы:
- Ты мог применять новые миграции (20260501..20260510) не касаясь prod данных менеджеров
- Менеджеры не видели пустые таблицы `sections`, `workers` и т.д.

**Два варианта:**

### Вариант A — Supabase Branching (рекомендую если есть Pro plan)

1. Supabase Dashboard → PinheadOS project → Branches
2. Create branch → Name: `redesign-v2`
3. Supabase создаст изолированный project-ref с копией схемы (без данных)
4. Скопируй новые keys: `PROJECT_URL`, `ANON_KEY`
5. В Vercel → Environment Variables → Preview environment → Branch `redesign/v2`:
   - `VITE_SUPABASE_URL = <ветка URL>`
   - `VITE_SUPABASE_ANON_KEY = <ветка anon key>`
6. `.env.local` на моей машине — использовать ветку keys (не коммитим в git)

**Важно:** Production environment variables Vercel (для main) НЕ трогаем.

### Вариант B — Второй Supabase project (если Branching недоступен)

1. Supabase Dashboard → New project → `pinhead-os-v2`
2. Дамп схемы из prod: `supabase db dump --schema-only > prod-schema.sql`
3. Применить на v2: `supabase db push` с project-ref v2
4. Дальше как в варианте A с env vars

## 4. Bitrix API access для baseline-extract (для W1 ADR-0006)

Мне нужен **read-only webhook** в Bitrix24 для замера baseline on-time rate за последние 3 месяца:

1. Bitrix24 → Приложения → Вебхуки → Добавить входящий
2. Права: `crm.deal.list`, `crm.deal.get`, `crm.status.list` (только read)
3. Скопируй URL (будет `https://<portal>.bitrix24.ru/rest/<id>/<token>/`)
4. Положи в `.env.local` как `BITRIX_WEBHOOK_URL=...` — **НЕ коммить**
5. Я напишу `scripts/baseline-extract.js` который прочтёт его и посчитает on-time rate

## 5. Коммуникация с командой (важно!)

Сообщение в команду (Bitrix чат / общий Telegram):

> Завтра работаем в `pinhead-os.vercel.app` как обычно — никаких изменений в основном проекте.
>
> Параллельно появится новый preview URL (`redesign-v2.*`) — там идёт разработка production-слоя (techcards, мастер-экран бригадира, сделка). Туда **не заходить** — данные ненастоящие, можно случайно сломать.
>
> Если что-то не работает в основном проекте — сразу пишите, я брошу v2 и чиню prod.
>
> План развития: 3 месяца, cutover с старой системы будет мягким через feature flags, никаких сюрпризов.

## 6. Назначения до W6 (не блокер сегодня, но напоминание)

- **Бухгалтер для parallel-run payroll** (ADR-0007) — кто будет делать daily Excel reconcile с W8. Имя в `docs/adr/0007-accountant.txt` (gitignored или без PII)
- **Менеджер-доброволец для baseline manual capture** (ADR-0006) — кто будет вести параллельный Google Sheet в W1-W2
- **COO authority** для закрытия piecework batch'а (ADR-0007) — подтвердить что COO согласен быть последней подписью при cutover

## Текущий checkpoint

- ✅ Ветка `redesign/v2` создана локально
- ✅ ADR-0001..0008 написаны и закоммичены
- ✅ CLAUDE.md обновлён с правилами параллельных веток
- ⬜ Ветка запушена в origin (`git push -u origin redesign/v2`)
- ⬜ Vercel preview deployment работает (проверить)
- ⬜ Supabase branch создан + env vars в Vercel preview
- ⬜ Bitrix webhook получен и в `.env.local`
- ⬜ Команда предупреждена
- ⬜ Бухгалтер/доброволец/COO назначены (до W6)

## Что я (Claude) могу сделать следующим, как только ты закончишь Day-0:

### Day 1 Tomorrow (пока менеджеры тестят main)

1. `scripts/baseline-extract.js` — извлечение on-time rate из Bitrix
2. `.github/workflows/diff-guard.yml` — CI проверка защищённых файлов
3. `.github/workflows/rls-gate.yml` — CI проверка что каждая новая миграция имеет RLS
4. Миграция `supabase/migrations/20260501_production_foundation.sql`:
   - `profiles.sub_role` + `assigned_section_id`
   - `sections` таблица
   - Role predicate functions (SECURITY DEFINER)
   - `domain_events` таблица с partitioning
   - RLS policies
5. Миграция `supabase/migrations/20260510_db_guards.sql`:
   - `paid_at` immutability trigger (скелет, т.к. piecework_entries в 20260505)
   - Заготовки triggers для 20260505
6. `supabase/functions/domain-events-dispatcher/index.ts` — stub

**Важно:** миграции я **не применяю** к Supabase автоматически — только пишу файлы. Ты потом руками `supabase db push` на ветку, когда всё настроено.

### Когда ты готов — скажи «поехали дальше» или дай конкретный пункт.
