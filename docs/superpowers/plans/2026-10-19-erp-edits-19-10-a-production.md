# Правки 19.10, часть A — производство (п. 1–6) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** одна задача вышивки «программа → вышивка», новая форма сдачи закроя (выпуск один раз, расход по рулонам тремя режимами), 30 МБ и загрузка ТЗ пачкой, техпаспорт необязателен, без «Принять поставку» в закупке.

**Architecture:** все шесть правок — в замороженном ERP (`src/erp/**` + функции/триггеры `erp_*`). Серверные изменения идут новыми миграциями (старые не правим), клиентский гейт и страж — одним коммитом; в конце каждой задачи — `npm run erp:freeze` и коммит манифеста. Миграции «мягче» (лимит, паспорт) — на бой ДО фронта; миграции вышивки и закроя — тоже до фронта: новые RPC и ветки совместимы со старым клиентом.

**Tech Stack:** React 19 + Zustand 5, Supabase (plpgsql, RLS, триггеры-стражи), Vitest + Testing Library, Playwright.

**Spec:** Google-документ «правки» от владельца (19.10), `https://docs.google.com/document/d/1raf4nOyC1YiXvuBpjGYMEYm3KnKiF3cMj-6bRhWCKkM`; снимок текста — `docs/erp/2026-10-19-pravki-19-10.md` (Task 0).

## Global Constraints

- **ERP заморожен:** правка `src/erp/**` и DDL по `erp_*` — только после «да» владельца на этот план; после правок задачи — `cd pinhead-react && npm run erp:freeze`, `erpFrozen.json` в том же коммите.
- Применённые миграции не редактируются; новая миграция — `supabase/migrations/20261019HHMMSS_<слаг>.sql`; после выкладки — запись в `APPLIED.json` (сторож `migrationJournal.test.ts`: неприменённых ≤ 5 — сейчас K и M, этот план добавляет ровно 3).
- Лимит файла: **30 МБ = `31457280` байт** литералом в миграции; `TZ_MAX_BYTES === ATTACH_MAX_BYTES === бакет` (сторож `attachmentLimits.test.ts`).
- Подпись рядом с загрузкой ТЗ — ровно «До 30 МБ на один файл» (мегабайты из константы).
- Тексты интерфейса — по документу: «Разработка программы вышивки», «Вышивка», «Результат кроя», «Расход ткани», «Не использован», «Полностью», «Частично», «Использованы полностью», «Остаток пригоден», «Малый остаток, не учитывать», «Уточнить метраж рулона», «Сдать результат», «Завершить разработку», «Готово к серии», «Технический паспорт» с пометкой «необязательно».
- Страж и клиентский гейт — одним коммитом; RLS — политика на команду, `(select auth.uid())`; `revoke … from public, anon` + `grant … to authenticated`.
- `StageReportForm.jsx` и `CreateOrderModal.jsx` — под ратчетом размера (`fileSizeRatchet.test.ts`): логику класть в новые модули, модалка не растёт ни на строку.
- npm-зависимости не добавлять.

## Review Focus

1. **Повторная сдача закроя с тем же рулоном** (частичный остаток в 1-й сдаче, крой из остатка во 2-й): рулон обязан быть в списке с «доступно» = текущему остатку, а не исходному метражу. Сейчас `rollsForItem` выкидывает свои рулоны со `status='used'` даже с пригодным остатком — тест в Task 4.
2. **Несколько материалов одной позиции** (полотно + рибана + подклад): выпуск не умножается на число материалов, средний расход считается по каждому материалу отдельно — тест в Task 4 (клиент) и Task 5 (SQL-проба).
3. **Двойное нажатие «Сдать результат» / повтор после сетевой ошибки**: один отчёт, одно списание (`client_key`) — тест в Task 5.
4. **Отметка «Готова программа», когда крой уже сдан**: вышивку сразу можно взять в работу, без ручной перезагрузки очереди — тест в Task 2.
5. **Пачка ТЗ, где один файл 31 МБ, а другой падает по сети**: остальные загружаются, упавший — с кнопкой «Загрузить заново», большой — с именем и причиной без повтора — тест в Task 7.

---

## Решения «за владельца» (подтвердить при одобрении)

