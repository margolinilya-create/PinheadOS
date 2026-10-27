# Веха 5в, этап Э1 «Защиты и хвосты» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** закрыть баги данных и пробелы раздела «Дизайн», найденные сверкой D0 (B1–B4, safe-зона, отступ в ERP, техника в цене, мелкие баги холста), без новых прав и без миграций.

**Architecture:** всё — на стороне Order (`src/orderstudio/**`), чистыми функциями с юнит-тестами и точечными правками экранов. Запись по-прежнему только `useDesignStore.commit` → `useSalesStore.edit`; ERP не трогается (мост меняет только содержимое `offset_note` в payload). Бэкфилл `zone_id` — файл данных для владельца, не миграция.

**Tech Stack:** TypeScript, React 19, Vitest + Testing Library, konva (холст), pdfjs (превью PDF/AI).

**Spec:** `docs/superpowers/plans/2026-10-26-order-flow-m5c-design-studio.md` (раздел «Э1»; карта D0 — там же).

## Global Constraints

- ERP заморожен: ни одного файла `src/erp/**`, ни DDL по `erp_*` (`orderstudio/erpFrozen.test.ts` зелёный).
- Открытие вкладки «Дизайн» ничего не пишет; запись — только в `draft` (`model/editable`).
- Бюджеты: чанк холста ≤ 100 000 Б gzip (сейчас 98 376) — в чанк холста не добавлять ничего, кроме правки `canvasChange.ts`; панель (`DesignSide`) и чек-лист — свои ленивые чанки. Проверка — `npm run bundle:budget`.
- Сторожа, которые должны остаться зелёными: `designGuards`, `assetGuards`, `pdfGuards`, `pricingParity`, `sceneGolden`, `tzModelGuards`, `workplaceSource`, `erpImports`, `catalogKeys`.
- Тексты — русские, с позиции пользователя; блок по условию — `aria-disabled` с причиной (правило 6+7), `disabled` — только на время запроса.
- Правила техник — константы в `model/printMethods.ts` (решение владельца 26.10), цифры ниже — черновик, подтверждает технолог.
- Коммиты — conventional, на русском, в ветку `claude/blankbuilder-integration-t94h7n`.

## Review Focus

1. Позиция без модели из каталога (`kind` = `customer`/`blank`, `sku_code` пуст или не найден) — проверка силуэта не должна ни блокировать отправку, ни прятать флэты: только когда модель известна. Тест — в задачах 1 и 2.
2. Старые заказы с `zone`, но без `zone_id`, и нанесения без мм — новые проверки размера не должны падать на `null`/пустых мм (пусто — это уже пункт «Укажите размер»). Тест — в задаче 4.
3. Нанесение «Прочее / подряд» (`other`), шевроны, сублимация — без правил размера: никаких пунктов. Тест — в задаче 4.
4. Ручной `offset_note` без мм с холста (старые заказы) — в ERP уходит как раньше, без «; » в начале. Тест — в задаче 7.
5. Перетаскивание нанесения на пустое место вида (центр не попал ни в одну зону) — зона не меняется. Тест — в задаче 9.

---

### Task 1: Силуэт только своей модели на холсте

**Files:**
- Modify: `pinhead-react/src/orderstudio/design/catalog/pickFlat.ts`
- Modify: `pinhead-react/src/orderstudio/design/ui/DesignTab.jsx:51` (`choices`)
- Modify: `pinhead-react/src/orderstudio/design/export/preflight.ts` (новый вход)
- Modify: `pinhead-react/src/orderstudio/design/ui/panel/ArtworkPicker.jsx`, `design/ui/canvas/EditorCanvas.jsx` (сброс и вставка файлов)
- Test: `design/catalog/pickFlat.test.ts`, `design/export/preflight.test.ts`, `design/ui/DesignTab.test.jsx`

**Interfaces:**
- Produces: `flatsForModel(catalog: GarmentFlatsCatalog, item: ItemRef, sku: SkuRef): GarmentFlat[]`; `flatMismatch(flat: GarmentFlat | null, item: FitRef, sku: FitSkuRef): boolean`; `PreflightInput.modelMismatch?: boolean`.

