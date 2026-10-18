# Правки 19.10, часть A — производство (п. 1–6) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** одна задача вышивки «программа → вышивка», новая форма сдачи закроя (выпуск один раз, расход по рулонам тремя режимами), 30 МБ и загрузка ТЗ пачкой, техпаспорт необязателен, без «Принять поставку» в закупке.

**Architecture:** все шесть правок — в замороженном ERP (`src/erp/**` + функции/триггеры `erp_*`). Сервер — тремя новыми миграциями (применённые не правим), страж и клиентский гейт — одним коммитом; в конце каждой задачи — `npm run erp:freeze` и коммит манифеста. Все три миграции совместимы со старым фронтом и идут на бой ДО него (порядок — Task 9).

**Tech Stack:** React 19 + Zustand 5, Supabase (plpgsql, RLS, триггеры-стражи), Vitest + Testing Library, Playwright, SQL-пробы `supabase/probes/`.

**Spec:** Google-документ владельца «правки» (19.10) — `https://docs.google.com/document/d/1raf4nOyC1YiXvuBpjGYMEYm3KnKiF3cMj-6bRhWCKkM`; снимок текста — `docs/erp/2026-10-19-pravki-19-10.md` (Task 0).

## Global Constraints

- **ERP заморожен:** правка `src/erp/**` и DDL по `erp_*` — только после «да» владельца на этот план; в конце каждой задачи `cd pinhead-react && npm run erp:freeze && npx vitest run src/orderstudio/erpFrozen.test.ts`, `erpFrozen.json` — в том же коммите.
- Применённые миграции не редактируются; новая — `supabase/migrations/20261019HHMMSS_<слаг>.sql`; тело пересоздаваемой функции берётся из её ПОСЛЕДНЕЙ редакции (`latestDefining`), сохраняя все прежние ветки.
- Применение на бой — владелец файлами в SQL Editor (MCP `execute_sql` виснет на `drop`/`delete`): сначала сухой прогон `begin; …; PROBE_RESULT; rollback;`, потом применение; контроллер — только SELECT-проверки и запись в `APPLIED.json`.
- Сторож журнала: неприменённых миграций ≤ 5. Перед стартом K и M вехи 8 применены и записаны (Task 0).
- Лимит файла: **30 МБ = `31457280`** литералом в миграции; `TZ_MAX_BYTES === ATTACH_MAX_BYTES === бакет`; писатели Order не мягче бакета.
- Подпись у загрузки ТЗ — ровно «До 30 МБ на один файл» (МБ из константы).
- Тексты интерфейса из спеки: «Разработка программы вышивки», «Вышивка», «Результат кроя», «Расход ткани», «Не использован», «Полностью», «Частично», «Использованы полностью», «Остаток пригоден», «Малый остаток, не учитывать», «Уточнить метраж рулона», «Сдать результат», «Завершить разработку», «Готово к серии».
- Метки транзакции (`set_config('erp.<имя>', 'on', true)`) — значение `'on'`, после записи сброс `'off'`; клиент их выставить не может (PostgREST).
- **Ратчет размера** (`src/fileSizeRatchet.test.ts`): `routes.ts` 618/618, `StageActionsPanel.jsx` 532/532, `stagesSlice.ts` 889/889, `CreateOrderModal.jsx` 955/955 — не растут ни на строку; `cutRolls.ts` 497/500, `StageReportForm.jsx` 496/500 — почти без запаса. Новый код — в новые модули (названы в задачах).
- Блок по условию — `aria-disabled` с видимой причиной (`aria-describedby`); `disabled` — только на время запроса.
- npm-зависимости не добавлять.

## Review Focus

1. **Повторная сдача закроя с тем же рулоном:** рулон с пригодным остатком прошлой сдачи остаётся в списке с «доступно» = текущий остаток (сейчас `rollsForItem` выкидывает свои `status='used'`) — Task 3.
2. **Несколько материалов одной позиции:** выпуск не умножается, средний расход — по каждому материалу — Task 3 (клиент), Task 5 (проба).
3. **Двойное нажатие «Сдать результат», повтор после сбоя, два закройщика одновременно на одном рулоне:** один отчёт, одно списание, второй — отказ «доступно меньше» — Task 4, Task 5.
4. **Старый заказ с двумя строками вышивки** после выкатки: программа сдаётся как раньше, вторая «Вышивка» не появляется — Task 1, Task 2.
5. **Пачка ТЗ: файл 31 МБ + файл с сетевым сбоем:** остальные загружены, у сбоя «Загрузить заново», у большого — имя и причина без повтора — Task 7.

---

## Решения «за владельца» (подтвердить при одобрении)

