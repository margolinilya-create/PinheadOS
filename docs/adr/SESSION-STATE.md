# Session State — быстрый восстановитель контекста

**Последнее обновление:** 2026-04-14 (сессия 12, UAT round 1 + fixes)
**Текущая фаза:** v2 MVP UAT-validated, готов к cutover. Bitrix sync блокирован.
**Активная ветка:** `redesign/v2`

> Этот файл существует чтобы любая новая сессия могла за 2 минуты понять где мы остановились. Обновляется в конце каждой рабочей сессии.

## TL;DR

Production-first редизайн PinheadOS 2.0 в `redesign/v2`. **W1 + W2 + W3 + W4 закрыты, UAT round 1 пройден.** 60+ коммитов с момента старта ветки.

- 8 миграций применены к v2 Supabase (последняя 20260525_piecework_update_policy_fix)
- 6 ADR-0001 stores + useUndoStore + lib/csvExport + lib/domainEvents + 2 hooks
- 9 production routes + bell + V2Nav + UndoToastHost
- **Real outbox consumer:** dispatcher теперь INSERTs в notifications таблицу с title/body — bell показывает реальные сообщения, не event_types
- CSV export для payroll/workers/orders с UTF-8 BOM (1С/Excel ready)
- KPI tiles на /workshop и /tech-cards
- Search filters в /tech-cards, /workers, /orders/table
- piecework reversal flow для closed batches (ADR-0007)
- **846/846 тестов** зелёные, build чистый, diff-guard не потревожен
- Demo seed + real auth user `demo@pinhead.local` для UAT
- **UAT round 1:** найден 1 blocker + 3 major + 5 minor → всё починено → round 2 PASS по всем пунктам
- **Director UAT checklist:** `docs/UAT-director-checklist.md` готов (20-30 мин прогон)

Все экраны под `app_config.feature_flags`. Main = все флаги отсутствуют → дарк. v2 = флаги=true → активно. Cutover = вставить row в prod app_config.

## UAT round 1 + 2 (2026-04-14, сессия 12)

**Round 1:** pinhead-qa агент нашёл:
- **[blocker]** `/payroll` close batch падал с 403 — policy `piecework_entries_update_admin_unpaid` имела `WITH CHECK (... AND paid_at IS NULL)`, что блокировало транзит NULL→timestamp, ради которого policy и существовала. Trigger `piecework_forbid_update_if_paid` корректен (проверяет `OLD.paid_at`), баг строго в RLS.
- **[major]** `window.confirm()` вместо `useConfirmStore` в `/payroll` → close batch
- **[major]** Delete worker без confirm и без UndoToast
- **[major]** Approve tech card без confirm (действие необратимо)
- **[minor]** `/tech-cards` показывал сырые enum статусы заказа
- **[minor]** «period» вместо «период» в Payroll/Foreman, отсутствие плюрализации «записей»
- **[minor]** Onboarding backdrop перехватывал клики V2Nav на первой загрузке

**Исправления (коммит `0137a42`):**
1. Migration `20260525_piecework_update_policy_fix.sql` — policy WITH CHECK больше не требует `paid_at IS NULL` на NEW row. Belt (USING) + suspenders (trigger) продолжают защищать paid rows.
2. `PayrollScreen`: `window.confirm` → `useConfirmStore` (danger variant)
3. `WorkersScreen`: confirm dialog + `useUndoStore.push()` с `restore` действием; новый `useWorkersStore.restore()` очищает `deleted_at`
4. `TechCardBuilder`: confirm dialog перед approve (irreversible action)
5. `TechCardOrderList`: локализация через `STATUS_LABELS` из useOrdersStore
6. i18n: «period» → «период» везде, `pluralize(n, 'запись', 'записи', 'записей')`
7. `v2.module.css`: `.navBar { position: sticky; top: 0; z-index: calc(var(--z-overlay) + 10); }` — V2Nav выше onboarding overlay

**Round 2 (после фиксов):** PASS по всем пунктам.
- Blocker verified: `PATCH piecework_entries → 204`, batch закрылся без 4xx
- 3 major verified: кастомные danger-диалоги работают, undo toast + restore работают end-to-end
- i18n и onboarding z-index confirmed
- Regression: golden path работает, 0 console errors
- Новых багов нет

**Migration applied:** `20260525_piecework_update_policy_fix.sql` уже в v2 Supabase (`glhwbktsokphgksdvcxj`). **В prod Supabase (`pulzirakjqehsulmjhdj`) ещё НЕ применена** — применить перед включением флагов payroll в prod.

**3 замечания low-priority (не блокеры):**
- Deep-link на защищённый route редиректит на `/` до инициализации auth store (RoleGuard видит isAdmin=false)
- `order_tech_cards` reset в draft требует сбрасывать ОБА поля (`approved_at` + `approved_by`), CHECK `order_tech_cards_approved_consistency` корректен
- UndoToast 5s window может быть коротким для медленных пользователей — UX polish

