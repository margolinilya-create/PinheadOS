# SESSION-STATE — память проекта PinheadOS

> Живой документ: обновляется в конце КАЖДОЙ сессии (правило в CLAUDE.md).
> Здесь — текущее состояние и решения ДВУХ последних сессий плюс открытые долги.
> История старше — `docs/sessions/` (по файлу на сессию, указатель
> `docs/sessions/INDEX.md`), changelog — `PROJECT.md`. Сторож
> `src/sessionsIndex.test.ts` не даёт истории снова копиться здесь.

## Состояние на 2026-10-19 (сессия 92) — правки 19.10, план B («Бизнес-задачи»): сборка ветки и документы

Ветка `claude/gifted-fermi-rnrf9q` (НЕ запушена): поверх части A слиты `--no-ff` полосы `wf/b-ui` (B1–B7) и `wf/b-chat`
(B8, B9; `wf/b-core` входит в обе), поверх — сборка и B10. План — `docs/superpowers/plans/2026-10-19-erp-edits-19-10-b-biz-tasks.md`,
ledger и отчёты — `.superpowers/sdd/2026-10-19-erp-edits-19-10-b-biz-tasks/` (отчёт сборки — `integrate-report.md`).
Владелец одобрил правку замороженного ERP; `erpFrozen.json` пересчитан. npm не добавлялся.

### Что сделано

- **Схема** T1 `20261020090000` и **писатели + диалог + напоминания** T2 `20261020100000` — файлами; выкатка
  `supabase/rollout/r1910b/README.md`, откат T2 `20261020100000_erp_biz_tasks_rpc_rollback.sql`, сторож `rollout1910b.test.ts`.
- **Клиент:** вкладка «Задачи» заказа и форма создания, раздел `/biz-tasks` и карточка задачи, диалог задачи в общей
  ленте, уведомления `task_*`, «Менеджер заказа», предупреждение при отгрузке.
- **Сборка:** конфликт `OrderCard.jsx` (оба импорта), `erpFrozen.json`; «кто я» в `useTaskChat` — из стора авторизации.
- **B10:** e2e `erp-biz-tasks.spec.ts` + мок писателей, axe раздела/карточки/формы, эталоны `erp-biz-tasks*` (skip до
  съёмки), правило `docs/rules/pravila-biznes-zadach-19-10.md`, CLAUDE.md обоих уровней, DESIGN.md, changelog.
  Сессия 90 перенесена в `docs/sessions/`.

### Проверки

- lint 0 ошибок, typecheck 0; vitest — 593 файла, 8535 тестов после слияния (+ сторож отката и гварды после B10 — зелёные).
- `bundle:budget`: оболочка ERP JS 195 724 / 196 000 Б gzip (раздел взял 667 из ≤ 1 000 по Р6), строгая база перезаписана.
- e2e (desktop + mobile, без `visual:`/`@walk`): 443 зелёных, 67 пропущено за 14 мин; `order-launch` «макет больше 30 МБ» (хвост части A: бакет макетов 25 МБ, скачивание отвергает раньше) переписан и зелёный. `visual.spec.ts` локально несравним — эталоны снимает владелец.
- Пробы T1/T2 (`total=31/407/55`) на бою не прогонялись.

### Следующие шаги

- **Владельцу:** переснять в CI все `erp-*` эталоны (пункт меню «Бизнес-задачи», вкладка «Задачи» в карточке заказа)
  и снять новые `erp-biz-tasks*`; выкатка части A, затем B по `r1910b/README.md` (T2 — в нерабочее время).
- Обход `pinhead-qa` (менеджер, снабженец, директор-наблюдатель, постановщик, продавец без `erp_employees`) — не делался.
- Хвосты: курсор после подстановки упоминания (`ChatComposer.jsx:113`, гонка с быстрым вводом); прямой INSERT в
  `erp_orders` обходит страж `manager_id`; Minor-хвосты ревизий B1–B9 — в ledger.

## Состояние на 2026-10-19 (сессия 91) — правки 19.10, план A (производство): сборка ветки и документы

Ветка `claude/gifted-fermi-rnrf9q` (НЕ запушена): полосы Workflow `wf/a-emb` (A1, A2, A6, A7, A8) и `wf/a-cut`
(A3, A4, A5) слиты `--no-ff`, поверх — сборка и A9. План — `docs/superpowers/plans/2026-10-19-erp-edits-19-10-a-production.md`,
ledger и отчёты — `.superpowers/sdd/2026-10-19-erp-edits-19-10-a-production/` (отчёт сборки — `integrate-report.md`).
Владелец одобрил правку замороженного ERP; `erpFrozen.json` пересчитан. npm не добавлялся. План B — в той же
ветке после A.