- [ ] **Step 1: Тесты `pickFlat.test.ts`**
  - `flatsForModel`: при известной модели категории `hoodies` возвращает только активные флэты с `categories` ∋ `hoodies` или `sku_codes` ∋ код модели, по `id`; при `sku = null` — все активные.
  - `flatMismatch(tshirtFlat, {sku_code:'H-002'}, {category:'hoodies'}) === true`; `flatMismatch(null, …) === false`; `flatMismatch(flat, item, null) === false` (модель неизвестна — не судим).
- [ ] **Step 2: Тест `preflight.test.ts`** — `preflight({ …, modelMismatch: true })` первым пунктом отдаёт `{ level: 'serious', message: 'Силуэт не от модели позиции — перенесите нанесения на силуэт модели.' }`.
- [ ] **Step 3: Тест `DesignTab.test.jsx`** — у худи в выборе силуэта нет флэта футболки; при `pick.modelChanged` кнопка «Добавить логотип» `aria-disabled="true"` с причиной «Сначала перенесите нанесения на силуэт новой модели», сброс файла на холст ничего не пишет.
- [ ] **Step 4: Прогнать — FAIL** (`npx vitest run src/orderstudio/design/catalog/pickFlat.test.ts src/orderstudio/design/export/preflight.test.ts src/orderstudio/design/ui/DesignTab.test.jsx`).
- [ ] **Step 5: Реализация** — `flatsForModel` и `flatMismatch` рядом с `flatFitsModel` (на нём же); `choices` в `DesignTab` = `flatsForModel(flats.catalog, item, d.sku)` (`FlatPicker` сам добавляет текущий, если его нет в списке); `preflight` — пункт `serious` в начале, если `modelMismatch`; вызывающие `preflight` передают `modelMismatch: d.pick.modelChanged`. Добавление файла (кнопка, сброс, Ctrl+V) при `d.pick.modelChanged` не начинается — причина текстом.
- [ ] **Step 6: Прогнать — PASS**, затем `npx vitest run src/orderstudio/design`.
- [ ] **Step 7: Commit** — `fix(design): силуэт только своей модели — выбор, проверка, блок новых логотипов (B1)`.

### Task 2: Отправка в работу не пропускает чужой силуэт

**Files:**
- Modify: `pinhead-react/src/orderstudio/tz/model/sendChecklist.ts` (`CheckCtx`, `itemChecks`)
- Modify: `pinhead-react/src/orderstudio/tz/useSendChecklist.ts` (новый аргумент)
- Modify: `pinhead-react/src/orderstudio/workplace/OrderWorkplace.jsx:96` (передать каталог моделей из `useStore`, селектор с `useShallow` не нужен — массив)
- Test: `tz/model/sendChecklist.test.ts`, `tz/useSendChecklist.test.ts`

**Interfaces:**
- Consumes: `flatMismatch` (задача 1).
- Produces: `CheckCtx.skuCategoryOf?: (code: string) => string | null`; `useSendChecklist(order, catalogs, margin, skuCatalog?: readonly { code: string; category: string }[])`.

- [ ] **Step 1: Тесты `sendChecklist.test.ts`**
  - позиция с `flat_id` флэта футболки и моделью категории `hoodies` → блокирующий пункт `flat:<key>`, текст продавцу «Силуэт позиции «…» не от её модели — откройте «Дизайн» и перенесите нанесения», `href` = `?tab=design&item=<key>`; МС — «… — верните менеджеру», `href: null`;
  - без `skuCategoryOf`, без `flat_id`, с неизвестной моделью или с `garmentFlats = null` — пункта нет;
  - пункт без `rule` (сервер этого не проверяет — клиент строже, что допустимо).
- [ ] **Step 2: Тест `useSendChecklist.test.ts`** — переданный `skuCatalog` доходит до `sendChecklist` как `skuCategoryOf`.
- [ ] **Step 3: FAIL → реализация → PASS.** `itemChecks` получает флэт из `cat.garmentFlats` по `item.flat_id`; хук строит `skuCategoryOf` из массива `useMemo`-ом.
- [ ] **Step 4:** `npx vitest run src/orderstudio/tz src/orderstudio/workplace` — PASS; `npm run bundle:budget` — рабочее место в потолке.
- [ ] **Step 5: Commit** — `fix(tz): «Отправить в работу» блокирует силуэт не от модели позиции (B1)`.

