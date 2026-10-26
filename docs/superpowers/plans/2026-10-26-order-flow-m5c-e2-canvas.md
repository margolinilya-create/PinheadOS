# Веха 5в, этап Э2 «Холст 2.0» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вкладка «Дизайн» по выбранному гибриду «А + лучшее из Б»: пресеты ставят место **и размер**, чипы «Стандарты Pinhead» над холстом, режим «Как на изделии», проверки под холстом и статус у каждого нанесения, цвет ткани чипами, строка итога; копия нанесения на другой вид (рукав — зеркально), Ctrl+D и копирование слоя.

**Architecture:** чистые функции — в модулях, которые импортируют **только ленивые чанки** (`ui/panel/presetOps.ts`, `ui/panel/copyOps.ts`); экранные части — один ленивый модуль `ui/stage/StageParts.jsx` (две обёртки `Suspense`: над холстом и под ним). В чанк холста — только проп режима у `EditorCanvas`, проп `onDuplicate` и поля стора. Запись — только `useDesignStore.commit` → `useSalesStore.edit`, одна позиция; открытие ничего не пишет.

**Tech Stack:** React 19, konva, Zustand (`useDesignStore`), Vitest + Testing Library.

**Spec:** `docs/superpowers/plans/2026-10-26-order-flow-m5c-design-studio.md` («Э2», «Визуал»); прототип `Final.dc.html` (артефакт «Дизайн 2.0 — варианты А и Б»). Ревью плана — 26.10, находки внесены ниже.

## Уже есть — не делать заново

- Магнит центра к оси, именованным осям и центру зоны ±5 мм с гайдами (`canvasMath.snapCenter`, `SnapGuides`); выноска отступов и плашка Ш×В (`DimensionOverlay`); клавиши стрелок, Delete, Ctrl+Z/Y, Esc, масштаб (`useCanvasKeys`); дубль слоя (`duplicateLayer`).
- **Сделано в коммите `51d7a57` + правка ревью:** флаг `designStudio` (`config/features.ts`, по умолчанию включён, `?design2=0` / `VITE_FEATURE_DESIGN_STUDIO=0` — прежний вид; ключ в `KEEP_ON_LOGOUT`); поля стора `display: 'markup' | 'garment'`, `fabricColor: string | null` (подпись цвета строки сетки; смена позиции сбрасывает), `clipboard: SalesPrint | null` (только в пределах заказа); `ui/panel/presetOps.ts` — `PRESET_WIDTH_MM` (250 / 90 / 300 / 70), `studioPresets(view, area)` с `hint`, `withStudioPreset(view, area, pl, preset)`: ширина по видимой рамке, не больше зоны минус отступ (и по высоте), отступ — `withVerticalOffset`/`withHorizontalOffset` (с поворотом), прижим внутрь зоны (сверху — по самой зоне, как правило края Э1), рукав — по центру зоны и оси рукава.

## Global Constraints

- **Чанк холста ≤ 100 000 Б gzip (сейчас 99 029).** `panelOps.ts` статически в холсте (`ViewTabs`, `useDesignTab`): новые функции туда **не класть**; `presetOps`/`copyOps` импортируют только `DesignSide`, `GeometryInspector`, `StageParts`. `DesignTab` не импортирует из `ui/stage/` ничего, кроме `import()`. Вставка слоя — обработчик грузит `copyOps` через `import()` по событию.
- `npm run bundle:budget` — в каждой задаче, которая трогает `DesignTab`, `EditorCanvas`, `useDesignTab` или стор. «Части сцены» меряются минус холст, картинки и панель; потолок — замер + 10 %; потолок панели пересматривается своим замером (общий `preflight` уйдёт в общий чанк).
- ERP заморожен; сторожа `designGuards`, `assetGuards`, `pdfGuards`, `pricingParity`, `sceneGolden`, `a11yGuards` зелёные. Селекторы стора по объектам — `useShallow`. Текст для читалки — `.srOnly` из `orderstudio/ui/a11y.module.css`.
- **Защита Э1 «силуэт другой модели» распространяется на всё новое:** при `pick.modelChanged` вставка слоя и «На другой вид» заблокированы так же, как добавление макета (`aria-disabled` + причина, тост на вставку).
- **Ctrl+V в `keyAction` не добавлять:** `preventDefault` на keydown гасит событие `paste`, вставка файла пропадёт. Файл в буфере всегда важнее слоя.
- `garmentHexOf` читают PDF макета и ТЗ (`tz/pdf/tzImages.ts`, хэш ТЗ): новый параметр цвета — необязательный, ТЗ и PDF его не передают (PDF макета — по первой строке, как сейчас).
- При выключенном флаге — прежний вид целиком: режим принудительно `markup`, кнопки пресетов в инспекторе, `PreflightList` в панели.