- **Р1. Вышивка — одна строка этапа, две фазы.** Фаза — `result_kind`: `'embroidery_program'` = «Разработка программы вышивки», `null` = «Вышивка». **Фаза есть только у одиночной строки:** у позиции нет другой строки цеха `embroidery` с `result_kind is null`. Старые заказы с двумя строками живут по прежним правилам (`erp_stage_program_block`, `embroideryProgramBlock` — «наследие», удалить, когда запрос из README выкатки вернёт 0).
- **Р2. Фаза программы не ждёт ни маршрута, ни материалов;** фаза вышивки ждёт `depends_on` строки (маршрут конкретного заказа: крой или последний этап цепочки). Сервер держит запуск и сдачу вышивки триггером; отсутствующую зависимость пропускает, как клиент.
- **Р3. В фазе программы строка «непрозрачна»:** не пропускает количество дальше и `qty_done = 0` (иначе при вышивке последним этапом склад примет тираж до вышивки). Пропуск (`skipped`) и принудительное завершение в фазе программы запрещены; «без программы» — отдельное действие `order.manage`.
- **Р4. Плановые даты строки — даты вышивки;** факт фазы программы — из `erp_stage_events` (старт/«Программа готова»).
- **Р5. Закрой:** выпуск — строки `erp_stage_report_sizes` с `report_roll_id = null`, расход — `erp_stage_report_rolls` без размеров. Старые отчёты не переписываются; их средний расход — по-старому (`roll_good`).
- **Р6. Средний расход — по материалу** (полотно и рибана отдельно); знаменатель — годные строки сдачи того же цвета (сравнение без регистра, пробелов, «ё/е»); если совпадений нет — все годные позиции в сдаче, с пометкой «по всей позиции». По заказу — Σ метров материала / Σ годных, не среднее средних.
- **Р7. Сдача с выпуском без отмеченного рулона** — подтверждение «Сдать без списания ткани?», не блок. Позиция без рулонов вовсе (давальческая, приём весом) — блока рулонов нет, как сейчас.
- **Р8. Закупка:** убираем `ReceiptButton` целиком — «Принять поставку» и «Открыть приёмку» (один вход на склад) — вместе с мёртвым возвратом «← К закупке» на складе (`purchasingReturnHref`, ветка `fromPurchasing`): его ставила только эта кнопка.
- **Р9. 30 МБ получают все вложения ERP** (одна величина — сторож) **и писатели Order** (`erpFiles.ts`, `sendChecklist.ts`, `launchFiles.ts`, мок бакета e2e) — иначе их текст «больше 20 МБ — производство его не примет» станет неправдой.
- **Р10. Квиточки закройщиков** — вопрос к производству, кода нет; ручной ввод среднего расхода не делаем.
- **Р11. Найденные попутно дыры:** у `erp_material_rolls` нет стража (любой со `stage.progress` правит метраж любого рулона) — закрываем в Task 5, потому что новая форма опирается на `length_left_m`. Открытая вставка `erp_order_attachments` (любой участник, любой `kind`) — в этом плане закрываем только для проверок, на которые опираемся (файл программы сверяется с `storage.objects` и заказом); общий страж вставки — отдельной задачей.

---

### Task 0: Предусловия, снимок спеки

**Files:**
- Create: `docs/erp/2026-10-19-pravki-19-10.md` (текст документа дословно, «источник — Google-документ владельца»)

- [ ] **Step 1:** Проверить предусловия выкатки (владелец/SELECT): K и M вехи 8 применены и записаны в `APPLIED.json`, окно наблюдения K закрыто; глобальный лимит Storage проекта ≥ 30 МБ (Dashboard → Storage → Settings). Нет — стоп, сообщить владельцу.
- [ ] **Step 2:** `cd pinhead-react && npm ci && npx vitest run src/orderstudio/erpFrozen.test.ts src/erp/utils/migrationJournal.test.ts` — PASS.
- [ ] **Step 3:** снимок спеки; commit `docs(erp): снимок правок 19.10`.

---

### Task 1: Вышивка — сервер (миграция E1)

**Files:**
- Create: `supabase/migrations/20261019100000_erp_embroidery_one_stage.sql`
- Create: `supabase/probes/erp_embroidery_one_stage.sql`
- Test: `pinhead-react/src/erp/utils/embroideryOneStage.test.ts` (`// @vitest-environment node`)

**Interfaces — Produces:**
- `public.erp_embroidery_is_phased(p_stage_id uuid) returns boolean` (stable, invoker): строка цеха `embroidery`, `result_kind = 'embroidery_program'`, у позиции нет другой строки `embroidery` с `result_kind is null`.
- `public.erp_embroidery_program_finish(p_stage_id uuid) returns erp_item_stages` (security definer, `set search_path = public`): `erp_embroidery_is_phased`, `status = 'in_progress'`, `erp_has_permission('stage.progress')` и `erp_can_act_in_dept(department_id)`; есть `erp_order_attachments(kind='stage_result', stage_id, order_id = заказ этапа)` И объект `storage.objects(bucket_id='erp-attachments', name=file_path)`. Под меткой `erp.program_finish = 'on'`: `result_kind = null, operation = null, status = 'waiting', started_at = null, finished_at = null, assignee = null, qty_done = 0`; метка `'off'`; `erp_stage_events(from 'in_progress', to 'waiting', comment 'Программа вышивки готова')`. Повтор → `22023` «Программа уже сдана»; не фаза → `22023`.
- `public.erp_embroidery_program_skip(p_stage_id uuid, p_reason text)` (definer, `order.manage`, причина обязательна): то же превращение без файла, событие «Без программы: <причина>».
- `public.erp_item_stages_embroidery_route_gate()` + триггер BEFORE UPDATE на `erp_item_stages`: цех `embroidery`, `result_kind is null` → запрет перехода в `in_progress`/`done` и роста `qty_done`, пока существующий `depends_on` не `done`/`skipped` (`23514` «Вышивку можно начать после этапа «<цех>»»); пропуск service role и `erp.force_complete`, `erp.moving`.
- `erp_stage_guard` (тело из `20260928082955_erp_supply_autoclose.sql`): (а) ранний `return new` под меткой `erp.program_finish` — только если `old.result_kind='embroidery_program'`, `new.result_kind is null`, `new.status='waiting'`, `new.qty_done=0`, разница `to_jsonb(new) - to_jsonb(old)` ⊂ {`result_kind`,`operation`,`status`,`started_at`,`finished_at`,`assignee`,`qty_done`,`updated_at`} и `erp_has_permission('stage.progress')`; (б) смена `result_kind` вне метки — только `order.manage`.
- `erp_stage_completion_block(uuid, int, boolean)` — тело из `20260928182342_erp_pravki_27_09_dorabotki.sql:152-255` (подпись из трёх аргументов, одна перегрузка) + ветка: `erp_embroidery_is_phased` → `done` и `skipped` запрещены («Сначала сдайте программу — задача станет «Вышивкой»»), без исключения для `erp.force_complete`.
- `erp_stage_passthrough` / `erp_item_produced_qty` (тела из `20261005074459_erp_stage_fact_flow.sql`): строка фазы программы — `passthrough = false`, в выпуск не идёт; старые отдельные строки программы — как раньше.
- Все функции: `revoke execute … from public, anon`; `grant execute … to authenticated` — только `program_finish`, `program_skip`, `is_phased`.