### Task 3: Админка флэтов — модели только своей категории

**Files:**
- Modify: `pinhead-react/src/orderstudio/design/edit/validateFlat.ts` (`FlatCheckCtx`, `skuChecks`)
- Modify: `pinhead-react/src/orderstudio/admin/flats/ModelPicker.jsx` (фильтр), `admin/flats/FlatEditor.jsx:56`, `admin/flats/saveFlat.ts:152` (контекст)
- Test: `design/edit/validateFlat.test.ts`, `admin/flats/ModelPicker.test.jsx` (создать, если нет)

**Interfaces:**
- Produces: `FlatCheckCtx.skuCategory: ReadonlyMap<string, string>` (код → категория).

- [ ] **Step 1: Тесты** — `validateFlat`: у флэта `categories: ['tshirts']` модель категории `hoodies` в `sku_codes` → ошибка «Модель H-002 — «Худи», а флэт для категорий: футболки» (`field: 'sku_codes'`); модель без категории — без ошибки. `ModelPicker`: при `categories={['tshirts']}` поиск не предлагает худи.
- [ ] **Step 2: FAIL → реализация → PASS.** В `saveFlat` контекст строится из того же каталога моделей, что у редактора (не только из `provisional.sku_codes`), — иначе проверка на сохранении слабее, чем на экране.
- [ ] **Step 3:** `npx vitest run src/orderstudio/design/edit src/orderstudio/admin/flats` — PASS.
- [ ] **Step 4: Commit** — `fix(flats): к флэту привязываются только модели его категорий (B1, B5)`.

### Task 4: Минимальный и максимальный размер по технике

**Files:**
- Modify: `pinhead-react/src/orderstudio/model/printMethods.ts` (профиль `size`)
- Modify: `pinhead-react/src/orderstudio/design/export/preflight.ts`, `tz/model/sendChecklist.ts`, `screens/PrintRow.jsx`
- Test: `model/printMethods.test.ts`, `design/export/preflight.test.ts`, `tz/model/sendChecklist.test.ts`, `screens/PrintRow.test.jsx`

**Interfaces:**
- Produces: `PrintMethodProfile.size?: { minMm: number; maxW: number; maxH: number }`; `methodSizeIssue(method: SalesPrintMethod, w: number | null, h: number | null): string | null`.

Черновые значения (мм): `dtf` 20 / 450 / 600; `silkscreen` 30 / 400 / 500; `embroidery` 15 / 300 / 300; `heat_transfer` 20 / 400 / 500; `dtg` 20 / 400 / 450; `sublimation`, `patch`, `other` — без `size`. Минимум сверяется по меньшей стороне, максимум — Ш ≤ maxW и В ≤ maxH или наоборот (поворот допустим).

- [ ] **Step 1: Тесты `printMethods.test.ts`** — `methodSizeIssue('dtf', 2, 1)` → «Размер 2 × 1 мм меньше минимума для DTF — 20 мм»; `('dtf', 600, 450)` → `null` (поворот); `('silkscreen', 420, 520)` → «Размер 420 × 520 мм больше максимума для шелкографии — 400 × 500 мм»; `('other', 1, 1)` и `('dtf', null, 10)` → `null`.
- [ ] **Step 2: Тесты потребителей** — `preflight`: пункт `warn` с тем же текстом; `sendChecklist`: блокирующий `mm-size:<n>:<key>` с этим текстом и `href` позиции; `PrintRow`: под полями мм — `role="status"` с текстом.
- [ ] **Step 3: FAIL → реализация → PASS** (`npx vitest run src/orderstudio/model src/orderstudio/design/export src/orderstudio/tz/model src/orderstudio/screens`).
- [ ] **Step 4: Commit** — `feat(design): пределы размера по технике — подсказка, PDF макета, чек-лист отправки (B3)`.

### Task 5: Физический размер JPEG и SVG в дюймах

**Files:**
- Modify: `pinhead-react/src/orderstudio/design/assets/loadAsset.ts`
- Test: `design/assets/loadAsset.test.ts` (байтовые фикстуры — `assets/bytes.testutil.ts`)

**Interfaces:**
- Produces: `readJpegDpi(b: Uint8Array): number | null`.