- **Р1. Вышивка — одна строка этапа, две фазы.** Фаза — колонка `result_kind`: `'embroidery_program'` = «Разработка программы вышивки», `null` = «Вышивка». Переход — только RPC `erp_embroidery_program_finish`. Старые заказы с двумя строками не трогаем (их держит прежний `erp_stage_program_block`).
- **Р2. Фаза программы не ждёт ни маршрута, ни материалов** (`isStageReady` игнорирует `depends_on` и материальный гейт); фаза вышивки ждёт `depends_on` строки — их строит маршрут конкретного заказа (крой или последний этап цепочки). Сервер держит запуск и сдачу вышивки триггером по образцу `erp_warehouse_route_gate`.
- **Р3. Закрой: выпуск — строки `erp_stage_report_sizes` с `report_roll_id = null`**, расход — строки `erp_stage_report_rolls` без размеров. Старые отчёты (размеры на рулоне) не переписываем; средний расход старых отчётов считается по-старому (`roll_good`), новых — по годным отчёта.
- **Р4. Знаменатель среднего расхода по цвету:** годные строки отчёта, у которых `color` совпадает с цветом материала (`fact_color` → `color`, без регистра и пробелов); если совпадений нет (одноцветная позиция, цвет «—») — все годные позиции в этой сдаче.
- **Р5. Сдача с выпуском, но без использованного рулона** — не блок, а подтверждение «Ни один рулон не отмечен — ткань не спишется. Сдать?». Если у позиции нет рулонов совсем (давальческая ткань, приём весом), формы рулонов нет, как сейчас.
- **Р6. Закупка:** убираем `ReceiptButton` целиком — и «Принять поставку», и «Открыть приёмку» (это один вход на склад). Возврат со склада «← К закупке» остаётся.
- **Р7. Лимит 30 МБ получают все вложения ERP** (одна величина бакета — сторож). Писатели Order (`orderstudio/api/erpFiles.ts`, `sendChecklist.ts`, `launchFiles.ts`) остаются на 20 МБ — строже бакета, безопасно.
- **Р8. Квиточки закройщиков** — вопрос к производству, кода нет; ручной ввод среднего расхода не делаем.

---

### Task 0: Снимок спеки и подготовка ветки

**Files:**
- Create: `docs/erp/2026-10-19-pravki-19-10.md` (текст документа дословно, без картинок, с пометкой «источник — Google-документ владельца»)

- [ ] **Step 1:** Сохранить текст документа; `git add` + `git commit -m "docs(erp): снимок правок 19.10"`.
- [ ] **Step 2:** `cd pinhead-react && npm ci && npx vitest run src/orderstudio/erpFrozen.test.ts src/erp/utils/migrationJournal.test.ts` — Expected: PASS (точка отсчёта).

---

### Task 1: Вышивка — сервер (миграция E1)

**Files:**
- Create: `supabase/migrations/20261019100000_erp_embroidery_one_stage.sql`
- Create: `supabase/probes/erp_embroidery_one_stage.sql` (проба `begin; … PROBE_RESULT; rollback`)
- Test: `pinhead-react/src/erp/utils/embroideryOneStage.test.ts` (`// @vitest-environment node`, читает миграцию через `latestDefining`)

**Interfaces:**
- Produces: `public.erp_embroidery_program_finish(p_stage_id uuid) returns erp_item_stages` (security definer, `set search_path = public`):
  проверяет `result_kind = 'embroidery_program'`, `status = 'in_progress'`, есть `erp_order_attachments(kind='stage_result', stage_id)`, `erp_has_permission('stage.progress')` и свой цех (`erp_can_act_in(department_id)` — тем же предикатом, что `erp_stage_guard`); под меткой `set_config('erp.program_finish','1',true)` ставит `result_kind = null, operation = null, status = 'waiting', started_at = null, finished_at = null, assignee = null, qty_done = 0`; пишет `erp_stage_events(from_status 'in_progress', to_status 'waiting', comment 'Программа вышивки готова')`. Повтор на уже переведённой строке → `22023` «Программа уже сдана».