### Что сделано

- **Вышивка одной задачей** (E1 `20261019100000`): строка одна, фаза по `result_kind`, переход только
  `erp_embroidery_program_finish`/`_skip`, страж запуска вышивки (`erp_item_stages_dep_gate`), фаза непрозрачна;
  клиент — `utils/embroideryPhase`, `ProgramFinishAction`, `store/slices/embroideryActions`; `Button ariaDisabledReason`.
- **Закрой** (C1 `20261019110000`): «Результат кроя» один раз + «Расход ткани» по рулонам (три режима), средний
  расход по материалу, страж `erp_material_rolls`, рулон `for update`; форма — `useCutReport`, `CutResultTable`,
  `CutUsageSection`, `CutTotalsBar`; модель — `utils/cutUsage.ts`.
- **30 МБ и техпаспорт** (S1 `20261019090000`): вложения ERP и писатели Order — 30 МБ, «Готово к серии» без паспорта.
- **ТЗ пачкой** в форме и карточке (`EditableFiles`, `fileLimitText`); **закупка без «Принять поставку»**.
- **Сборка:** конфликты — `orderV4M8.test.ts` (оставлена строгая редакция полосы emb: «последние» среди файлов ≤ M),
  `erpFrozen.json` (перезаморожен). «Использованы полностью» переведена на `ariaDisabledReason`. Тексты фазы
  (`PROGRAM_PHASE_BLOCK`, `stageHeadingId`) вынесены в `utils/embroideryPhaseText.ts` — из оболочки ERP (−49 Б gzip).
- **A9:** `supabase/rollout/r1910a/README.md` (предусловия, S1 → E1 → C1, откаты, триггеры, запрос «наследия»),
  откат E1 `20261019100000_erp_embroidery_one_stage_rollback.sql`, сторож `utils/rollout1910a.test.ts`
  (тела откатов = прежние редакции; мутация проверена), правило `docs/rules/pravila-pravok-19-10.md`, DESIGN.md,
  CLAUDE.md обоих уровней. Сессия 89 перенесена в `docs/sessions/`.

### Проверки

- lint 0 ошибок, typecheck 0; vitest — 574 файла, 8292 теста до правок сборки (2 падения: `erpFrozen` — до
  перезаморозки, `FlatsTab part=zones` — нестабилен под нагрузкой, отдельно зелёный); после — см. `integrate-report.md`.
- e2e: `erp-queue`, `erp-experimental`, `erp-tablet`, `erp-supply`, `erp-a11y`, `erp-axe`, `erp-mobile` — 243/243.
  `visual.spec.ts` локально не сравним: 54 кадра упали (1 прошёл, 7 пропущены), расхождение 1–7 %, включая нетронутые `studio-*` —
  среда, а не правка; эталоны не переснимались.
- **`bundle:budget` зелёный после решения Р6:** оболочка ERP JS 195 057 Б gzip (+249 к 194 808: `Button`
  `ariaDisabledReason` в `ErpStates` +136, `embroideryPhase` в ядре маршрута `statusUi` +71, перенумерация
  `ErpApp` +29), CSS +33. Потолок `shellJs` поднят 195 000 → 196 000 (запас ≤ 1 000 Б — под «Бизнес-задачи»),
  строгая база перезаписана — разбор в `design/README.md`, «Замеры 19.10».
- Пробы S1/E1/C1 (`total=8/38/41`) не прогонялись ни разу — первый сухой прогон при выкатке.

### Следующие шаги

- **Владельцу:** `update_snapshots` для `erp-queue-*`, `erp-order-card-*`,
  `erp-purchasing-*` (и `erp-experimental-*` — финальный пакет) в CI; глобальный лимит Storage ≥ 30 МБ.
- Выкатка по `supabase/rollout/r1910a/README.md`: сухие прогоны проб с миграциями, S1 → E1 → C1, `APPLIED.json`.
- Обход `pinhead-qa` (закройщик, вышивальщик, технолог, менеджер) — не делался.
- Хвосты ревизий (Minor): событие этапа при `erp.subcontract_rollup`, `isLegacyProgram` и `executor`, склейка
  `aria-describedby` в `Button`, `cutRolls.ts:135` (`qty_left` в кг), фокус после «Удалить» в `EditableFiles`,
  проба гонки C1 в одной транзакции, точное сравнение числовых проб.
- Затем план B (`docs/superpowers/plans/2026-10-19-erp-edits-19-10-b-biz-tasks.md`).

## История

Разделы сессий 90 и старше — `docs/sessions/INDEX.md` (99 файлов, перенос
дословный). В конце сессии старший из разделов здесь переезжает
туда же, чтобы в этом файле оставались две последние сессии.
