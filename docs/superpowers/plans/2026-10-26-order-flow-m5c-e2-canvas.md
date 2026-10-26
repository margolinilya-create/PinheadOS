# Веха 5в, этап Э2 «Холст 2.0» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вкладка «Дизайн» по выбранному гибриду «А + лучшее из Б»: пресеты ставят место **и размер**, чипы «Стандарты Pinhead» над холстом, режим «Как на изделии», проверки под холстом и статус у каждого нанесения, цвет ткани чипами, строка итога; копия нанесения на другой вид (рукав — зеркально) и Ctrl+D / Ctrl+C / Ctrl+V слоя.

**Architecture:** чистые функции — в `geometry/view.ts` (размеры пресетов) и `ui/panel/panelOps.ts` (копия на вид, вставка слоя); новые экранные части — **один ленивый чанк** `ui/stage/StageParts.jsx` (несколько `React.lazy` от одного модуля), холст получает только флаг режима и две клавиши. Запись — по-прежнему только `useDesignStore.commit` → `useSalesStore.edit`, одна позиция; открытие ничего не пишет.

**Tech Stack:** React 19, konva (холст), Zustand (`useDesignStore`), Vitest + Testing Library.

**Spec:** `docs/superpowers/plans/2026-10-26-order-flow-m5c-design-studio.md` (разделы «Э2» и «Визуал»; прототип `Final.dc.html` в артефакте «Дизайн 2.0 — варианты А и Б»).

## Что уже есть (сверка с кодом 26.10) — не делать заново

- Магнит центра к оси изделия, именованным осям и центру зоны ±5 мм с гайдами (`canvasMath.snapCenter`, `SnapGuides`).
- Выноска отступов до краёв и от горловины, плашка Ш×В у выбранного (`DimensionOverlay`).
- Клавиши: стрелки 1 / 10 мм, Delete — снять, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Esc, масштаб (`useCanvasKeys`).
- Дубль слоя (`duplicateLayer`), пресеты положения (`presetsFor`, `withPreset`), проверка макета (`PreflightList`).

## Global Constraints

- Холст ≤ 100 000 Б gzip (сейчас 99 029): в чанк холста — только флаг режима в `EditorCanvas`, клавиши `duplicate`/`copy` в `keyAction` и поле `display` в сторе. Всё прочее — ленивые чанки (`StageParts`, `DesignSide`).
- Панель «Дизайн» — потолок 6 600 (замер 6 235); `StageParts` — свой потолок по замеру + 10 % в `bundle-budget-limits.mjs`.
- ERP заморожен; сторожа `designGuards`, `assetGuards`, `pdfGuards`, `pricingParity`, `sceneGolden` зелёные.
- Флаг `designStudio` (`config/features.ts`, по умолчанию **включён**, `VITE_FEATURE_DESIGN_STUDIO=0` или `?design2=0` — прежний вид): гасит только новые точки входа (чипы, режим, проверки под холстом, цвет ткани, строка итога, «На другой вид»). Ключ классифицирован в `lib/storage.ts` (`KEEP_ON_LOGOUT`, как `styleguide`).
- Тексты — русские, с позиции пользователя; статус — текстом и знаком, не только цветом; тач-цели ≥ 44 px; блок по условию — `aria-disabled` с причиной.
- «Лого везде» (во все позиции заказа) **не в Э2**: запись нескольких позиций одной правкой ломает правило «одна позиция — одна история undo»; переносится в Э8 («Мои раскладки» применяет раскладку к позиции).
- META-поле `preset` у зоны **не вводится**: размеры пресетов — константы `STANDARD_PLACEMENT` (решение «константы в коде»); поле в справочнике — когда технолог попросит разные размеры по моделям.

## Review Focus

1. Макет без размеров (только что добавлен, Ш×В из файла) — пресет ставит ширину стандарта, высоту — по пропорции файла; поворот 90° учитывается (рамка, не сырые Ш×В).
2. Пресет на зоне меньше стандарта (детская футболка, узкий рукав) — ширина ужимается до зоны минус безопасный отступ, без выхода за зону.
3. Копия на вид, которого нет у силуэта, или в зону, запрещённую моделью (`areaAllowed`), — кнопка не предлагает этот вид.
4. Ctrl+V с файлом в буфере — по-прежнему добавляет макет (файл важнее слоя); Ctrl+C / Ctrl+V в поле ввода — не перехватываются.
5. Режим «Как на изделии» и только чтение — переключение режима ничего не пишет в заказ и работает у не-черновика.

---

### Task 1: Пресеты ставят место и размер; пресет рукава

**Files:**
- Modify: `pinhead-react/src/orderstudio/design/geometry/view.ts` (`STANDARD_PLACEMENT` + ширины, `presetSize`, пресет `sleeve-standard`)
- Modify: `pinhead-react/src/orderstudio/design/ui/panel/panelOps.ts` (`withPreset` — размер + место, `presetsFor` — рукав, подпись с размером)
- Test: `design/geometry/view.test.ts`, `design/ui/panel/panelOps.test.ts`