- Produces: триггер `erp_item_stages_embroidery_route_gate` (BEFORE UPDATE на `erp_item_stages`): для цеха `embroidery` при `result_kind is null` запрещает переход в `in_progress`/`done` и рост `qty_done`, пока любой `depends_on` не `done`/`skipped` (`23514`, текст «Вышивку можно начать после этапа «<цех>»»); пропускает service role и метки `erp.force_complete`, `erp.moving`.
- Produces: ветка в `erp_stage_completion_block`: при `result_kind = 'embroidery_program'` переход в `done` запрещён всегда (`'Сначала сдайте программу — задача станет «Вышивкой»'`), кроме меток выше.
- Produces: исключение метки `erp.program_finish` в `erp_stage_guard` для смены `operation`/`result_kind`.

- [ ] **Step 1: Failing test** — `embroideryOneStage.test.ts`:
  `it('функция перехода фазы — security definer с проверкой файла и права')` — тело `latestDefining('erp_embroidery_program_finish')` содержит `security definer`, `kind = 'stage_result'`, `erp_has_permission('stage.progress')`, `erp.program_finish`, `revoke`… `from public, anon`;
  `it('страж запуска вышивки ждёт depends_on')` — тело триггерной функции содержит `'embroidery'`, `result_kind is null`, `depends_on`, `in ('done','skipped')`;
  `it('завершение фазы программы закрыто')` — `latestDefining('erp_stage_completion_block')` содержит `'embroidery_program'`;
  `it('erp_stage_guard пропускает метку перехода фазы')`.
- [ ] **Step 2:** `npx vitest run src/erp/utils/embroideryOneStage.test.ts` — FAIL (миграции нет).
- [ ] **Step 3:** Написать миграцию: функции пересоздаются полным телом из последних определений (`20260928082955_erp_supply_autoclose.sql` — guard, `20260928083215_erp_stage_done_gate.sql` — completion block) плюс новые ветки; `revoke execute … from public, anon; grant execute … to authenticated`.
- [ ] **Step 4:** Проба: заказ с кроем и вышивкой → фаза программы `in_progress` при крое `waiting` — разрешено; finish без файла → `23514`; finish с файлом → строка та же (`id`), `result_kind null`, `status waiting`, вложение на месте; `in_progress` вышивки при крое `waiting` → `23514`; после `cutting done` → разрешено; `done` в фазе программы → `23514`. Итог `PROBE_RESULT total=N`.
- [ ] **Step 5:** `npx vitest run src/erp/utils/embroideryOneStage.test.ts src/erp/utils/stageDoneGate.test.ts src/erp/utils/stageResultKind.test.ts` — PASS (старые сторожа читают `latestDefining` — обновить их ожидания, если упали из-за новой редакции).
- [ ] **Step 6:** `npm run erp:freeze`; commit `feat(erp-db): вышивка одной задачей — переход фазы и страж запуска`.

---

### Task 2: Вышивка — маршрут, готовность, кнопка

**Files:**
- Modify: `pinhead-react/src/erp/utils/routes.ts:263-319` (`buildRoute`), `:561-618` (`isStageReady`, `waitingReason`)
- Modify: `pinhead-react/src/erp/utils/routeDraft.ts:478-514` (убрать ветку `standalone`, если больше никто не ставит)
- Modify: `pinhead-react/src/erp/store/slices/stagesSlice.ts` (действие), `store/types.ts` (сигнатура)
- Modify: `pinhead-react/src/erp/store/slices/stageGates.ts:69-107` (`completionBlockFor`)
- Modify: `pinhead-react/src/erp/screens/queue/StageActionsPanel.jsx:325-384`, `screens/queue/useStageActions.js:137`
- Modify: `pinhead-react/src/erp/screens/ProductionTask.jsx:188-190` (подпись фазы)
- Test: `utils/routes.test.ts` (describe «разработка программы вышивки» :786), `screens/queue/StageActionsPanel.test.jsx`, `utils/queueEntries.test.js`, `store/stageCompletionGate.test.ts`

**Interfaces:**
- Consumes: RPC `erp_embroidery_program_finish(p_stage_id)` (Task 1).
- Produces: `finishEmbroideryProgram(stageId: string): Promise<ErpItemStage | null>` в сторе (toast.error и `null` при ошибке; после ответа — `loadOne(orderId)`).
- Produces: `isProgramPhase(stage: Pick<ErpItemStage,'result_kind'>): boolean` в `utils/stageResult.ts`.