- [ ] **Step 1: Failing tests** `embroideryOneStage.test.ts` (тела — `withoutComments(functionBody(latestDefining(fn), fn))`, гранты — `withoutComments(latestDefining(fn))`):
  `it('program_finish: definer, файл в storage.objects и заказе, право stage.progress и цех, метка on/off')`;
  `it('фаза только у одиночной строки: is_phased ищет соседа embroidery с result_kind is null')`;
  `it('route gate ждёт существующие depends_on')` (`/in \(\s*'done',\s*'skipped'\s*\)/`);
  `it('completion_block: одна перегрузка (uuid,int,boolean) и все ветки прежней редакции + ветка фазы')` (набор `raise`/`return` новой ⊇ прежней);
  `it('guard: смена result_kind вне метки требует order.manage')`;
  `it('passthrough и produced_qty: фаза программы непрозрачна')`.
- [ ] **Step 2:** `npx vitest run src/erp/utils/embroideryOneStage.test.ts` — FAIL.
- [ ] **Step 3:** миграция.
- [ ] **Step 4:** проба (роли через `request.jwt.claims`): одиночная фаза `in_progress` при крое `waiting` — OK; finish без файла / с «пустышкой» без объекта в бакете → `23514`; worker чужого цеха → `42501`; прямой `PATCH result_kind=null` от worker → `42501`; finish → тот же `id`, `result_kind null`, `waiting`, вложение на месте; повтор → `22023`; `in_progress` вышивки при крое `waiting` → `23514`, после `cutting done` → OK; `done`/`skipped` в фазе → `23514`; `erp.force_complete` в фазе → `23514`; **старый заказ с двумя строками:** программа → `done` OK, `program_finish` → `22023`, прежний `erp_stage_program_block` держит вышивку; вышивка последним этапом в фазе программы — `erp_item_produced_qty = 0`. `PROBE_RESULT total=N fails=0`.
- [ ] **Step 5:** `npx vitest run src/erp/utils/embroideryOneStage.test.ts src/erp/utils/stageDoneGate.test.ts src/erp/utils/stageResultKind.test.ts src/erp/utils/stageRemaining.test.ts src/erp/store/stageCompletionGate.test.ts` — PASS. Мутация: убрать ветку `is_phased` из completion block → тест красный → вернуть.
- [ ] **Step 6:** `npm run erp:freeze`; commit `feat(erp-db): вышивка одной задачей — переход фазы и страж запуска`.

---

### Task 2: Вышивка — маршрут, готовность, кнопка

**Files:**
- Create: `pinhead-react/src/erp/utils/embroideryPhase.ts` — `isProgramPhase`, подписи фаз (вынос из `routes.ts`/`stageResult.ts` — ратчет)
- Create: `pinhead-react/src/erp/screens/queue/ProgramFinishAction.jsx` — кнопка, подтверждение, фокус (вынос из `StageActionsPanel.jsx`)
- Create: `pinhead-react/src/erp/store/slices/embroideryActions.ts` — действия стора (вынос из `stagesSlice.ts`)
- Modify: `pinhead-react/src/erp/utils/routes.ts:263-319,561-618` (без роста: удалить push программы и `standalone` у этой ветки, готовность — через `embroideryPhase`)
- Modify: `pinhead-react/src/erp/utils/routeDraft.ts:72,495` (убрать `standalone`), `routes.ts:56` (поле `standalone`)
- Modify: `pinhead-react/src/erp/utils/stageInput.ts:138`, `utils/progress.ts:82` (фаза программы непрозрачна — зеркало Р3)
- Modify: `pinhead-react/src/erp/store/slices/stageGates.ts:69-107` (фаза → блок `done`; вызов `embroideryProgramBlock(` для старых заказов сохранить — `stageDoneGate.test.ts:74`)
- Modify: `pinhead-react/src/erp/components/Button.jsx` — проп `ariaDisabledReason`
- Modify: `screens/queue/StageActionsPanel.jsx`, `screens/queue/useStageActions.js:137`, `screens/ProductionTask.jsx:188-190` — подключение
- Test: `utils/embroideryPhase.test.ts`, `utils/routes.test.ts:786`, `routeDraft.test.ts`, `routeWalk.test.ts:73`, `stageResultKind.test.ts:35`, `stageResult.test.ts`, `outsourcing.test.ts:204`, `stageInput.test.ts`, `progress.test.ts`, `gantt.test.ts`, `deptLoad.test.ts`, `queueEntries.test.js`, `screens/queue/StageActionsPanel.test.jsx`, `screens/ProductionTask.test.jsx`, `components/Button.test.jsx`, `store/stageCompletionGate.test.ts`

**Interfaces:**
- Consumes: RPC `erp_embroidery_program_finish`, `erp_embroidery_program_skip` (Task 1).
- Produces: `isProgramPhase(stage: Pick<ErpItemStage,'id'|'item_id'|'department_id'|'result_kind'>, siblings: readonly Pick<ErpItemStage,'id'|'department_id'|'result_kind'>[]): boolean`; стор `finishEmbroideryProgram(stageId: string): Promise<ErpItemStage | null>`, `skipEmbroideryProgram(stageId: string, reason: string): Promise<ErpItemStage | null>` (toast.error + `null`; после ответа `loadOne(orderId)`); `Button` `ariaDisabledReason?: string` → `aria-disabled="true"`, `onClick` заглушён, причина видимым текстом через `aria-describedby`; во время `loading` — обычный `disabled` без причины.