## Осознанные отступления от спеки (решено контроллером 26.10)

- META-поле `preset` у зоны не вводится: размеры — константы `PRESET_WIDTH_MM`; поле в справочнике — когда технолог попросит разные размеры по моделям.
- «Мягкие складки» в режиме «Как на изделии» — нет (вес холста); основа мокапов — Э5.
- «+N дн.» в строке итога — нет: сроки по технике появятся с КП (Э6).
- Магнит к краям безопасной зоны — нет (есть к осям и центру зоны; края — предупреждение Э1).
- «Лого везде» (во все позиции заказа) — Э8: правка нескольких позиций одной записью ломает историю undo одной позиции.
- «Далее: ТЗ и цена» в строке итога — нет: под вкладкой уже есть «Далее: клиент и доставка» (`OrderWorkplace.jsx`), вторая кнопка «Далее» запутает. Строка итога — без кнопки перехода.

## Review Focus

1. Повёрнутое нанесение — пресет по видимой рамке; рамка выше зоны — ужатие (тесты `presetOps`).
2. Копия рукав ↔ рукав: зоны `sleeve-l` ↔ `sleeve-r` разные; зеркало относительно осей ОБОИХ рукавов.
3. Ctrl+C текста в другом окне после Ctrl+C слоя — Ctrl+V не вставляет старый слой (метка в `clipboardData`).
4. Режим «Как на изделии» и только чтение — ничего не пишет, гайды магнита тоже скрыты.
5. Общее замечание без `printKey` (`MSG_MODEL_MISMATCH`) — строки слоёв не показывают «✓ готово».

---

### Task 1: Части сцены — ленивый модуль и «Стандарты Pinhead» над холстом

**Files:**
- Create: `design/ui/stage/StageParts.jsx` (именованные `StageTop`, `StageBelow`, `ItemTotalBar`), `design/ui/stage/stage.module.css`, `design/ui/stage/StageParts.test.jsx`
- Modify: `design/ui/DesignTab.jsx` (две обёртки: `lazy(() => import('./stage/StageParts').then((m) => ({ default: m.StageTop })))` и то же для `StageBelow`; заглушки той же высоты, как `SIDE_FALLBACK`), `design/ui/useDesignTab.js` (`studio = isFeatureEnabled('designStudio')` один раз), `design/ui/panel/GeometryInspector.jsx` (кнопки пресетов — только без флага), `scripts/bundle-budget-limits.mjs` + `scripts/bundle-budget.mjs` (чанк «Части сцены»)
- Test: `StageParts.test.jsx`, `DesignTab.test.jsx`

- [ ] **Step 1: Тесты.** Флаг выключен — нет группы «Стандарты Pinhead», кнопки пресетов в инспекторе есть. Флаг включён — `role="group"` `aria-label="Стандарты Pinhead"` над холстом, чипы — `studioPresets` выбранного вида; без выбора — зона по умолчанию вида (`defaultAreaId`), чипы `aria-disabled`, причина «Выберите нанесение на холсте» через `aria-describedby`; подсказка размера — тоже в `aria-describedby`, не в имени; клик у выбранного → один шаг истории с подписью «Центр груди (стандарт)», `width_mm` = 250; только чтение — чипов нет.
- [ ] **Step 2: FAIL → реализация → PASS** (`npx vitest run src/orderstudio/design`).
- [ ] **Step 3:** `npm run build && npm run bundle:budget` — холст +≤ 300 Б.
- [ ] **Step 4: Commit** — `feat(design): «Стандарты Pinhead» — пресеты с размером чипами над холстом`.