- [ ] **Step 1: Тесты** — JFIF APP0 с единицей 1 (dpi) 300 → 300; единица 2 (dpcm) 118 → ≈ 299.7; единица 0 → `null`; EXIF APP1 `XResolution` 300/1 при `ResolutionUnit` 2 → 300 (оба порядка байт `II`/`MM`); мусор и обрезанный файл → `null` без исключения. `parseSvgSizeMm('<svg width="2in" height="1in">')` → `{ w: 50.8, h: 25.4, estimated: false }`. Растр JPEG 1200 px при 300 dpi → `intrinsic_w_mm` 101.6, `size_estimated: false`.
- [ ] **Step 2: FAIL → реализация → PASS.** Разбор маркеров JPEG до `SOS`, без чтения пикселей; предел чтения — первые 64 КБ; EXIF — только IFD0, теги 0x011A/0x0128.
- [ ] **Step 3:** `npx vitest run src/orderstudio/design/assets` — PASS (сторож `assetGuards` зелёный).
- [ ] **Step 4: Commit** — `feat(design): размер JPEG по DPI из JFIF/EXIF и SVG в дюймах (B4)`.

### Task 6: Предупреждение «близко к краю зоны»

**Files:**
- Modify: `pinhead-react/src/orderstudio/design/export/preflight.ts`
- Test: `design/export/preflight.test.ts`

- [ ] **Step 1: Тест** — раскладка внутри зоны, но в 4 мм от края при `safe_inset_mm: 10` → `warn` «до края зоны меньше 10 мм — цех может не попасть»; за зоной — только прежнее «выходит за печатную зону» (без второго пункта); внутри safe — ничего.
- [ ] **Step 2: FAIL → реализация** (данные уже есть: `placementInfo(...).check.out_of_safe_zone` и `safeInsetMm`) **→ PASS.**
- [ ] **Step 3: Commit** — `feat(design): предупреждение у края печатной зоны`.

### Task 7: Отступ с холста доходит до ERP

**Files:**
- Modify: `pinhead-react/src/orderstudio/bridge/tzToErpDraft.ts:199` (`mapPrint`)
- Test: `bridge/tzToErpDraft.test.ts`

**Interfaces:**
- Consumes: `offsetText` из `model/printOffset.ts`.

- [ ] **Step 1: Тесты** — нанесение `offset_mm: 70, offset_from: 'neck_seam'`, `offset_note: ''` → `offset_note` черновика «70 мм от шва горловины»; с ручной заметкой «по центру кармана» → «70 мм от шва горловины; по центру кармана»; без мм — как раньше, ровно ручная заметка (Review Focus 4). Порядок и разделитель — как в ТЗ (`tzDocument.ts:144`).
- [ ] **Step 2: FAIL → реализация → PASS** (`npx vitest run src/orderstudio/bridge`); сторож контракта с формой ERP зелёный.
- [ ] **Step 3: Commit** — `fix(bridge): отступ нанесения с холста уходит в ERP (offset_note)`.

### Task 8: Техника в цене — формат, плёнка, стежки

**Files:**
- Modify: `pinhead-react/src/utils/pricingCore.ts:206` (вынести расчёт вышивки в экспорт `embroideryResult(P, input)`, `calcZonePriceDirect` зовёт его же)
- Modify: `pinhead-react/src/orderstudio/pricing/priceOrder.ts` (`printUnitPrice` → `tech`, `PrintPrice.tech`)
- Create: `pinhead-react/src/orderstudio/pricing/printTech.ts`
- Modify: `pinhead-react/src/orderstudio/design/ui/panel/DesignSide.jsx` (строка под ценой нанесения)
- Test: `utils/pricingCore.test.ts`, `pricing/priceOrder.test.ts`, `pricing/printTech.test.ts`, `design/ui/DesignTab.test.jsx`

**Interfaces:**
- Produces: `type PrintTech = { kind: 'screen'; fmt: string } | { kind: 'dtf'; perMeter: number; cols: number } | { kind: 'emb'; stitches: number } | { kind: 'dtg'; size: string }`; `PrintPrice.tech?: PrintTech`; `printTechText(t: PrintTech): string`.