- [ ] **Step 1: Failing tests:**
  `routes.test.ts`: `it('вышивка на крое — одна строка embroidery: operation «Разработка программы вышивки», resultKind embroidery_program, dependsOnCodes [cutting], cycle 0')`; то же «на готовом» — зависит от последнего этапа.
  `embroideryPhase.test.ts`: `it('одиночная строка — фаза')`, `it('старая пара строк — не фаза')`.
  `routes.test.ts`: `it('isStageReady: фаза программы готова при несданном крое и держащих материалах')`, `it('фаза вышивки ждёт крой')`.
  `stageInput.test.ts`/`progress.test.ts`: `it('вышивка последним этапом в фазе программы — выпуск 0')`.
  `gantt.test.ts`/`deptLoad.test.ts`: `it('строка вышивки одна, плановые даты — вышивки')`.
  `StageActionsPanel.test.jsx`: `it('фаза программы: «Программа готова» → подтверждение «Программа готова?» с текстом «Этап станет «Вышивка». Файлы программы закроются для правки.» → finishEmbroideryProgram, не setStageStatus(done)')`; `it('без файла — aria-disabled и описание «Приложите файл программы»')`; `it('после перехода фокус на заголовке этапа, status «Программа готова — этап «Вышивка»», при несданном крое — «Вышивка ждёт сдачи кроя»')`; `it('в фазе вышивки файлы программы только для чтения')`; `it('старая строка программы — прежняя «Сдать результат»')`.
  `ProductionTask.test.jsx`: `it('фаза вышивки — заголовок «Вышивка»')`.
  `queueEntries.test.js`: `it('после перехода фазы при сданном крое — группа ready')`.
  `Button.test.jsx`: `toHaveAttribute('aria-disabled','true')`, `toHaveAccessibleDescription(/Приложите файл программы/)`, клик не зовёт обработчик.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** реализовать (подпись этапа в фазе вышивки — «Вышивка»; «Без программы» — в меню действий только при `order.manage`, с причиной).
- [ ] **Step 4:** `npx vitest run src/erp/utils src/erp/screens/queue src/erp/screens/ProductionTask.test.jsx src/erp/components/Button.test.jsx src/erp/store src/fileSizeRatchet.test.ts` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): одна задача вышивки — программа становится вышивкой`.

---

### Task 3: Закрой — модель формы (чистые функции)

**Files:**
- Create: `pinhead-react/src/erp/utils/cutUsage.ts`
- Create: `pinhead-react/src/erp/utils/cutUsage.examples.ts` — общие примеры (вход → итоги), их же читает проба Task 5 (зеркало SQL)
- Modify: `pinhead-react/src/erp/utils/cutRolls.ts:125-146` (`rollsForItem`: свои рулоны `used` + `leftover_kind 'usable'` + остаток > 0 — в списке; без роста файла)
- Modify: `pinhead-react/src/erp/utils/reportTotals.ts:35-61` (годные — из таблицы выпуска)
- Test: `utils/cutUsage.test.ts`, `utils/cutRolls.test.ts`, `utils/foreignRolls.test.ts`, `utils/reportTotals.test.ts`, `utils/cutExtras.test.ts`

**Interfaces — Produces (`cutUsage.ts`):**
- `type RollUse = 'unused' | 'full' | 'partial'`; `type LeftoverFate = 'usable' | 'scrap'`
- `interface RollUsageRow { rollId: string; materialId: string; use: RollUse; leftoverM: number | null; fate: LeftoverFate | null }`
- `rollUsedM(availableM: number, row: RollUsageRow): number` — unused 0, full = доступно, partial = доступно − остаток.
- `rollUsageErrors(availableM: number, row: RollUsageRow): string[]` — тексты: «Введите остаток, м»; «Остаток больше доступного (50 м) — уточните метраж рулона»; «Остаток равен доступному — выберите «Не использован»»; «Выберите: остаток пригоден или малый остаток».
- `markAllFull(rows: RollUsageRow[], ids: readonly string[]): RollUsageRow[]` — иммутабельно.
- `interface MaterialUsageTotal { materialId: string; cutM: number; scrapM: number; totalM: number; usableLeftM: number; cutCost: number; scrapCost: number; avgPerGood: number | null; avgScope: 'color' | 'item' }`
- `usageTotals(options: RollOption[], rows: RollUsageRow[], goodByColor: Map<string, number>, goodTotal: number): MaterialUsageTotal[]` — по материалу; знаменатель по Р6; `null` при 0 годных.
- `usagePayload(options: RollOption[], rows: RollUsageRow[]): CutRollPayload[]` — только `use !== 'unused'`; full → `{ roll_id, material_id, length_used_m, finished: true }`; partial → `{ roll_id, material_id, length_used_m, finished: true, leftover: fate, leftover_measured_m: null }` (остаток задан вводом; отдельный замер не шлём).
- `normColor(s: string): string` — нижний регистр, без пробелов, «ё» → «е».

- [ ] **Step 1: Failing tests** (`cutUsage.test.ts`, примеры из `cutUsage.examples.ts`):
  `it('3×50 м: полностью / остаток 12 пригоден / не использован → 88, остатки 62, 0,88 на 100 годных')`;
  `it('то же со списанием 12 м → cutM 88, scrapM 12, totalM 100, usableLeftM 50, средний 1')`;
  `it('по умолчанию все unused — payload пуст')`; `it('payload несёт material_id')`;
  `it('markAllFull не мутирует вход и меняет только выбранные')`;
  `it('остаток больше доступного — ошибка с доступным и уточнением метража')`; `it('остаток = доступному — ошибка')`;
  `it('good = 0 → avgPerGood null, расход сохранён')`;
  `it('полотно + рибана — два итога, годные не удваиваются')`;
  `it('цвет материала «Чёрный», строки «черный» → avgScope color')`, `it('нет совпадения цвета → avgScope item')`.
  `cutRolls.test.ts`: `it('свой рулон с пригодным остатком прошлой сдачи — в списке, доступно = length_left_m')`.
  `reportTotals.test.ts`: `it('режим рулонов: good — сумма таблицы выпуска')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать.