## Следующие шаги перед cutover

1. **Директорский UAT:** отдать `docs/UAT-director-checklist.md` директору, вставив Vercel preview URL в placeholder (строка 6)
2. **Prod migration:** применить `20260525_piecework_update_policy_fix.sql` в prod Supabase **до** включения payroll флагов в prod
3. **Merge strategy:** `git merge redesign/v2 --no-ff` в main с флагами=OFF в prod `app_config.feature_flags`. Per ADR-0009: never rebase. Red zone файлы для конфликтов: `App.jsx`, `KanbanBoard.jsx`, `Header.jsx`, `package.json`
4. **Post-merge:** включать флаги постепенно через prod `app_config` update — сначала демо-пользователь, потом менеджеры

## Текущее состояние v2

### DB (v2 Supabase `glhwbktsokphgksdvcxj`)

| Таблица | Status |
|---|---|
| `sections` (7 seed) | ✅ |
| `operation_types` (30 seed) | ✅ |
| `sku_tech_templates` + `*_items` | ✅ |
| `order_tech_cards` | ✅ |
| `order_tech_operations` (snapshot cols) | ✅ |
| `workers` | ✅ |
| `piecework_batches` | ✅ |
| `piecework_entries` | ✅ |
| `domain_events` (partitioned) | ✅ |
| `profiles` `orders` `app_config` `catalog_config` `order_comments` `order_audit` `order_templates` (init-from-prod) | ✅ |

**Триггеры:**
- `piecework_immutable_after_pay` — рот для `paid_at IS NOT NULL`
- `tech_operation_order_id_consistency` — denorm consistency
- `orders_audit_trigger` — audit log

**RLS:** все 10 новых таблиц — RLS on, ≥2 политики на каждой. 6 `auth_is_*` SECURITY DEFINER predicates.

**Cron:** `dispatch-domain-events` каждую минуту → POST edge function → drains outbox.

**Edge function:** `domain-events-dispatcher` deployed, dispatchEvent поддерживает event_type vocabulary `tech_card.approved`, `piecework.entry_created`, `payroll.batch_closed`, `test.smoke`.

### Stores (`pinhead-react/src/store/`)

| Store | Tests |
|---|---|
| `useTechCardStore.ts` | 9 (loadCatalog, addOperation snapshot copy, approve refresh, deleteTechCard) |
| `useWorkshopStore.ts` | 3 |
| `useForemanStore.ts` | 4 |
| `useWorkersStore.ts` | 6 |
| `usePayrollStore.ts` | 6 (включая reverseEntry) |
| `useNotificationsStore.ts` | 4 |
| `useUndoStore.ts` (utility) | 5 |
| `lib/domainEvents.ts` (producer) | — |
| RTL `V2Nav.test.jsx` | 4 |

### UI Routes (все flag-gated)

| Route | Component | Что делает |
|---|---|---|
| `/orders/table` | OrdersTableView | Альтернативный листинг Kanban с сортировкой+поиском, кликабельные order_number → builder |
| `/tech-cards` | TechCardOrderList | Список заказов с tech card status |
| `/tech-cards/:orderId` | TechCardBuilder | Create/delete draft, add/remove ops, qty edit, approve со snapshot freeze. Header показывает PH-NNNN |
| `/workshop` | WorkshopBoard | Kanban-style колонки по секциям |
| `/foreman` | ForemanScreen | Section picker + задачи + worker dropdown + запись piecework + auto-batch |
| `/workers` | WorkersScreen | HR CRUD: add, inline section+rate edit, soft-delete |
| `/payroll` | PayrollScreen | Batches → entries (с именами через workers lookup) → Close → **Сторно** для корректировок (reversal_of) |
| `/trash` | TrashScreen | Две секции: tech cards + операции, restore |
| 🔔 NotificationsBell | float widget | Realtime subscribe, unread badge, localStorage seenAt |
| V2Nav | float nav bar | Chips + dev "Войти как demo" button |
| UndoToastHost | float widget | 5с undo для destructive ops |

### Feature flags (v2 `app_config.feature_flags`)

```json
{
  "tech_card_builder": true,
  "workshop_board": true,
  "foreman_screen": true,
  "payroll_screen": true,
  "notifications_bell": true,
  "trash_screen": true,
  "orders_table_view": true,
  "workers_screen": true
}
```

## UAT login

- **URL:** `npm run dev` → пойдёт на `localhost:5176` (или другой порт), Vite читает `pinhead-react/.env.local` → v2 Supabase
- **Credentials:** `demo@pinhead.local` / `DemoPass2026!`
- **Как:** в DEV_MODE авто-логинит fake user → RLS блокирует → жми **🔐 Войти как demo** в правой части V2Nav → reload → реальная сессия → всё видно
- **Seed:** 3 заказа PH-0004..06, 5 workers, 2 approved tech cards, 4 операции, 1 open batch, 2 entries