- [ ] **Step 1: Failing tests:**
  `routes.test.ts`: `it('заказ с вышивкой на крое — один этап цеха embroidery с resultKind embroidery_program и dependsOnCodes [cutting]')` — `buildRoute(...)` даёт ровно одну строку `deptCode 'embroidery'`, `operation 'Разработка программы вышивки'`, `resultKind 'embroidery_program'`, `dependsOnCodes ['cutting']`; то же для нанесения на готовом — зависит от последнего этапа.
  `it('isStageReady: фаза программы готова при незавершённом крое и держащих материалах')`, `it('isStageReady: фаза вышивки ждёт крой')`.
  `StageActionsPanel.test.jsx`: `it('в фазе программы кнопка «Программа готова» зовёт finishEmbroideryProgram и не зовёт setStageStatus(done)')`; `it('без файла программы кнопка aria-disabled с причиной «Приложите файл программы»')`; `it('в фазе вышивки файлы программы видны только для чтения')`.
  `queueEntries.test.js`: `it('после перехода фазы при сданном крое строка в группе ready')` (Review Focus 4).
  `stageCompletionGate.test.ts`: `it('прямое done в фазе программы блокируется')`.
- [ ] **Step 2:** запустить — FAIL.
- [ ] **Step 3:** реализовать: в `buildRoute` убрать отдельный push программы, ветке вышивки дать `operation/resultKind` программы (cycle — прежний цикл вышивки); `isStageReady`/`waitingReason` принимают `result_kind` в `Pick` и при `isProgramPhase` пропускают `depends_on` и материалы; панель: при `isProgramPhase` вместо «Сдать результат» — «Программа готова»; подпись этапа в фазе вышивки — «Вышивка».
- [ ] **Step 4:** `npx vitest run src/erp/utils/routes.test.ts src/erp/utils/routeDraft.test.ts src/erp/utils/queueEntries.test.js src/erp/screens/queue src/erp/store/stageCompletionGate.test.ts src/erp/screens/ProductionTask.test.jsx` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): одна задача вышивки — программа становится вышивкой`.

---

### Task 3: Закрой — модель формы (чистые функции)

**Files:**
- Create: `pinhead-react/src/erp/utils/cutUsage.ts` (режимы рулона, итоги, средний расход)
- Modify: `pinhead-react/src/erp/utils/cutRolls.ts:125-146` (`rollsForItem`: свои рулоны `used` + `leftover_kind 'usable'` + остаток > 0 — в списке), `:329,:380-391` (`cutBlock`, `cutRollsPayload` без требования размеров на рулоне)
- Modify: `pinhead-react/src/erp/utils/reportTotals.ts:35-61` (годные — из таблицы выпуска, не из рулонов)
- Test: `utils/cutUsage.test.ts`, `utils/cutRolls.test.ts`, `utils/reportTotals.test.ts`

**Interfaces:**
- Produces (`cutUsage.ts`):
  - `type RollUse = 'unused' | 'full' | 'partial'`
  - `type LeftoverFate = 'usable' | 'scrap'`
  - `interface RollUsageRow { rollId: string; materialId: string; use: RollUse; leftoverM: number | null; fate: LeftoverFate | null }`
  - `rollUsedM(availableM: number, row: RollUsageRow): number` — unused 0, full = available, partial = available − leftoverM.
  - `rollUsageErrors(availableM: number, row: RollUsageRow): string[]` — partial без остатка → «Введите остаток»; остаток > доступно → «Остаток больше доступного — уточните метраж рулона»; partial с остатком > 0 без `fate` → «Выберите: остаток пригоден или малый остаток».
  - `markAllFull(rows: RollUsageRow[], ids: readonly string[]): RollUsageRow[]` — иммутабельно.
  - `interface MaterialUsageTotal { materialId: string; cutM: number; scrapM: number; totalM: number; usableLeftM: number; cutCost: number; scrapCost: number; avgPerGood: number | null }`
  - `usageTotals(options: RollOption[], rows: RollUsageRow[], goodByColor: Map<string, number>, goodTotal: number): MaterialUsageTotal[]` — группировка по материалу; `avgPerGood = totalM / good` (good — по цвету материала, иначе `goodTotal`, Р4); `null` при good = 0.
  - `usagePayload(options: RollOption[], rows: RollUsageRow[]): CutRollPayload[]` — только `use !== 'unused'`; full → `{ roll_id, length_used_m: available, finished: true }`; partial → `{ roll_id, length_used_m, finished: true, leftover: fate, leftover_measured_m: leftoverM }`.

- [ ] **Step 1: Failing tests** (`cutUsage.test.ts`) — пример документа:
  `it('три рулона по 50 м: полностью / остаток 12 пригоден / не использован → расход 88, остатки 62, средний 0,88 при 100 годных')` → `cutM 88`, `usableLeftM 62`, `avgPerGood 0.88`;
  `it('тот же пример со списанием 12 м → cutM 88, scrapM 12, totalM 100, usableLeftM 50, средний 1')`;
  `it('по умолчанию все рулоны unused — payload пуст')`;
  `it('markAllFull не мутирует вход и меняет только выбранные')`;
  `it('остаток больше доступного — ошибка про уточнение метража')`;
  `it('good = 0 → avgPerGood null, расход сохраняется')`;
  `it('полотно и рибана одной позиции — два итога, годные не удваиваются')` (Review Focus 2);
  `cutRolls.test.ts`: `it('свой рулон с пригодным остатком после прошлой сдачи остаётся в списке с доступным = length_left_m')` (Review Focus 1);
  `reportTotals.test.ts`: `it('режим рулонов: good — сумма таблицы выпуска, не рулонов')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npx vitest run src/erp/utils/cutUsage.test.ts src/erp/utils/cutRolls.test.ts src/erp/utils/reportTotals.test.ts src/erp/utils/cutExtras.test.ts` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): модель расхода ткани по рулонам — три режима и средний расход`.