- [ ] **Step 4:** `npx vitest run src/erp/utils/cutUsage.test.ts src/erp/utils/cutRolls.test.ts src/erp/utils/foreignRolls.test.ts src/erp/utils/reportTotals.test.ts src/erp/utils/cutExtras.test.ts src/fileSizeRatchet.test.ts` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): модель расхода ткани по рулонам — три режима и средний расход`.

---

### Task 4: Закрой — форма «Результат кроя» + «Расход ткани»

**Files:**
- Create: `pinhead-react/src/erp/screens/queue/useCutReport.js` — состояние таблицы, строк рулонов, выбора, валидация, payload
- Create: `pinhead-react/src/erp/screens/queue/CutResultTable.jsx` (+ `.module.css`)
- Create: `pinhead-react/src/erp/screens/queue/CutUsageSection.jsx` (+ `.module.css`)
- Create: `pinhead-react/src/erp/screens/queue/CutTotalsBar.jsx` (+ `.module.css`)
- Modify: `pinhead-react/src/erp/components/StageReportForm.jsx:174-348` — в режиме `byRolls` монтировать три блока; строк не прибавлять
- Delete: `screens/queue/CutRollsSection.jsx`, `CutSizeRows.jsx` (+ тесты); из `utils/cutRolls.ts` — `cutBlock`, `cutRollsPayload`, `cutSizesPayload`, `rollTotal`, `CutRollEntry` (больше никто не зовёт; сверить `grep`). `RollFinishModal`/«рулоны в работе» остаются для старых сдач.
- Modify: `pinhead-react/e2e/erp-axe.spec.ts` (очередь закроя с открытой формой, 375 px), `e2e/erp-tablet.spec.ts`
- Test: `screens/queue/CutUsageSection.test.jsx`, `CutResultTable.test.jsx`, `CutTotalsBar.test.jsx`, `components/StageReportForm.test.jsx`

**Interfaces:**
- Consumes: Task 3.
- Produces: `useCutReport({ stage, order, options }) → { sizesRows, setCell, addSize, usageRows, setUse, setLeftover, setFate, selected, toggleSelect, selectGroup, markSelectedFull, errors, firstErrorRef, payload: { sizes, rolls }, totals }`.

**Устройство экрана (решения проверки дизайна):**
- Порядок: «Результат кроя» (сетка позиции один раз; «Размер вне заказа…»; «записано N»; брак и комментарий — общие поля формы) → «Расход ткани» → липкая нижняя полоса.
- Группа «<материал> · <цвет>»: флажок «Выбрать все в группе» (промежуточное состояние), «Выбрано: N», кнопка «Использованы полностью» (без выбора — `aria-disabled`, причина «Отметьте рулоны флажками»).
- Строка рулона: флажок, «№ <seq> · Доступно 50 м» (+ «расчётный метраж», если `length_source='calc'`; + «остаток заказа PH-…» для чужого), три режима — нативные `<input type="radio" name="use-<rollId>">` в плитках ≥ 44 px, группа `aria-label="Рулон №12 — использование"`; при «Частично» — поле «Остаток, м» и группа «Рулон №12 — остаток»: «Остаток пригоден» / «Малый остаток, не учитывать» (подсказка «спишется в отходы»); справа — «Расход, м». «Уточнить метраж рулона» — у строки.
- Итоги группы: расход на крой, списание, всего, пригодный остаток, стоимость, «Средний 0,88 м/шт» (или «по всей позиции»); пока годных 0 — «Средний — введите годные в «Результат кроя»».
- Липкая полоса: «Расход 88 м · Остаток 62 м · Средний 0,88 м/шт» по материалам + «Сдать результат»; один `role="status"`, обновление по `blur` и смене режима.
- Массовое действие: если среди выбранных есть «Частично» с остатком — «У 1 рулона введён остаток. Отметить полностью?» / «Отметить полностью» / «Не менять»; после действия выбор снимается, фокус остаётся на кнопке, status «2 рулона: полностью. Расход 100 м».
- Ошибки: поле — `aria-invalid` + `aria-describedby`; при «Сдать результат» — сводка `role="alert"` «Проверьте 2 рулона» и фокус на первое ошибочное поле.
- Р7: «Сдать без списания ткани?» / «Ни один рулон не отмечен как использованный — метры не спишутся со склада.» / «Сдать без списания» / «Отметить рулоны» (фокус на первую группу).
- ≤ 760 px — строки карточками; токены, CSS-модули.

- [ ] **Step 1: Failing tests:**
  `CutUsageSection.test.jsx`: `it('по умолчанию «Не использован»')`; `it('стрелка вправо в radiogroup «Рулон №12 — использование» → «Полностью»')`; `it('выбор двух + «Использованы полностью» → расход = доступному, без выбора пригодности, status объявляет итог, фокус на кнопке')`; `it('выбор строк сам не меняет итоги')`; `it('частичный остаток не затирается без подтверждения')`; `it('частично 12 из 50 → расход 38 и обязательная пригодность')`; `it('остаток больше доступного → ошибка и «Уточнить метраж рулона»')`; `it('группы по материалу и цвету, чужой остаток с заказом-источником')`.
  `CutResultTable.test.jsx`: `it('сетка позиции один раз при двух материалах')`; `it('размер вне заказа')`.
  `CutTotalsBar.test.jsx`: `it('средний по материалу, один status')`.
  `StageReportForm.test.jsx`: `it('один вызов: sizes из таблицы, rolls только отмеченные, брак и комментарий один раз')`; `it('двойной клик — один submitStageReport')`; `it('повтор после сетевой ошибки — тот же client_key, значения формы сохранены')`; `it('выпуск без рулонов — подтверждение «Сдать без списания ткани?», отказ не отправляет')`; `it('сдача с ошибкой — alert и фокус на первом ошибочном поле')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать.