## Ключевые факты

- **Стек:** React 19 + Vite 7 + Zustand 5 + Supabase + TypeScript
- **Команда:** 1 developer (bus factor = 1)
- **MVP scope (TL;DR):** Tech Card Builder → Workshop → Мастер → bell + undo + trash + Bitrix one-way + Kanban table view. **Bitrix блокирован**, остальное закрыто. TV Dashboard дропнут в phase 2.
- **KPI:** On-time delivery `baseline + 5..+20 п.п.`, цель +10. Baseline ещё не измерен — ждёт Bitrix data.
- **Payroll правило:** ни одна зарплата не выплачивается до parallel-run drift <1% с Excel (ADR-0007). Excel data ещё нет.

## Параллельная разработка main + redesign/v2

См. **ADR-0009**. Коротко:
- Еженедельный `git merge main --no-ff` в `redesign/v2`
- Never rebase
- Diff-guard защищает existing slices/pricing/wizard steps от случайных изменений
- Красная зона merge-конфликтов: `App.jsx`, `KanbanBoard.jsx`, `Header.jsx`, `package.json`
- Синяя зона (main свободно меняет): Wizard, pricing, SKU editors, Dashboard

**Текущий статус merge:** main не двигался с последнего sync (2026-04-13). Никаких diffs нет.

## Защищённые файлы (CI diff-guard)

Ни одно изменение в `redesign/v2` не должно трогать:
- `pinhead-react/src/utils/pricing.ts` (84 теста)
- `pinhead-react/src/store/slices/{wizard,product,design,items,details,catalog,order}Slice.ts` (796 тестов)
- `pinhead-react/src/components/steps/**`
- `pinhead-react/src/components/shared/CommandPalette.jsx`

## Outbox loop end-to-end

```
1. UI action (e.g. approveTechCard)
   → store updates DB (order_tech_cards.status='approved')
   → emitDomainEvent → INSERT domain_events
2. pg_cron tick (каждую минуту)
   → POST https://glhwbktsokphgksdvcxj.functions.supabase.co/domain-events-dispatcher
3. Edge function:
   → SELECT * FROM domain_events WHERE processed_at IS NULL ORDER BY created_at LIMIT 500
   → for each: dispatchEvent (stub log) + UPDATE processed_at = now()
4. Realtime channel в NotificationsBell
   → постгрес-changes INSERT subscription
   → bell badge увеличивается
```

Verified: вставлен test.smoke event → cron подобрал → processed_at проставлен → bell обновился.

## Где искать важные документы

| Что | Путь |
|---|---|
| Этот файл (текущее состояние) | `docs/adr/SESSION-STATE.md` |
| ADR (архитектурные решения) | `docs/adr/0001..0009.md` |
| Day-0 manual checklist | `docs/adr/0000-day0-manual-steps.md` |
| W1 apply checklist (как накатывать на v2) | `docs/adr/W1-APPLY-CHECKLIST.md` |
| Demo seed | `supabase/seed/v2_uat_demo.sql` |
| Контекст проекта | `CLAUDE.md` + `pinhead-react/CLAUDE.md` |
| Changelog/история | `PROJECT.md` |

## Что осталось (не блокирует UAT)

| Item | Why not yet |
|---|---|
| **Bitrix one-way sync** | Блокирован — нужен webhook URL от пользователя |
| **Baseline-extract** (ADR-0006) | Блокирован — нужен Bitrix API + история заказов |
| **piecework parallel-run** vs Excel (ADR-0007) | Нужны Excel-данные для drift сравнения |
| **Real dispatcher consumers** (notifications insert, audit projection) | Stub OK — bell работает через realtime |
| **DnD operations between sections** | Не входило в MVP |
| **More RTL tests** для остальных v2 screens | Incremental safety |
| **Manual chunks split** (904kB warning) | Touches main bundle, risky |
| **TV Dashboard** | Дропнут в phase 2 |

## Следующие шаги

1. **UAT:** пользователь открывает приложение, кликает по экранам, репортит баги
2. **Bitrix unblock:** как только webhook URL — пишу `scripts/baseline-extract.js` + одностороннюю sync ProductionStatus → BitrixDealStage
3. **Excel parallel-run:** когда будут Excel-данные, пишу diff-script
4. **Polish on demand:** конкретные жалобы → конкретные фиксы

## Проверки перед закрытием каждой сессии

- [ ] `git status` чист
- [ ] Коммиты внятно описывают что сделано
- [ ] `SESSION-STATE.md` обновлён
- [ ] Все тесты зелёные
- [ ] `git push origin redesign/v2`