### Task 2: Проверки под холстом и статус нанесения

**Files:** `ui/stage/StageParts.jsx` (`StageBelow` — проверки), `ui/panel/printStatus.ts` (create), `ui/panel/LayerRow.jsx`, `ui/panel/DesignSide.jsx`; тесты `printStatus.test.ts`, `StageParts.test.jsx`, `DesignTab.test.jsx`

**Interfaces:** `printStatus(issues: PreflightIssue[], key: string): 'ok' | 'check' | 'fix'` — `serious` у нанесения или общее `serious` без `printKey` → `fix`; `warn` → `check`; `info` и пусто → `ok`.

- [ ] **Step 1: Тесты.** Проверки под холстом — те же замечания, что `preflight` (подписи «Серьёзно / Внимание / Подсказка»), «Показать» выбирает нанесение (сначала `setView`, потом `select`); живой регион — только короткая сводка («2 замечания», `role="status"`), список — без `aria-live`; пусто — «Замечаний нет». Строка слоя: «Исправить» / «Проверить» / «Готово» текстом, знак ✕ / ! / ✓ — `aria-hidden`; общий MSG_MODEL_MISMATCH даёт «Исправить» всем строкам. При флаге панель без `PreflightList`.
- [ ] **Step 2: FAIL → реализация → PASS.**
- [ ] **Step 3:** `npm run build && npm run bundle:budget`.
- [ ] **Step 4: Commit** — `feat(design): проверки под холстом, статус у каждого нанесения`.

### Task 3: Режим «Как на изделии» и цвет ткани

**Files:** `ui/stage/StageParts.jsx` (переключатель в `StageTop`, чипы цвета в `StageBelow`), `ui/canvas/EditorCanvas.jsx` (проп `display`: в `garment` не рисовать `ZoneShapes`, `NamedAxes`, `GridLines`, `DimensionOverlay`, `SnapGuides`, строку зоны `styles.status`; режим — в `canvasLabel`), `ui/DesignTab.jsx` (проп из стора, без флага — `markup`), `assets/garmentHex.ts` (необязательный `color`), `ui/useDesignTab.js` (`colorHex` по `fabricColor`)
- Test: `EditorCanvas.test.jsx`, `StageParts.test.jsx`, `assets/flatImages.test.ts` (там тесты `garmentHexOf`)

- [ ] **Step 1: Тесты.** Переключатель: `role="group"` «Вид холста», две кнопки «Разметка» и «Как на изделии» с неизменным текстом и `aria-pressed`; работает при только чтении, в заказ не пишет. Холст в `garment`: нет зон, осей, сетки, выноски и гайдов; выбор и перетаскивание работают; `aria-label` холста называет режим. Цвет ткани: группа «Показать на цвете», чипы по уникальным непустым цветам сетки (ключ — подпись), `aria-pressed`; `garmentHexOf(item, suppliers, null, 'Чёрный (15-01)')` — hex этой строки, без параметра — как раньше (ТЗ и PDF не меняются).
- [ ] **Step 2: FAIL → реализация → PASS.**
- [ ] **Step 3:** `npm run build && npm run bundle:budget` — холст ≤ 100 000.
- [ ] **Step 4: Commit** — `feat(design): режим «Как на изделии» и цвет ткани чипами`.

### Task 4: Строка итога позиции

**Files:** `ui/stage/StageParts.jsx` (`ItemTotalBar`), `stage.module.css`, `ui/DesignTab.jsx`; тест `StageParts.test.jsx`

- [ ] **Step 1: Тесты.** «2 нанесения · 545 ₽/шт · 27 250 ₽ за позицию» — `price.unit` и `price.total` (с ручной ценой совпадает с «ТЗ и цена»), склонение — `pluralize`; нет цены — «Цена не посчитана». Липкая только на ≥ 761 px.
- [ ] **Step 2: FAIL → реализация → PASS.**
- [ ] **Step 3:** `npm run bundle:budget`.
- [ ] **Step 4: Commit** — `feat(design): строка итога позиции под холстом`.

