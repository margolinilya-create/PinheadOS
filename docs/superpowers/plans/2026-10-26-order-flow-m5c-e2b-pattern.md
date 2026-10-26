# Веха 5в, этап Э2б «Выкройка в 2D» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** лекала конструктора (DXF/SVG) привязываются к флэту в админке «Флэты и зоны», а вкладка «Дизайн» показывает все детали кроя позиции на одном листе в натуральную величину с нанесениями, зонами и линейкой. 3D отложено решением владельца.

**Architecture:** деталь = вид флэта (`front/back/sleeve_left/sleeve_right`). К виду добавляется GEOMETRY-поле `pattern` — контур детали **в той же системе мм, что и вид** (выравнивается при импорте), поэтому раскладка v1, цена, ТЗ и отступы не меняются: лист выкройки рисует контуры вместо рисунка флэта, а нанесения — по тем же `x_mm/y_mm`. Непечатные детали (капюшон, карман, манжета) — **в Э9** вместе с видами капюшона и кармана: поле уровня флэта потребовало бы своей записи в `history[]` (сервер при смене версии сверяет только `views` записи). Разбор файлов — чистое ядро `design/edit/pattern/` без зависимостей. Лист — SVG-строка через `sanitizeSvg` в `<img>` (как превью телефона), ленивым чанком, без konva.

**Tech Stack:** TypeScript, React 19, `zod/mini` (схема флэтов), Vitest.

**Spec:** `docs/superpowers/plans/2026-10-26-order-flow-m5c-design-studio.md` («Э2б»; прототип — артефакт «Принт в 2D и 3D», 2D-часть).

## Global Constraints

- **Миграции нет:** серверная проверка формы `garmentFlats` (миграция I, `catalog_value_check`) сверяет известные поля и лишние ключи вида не отвергает; триггер-страж истории сравнивает jsonb целиком — новое поле ложится в историю как есть. Проверить пробой формы `supabase/probes/flats_admin.sql` логикой (без боя): лишний ключ вида не даёт `22023`.
- **Размер справочника:** 1 МБ на всё `garmentFlats` с историей. Контур упрощается (Дуглас — Пекер, допуск 0,3 мм), не больше 400 точек на деталь, координаты — до 0,1 мм; предупреждение — существующее `catalogBytes` (80 % от 1 МБ), отказ — до записи.
- `pattern` — GEOMETRY вида (`GEOMETRY_KEYS.view` в `flatVersion.ts`): правка — новая версия флэта, прежний вид с лекалом — в `history[]` (сервер сверяет `ne->'views' = o->'views'` — поле внутри вида проходит); сторож классификации ключей схемы зелёный. `z.object` отбрасывает неизвестные ключи — поле обязано быть в `viewSchema`, иначе лекала теряются при чтении.
- Сохранение — только `admin/flats/saveFlat.ts` (файлы видов → справочник); лекала файлом в бакет не пишутся (контур — в справочнике).
- `design/edit/**` — без React, `api/`, стора, тостов (сторож `designGuards`); разбор DXF/SVG — без новой зависимости и без `innerHTML` (SVG — `DOMParser`).
- Чанк холста ≤ 100 000 (сейчас 98 946): лист выкройки — свой ленивый чанк; в холст — только кнопка режима (в ленивых частях сцены).
- Без лекал вкладка работает как сейчас; режим «Выкройка» не предлагается.

## Review Focus