**Interfaces:**
- Produces: `STANDARD_PLACEMENT.widthMm: Record<'chest-standard'|'left-chest'|'back-standard'|'sleeve-standard', number>` = 250 / 90 / 300 / 70; `presetSize(view, area, pl, preset): { width_mm, height_mm }`; `PresetOption.hint: string` («250 мм, 75 мм от горловины»).

- [ ] **Step 1: Тесты.** `withPreset(front, chest, pl 120×80, 'chest-standard')` → `width_mm 250`, `height_mm ≈ 167` (пропорция), центр по оси, верх на 75 мм от горловины; `'center-zone'` — размер не меняет; зона уже 250 → ширина = ширина зоны − 2 × safe_inset; повёрнутое на 90° — по рамке; `presetsFor(sleeve)` → `['sleeve-standard', 'center-zone']`, подсказка «70 мм по оси рукава».
- [ ] **Step 2: FAIL → реализация → PASS** (`npx vitest run src/orderstudio/design/geometry src/orderstudio/design/ui/panel`).
- [ ] **Step 3: Commit** — `feat(design): пресеты ставят размер стандарта, пресет рукава`.

### Task 2: Флаг `designStudio` и ленивый чанк частей сцены

**Files:**
- Modify: `pinhead-react/src/config/features.ts`, `pinhead-react/src/lib/storage.ts` (классификация ключа)
- Create: `pinhead-react/src/orderstudio/design/ui/stage/StageParts.jsx` (экспорты `PresetChips`, `CanvasChecks`, `FabricChips`, `ItemTotalBar`), `ui/stage/stage.module.css`
- Modify: `pinhead-react/src/orderstudio/design/ui/DesignTab.jsx` (полосы над и под холстом через `React.lazy` от одного модуля), `scripts/bundle-budget-limits.mjs` + `scripts/bundle-budget.mjs` (чанк «Части сцены»)
- Test: `config/features.test.ts`, `lib/storage.test.ts` (сторож классификации), `design/ui/stage/StageParts.test.jsx`, `design/ui/DesignTab.test.jsx`

**Interfaces:**
- Produces: `isFeatureEnabled('designStudio')`; `<PresetChips d entry />`, `<CanvasChecks d item />`, `<FabricChips item suppliers value onChange />`, `<ItemTotalBar item price />`.

- [ ] **Step 1: Тесты.** Флаг: по умолчанию `true`, `?design2=0` и env `'0'` — `false`; ключ `pinhead_feature_designStudio` классифицирован. `DesignTab`: при выключенном флаге разметка как сейчас (нет `region` «Стандарты Pinhead»), при включённом — есть.
- [ ] **Step 2: FAIL → реализация → PASS.** Пока части — заглушки с разметкой (наполнение — задачи 3–5).
- [ ] **Step 3:** `npm run build && npm run bundle:budget` — холст не вырос больше чем на 300 Б; потолок «Частей сцены» — замер + 10 %.
- [ ] **Step 4: Commit** — `feat(design): флаг designStudio и ленивые части сцены`.

### Task 3: «Стандарты Pinhead» над холстом

**Files:** `ui/stage/StageParts.jsx` (`PresetChips`), тесты `StageParts.test.jsx`, `DesignTab.test.jsx`

- [ ] **Step 1: Тесты.** Чипы — пресеты текущего вида (`presetsFor`) с подсказкой размера; без выбранного нанесения — `aria-disabled` и причина «Выберите нанесение на холсте»; клик по чипу у выбранного → один шаг истории «Пресет: Центр груди», `width_mm` = 250; только чтение — чипов нет. Группа — `role="group"` с `aria-label="Стандарты Pinhead"`.
- [ ] **Step 2: FAIL → реализация → PASS.** Кнопки пресетов в `GeometryInspector` остаются при выключенном флаге, при включённом — убираются (одна точка входа).
- [ ] **Step 3: Commit** — `feat(design): «Стандарты Pinhead» — пресеты чипами над холстом`.

### Task 4: Проверки под холстом, статус у нанесения, режим «Как на изделии», цвет ткани

**Files:**
- Modify: `ui/stage/StageParts.jsx` (`CanvasChecks`, `FabricChips`), `ui/panel/LayerRow.jsx` (статус), `ui/panel/DesignSide.jsx` (при флаге — без `PreflightList`), `ui/canvas/EditorCanvas.jsx` (проп `display`), `store/useDesignStore.ts` (`display: 'markup' | 'garment'`, `setDisplay`; `fabricRow`), `ui/useDesignTab.js` (`colorHex` по выбранной строке цвета)
- Create: `ui/panel/printStatus.ts` (`printStatus(issues, key): 'ok' | 'check' | 'error'`)
- Test: `printStatus.test.ts`, `StageParts.test.jsx`, `EditorCanvas.test.jsx`, `useDesignStore.test.ts`, `garmentHex.test.ts`