---

### Task 4: Закрой — форма «Результат кроя» + «Расход ткани»

**Files:**
- Create: `pinhead-react/src/erp/screens/queue/CutResultTable.jsx` (+ `.module.css` на токенах) — размер × цвет × годные, «Размер вне заказа…», «записано N»
- Create: `pinhead-react/src/erp/screens/queue/CutUsageSection.jsx` (+ `.module.css`) — группы «материал · цвет», строка рулона: номер, «Доступно», выбор «Не использован / Полностью / Частично» (`radiogroup`), поле «Остаток, м», «Остаток пригоден / Малый остаток, не учитывать», «Остаток после кроя», «Расход»; флажок строки + «Использованы полностью» на группу; «Уточнить метраж рулона» (существующий `RollParamsForm`); итоги группы (расход на крой, списание, всего, пригодный остаток, стоимость, средний на годное); признак «расчётный метраж».
- Modify: `pinhead-react/src/erp/components/StageReportForm.jsx:174-348` — в режиме `byRolls` монтировать два новых блока вместо `CutRollsSection`; `sizes` из таблицы, `rolls` из `usagePayload`; подтверждение Р5. Ратчет: строк не прибавлять (вынести состояние в `useCutReport.js`).
- Create: `pinhead-react/src/erp/screens/queue/useCutReport.js` — состояние таблицы и строк рулонов, валидация.
- Delete (если больше не импортируются): `CutRollsSection.jsx`, `CutSizeRows.jsx` и их тесты; `RollFinishModal` остаётся (рулоны «в работе» старых сдач).
- Test: `screens/queue/CutUsageSection.test.jsx`, `screens/queue/CutResultTable.test.jsx`, `components/StageReportForm.test.jsx`

**Interfaces:**
- Consumes: всё из Task 3.
- Produces: `useCutReport({ stage, order, options }) → { sizesRows, setCell, usageRows, setUse, setLeftover, setFate, markFull(ids), errors, payload: { sizes, rolls }, totals }`.