- [ ] **Step 1: Тесты** — `pricingCore`: `embroideryResult` даёт тот же `unit`, что `calcZonePriceDirect('embroidery', …)` на трёх входах (паритет). `priceOrder`: шелкография 280 × 200 → `tech { kind: 'screen', fmt: 'A4' }`; DTF 90 × 72 на 150 шт → `perMeter`/`cols` из `dtfLayout`; вышивка 80 × 60 → `stitches` из `embroideryResult`; цена (`unit`) не изменилась ни в одном существующем тесте. `printTechText`: «Формат сетки: A4», «Плёнка: 1 м на 42 шт (6 в ряд)», «≈ 8 600 стежков», «Формат печати DTG: A4».
- [ ] **Step 2: FAIL → реализация → PASS** (`npx vitest run src/utils/pricingCore.test.ts src/orderstudio/pricing src/orderstudio/design`); `pricingParity` и 88 тестов цены зелёные.
- [ ] **Step 3:** `npm run bundle:budget` — панель в потолке.
- [ ] **Step 4: Commit** — `feat(design): техника в цене нанесения — формат сетки, плёнка DTF, стежки`.

### Task 9: Перетаскивание в другую зону меняет зону

**Files:**
- Modify: `pinhead-react/src/orderstudio/design/ui/canvas/canvasChange.ts` (`nextPrint`, ветка `place`)
- Test: `design/ui/canvas/canvasChange.test.ts`

**Interfaces:**
- Consumes: `areaAt(view, x_mm, y_mm)` из `ui/canvas/canvasMath.ts` (им пользуется сброс файла).

- [ ] **Step 1: Тесты** — вид с зонами «Грудь» и «Живот»: перенос рамки так, что центр в «Животе», → `layout.area_id` = id «Живота», `zone_id`/`zone`/отступ пересчитаны (`applyPlacement`); центр вне всех зон → зона прежняя (Review Focus 5); `nudge` зону не меняет.
- [ ] **Step 2: FAIL → реализация → PASS** (`npx vitest run src/orderstudio/design/ui/canvas`).
- [ ] **Step 3:** `npm run bundle:budget` — холст ≤ 100 000.
- [ ] **Step 4: Commit** — `fix(design): нанесение, перенесённое в другую зону вида, получает её зону`.

### Task 10: Превью PDF/AI без белой подложки

**Files:**
- Modify: `pinhead-react/src/orderstudio/design/assets/loadPdf.ts:130`
- Test: `design/assets/loadPdf.test.ts`

- [ ] **Step 1: Тест** — рендер страницы зовётся с прозрачным фоном (`background: 'rgba(0,0,0,0)'`), холст не заливается белым; превью по-прежнему PNG ≤ 2048 px.
- [ ] **Step 2: FAIL → реализация → PASS.** Старые превью не перегенерируются (файлы неизменяемы); в отчёт сессии — строка про это.
- [ ] **Step 3: Commit** — `fix(design): превью PDF/AI без белой подложки — видно на тёмной ткани`.

### Task 11: Бэкфилл `zone_id` (файл для владельца)

**Files:**
- Create: `supabase/rollout/m5c/README.md`, `supabase/rollout/m5c/zone_id_backfill_dryrun.sql`, `supabase/rollout/m5c/zone_id_backfill_apply.sql`
- Test: `pinhead-react/src/orderstudio/rolloutM5c.test.ts` (сторож файлов; `// @vitest-environment node`)

- [ ] **Step 1: Сторож** — файлы есть; в `dryrun` — `begin;` … `rollback;` и отчёт `select count(*)` по совпавшим и не совпавшим строкам; в `apply` — только `update order_item_prints set zone_id = …` по точному совпадению `lower(trim(zone))` с `name` зоны `app_config.zonesCatalog`, где `zone_id is null`; нет `drop`, `delete`, DDL и `erp_`.
- [ ] **Step 2: Файлы.** Перед запуском README велит проверить, пропускает ли `order_v4_child_guard` служебный вызов из SQL Editor (у не-черновиков иначе отказ); если не пропускает — остановиться и вернуться с решением, а не ослаблять страж.
- [ ] **Step 3:** `npx vitest run src/orderstudio/rolloutM5c.test.ts` — PASS.
- [ ] **Step 4: Commit** — `chore(rollout): бэкфилл zone_id по названию зоны — сухой прогон и применение (B2)`.