1. DXF в дюймах или сантиметрах (`$INSUNITS` 1 / 5 / 4) и без единиц — мм считаются верно; без единиц — выбор единиц человеком, по умолчанию мм.
2. DXF AAMA: деталь — блок (`BLOCK` + `INSERT`), контур — полилиния слоя 1; внутренние линии (насечки, линия долевой) не становятся деталями.
3. Незамкнутый контур из отрезков `LINE` — собирается в цепочку по совпадению концов (допуск 0,01 мм); не замкнулся — деталь не предлагается, причина текстом.
4. SVG с `transform` на группах и с кривыми (`C`, `Q`, `A`) — контур в мм с учётом `viewBox` и единиц (`mm`, `cm`, `in`, `px` = 1/96").
5. Справочник у границы 1 МБ — сохранение отказывает до записи с понятной причиной, флэт не портится.

---

### Task 1: Данные — поле лекала у вида и непечатные детали

**Files:** `design/types.ts`, `design/catalog/flatsSchema.ts`, `design/catalog/flatVersion.ts` (`GEOMETRY_KEYS.view` + `pattern`), тесты `flatsSchema.test.ts`, `flatVersion.test.ts`.

**Interfaces:** `PatternPiece = { contour_mm: [number, number][]; count: number }`; `FlatView.pattern?: PatternPiece`.

- [ ] **Step 1: Тесты.** Схема: контур 3…400 точек, координаты конечные в ±3000 мм, `count` 1…8; лишнее — ошибка с путём; правка `pattern` → `geometryChanged` = true (новая версия), прежний `pattern` — в `history[]`; `flatAtVersion(flat, 1)` отдаёт лекало версии 1.
- [ ] **Step 2: FAIL → реализация → PASS** (`npx vitest run src/orderstudio/design/catalog`).
- [ ] **Step 3: Commit** — `feat(flats): лекала деталей в справочнике флэтов (GEOMETRY)`.

### Task 2: Разбор DXF и SVG — чистое ядро

**Files:** `design/edit/pattern/dxf.ts`, `svgContours.ts`, `simplify.ts`, `importPattern.ts` + тесты и фикстуры `design/edit/pattern/fixtures/*.dxf|svg` (маленькие, рукописные).

**Interfaces:** `parseDxf(text): { units: 'mm'|'cm'|'in'|null; pieces: RawPiece[] }`; `parseSvgContours(doc: Document): RawPiece[]` (мм); `RawPiece = { name: string; contour: [number, number][]; closed: boolean; reason?: string }`; `simplify(points, tolMm)`; `toPatternPieces(raw, units)`.

- [ ] **Step 1: Тесты** по Review Focus 1–4: DXF в мм / дюймах / без единиц; AAMA-блоки с `INSERT` (смещение и масштаб вставки); `LWPOLYLINE` с `bulge` (дуга — отрезками); цепочка `LINE`; внутренние линии — не детали; SVG: `path` (M/L/H/V/C/Q/A/Z, относительные), `polygon`, `rect`, `transform`, единицы `viewBox`.
- [ ] **Step 2: FAIL → реализация → PASS** (`npx vitest run src/orderstudio/design/edit`).
- [ ] **Step 3: Commit** — `feat(flats): разбор лекал DXF и SVG без зависимостей`.

### Task 3: Импорт лекал в админке флэта

**Files:** `admin/flats/PatternImport.jsx` (ленивый, внутри `FlatEditor`), `admin/flats/patternAlign.ts` (+ тест), `admin/flats/useFlatEditor.ts` (правка `pattern`), `admin/flats/FlatEditor.jsx`.

**Interfaces:** `alignToView(piece, view): PatternPiece` — перед/спина: ось детали (середина рамки) — на `center_axis_x`, верх — на `neckline_point.y`; рукав: ось — на `sleeve_center_x`, низ — на `sleeve_bottom_y`; затем ручной сдвиг `dx/dy` мм.

- [ ] **Step 1: Тесты.** Файл → список деталей с размерами «56 × 72 см»; роль у каждой: «Перед / Спина / Рукав левый / Рукав правый / Не брать» (виды, которых у флэта нет, не предлагаются; непечатные детали — Э9), кол-во в крое; единицы файла — из файла, иначе выбор; выравнивание по якорям; две детали на одну роль — ошибка; «Сохранить» → `saveFlat` → новая версия; файл > 2 МБ или без деталей — причина текстом; на ≤ 760 px — только просмотр.
- [ ] **Step 2: FAIL → реализация → PASS** (`npx vitest run src/orderstudio/admin/flats`).
- [ ] **Step 3: Commit** — `feat(flats): импорт лекал конструктора в редактор флэта`.

### Task 4: Лист «Выкройка» на вкладке «Дизайн»

**Files:** `design/export/buildPatternSvg.ts` (+ тест-снимок), `design/ui/stage/PatternSheet.jsx` (ленивый), `ui/stage/StageParts.jsx` (третья кнопка «Выкройка» в «Вид холста», только если у флэта есть лекала), `ui/DesignTab.jsx` (в режиме «Выкройка» вместо холста — лист), бюджет «Лист выкройки».

**Interfaces:** `buildPatternSvg({ pieces: { view, placements, images }[], colorHex }): string` — детали в ряд с зазором 40 мм, контур детали заливкой цвета ткани, зоны пунктиром, нанесения по клипу зоны, подпись «Перед · 56 × 72 см · крой: 1», линейка 10 см; итог — `sanitizeSvg(…, 'scene')`.

- [ ] **Step 1: Тесты.** Снимок строки листа на фикстуре (2 детали, 1 нанесение); нет лекал — кнопки «Выкройка» нет; лист — `<img alt="Выкройка: перед, спина, рукава; нанесений N">`; под листом — кнопки «Править: Перед» (переключают в «Разметку» на этот вид); открытие ничего не пишет.
- [ ] **Step 2: FAIL → реализация → PASS**; `npm run build && npm run bundle:budget` — холст ≤ 100 000, «Лист выкройки» — потолок по замеру + 10 %.
- [ ] **Step 3: Commit** — `feat(design): лист «Выкройка» — детали кроя с нанесениями в 2D`.

### Task 5: Проверка ветки и документы

- [ ] `npm run lint && npm run typecheck && npx vitest run --maxWorkers=3 && npm run build && npm run bundle:budget`; e2e вкладки «Дизайн» и «Флэты и зоны»; документы (`design/README.md`, правило вехи 5в — раздел Э2б, журнал, `SESSION-STATE.md`); commit + push.