- [ ] **Step 1: Failing tests:**
  `CutUsageSection.test.jsx`: `it('по умолчанию у каждого рулона выбрано «Не использован»')`; `it('выбор двух строк и «Использованы полностью» — расход = доступному, остаток 0, выбора пригодности нет')`; `it('выбор строк сам ничего не меняет в итогах')`; `it('частично 12 из 50 → расход 38, обязательный выбор пригодности')`; `it('остаток больше доступного — сообщение и ссылка «Уточнить метраж рулона»')`; `it('рулоны сгруппированы по материалу и цвету, чужой остаток помечен заказом-источником')`.
  `CutResultTable.test.jsx`: `it('сетка позиции подставлена один раз, независимо от числа материалов')`; `it('добавление размера вне заказа')`.
  `StageReportForm.test.jsx`: `it('сдача уходит одним вызовом: sizes из таблицы, rolls только отмеченные, брак и комментарий один раз')`; `it('двойной клик — один submitStageReport')` (Review Focus 3); `it('выпуск без отмеченных рулонов — подтверждение, отказ не отправляет')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать (CSS-модули на токенах; тач-цели ≥ 44 px; компактная раскладка ≤ 760 px — карточки строк).
- [ ] **Step 4:** `npx vitest run src/erp/screens/queue src/erp/components/StageReportForm.test.jsx src/fileSizeRatchet.test.ts` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): форма закроя — результат один раз, расход по рулонам`.

---

### Task 5: Закрой — сервер (миграция C1)

**Files:**
- Create: `supabase/migrations/20261019110000_erp_cut_result_once.sql`
- Create: `supabase/probes/erp_cut_result_once.sql`
- Test: `pinhead-react/src/erp/utils/cutResultOnce.test.ts` (node, `latestDefining`)

**Interfaces:**
- Produces: новая редакция `erp_stage_submit_report(...)` (подпись без изменений): если в `p_rolls` нет ни одного рулона с размерами, а `p_sizes` не пуст — `v_good` из `p_sizes`, строки размеров с `report_roll_id = null`, рулоны пишутся без размеров (`length_used_m` > 0); старый формат (размеры на рулоне) работает как раньше. Повтор `p_client_key` — прежний ответ без записи.
- Produces: новые редакции `erp_fabric_usage`, `erp_item_economics`, `erp_analytics_fabric_by_sku`: знаменатель по отчёту — если у отчёта есть размеры с `report_roll_id`, прежний `roll_good`; иначе годные отчёта по цвету материала (Р4); `metres` включает `scrap_writeoff` по этому отчёту; сводка по заказу = Σ метров / Σ годных (не среднее средних).
- Produces: `erp_roll_set_leftover` и `erp_material_roll_set_params` — без изменений; в пробе закрепить: уточнение метража не меняет `erp_stage_report_rolls.length_used_m` прошлых отчётов и пишет `length_refine`.

- [ ] **Step 1: Failing test** `cutResultOnce.test.ts`: `it('при пустых размерах рулонов годные берутся из p_sizes и report_roll_id null')` (тело содержит ветку `report_roll_id` `null` и условие по `p_sizes`); `it('средний расход: ветка нового отчёта делит на годные отчёта')`; `it('сводка заказа — сумма на сумму')`.
- [ ] **Step 2:** FAIL. **Step 3:** миграция (полные тела из `20261008003410_erp_cut_batch_without_fate.sql` и `20260928182342…` + ветки).
- [ ] **Step 4:** проба: пример документа (3 × 50 м, S30/M40/L30) → отчёт `qty_good 100`, три строки размеров с `report_roll_id null`, два `report_rolls` (50 и 38), рулон 2 `length_left_m 12 leftover_kind usable`, рулон 3 нетронут; `erp_item_economics` → `0.88`; вариант со списанием → `scrap_writeoff 12`, средний `1.00`; повтор того же `client_key` → отчётов 1, `report_rolls` 2; вторая сдача из рулона 2 видит доступно 12; полотно + рибана → `qty_good` 100, а не 200. `PROBE_RESULT total=N`.
- [ ] **Step 5:** `npx vitest run src/erp/utils/cutResultOnce.test.ts src/erp/utils/itemEconomics.test.ts src/erp/utils/rpcContract.test.ts` — PASS.
- [ ] **Step 6:** `npm run erp:freeze`; commit `feat(erp-db): сдача закроя — выпуск один раз, средний расход по отчёту`.

---

### Task 6: Лимит 30 МБ + техпаспорт (миграция S1, «мягче — до фронта»)