### Task 12: Проверка ветки и документы сессии

- [ ] **Step 1:** `cd pinhead-react && npm run lint && npm run typecheck && npx vitest run --maxWorkers=3 && npm run build && npm run bundle:budget` — всё зелёное (вывод в отчёт).
- [ ] **Step 2:** Документы по правилу конца сессии: `SESSION-STATE.md` (старший раздел — в `docs/sessions/` + `INDEX.md`), `docs/changelog/2026-10.md`, `docs/rules/` — файл правил Э1 (силуэт по модели, пределы техник, отступ в ERP) и строка в `docs/rules/INDEX.md`; `CLAUDE.md` — строка о вехе 5в в карте `orderstudio/`.
- [ ] **Step 3: Commit + push** — `docs: веха 5в Э1 — состояние, журнал, правила`.

---

## Ход выполнения и поправки ревью (26.10)

Сделано: задачи 1–10 (коммиты `2c8d5d7` … `2d06f88` в `claude/blankbuilder-integration-t94h7n`).

Поправки ревью, отличающие код от текста задач выше:
- **Задача 1.** Правило «модель ↔ флэт» одно — `flatFitsModel` (`design/catalog/pickFlat.ts`): код модели
  засчитывается только внутри её категории; `flatsForModel` — список силуэта, `flatMismatch` — несовпадение.
  Новые логотипы при чужом силуэте блокирует `useDesignTab` (`target = null`, причина текстом
  у кнопок, тост на перетаскивание/вставку); `EditorCanvas` не тронут. **Сброс `flat_id` в `garmentPatch`
  при смене модели снят:** блок по раскладкам (задача 2) даёт выход «перенести на силуэт модели», а сброс
  терял бы привязку молча.
- **Задача 2.** Блок — по `layout.flat_id` нанесений (что попадёт в ТЗ), а не по `item.flat_id`; категории
  моделей — через единую сборку `tzCatalogsOf` (`skuCategories`), так их видят все три вызывающих.
- **Задача 3.** Фильтр по категориям — в `FlatModelSection`; в `NewFlatForm` его нет: там тип берётся из модели.
- **Задача 4.** Пределы — `size` в профилях `printMethods.ts` (DTF 20/450×600, шелкография 30/400×500,
  вышивка 15/300×300, флекс 20/400×500, DTG 20/400×450 — черновик технолога); мельче минимума — блок
  отправки, больше рамки — подсказка без блока.
- **Задача 6.** Край зоны — только лево/право/низ (верх зоны у горловины — нормальное место логотипа,
  иначе предупреждение на каждом стандартном логотипе). **Выход по многоугольнику** отложен: зоны сида —
  прямоугольники, `out_of_zone` по рамке их покрывает; вернуться, когда появятся непрямоугольные зоны (Э2б).
- **Задача 8.** `pricingCore` не тронут: стежки — `printRules.embroideryPrice`, плёнка — `dtfLayout`,
  формат — `screenFormat`/`fitFormat`, DTG — `dtgFitSize`. `tech` есть только при обоих мм; флекс тоже
  показывается; Max — «больше A3+», DTG 40x45 — «40 × 45 см».
- **Задача 9.** Центр рамки в текущей зоне — зона сохраняется; в другую — только в зону, разрешённую
  модели (`areaAllowed`).

**Задача 11 (бэкфилл `zone_id`) — отложена.** Причины:
1. `order_v4_child_guard` пропускает правку нанесений только у черновика; служебный `update` из SQL Editor
   по не-черновикам либо упрётся в страж, либо потребует его ослабить — план это прямо запрещает.
2. Черновики, открытые во вкладках, держат прежние нанесения в сторе: первое же автосохранение
   (`order_v4_save_full` пишет нанесения целиком) молча вернёт `zone_id = null`.
3. `zone_id` входит в документ ТЗ (строка матрицы): у отправленных заказов поменялся бы хэш ТЗ
   и проверка `bridge/tzCheck` на «К запуску».

Цену и строку ТЗ без `zone_id` по-прежнему считают по имени зоны (веха 8, К5) — данные не теряются.
Вернуться — вместе с миграцией Э4б (окно выкатки, пустая очередь «К запуску»), отдельным решением владельца.