- [ ] **Step 4:** `npx vitest run src/erp/screens/queue src/erp/components/StageReportForm.test.jsx src/erp/utils src/fileSizeRatchet.test.ts` — PASS; `npx playwright test e2e/erp-axe.spec.ts e2e/erp-tablet.spec.ts` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): форма закроя — результат один раз, расход по рулонам`.

---

### Task 5: Закрой — сервер и страж рулонов (миграция C1)

**Files:**
- Create: `supabase/migrations/20261019110000_erp_cut_result_once.sql`
- Create: `supabase/rollout/r1910a/20261019110000_erp_cut_result_once_rollback.sql` (только `erp_stage_submit_report` прежним телом; читатели остаются новыми)
- Create: `supabase/probes/erp_cut_result_once.sql`
- Test: `pinhead-react/src/erp/utils/cutResultOnce.test.ts` (node)

**Interfaces — Produces:**
- `erp_stage_submit_report(...)` (подпись прежняя; тело из `20261008003410_erp_cut_batch_without_fate.sql`, все прежние фрагменты, на которые смотрят `stageDoneGate.test.ts:95-98`, `stageRemaining.test.ts:174`, `rollFate.test.ts`, — дословно):
  - новая ветка: в `p_rolls` нет размеров, `p_sizes` не пуст → `v_good` из `p_sizes`; строки размеров с `report_roll_id = null` пишутся ДО расчёта плюсов; плюсы считаются для любой размерной сдачи закроя (и без рулонов — Р7);
  - проверки строк `p_sizes` — те же, что в ветке размеров: `>= 0`, сетка, остаток;
  - каждый рулон — `select … for update`; повтор `roll_id` в `p_rolls` → `22023`; `material_id` берётся из рулона, а не из клиента; рулон в кг — `qty_used > 0`;
  - старый формат (размеры на рулоне) — без изменений; повтор `p_client_key` — прежний ответ.
- `erp_fabric_usage`, `erp_item_economics`, `erp_analytics_fabric_by_sku` (тела из `20260928182342…:1337,1420,1549`): `drop` + пересоздание в зависимом порядке, `revoke`/`grant` заново; знаменатель — старый отчёт `roll_good`, новый — годные отчёта по цвету материала (Р6); метры + `scrap_writeoff` отчёта; по материалу; итог заказа — Σ/Σ.
- `public.erp_material_roll_guard()` + триггер BEFORE UPDATE на `erp_material_rolls`: `length_m`, `length_left_m`, `qty`, `qty_left`, `status`, `leftover_kind`, `price_per_m`, `price_per_unit`, `kg_per_m` меняются только под `erp.roll_adjust`, внутри `erp_stage_submit_report` (метка `erp.cut_submit = 'on'`), или с `warehouse.manage`; service role — пропуск; страж перечисляет исключения снимком (`snapshotExclusions`).

- [ ] **Step 1: Failing test** `cutResultOnce.test.ts`: `it('годные из p_sizes при рулонах без размеров, report_roll_id null, плюсы после вставки')`; `it('рулон блокируется for update, дубль roll_id отклоняется, material_id из рулона')`; `it('фрагменты, на которые смотрят прежние сторожа, на месте')`; `it('страж рулонов: исключения снимком, метки roll_adjust и cut_submit, warehouse.manage')`; `it('rollback-файл совпадает с прежней редакцией submit_report')`.
- [ ] **Step 2:** FAIL. **Step 3:** миграция.
- [ ] **Step 4:** проба (из `cutUsage.examples.ts`): пример документа → `qty_good 100`, 3 строки размеров `report_roll_id null`, `report_rolls` 50 и 38, рулон 2 `length_left_m 12 usable`, рулон 3 нетронут, `erp_item_economics` 0,88; со списанием → `scrap_writeoff 12`, 1,00; два отчёта 50 м/100 и 30 м/20 → 0,667; полотно + рибана → `qty_good 100`; старый формат сдачи проходит; смешанный заказ (старый + новый отчёт); двухцветная позиция; повтор `client_key` → отчётов 1; две сессии на один рулон по 50 → вторая `22023`; дубль рулона, `qty_good < 0`, чужой рулон без пригодного остатка → отказ; сдача без рулонов сверх плана → плюсы посчитаны; worker прямым `PATCH length_left_m=999` → `42501`; уточнение метража не меняет `length_used_m` прошлых отчётов и пишет `length_refine`. `PROBE_RESULT total=N fails=0`.
- [ ] **Step 5:** `npx vitest run src/erp/utils/cutResultOnce.test.ts src/erp/utils/itemEconomics.test.ts src/erp/utils/rpcContract.test.ts src/erp/utils/stageDoneGate.test.ts src/erp/utils/stageRemaining.test.ts src/erp/utils/rollFate.test.ts src/erp/utils/reportTotals.test.ts src/erp/store/stageCompletionGate.test.ts` — PASS. Мутация: убрать `for update` → проба гонки красная → вернуть.
- [ ] **Step 6:** `npm run erp:freeze`; commit `feat(erp-db): сдача закроя — выпуск один раз, средний по материалу, страж рулонов`.

---

### Task 6: 30 МБ + техпаспорт (миграция S1, «мягче — до фронта»)

**Files:**
- Create: `supabase/migrations/20261019090000_erp_attach_30mb_passport_optional.sql` — `update storage.buckets set file_size_limit = 31457280 where id = 'erp-attachments';` + `create or replace function public.erp_dev_package_guard()` (тело `20260913002246_erp_dev_package_guard_back.sql:35-110` без блока `dev_passport` :62-66) + `revoke … from public, anon, authenticated`
- Create: `supabase/probes/erp_attach_30mb_passport.sql`
- Modify: `pinhead-react/src/erp/types.ts:885-896`, `hooks/useAttachmentUploads.js:31-41`, комментарии `store/slices/tzSlice.ts:34`, `components/AttachmentPicker.jsx:41`
- Modify: `pinhead-react/src/orderstudio/api/erpFiles.ts:15,28,72`, `orderstudio/tz/model/sendChecklist.ts:32,78-79`, `orderstudio/bridge/launchFiles.ts:57`, `e2e/support/mock/storageBuckets.ts:22` → 30 МБ (Р9)
- Modify: `pinhead-react/src/erp/utils/finalPackage.ts:124` (удалить паспорт), комментарии :26-28, :103-119
- Modify: `pinhead-react/src/erp/screens/experimental/DevFinalPackage.jsx:250-259` — «Технический паспорт · необязательно» (входит в доступное имя блока), без чипа «не приложен»; шапка :14-35
- Modify: `pinhead-react/e2e/erp-experimental.spec.ts:1189` (`'Технический паспорт'` → `'Фото образца'`), комментарий :29-37
- Test: `utils/attachmentLimits.test.ts`, `utils/finalPackage.test.ts`, `screens/experimental/DevFinalPackage.test.jsx`, `orderstudio/api/erpFiles.test.ts`, `bridge/launchFiles.test.ts`, `tz/model/sendChecklist.test.ts`, `tz/ui/tzUiText.test.ts`, `api/v4Mock.test.ts`

- [ ] **Step 1: Failing tests:** `finalPackage.test.ts`: `it('без техпаспорта при остальных полях перечень пуст')`; `it('без фото — «Фото образца»')`; `it('страж: последняя редакция требует фото и лекала и не требует dev_passport')` (положительный якорь); прогресс `3/3`, `10/10`. `DevFinalPackage.test.jsx`: `it('без паспорта «Завершить разработку» активна')`, `'3 / 3'`, `it('доступное имя «Технический паспорт, необязательно»')`. `attachmentLimits.test.ts`: `it('писатели Order не мягче бакета')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать (миграция → константы ERP → Order).
- [ ] **Step 4:** проба: `file_size_limit = 31457280`; завершение без паспорта → OK; без фото → `23514`. `npx vitest run src/erp/utils/attachmentLimits.test.ts src/erp/utils/finalPackage.test.ts src/erp/screens/experimental src/erp/store/useErpStore.test.ts src/orderstudio` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): вложения до 30 МБ, техпаспорт необязателен`.

---

### Task 7: ТЗ пачкой — создание заказа и карточка

**Files:**
- Create: `pinhead-react/src/erp/utils/fileLimitText.ts` — `fileLimitCaption(maxBytes: number): string`, `tooBigText(maxBytes: number): string` → «не загрузилось: файл больше 30 МБ — уменьшите или разбейте PDF»
- Create: `pinhead-react/src/erp/screens/orders/create/EditableFiles.jsx` (вынос из `EditOrderFiles.jsx`, чтобы карточка не тянула форму)
- Modify: `screens/orders/create/FormParts.jsx:34-53` (`PdfPick`: `multiple`, `onPick(files: File[])`), `create/useTzDocs.js:80-101` (`addTzDocs(files: File[], itemIndex: number | null)`; большой файл → строка `state: 'error'`, без «Загрузить заново»; остальные — параллельно), `create/TzSection.jsx:76-101` (пачка, «До 30 МБ на один файл»), `orderCard/TzDocsSection.jsx:38-108` (через `EditableFiles`, «Заменить файл» одиночная, подпись)
- Строки файлов: без `role` у чипов, один сводный `role="status"` «Загружено 3 из 5 · не загрузилось 1»; `aria-label` «Загрузить заново: tz-1.pdf», «Убрать: tz-1.pdf»; после удаления — фокус на соседнюю строку или кнопку выбора.
- Test: `screens/orders/CreateOrderModal.test.jsx:127`, `screens/orderCard/TzDocsSection.test.jsx` (новый), `utils/fileLimitText.test.ts`

- [ ] **Step 1: Failing tests:** `CreateOrderModal.test.jsx`: `it('три файла одним выбором — три строки')`; `it('31 МБ в пачке — «не загрузилось: файл больше 30 МБ…», остальные загружены')`; `it('сбой одного не убирает загруженные; «Загрузить заново: <имя>» только у упавшего')`; `it('новая пачка добавляется к загруженным')`; `it('один сводный status пачки')`; хелпер `pickItemPdf` → `files: [a, b]`. `TzDocsSection.test.jsx`: `it('пачка в карточке — строка на файл, соседи не блокируются')`; `it('замена одиночная')`. `fileLimitText.test.ts`: `fileLimitCaption(31457280) === 'До 30 МБ на один файл'`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать (сторож `attachmentLimits.test.ts:80-106`: текст «больше» — из `TZ_MAX_BYTES`).
- [ ] **Step 4:** `npx vitest run src/erp/screens/orders src/erp/screens/orderCard src/erp/utils/attachmentLimits.test.ts src/erp/utils/fileLimitText.test.ts src/fileSizeRatchet.test.ts` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): ТЗ загружается пачкой, до 30 МБ на файл`.