**Files:**
- Create: `supabase/migrations/20261019090000_erp_attach_30mb_passport_optional.sql` — `update storage.buckets set file_size_limit = 31457280 where id = 'erp-attachments';` + `create or replace function public.erp_dev_package_guard()` (тело из `20260913002246_erp_dev_package_guard_back.sql:35-110` без блока `dev_passport` :62-66) + повторный `revoke`.
- Modify: `pinhead-react/src/erp/types.ts:885-896` (`TZ_MAX_BYTES = 30 * 1024 * 1024`), `src/erp/hooks/useAttachmentUploads.js:31-41`, комментарии `store/slices/tzSlice.ts:34`, `components/AttachmentPicker.jsx:41`
- Modify: `pinhead-react/src/erp/utils/finalPackage.ts:124` (удалить пункт паспорта), комментарии :26-28, :103-119
- Modify: `pinhead-react/src/erp/screens/experimental/DevFinalPackage.jsx:250-259` (подпись «Технический паспорт · необязательно», без чипа «не приложен»), шапка :14-35
- Modify: `pinhead-react/e2e/support/mock/storageBuckets.ts:22` — НЕ трогать (мок Order, Р7)
- Test: `utils/attachmentLimits.test.ts`, `utils/finalPackage.test.ts`, `screens/experimental/DevFinalPackage.test.jsx`, `e2e/erp-experimental.spec.ts:1185-1192`

- [ ] **Step 1: Failing tests:** `finalPackage.test.ts`: `it('без техпаспорта при остальных полях перечень пуст')`, `it('без фото образца — «Фото образца»')`, `it('страж в последней редакции не требует dev_passport')`; прогресс `3/3` и `10/10`; `DevFinalPackage.test.jsx`: `it('только фото и лекала — «Завершить разработку» активна')`, `'3 / 3'`; `attachmentLimits` сам покраснеет на 20 МБ ≠ 30 МБ после правки миграции — порядок: миграция → константы.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. e2e: :1189 `'Технический паспорт'` → `'Фото образца'`.
- [ ] **Step 4:** `npx vitest run src/erp/utils/attachmentLimits.test.ts src/erp/utils/finalPackage.test.ts src/erp/screens/experimental src/erp/store/useErpStore.test.ts` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): вложения до 30 МБ, техпаспорт необязателен`.

---

### Task 7: ТЗ пачкой — создание заказа и карточка

**Files:**
- Modify: `pinhead-react/src/erp/screens/orders/create/FormParts.jsx:34-53` (`PdfPick`: `multiple`, `onPick(files: File[])`)
- Modify: `pinhead-react/src/erp/screens/orders/create/useTzDocs.js:80-101` (`addTzDocs(files: File[], itemIndex: number | null)`; файл > `TZ_MAX_BYTES` → строка `state: 'error'`, `reason: 'Файл больше 30 МБ'` (МБ из константы), без «Загрузить заново»; остальные грузятся параллельно)
- Modify: `pinhead-react/src/erp/screens/orders/create/TzSection.jsx:76-101` (обе кнопки — пачка; подпись «До 30 МБ на один файл»)
- Modify: `pinhead-react/src/erp/screens/orderCard/TzDocsSection.jsx:38-108` — загрузка через `EditableFiles` (вынести из `EditOrderFiles.jsx` в `create/EditableFiles.jsx`, если импорт тянет лишнее), «Заменить файл» одиночная; подпись «До 30 МБ на один файл»
- Create: `pinhead-react/src/erp/utils/fileLimitText.ts` — `fileLimitCaption(maxBytes: number): string` → «До 30 МБ на один файл»
- Test: `screens/orders/CreateOrderModal.test.jsx` (describe «ТЗ в PDF» :127), `screens/orderCard/TzDocsSection.test.jsx` (новый), `utils/fileLimitText.test.ts`

- [ ] **Step 1: Failing tests:** `CreateOrderModal.test.jsx`: `it('три файла одним выбором — три строки со своим состоянием')`; `it('файл 31 МБ в пачке — строка с именем и «Файл больше 30 МБ», остальные загружены')`; `it('сбой одного файла не убирает загруженные; «Загрузить заново» только у упавшего')` (Review Focus 5); `it('новая пачка добавляется к уже загруженным')`; хелпер `pickItemPdf` → `files: [a, b]`. `TzDocsSection.test.jsx`: `it('пачка в карточке — по строке на файл, кнопки соседей не блокируются')`, `it('замена одного файла остаётся одиночной')`. `fileLimitText.test.ts`: `fileLimitCaption(31457280) === 'До 30 МБ на один файл'`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать (сторож `attachmentLimits.test.ts:80-106`: текст «больше» в `useTzDocs` — из `TZ_MAX_BYTES`).
- [ ] **Step 4:** `npx vitest run src/erp/screens/orders src/erp/screens/orderCard src/erp/utils/attachmentLimits.test.ts src/erp/utils/fileLimitText.test.ts src/fileSizeRatchet.test.ts` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): ТЗ загружается пачкой, до 30 МБ на файл`.