- [ ] **Step 1: Тесты.** `CanvasChecks` — живой регион `aria-live="polite"`, те же замечания, что `preflight`, «Показать» выбирает нанесение; пусто — «Замечаний нет». Статус строки слоя: serious → «✕ ошибка», warn → «! проверить», иначе «✓ готово» — текстом. Режим: переключатель «Разметка / Как на изделии» (`aria-pressed`), в режиме изделия холст без зон, осей, сетки и выноски (`EditorCanvas` не рисует `ZoneShapes`/`NamedAxes`/`GridLines`/`DimensionOverlay`), выбор и перетаскивание работают; режим не пишет в заказ и работает при только чтении. Цвет ткани: чипы по строкам `size_grid` с названием, выбранный — `aria-pressed`, `garmentHexOf(item, suppliers, null, row)` берёт цвет строки; смена позиции сбрасывает строку на первую.
- [ ] **Step 2: FAIL → реализация → PASS** (`npx vitest run src/orderstudio/design`).
- [ ] **Step 3:** `npm run build && npm run bundle:budget` — холст ≤ 100 000.
- [ ] **Step 4: Commit** — `feat(design): проверки под холстом, статус нанесения, режим «Как на изделии», цвет ткани`.

### Task 5: Строка итога позиции

**Files:** `ui/stage/StageParts.jsx` (`ItemTotalBar`), `ui/stage/stage.module.css`, `ui/DesignTab.jsx`; тест `StageParts.test.jsx`

- [ ] **Step 1: Тесты.** «2 нанесения · 545 ₽/шт · 27 250 ₽ за позицию» из `price` (`calc_unit` × тираж позиции); нет цены — «Цена не посчитана»; кнопка «Далее: ТЗ и цена» ведёт на `?tab=summary` (`onOpenSummary`); «PDF макета» остаётся в шапке (одна точка). Липкая только на ≥ 761 px (CSS).
- [ ] **Step 2: FAIL → реализация → PASS.**
- [ ] **Step 3: Commit** — `feat(design): строка итога позиции под холстом`.

### Task 6: Копия нанесения на другой вид; Ctrl+D, Ctrl+C / Ctrl+V слоя

**Files:**
- Modify: `ui/panel/panelOps.ts` (`copyToView`, `pasteLayer`), `ui/panel/DesignSide.jsx` или `LayerRow.jsx` (меню «На другой вид»), `ui/canvas/useCanvasKeys.ts` (`duplicate`, `copy`), `ui/canvas/EditorCanvas.jsx` (`paste` без файла → слой), `store/useDesignStore.ts` (`clipboard`)
- Test: `panelOps.test.ts`, `useCanvasKeys.test.ts`, `EditorCanvas.test.jsx`, `DesignTab.test.jsx`

**Interfaces:**
- Produces: `copyToView(prints, key, target: DesignView, ctx): { prints, key } | null` — новая строка (новый ключ) с той же техникой, файлом и размером; место — по зоне того же `zone_id` на целевом виде, иначе по центру первой разрешённой зоны вида; рукав ↔ рукав — зеркально относительно оси рукава (`x' = 2·axis − x − w`, `flip_h` не меняется — рисунок не отражается). `pasteLayer(prints, copied: SalesPrint, view, ctx)`.

- [ ] **Step 1: Тесты.** Логотип на левом рукаве → копия на правом: тот же размер, зеркальное место, новый ключ, одна запись истории «Копия на вид»; вид без силуэта или без разрешённой зоны — не предлагается; Ctrl+D → `duplicate` (только при выборе, не в только чтении); Ctrl+C → `copy` (в сторе — копия строки без ключа); `paste` без файлов при непустом буфере слоя → вставка на текущий вид; `paste` с файлом — макет, как раньше; в полях ввода клавиши не перехватываются (Review Focus 4).
- [ ] **Step 2: FAIL → реализация → PASS** (`npx vitest run src/orderstudio/design`).
- [ ] **Step 3:** `npm run build && npm run bundle:budget`.
- [ ] **Step 4: Commit** — `feat(design): копия нанесения на другой вид (рукав зеркально), Ctrl+D и Ctrl+C/V слоя`.

### Task 7: Проверка ветки и документы

- [ ] **Step 1:** `cd pinhead-react && npm run lint && npm run typecheck && npx vitest run --maxWorkers=3 && npm run build && npm run bundle:budget`.
- [ ] **Step 2:** Обход в браузере (dev, 1440 / 1100 / 390): чипы, режим, проверки, цвет ткани, итог, копия на рукав; axe по вкладке.
- [ ] **Step 3:** Документы: `design/README.md` («Замеры Э2»), правило в `docs/rules/pravila-dizain-veha-5v-e1-26-10.md` (раздел Э2), `docs/changelog/2026-10.md`, `SESSION-STATE.md`.
- [ ] **Step 4: Commit + push** — `docs: веха 5в Э2 — замеры, правила, журнал`.