---

### Task 8: Закупка без «Принять поставку»

**Files:**
- Modify: `screens/purchasing/PurchaseMaterialsTable.jsx:9,86,20-22`, `PurchaseRowCard.jsx:9,69,21-26`
- Modify: `screens/Warehouse.jsx:13,155` — убрать `purchasingReturnHref` и ветку `fromPurchasing`
- Delete: `screens/purchasing/ReceiptButton.jsx`; из `utils/receiptLink.ts` — `materialReceiptTask`, `receiptAction`, `receiptHref`, `RECEIPT_TASK_MISSING_HINT`, `purchasingReturnHref` (`qtyLeftToAccept` остаётся); `.receiptAction` в `screens.module.css:743`
- Test: `PurchaseRowCard.test.jsx:278-310`, `utils/receiptLink.test.ts`, `screens/Warehouse.test.jsx:334-340`

- [ ] **Step 1: Failing test:** `it('в строке материала нет «Принять поставку» и «Открыть приёмку», принятое количество видно')` (карточка и таблица).
- [ ] **Step 2:** FAIL. **Step 3:** удалить кнопку и мёртвый код (`grep -rn "receiptHref\|fromPurchasing\|purchasingReturnHref" src` → пусто).
- [ ] **Step 4:** `npx vitest run src/erp/screens/purchasing src/erp/utils/receiptLink.test.ts src/erp/screens/Warehouse.test.jsx src/erp/screens/warehouse` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): приёмка только на складе — кнопка убрана из закупки`.

---

### Task 9: Проверка ветки, документы, выкатка

**Files:**
- Create: `supabase/rollout/r1910a/README.md`, `supabase/rollout/r1910a/20261019100000_erp_embroidery_one_stage_rollback.sql`
- Modify: `CLAUDE.md`, `pinhead-react/CLAUDE.md`, `docs/rules/pravila-pravok-19-10.md` (новый) + `docs/rules/INDEX.md`, `docs/rules/react/pravila-sessii-61-hvosty-14-09-gde-chto-lezhit.md:4-6`, `docs/DESIGN.md` (форма закроя, `ariaDisabledReason`), `docs/changelog/2026-10.md`, `SESSION-STATE.md`
- Test: `pinhead-react/src/erp/utils/rollout1910a.test.ts` — тело каждой функции в `…_rollback.sql` = `functionBody` предыдущей редакции

**README выкатки — содержание:**
1. Предусловия (Task 0, Step 1) + SELECT перед E1: «вышивка в работе при несданном крое» (должно быть 0 или разобрано).
2. Порядок: S1 → E1 → C1 (сухой прогон каждой с пробой, потом применение; `notify pgrst, 'reload schema'`), запись в `APPLIED.json`, `npm run migrations:verify`; затем фронт.
3. Откат: по умолчанию — только фронт (сервер совместим); серверный откат E1 — после SELECT списка одиночных строк вышивки для ручного разбора; C1 — `_rollback.sql` (только `submit_report`).
4. Триггеры отката:

   | Условие | Действие |
   |---|---|
   | `PROBE_RESULT fails>0` после применения | откат миграции |
   | `check_violation` на `done` строки программы двухстрочного заказа | срочная правка E1 |
   | `erp_item_economics` = `null` по новым отчётам кроя | откат фронта, разбор C1 |
   | новые «Ошибки интерфейса» ERP за 2 ч | откат фронта |
   | загрузки 20–30 МБ отвечают 413 | глобальный лимит Storage |

5. SQL «наследия»: число открытых заказов с двумя строками вышивки — когда 0, удалить `erp_stage_program_block`/`embroideryProgramBlock` отдельной правкой.

- [ ] **Step 1:** `cd pinhead-react && npm run lint && npm run typecheck && npx vitest run --maxWorkers=3` — зелёное.
- [ ] **Step 2:** `npm run build && npm run bundle:budget` — PASS; оболочка ERP не меняется (`routes.ts`, `stageResult.ts`, `Button.jsx` — проверить, что не в чанке оболочки; если `Button` в оболочке — рост учесть до коммита).
- [ ] **Step 3:** `npx playwright test e2e/erp-queue.spec.ts e2e/erp-experimental.spec.ts e2e/erp-tablet.spec.ts e2e/erp-supply.spec.ts e2e/erp-a11y.spec.ts e2e/erp-axe.spec.ts e2e/erp-mobile.spec.ts e2e/visual.spec.ts` — PASS; пересняты только `erp-queue-*`, `erp-order-card-*`, `erp-purchasing-*`, где реально менялся экран.
- [ ] **Step 4:** обход `pinhead-qa`: закройщик (пример документа на моке, два материала, повторная сдача из остатка), вышивальщик (программа до кроя → вышивка после кроя; старый заказ с двумя строками), технолог (завершение без паспорта), менеджер (ТЗ пачкой 3 файла + 1 на 31 МБ).
- [ ] **Step 5:** документы; commit `docs: правки 19.10 — часть A`; `git push -u origin claude/gifted-fermi-rnrf9q`.

---

## Проверка скиллами (до одобрения)

Пять проверяющих: архитектура + техдолг, стратегия тестов, атакующий (права, RLS, Storage, RPC), выкатка, экраны (design-critique, accessibility-review, ux-copy). Все Critical и High внесены в задачи выше:

| Находка | Уровень | Куда внесено |
|---|---|---|
| Старые заказы с двумя строками вышивки ломаются (фаза по одному `result_kind`) | Critical ×3 | Р1, Task 1 `erp_embroidery_is_phased`, Task 2 `isProgramPhase(stage, siblings)`, пробы |
| Не та редакция `erp_stage_completion_block` (откат правок 27.09, вторая перегрузка) | Critical/High | Task 1 — источник `20260928182342`, тест «одна перегрузка, ветки ⊇» |
| Прямой `PATCH result_kind` обходит файл программы; метка шире нужного | High | Task 1 — guard: `order.manage` вне метки, узкая ветка метки `'on'/'off'` |
| Фаза программы пропускает количество → склад примет до вышивки | High | Р3, Task 1 passthrough/produced, Task 2 зеркала |
| skip/force_complete фазы закрывает всю вышивку; план/гант | High | Р3, Р4, `program_skip`, тесты gantt/deptLoad |
| `material_id` в payload, остаток = доступному, пустые `leftover_measure` | High | Task 3 |
| Плюсы теряются в новой ветке | High | Task 5 |
| Нет стража `erp_material_rolls`; гонка двух сдач на один рулон | High | Р11, Task 5 страж + `for update` + проба гонки |
| Ратчет размера: файлы на потолке | High | Global Constraints, вынос в новые модули (Task 2, 4, 7) |
| Невключённые в прогон тесты (`stageResultKind`, `routeWalk`, `outsourcing`, `foreignRolls`, Order) | High | Step 4 задач 2, 3, 5, 6 |
| «Программа готова» — необратимо без подтверждения, фокус теряется | Critical (UX) | Task 2 |
| Плотность формы, массовый выбор, radiogroup (100 остановок Tab), ошибки, live-регион | High (UX) | Task 4 «Устройство экрана» |
| `aria-disabled` в ERP нечем поддержать | High (UX) | Task 2 — `Button.ariaDisabledReason` |
| Пересечение с K/M вехи 8, лимит ≤ 5 неприменённых, глобальный лимит Storage | High/Medium | Task 0 Step 1, README выкатки |
| Мок бакета e2e и тексты Order «больше 20 МБ» | Medium | Р9, Task 6 |
| Мёртвый код: `cutBlock`…, `standalone`, `purchasingReturnHref` | Medium | Task 2, 4, 8 |
| Откаты без проверки | Medium | Task 9 `rollout1910a.test.ts` |
| Вставка `erp_order_attachments` открыта всем (пустышка вместо файла) | Medium | Р11 частично (`storage.objects`); общий страж — отдельной задачей |