---

### Task 8: Закупка без «Принять поставку»

**Files:**
- Modify: `pinhead-react/src/erp/screens/purchasing/PurchaseMaterialsTable.jsx:9,86,20-22`, `PurchaseRowCard.jsx:9,69,21-26`
- Delete: `pinhead-react/src/erp/screens/purchasing/ReceiptButton.jsx`; из `utils/receiptLink.ts` — `materialReceiptTask`, `receiptAction`, `receiptHref`, `RECEIPT_TASK_MISSING_HINT` (оставить `qtyLeftToAccept`, `purchasingReturnHref`); класс `.receiptAction` в `screens.module.css:743`
- Test: `screens/purchasing/PurchaseRowCard.test.jsx:278-310`, `utils/receiptLink.test.ts:32-55`

- [ ] **Step 1: Failing test:** `PurchaseRowCard.test.jsx`: `it('в строке материала нет «Принять поставку» и «Открыть приёмку», принятое количество видно')`; то же для таблицы.
- [ ] **Step 2:** FAIL. **Step 3:** удалить кнопку и мёртвый код; убрать тесты удалённых функций.
- [ ] **Step 4:** `npx vitest run src/erp/screens/purchasing src/erp/utils/receiptLink.test.ts src/erp/screens/warehouse` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): приёмка только на складе — кнопка убрана из закупки`.

---

### Task 9: Проверка ветки, документы, выкатка

**Files:**
- Modify: `CLAUDE.md` (раздел правил ERP: вышивка одной строкой, закрой — выпуск один раз, 30 МБ), `pinhead-react/CLAUDE.md`, `docs/rules/pravila-pravok-19-10.md` (новый) + `docs/rules/INDEX.md`, `docs/rules/react/pravila-sessii-61-hvosty-14-09-gde-chto-lezhit.md:4-6`, `docs/DESIGN.md` (форма закроя), `docs/changelog/2026-10.md`, `SESSION-STATE.md`
- Create: `supabase/rollout/r1910a/README.md` — порядок: S1 → E1 → C1 (SQL Editor владельцем, сначала сухой прогон `begin; …; rollback`), проверка глобального лимита Storage проекта ≥ 30 МБ (Dashboard → Storage → Settings), затем фронт; откат — фронт, потом обратные миграции (`…_rollback.sql` для E1/C1: прежние тела функций).

- [ ] **Step 1:** `cd pinhead-react && npm run lint && npm run typecheck && npx vitest run --maxWorkers=3` — всё зелёное.
- [ ] **Step 2:** `npm run build && npm run bundle:budget` — PASS (ERP-оболочка не растёт: новые блоки — в чанке экрана очереди).
- [ ] **Step 3:** `npx playwright test e2e/erp-queue.spec.ts e2e/erp-experimental.spec.ts e2e/erp-tablet.spec.ts` — PASS; визуальные эталоны пересняты только там, где менялась форма закроя.
- [ ] **Step 4:** обход `pinhead-qa`: закройщик (пример документа на моке), вышивальщик (программа до кроя → вышивка после кроя), технолог (завершение без паспорта), менеджер (ТЗ пачкой 3 файла + 1 слишком большой).
- [ ] **Step 5:** документы; commit `docs: правки 19.10 — часть A`; `git push -u origin claude/gifted-fermi-rnrf9q`.