### Task 5: Копия на другой вид, Ctrl+D, копирование слоя

**Files:**
- Create: `design/ui/panel/copyOps.ts` (`copyToView`, `pasteLayer`, `copyTargets`), `design/catalog/sleeveZones.ts` (`SWAP_ZONE` из `edit/mirrorSleeve.ts` — лёгкий общий модуль; `mirrorSleeve` импортирует его оттуда)
- Modify: `ui/panel/LayerRow.jsx` или `DesignSide.jsx` (меню «На другой вид»), `ui/canvas/useCanvasKeys.ts` (`duplicate` — Ctrl+D по `code` `KeyD`), `ui/canvas/EditorCanvas.jsx` (проп `onDuplicate`; `onCopy`/`onPaste` контейнера — `import('../panel/copyOps')` по событию), `ui/useDesignTab.js` (блок при `modelChanged`)
- Test: `copyOps.test.ts`, `useCanvasKeys.test.ts`, `EditorCanvas.test.jsx`, `DesignTab.test.jsx`

**Interfaces:**
- `copyToView(prints, key, target: DesignView, ctx): { prints, key } | null` — новая строка (новый ключ), та же техника, файл, размер; зона — `SWAP_ZONE[zone_id]` для рукавов, иначе тот же `zone_id`, иначе первая разрешённая (`areaAllowed`) зона вида. Рукав ↔ рукав: `x' = axisS + axisT − x − w`, `y' = y + (bottomT − bottomS)`, поворот `(360 − θ) mod 360`, `flip_h` не меняется (рисунок не отражается).
- `copyTargets(pl, ctx): DesignView[]` — виды силуэта, кроме текущего, где есть разрешённая зона.
- Копирование: `onCopy` при выбранном слое пишет в `clipboardData` метку `application/x-pinhead-print` (ключ заказа + ключ строки) и кладёт строку в `useDesignStore.clipboard`; `onPaste`: есть файл → макет (как раньше); иначе метка совпала с буфером → `pasteLayer` на текущий вид (другой флэт — через `remapToFlat`); иначе — ничего. Поля ввода (`input`, `textarea`, `select`) не перехватываются.

- [ ] **Step 1: Тесты.** Левый рукав → правый: зеркальное место по осям обоих рукавов, тот же размер, зона `sleeve-r`, одна запись истории «Копия на вид»; вид без разрешённой зоны в `copyTargets` нет; Ctrl+D → дубль и выбор нового ключа (не в только чтении); Ctrl+C текста после слоя → Ctrl+V слой не вставляет; `paste` с файлом — макет; силуэт другой модели — «На другой вид» `aria-disabled` с причиной, вставка — тост; после копии — `setView` цели, затем `select` копии.
- [ ] **Step 2: FAIL → реализация → PASS** (`npx vitest run src/orderstudio/design`).
- [ ] **Step 3:** `npm run build && npm run bundle:budget`.
- [ ] **Step 4: Commit** — `feat(design): копия нанесения на другой вид (рукав зеркально), Ctrl+D и копирование слоя`.

### Task 6: Проверка ветки и документы

- [ ] **Step 1:** `cd pinhead-react && npm run lint && npm run typecheck && npx vitest run --maxWorkers=3 && npm run build && npm run bundle:budget`.
- [ ] **Step 2:** Обход в браузере (dev, 1440 / 1100 / 390): чипы, режим, проверки, цвет ткани, итог, копия на рукав; axe по вкладке.
- [ ] **Step 3:** Документы: `design/README.md` («Замеры Э2»), раздел Э2 в `docs/rules/pravila-dizain-veha-5v-e1-26-10.md`, `docs/changelog/2026-10.md`, `SESSION-STATE.md`.
- [ ] **Step 4: Commit + push** — `docs: веха 5в Э2 — замеры, правила, журнал`.
