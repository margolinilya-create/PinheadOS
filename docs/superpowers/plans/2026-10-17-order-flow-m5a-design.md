# Веха 5а единого потока: дизайн-мейкер во вкладке «Дизайн» (17.10)

## Context
Веха 5 единого потока (спека docs/superpowers/specs/2026-10-16-unified-order-flow-design.md). Владелец решил: 5а — холст во вкладке «Дизайн» + типовые флэты + логотипы + PDF макета; 5б — админка «Флэты и зоны». Флэты — бакет garment-flats + app_config.garmentFlats; виды только перед/спина; zod добавить, иконки и стили свои. Ниже — план агента-планировщика; раздел «Проверка плана» дописывается после проверки скиллами и агентом безопасности.

Этот план я собрал только чтением кода PH и дизайн-мейкера (DM). Пути и функции ниже сверены с репозиторием. Я запустил один раз `bundle-budget` на готовой `dist`. Результат: оболочка ERP 194382 / 195000, вход 151768 / 155000, CSS 15905 / 16000.

> **Для исполнителей:** обязательный скилл — `superpowers:subagent-driven-development` (или `executing-plans`). Шаги — чекбоксы `- [ ]`.

**Цель.** Менеджер открывает позицию заказа на вкладке «Дизайн». Там он видит флэт модели (точный или типовой), загружает логотип и ставит его в зону. Мм, зона, техника, отступ от горловины и файл макета сами попадают в нанесение позиции. Цену считает прежний `priceOrder`. По кнопке скачивается PDF макета по видам.

**Архитектура (коротко):**
- Новый модуль `src/orderstudio/design/` — один ленивый чанк холста. PDF-движок и pdfjs грузятся `import()` по действию.
- **Источник правды — заказ v4.** Холст ничего не хранит у себя. Размещения выводятся из `item.prints[].layout`, правка пишется через `useSalesStore.edit`. Локально хранятся только выбор, вид, масштаб и undo.
- Флэты:
  - SVG лежат в приватном бакете `garment-flats`;
  - метаданные — в `app_config.garmentFlats`, пишет `putCatalog`, только admin и director.
- Миграция H: бакет и политики, ключ `garmentFlats` в `catalog_put` и `catalog_value_check`, проверка формы `layout`, удаление перегрузки `sales_set_staff(uuid, boolean)`.

**Tech stack.** React 19.2.4, Zustand 5. Новые зависимости (точные версии — в задаче 0):
- `konva`, `react-konva` — холст;
- `jspdf`, `svg2pdf.js` — PDF макета;
- `pdfjs-dist` — логотипы PDF/AI;
- `zod` — проверка справочника флэтов.

Vitest + Testing Library, Playwright на моке.

**Spec:** `docs/superpowers/specs/2026-10-16-unified-order-flow-design.md` — строки 72, 74–75, 94, 114–126, 160, 180, 194–195, 243; таблица вех (веха 5 разделена на 5а и 5б).

---

## Решения владельца (окончательные)
1. Веха 5 разделена:
   - **5а** — холст во вкладке «Дизайн» рабочего места `/sales/:id`, типовые флэты, загрузка логотипов, PDF макета;
   - **5б** — админка «Флэты и зоны».

   Данные 5а сразу проектируются под 5б: версия флэта, `zone_id` и `tz_row` у зоны, точные флэты моделей.
2. Флэты — бакет `garment-flats` и справочник `app_config.garmentFlats`. Начальное наполнение — 67 SVG и 35 SKU из DM.
3. Виды — только перед и спина. Нанесения в зоны без вида (рукава, капюшон, штанины) остаются строкой `PrintRow`.
4. Зависимости:
   - `zod` разрешён;
   - konva, react-konva@19, jspdf, svg2pdf.js, pdfjs-dist одобрены 16.10;
   - стили — CSS-модули;
   - иконки — свой набор Order (ERP заморожен).

## Решения контроллера (предложение плана)

### 1. Как засеять флэты без service key — кнопка в админке
Выбран вариант кнопки в «Справочниках заказа»:
- SVG сида лежат в `src/orderstudio/design/seed/flats/*.svg` и подключаются через `import.meta.glob('./flats/*.svg', { query: '?raw', import: 'default' })` (лениво, по чанку на файл);
- рядом — `garmentFlats.seed.json`, уже в нашем формате;
- всё это грузится только в чанке кнопки «Загрузить типовые флэты» на новой вкладке `/order-settings?tab=flats`;
- кнопку видят admin и director, rop видит вкладку только для чтения.

Как работает кнопка:
1. Читает свежее значение `fetchCatalogKey('app_config', 'garmentFlats')`.
2. По каждому флэту, которого нет в справочнике, — `sanitizeSvg` и загрузка в бакет с `upsert: false`. Ответ «Duplicate» считается успехом: путь версионный, содержимое то же.
3. Последним шагом — `putCatalog('app_config', 'garmentFlats', merged, base)`. Справочник никогда не ссылается на файл, которого нет.
4. Повтор после частичного сбоя идемпотентен. Существующие флэты не перезаписываются — только дописываются недостающие.

Отвергнутые варианты:
- (а) SQL-миграция с SVG — Storage-объект SQL-ом не создать: байты живут вне Postgres;
- (б) Node-скрипт с service key — ещё один носитель ключа; против этого правила `storage-gc`;
- (в) ручная загрузка 67 файлов в панель плюс JSON в SQL Editor — ошибки руками и нет повторяемости;
- (г) SVG в `public/` — флэты стали бы публичными мимо приватного бакета и попали бы в кэш service worker.

### 2. Версионные пути флэтов
Путь — `flats/<flat_id>/v<N>/<view>.svg`, ASCII. Это расширение формы `flats/<id>/<view>.svg` из задания.
- Объект неизменяем: UPDATE в бакете запрещён restrictive-политикой.
- Новая версия флэта в 5б — новый путь.
- `layout` хранит `flat_version`. Старые PDF и заказы ссылаются на «свою» картинку (спека, строка 72).

### 3. Связь «нанесение = размещение»
Одно `SalesPrint` равно одному размещению.

**Стандартные поля** (их читают `priceOrder`, `tzToErpDraft`, будущее ТЗ):
- `zone` — название зоны из `zonesCatalog` по `PrintArea.zone_id`; без `zone_id` — `area.name`;
- `width_mm`, `height_mm` — целые;
- `method`;
- `artwork_path`;
- `offset_mm`, `offset_from`, `offset_dir`.

**`layout`** хранит только геометрию холста:
```ts
interface PrintLayoutV1 {
  v: 1;
  flat_id: string; flat_version: number;
  view: 'front' | 'back';                 // под 5б: + 'sleeve_left' | 'sleeve_right'
  area_id: string;
  x_mm: number; y_mm: number;             // левый верх bbox до поворота, мм флэта, шаг 0,1
  rotation_deg: number; flip_h: boolean; flip_v: boolean;
  asset: {
    type: 'svg' | 'png'; source_file: string;
    intrinsic_w_mm: number; intrinsic_h_mm: number;
    px_w?: number; px_h?: number; dpi?: number;
    size_estimated: boolean;
    has_preview: boolean;                 // PDF/AI: растр лежит по выводимому пути
  };
}
```
**Путей в `layout` нет.** `order_v4_child_guard` и `order_v4_save` проверяют только `artwork_path` и подобные поля, а jsonb не проверяют. Поэтому превью PDF/AI лежит по детерминированному пути `<artwork_path>.preview.png`. Он проходит `isArtworkPath`, а сервер не нужно менять.

### 4. Отступ — из `placementInfo` DM
| Опора `anchor.kind` | `offset_from` | `offset_mm` и `offset_dir` |
|---|---|---|
| `neckline` | `neck_seam` | `round(abs(vertical))`; `down` при vertical ≥ 0, иначе `up` |
| `panel` (этикетка, шоппер) | `top_edge` | направление `down` |
| `sleeve` (под 5б) | `part_seam` | направление `up` |

`offset_note` — свободный текст, холст его не трогает.

### 5. Запись
- Только через `useSalesStore.getState().edit(fn)`. Он сам делает no-op не в `draft` и в конечных состояниях.
- Правка уходит на `dragend` и `transformend`, а не на `dragmove`.
- Поля инспектора — через `BufferedInput` (blur и Enter).
- Стрелки — каждое нажатие, автосохранение и так с паузой 1 с.
- Буфер `useStore` и `itemBuffer` не участвуют: `ItemTab` на вкладке «Дизайн» не смонтирован.

### 6. Undo
- Локальный `useDesignStore`: снимки `item.prints`, предел 50, слияние 800 мс по ключу (как в DM `projectStore`).
- История сбрасывается при смене позиции или заказа, при уходе с вкладки и в `registerAppReset`.
- Снимок пишется, только если `isEditable(order)` и состояние сохранения не конечное.

### 7. Флэт позиции
- `SalesItem.flat_id` — колонка уже есть, `order_v4_save` её пишет.
- Подбор по умолчанию — чистая `pickFlat(item, sku, catalog)`:
  1. `item.flat_id`, если флэт активен;
  2. точный флэт: `sku_codes` содержит `item.sku_code`;
  3. типовой: `categories` содержит `sku.category` и `fits` содержит `sku.fit`;
  4. типовой только по категории;
  5. `null` — показывается плашка «Для этой модели нет флэта — нанесения задаются строками на вкладке «Изделие»».
- **Открытие ничего не пишет.** `flat_id` записывается тем же `edit`, что и первое размещение, либо явным выбором в списке.
- Смена флэта при размещённых нанесениях:
  - подтверждение;
  - `remapToFlat()` переносит размещения по `zone_id`, сохраняет размер и отступ;
  - ненайденные снимаются с холста (`layout = null`) и остаются строками.

### 8. Техника
- Профили на все 8 наших методов: `design/catalog/printMethod.ts`.
- Метод по умолчанию: метод зоны (`default_method`), затем пересечение `area.methods` и `allowedZoneTechs[zone_id]` из `getEffectiveRules`, затем `silkscreen`.
- Ключи техник визарда переводит `TECH_TO_METHOD`. Он переезжает из `wizard/wizardAdapter.ts` (сейчас не экспортирован) в `model/printMethods.ts` и экспортируется оттуда.
- DPI-контроль:
  - DTG и флекс (`heat_transfer`) — пороги 300 / 150;
  - вышивка — подсказка о минимальной детали (линия 1 мм, текст 4 мм);
  - остальные методы — без DPI.
- **Открытый вопрос владельцу:** в DM были пороги у DTF (300 / 150) и шелкографии (200 / 120). Рекомендую оставить DTF — это растровая печать. По умолчанию план делает, как решено.

### 9. Иконки
- Свой набор `design/ui/DesignIcon.jsx` + `designIcons.ts`, формат форм как у ERP `{ t, ...attrs }`. Около 14 форм из lucide (ISC, атрибуция в шапке): upload, redo, flipH, flipV, rotateCw, rotateCcw, copy, layers, zoomIn, zoomOut, fit, lock, unlock, eyeOff.
- **Из ERP в чанке дизайна — ни одного импорта**, даже разрешённых `Icon` и `icons`. Тогда разрезка `ErpStates`/`ErpSkeletons` не может сдвинуться (правило «сверять `bundle:budget`», запас 618 Б).
- Сторож — расширение `erpImports.test.ts`: в `orderstudio/design/**` нет импортов `/erp/`.

### 10. Безопасность SVG
`design/assets/sanitizeSvg.ts` — чистая функция на `DOMParser('image/svg+xml')`.
- Разрешены элементы: svg, g, path, rect, circle, ellipse, line, polyline, polygon, defs, clipPath, mask, linearGradient, radialGradient, stop, title, desc, use.
- Атрибуты `on*` удаляются.
- `href` — только `#…`.
- Удаляются `style` с `url(` не на `#`, `<script>`, `<foreignObject>`, `<image>` и `<style>`.

Где применяется:
1. Флэты — при сиде (и в 5б при загрузке) и повторно перед показом (защита в глубину).
2. Логотипы пользователя на холсте — `Blob`, затем object URL, затем `HTMLImageElement`. Внутри `<img>` скрипты не исполняются; санитайзер здесь не нужен.
3. Логотипы в PDF — `sanitizeSvg`. Если что-то вырезано, SVG растрируется в PNG 300 dpi, вектор теряется, в PDF ставится пометка.
4. Экспорт собирает DOM через `DOMParser` + `importNode`, а **не `innerHTML`**, как в DM `exportPdf.ts:12`. Сторож: в `design/**` нет `innerHTML`, `outerHTML =` и `dangerouslySetInnerHTML`.

Тип файла определяется по содержимому, функция `sniffArtwork(bytes)`:
- сигнатуры PNG, JPEG, WEBP (RIFF…WEBP), `%PDF` (PDF и AI, совместимый с PDF);
- SVG — текст, который после BOM и пробелов начинается с `<?xml`/`<svg` и содержит `<svg`.

Расхождение с расширением — отказ. PSD, TIFF, EPS на холст не идут: «Сохраните в PNG, SVG или PDF». В бакет их можно положить, как раньше.

---

## Global Constraints
- **ERP не меняется** (`erpFrozen`, `erpImports`). DDL по `erp_*` нет.
- **npm** — только пакеты задачи 0, точные версии (как в DM).
- **Lint** ≤ 34, новых предупреждений 0. **`fileSizeRatchet`** — ≤ 500 строк на файл:
  - `SidePanel` (657 строк) режется на 6 файлов панели;
  - `PlacementInspector` (442) — на `GeometryInspector` + `PrintRow` в режиме `placed`;
  - `EditorCanvas` (496) — на `EditorCanvas` + `useCanvasViewport` + `useCanvasKeys`.
- **Бюджет:**
  - вход ≤ 155000, оболочка ERP ≤ 195000 / 16000 — не растут;
  - новые проверки — в задаче 0.
- **Код:**
  - `useShallow`;
  - `toast.error` и `return null` при ошибке Supabase;
  - объекты Storage не удаляются оптимистично;
  - object URL освобождаются (`revokeObjectURL`) при размонтировании и сбросе.
- **Storage:** ключи ASCII; файл грузится при выборе; подписанные ссылки на холст не идут — только `download()` → `Blob`.
- **Интерфейс:**
  - вкладка и позиция — в адресе (`?tab=design&item=`);
  - на ≤ 760 px — только просмотр (статичное превью `<img>`);
  - тач-цели ≥ 44 px;
  - у холста клавиатурная альтернатива: список слоёв, инспектор, стрелки;
  - кнопки называют результат («Загрузить логотип», «Скачать PDF макета»).
- **Миграции на бой** — файлами для SQL Editor владельцем: `1-dryrun-H.sql` (begin; миграция; пробы; `PROBE_RESULT`) → `2-apply-H.sql` (begin; миграция; `insert into supabase_migrations.schema_migrations(version, name) values ('<ts>', 'garment_flats')`; commit) → `APPLIED.json`, `npm run migrations:verify`.

## Review Focus
1. **Цена не расходится с холстом.** Нанесение с холста и то же нанесение, введённое строкой, дают одну цену. DTG в «Кармане» — ×1,2 по названию зоны. Тесты — задачи 3, 6.
2. **Открытие заказа и вкладки ничего не пишет**, в том числе `flat_id`. Не черновик — холст только для чтения, undo не копит. Задачи 5, 6, 8.
3. **Чужой SVG** (флэт или логотип со `<script>` и `onload`) не исполняется нигде: холст, превью, PDF. Задачи 3, 7, 8.
4. **Право на флэты.** Продавец, rop, неодобренный и `anon` не пишут ни в бакет, ни в `garmentFlats`. UPDATE запрещён всем. Задача 2.
5. **Бюджет.** Konva, jspdf, pdfjs и zod не попадают ни в оболочку ERP, ни во вход, ни в оболочку Order. Холст ≤ 100 кБ gzip. Задачи 0, 8.

---

## Граф задач

```
T0 (спайк, зависимости, бюджет)
 ├─► T1 уборка designSlice ─────────────────────────────┐
 ├─► T2 миграция H, пробы, мок, ключи ──┐                │
 └─► T3 ядро дизайна (чистое) ──────────┼─► T4 сид + вкладка «Флэты»
                                        │                │
                                        └─► T5 стор, ассеты, загрузка
                                                 ├─► T6 холст и панель (UI)
                                                 └─► T7 PDF макета
T4 + T6 + T7 + T1 ─► T8 e2e, axe, эталоны, финальный бюджет ─► T9 документы и выкатка
```

Параллельно в worktree:
- `T1 ∥ T2 ∥ T3`;
- затем `T4 ∥ T5`;
- затем `T6 ∥ T7`.

Общие файлы закреплены за одной задачей:
- типы `design/types.ts` и `catalog/flatsSchema.ts` — только T3;
- `CATALOG_PUT_KEYS`, мок и `catalogKeys.test.ts` — только T2;
- `OrderWorkplace.jsx`, `ItemTab.jsx`, `PrintRow.jsx` — только T6;
- `orderSettingsTabs.ts` — только T4;
- `vite.config.js`, `bundle-budget.mjs`, `package.json` — только T0 (T8 лишь уточняет числа).

---

### Task 0: Спайк, зависимости, бюджет бандла (первая, последовательно)

**Files:**
- Modify: `pinhead-react/package.json`, lock-файл, `vite.config.js` (`manualChunks`), `scripts/bundle-budget.mjs`.
- Create: `src/orderstudio/design/README.md` — карта модуля и замеры.

**Версии (проверены `npm view` 17.10; React в дереве — 19.2.4):**

| Пакет | Версия | Почему |
|---|---|---|
| `konva` | `9.3.22` | ветка, на которой работал DM (9.3.16) |
| `react-konva` | последняя `19.2.x` (на 17.10 — 19.2.7) | у 19.3.x пир `react ^19.3.0`, у нас 19.2.4 |
| `jspdf` | `4.2.1` | вместо DM 2.5.2: у ветки 2.x/3.x известные уязвимости (ReDoS, LFI в Node-сборке, исправлены к 4.0); сверить `npm audit` |
| `svg2pdf.js` | `2.8.1` | пир `jspdf ^4 \|\| ^3 \|\| ^2` |
| `pdfjs-dist` | `4.10.38` | как DM; 5.x требует новых браузерных API |
| `zod` | `^4.3.6` | уже есть транзитивно (`eslint-plugin-react-hooks`), дедуп |

**Шаги:**
- [ ] **Step 1. Базовый замер.** `npm run build && npm run bundle:budget` до изменений — записать в README модуля.
- [ ] **Step 2. Спайк на выброс** (одна ветка, в main не идёт). Проверить под Vite 7:
  - (а) импорт `konva/lib/Core` + `konva/lib/shapes/{Image,Rect,Line,Arrow,Text,Transformer}` и `react-konva/lib/ReactKonvaCore` — есть ли подпути в `exports` пакета;
  - (б) `pdfjs-dist/build/pdf.mjs` (не legacy) + `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`, `isEvalSupported: false`; без запасного режима «воркер в главном потоке» — при сбое воркера ошибка;
  - (в) `jspdf` 4 + `svg2pdf.js` 2.8: кириллица через подмножество LiberationSans (TTF ?url) и вложенный SVG-логотип в `<image href="data:image/svg+xml…">`;
  - (г) gzip `zod` и `zod/mini` в ленивом чанке.
- [ ] **Step 3. `manualChunks`** — группы `vendor-konva` (konva, react-konva, react-reconciler, its-fine), `vendor-pdf` (jspdf, svg2pdf.js, fflate, fast-png) и `vendor-pdfjs` (pdfjs-dist). Комментарий: почему функция, как в шапке файла.
- [ ] **Step 4. Новые проверки в `bundle-budget.mjs`:**
  - `FORBIDDEN_IN_SHELL` += `vendor-konva`, `vendor-pdf`, `vendor-pdfjs`;
  - **«Оболочка Order»** = статический граф `OrderStudioApp` + `OrderWorkplace` (ключи по `name`, как `ErpApp`; иначе страж падает). Запрещены три группы выше, чанки `seedFlats` и `flats/*.svg`, маркер холста;
  - **«Холст»** = граф `design/ui/DesignTab` минус «оболочка Order» — ≤ **100000** Б gzip (спека, строка 126);
  - **«PDF макета»** = граф `design/export/exportPdf` минус «холст» и «оболочка Order» — потолок по замеру +5 % (ожидание около 150 кБ);
  - **«pdfjs»** = граф `design/assets/loadPdf` — потолок по замеру +5 % (около 110 кБ); воркер — ассет, не JS-граф;
  - **маркер `data-design-canvas`** (литерал в `DesignTab.jsx`) не встречается в файлах входа, оболочки ERP и оболочки Order — тот же приём, что у agentation;
  - проверка мутацией: статический импорт `DesignTab` в `OrderWorkplace` даёт красный страж.
- [ ] **Step 5. «Найти запас».** 5а не должна трогать оболочку ERP: дизайн ленив и ERP не импортирует. Шаг фиксирует, что после T0 числа оболочки ERP и входа **совпадают побайтно** с базой. Если не совпадают — разбор до T3. Кандидаты вне ERP: `index-*.js` 13,9 кБ (`App.jsx`, `main.jsx`, `lib/*`). Править ERP ради запаса нельзя.
- [ ] **Step 6.** `npm audit` (новые high/critical = 0), `typecheck`, `lint`, `vitest`. Коммит `chore(deps): холст и PDF макета — konva, react-konva, jspdf, svg2pdf, pdfjs, zod (веха 5а, задача 0)`.

**Выход:** числа, записанные в плане и README, и решение `zod` против `zod/mini`. Если konva с react-konva и нашим кодом не влезают в 100 кБ, схема флэтов разбирается в отдельном маленьком чанке, а не в «холсте».

**Итог задачи 0 (17.10, подробности — `src/orderstudio/design/README.md`):**
- версии установлены точно: konva 9.3.22, react-konva 19.2.7, jspdf 4.2.1, svg2pdf.js 2.8.1, pdfjs-dist 4.10.38, zod 4.3.6; `npm audit` — 0;
- база (фикс. SHA сборки): вход 151 750, оболочка ERP 194 369 / CSS 15 905, оболочка Order 267 043 Б gzip; после T0 — **побайтно то же** (тот же набор файлов с теми же хешами);
- спайк: Core-подпути konva/react-konva работают без alias; pdfjs `build/pdf.mjs` + module-воркер через `workerPort` рисует; svg2pdf рисует сцену из `createHTMLDocument()` (не `document.body`), кириллица LiberationSans встраивается, вложенный SVG-логотип — вектором; подмножество шрифта 42,6 кБ;
- jsPDF: необязательные `html2canvas`/`dompurify`/`canvg` вырезаны плагином сборки — без этого `__vitePreload` уезжал в `vendor-pdf`, и вход тянул весь jsPDF (151 → 303 кБ);
- замеры: холст konva + reconciler 79,3 кБ (+ `Arrow` 8,5; zod 19 / **`zod/mini` 6,5 — выбран `zod/mini`**) → нашему коду ≈ 14 кБ; **`Arrow` не импортировать**; при нехватке — схема флэтов в свой чанк; PDF макета 152,5 кБ (потолок 160 000); pdfjs 98,8 кБ (потолок 104 000);
- прогноз T6: `vendor-react` +64 Б gzip (экспорт общего чанка для `vendor-konva`), оболочка ERP ≈ 194 430 из 195 000.

### Task 1: Уборка мёртвого кода визарда (∥ T2, T3)

**Files:**
- Delete: `src/store/slices/designSlice.ts`.
- Modify:
  - `store/useStore.ts`, `store/slices/index.ts`;
  - `store/slices/helpers.ts` (`zoneArtworks`, `designNotes`, если без читателей);
  - `types/order.ts`;
  - `orderstudio/wizard/wizardAdapter.ts` — `wizardToSalesItem`, `printFromZone`, `labelsFrom`: вне тестов не вызываются (проверено grep), чтение `snap.zoneArtworks` на строке 174 уходит с ними; в `salesItemToWizard` убрать сборку `zoneArtworks` (строки 323–359), если её не читает `GarmentPanel`;
  - `src/multiItem.test.js` (строки 647–648 и 1100–1102 — сценарии `toggleZone`/`setZoneTech`), `wizardAdapter.test.ts`.
- Test: `deadCode.test.ts`; при необходимости дописать имена.

- [ ] **Step 1.** Перед удалением — `grep` каждого экспорта. Экспресс-калькулятор держит свои локальные `setZoneTech`/`setZoneParam` (`ExpressCalc.jsx:144`, `:156`) — их не трогать.
- [ ] **Step 2.** Удаление; зелёные `wizardParity`, `itemBuffer`, `wizardAdapter`.
- [ ] **Step 3.** Коммит `refactor: убран designSlice и мёртвый перенос визарда (веха 5а, задача 1)`.

### Task 2: Миграция H, пробы, мок, ключи справочника (∥ T1, T3)

**Files:**
- Create:
  - `supabase/migrations/<ts>_garment_flats.sql`;
  - `supabase/probes/garment_flats.sql`;
  - `src/orderstudio/api/garmentFlats.ts`;
  - `src/orderstudio/garmentFlatsBucket.test.ts`;
  - `src/orderstudio/flatsWrites.test.ts`.
- Modify:
  - `supabase/probes/README.md` (строка `garment_flats.sql`, ожидание);
  - `supabase/probes/order_v4_rights.sql` — 8 проб двухаргументной `sales_set_staff` (строки 152, 255, 289–291, 303, 315, 331) переписать на `42883 function … does not exist` или на трёхаргументную; обновить `total`;
  - `src/orderstudio/api/catalogAdmin.ts` — `CATALOG_PUT_KEYS.app_config` += `'garmentFlats'`; в `SALES_CATALOG_KEYS` не добавлять (только admin и director);
  - `catalog/catalogKeys.test.ts`;
  - `orderV4Rights.test.ts` — блок «H: перегрузки нет, трёхаргументная на месте, метка `sales.rpc`»;
  - `e2e/support/mockSupabase.ts`.

**Interfaces — Produces (SQL), миграция H:**
1. **Бакет:** `insert into storage.buckets ('garment-flats', 'garment-flats', false, 1048576, array['image/svg+xml']) on conflict (id) do update …`. Самый большой сид — 80 КБ, лимит 1 МБ с запасом.
2. **`public.garment_flat_path_ok(p_name text) returns boolean`:** `immutable`, `security invoker`, `search_path = public`. Регулярное выражение `^flats/[a-z0-9][a-z0-9-]{0,62}/v[1-9][0-9]{0,3}/(front|back|sleeve_left|sleeve_right)\.svg$`. `revoke from public, anon`, `grant` для `authenticated`.
3. **Политики `storage.objects` на команду:**
   - `garment_flats_select` — `bucket_id = 'garment-flats' and (select public.catalog_reader())`;
   - `garment_flats_insert` — `… and public.garment_flat_path_ok(name) and (select public.catalog_writer())`;
   - `garment_flats_no_update` — **restrictive**, `using / with check (bucket_id <> 'garment-flats')`;
   - `garment_flats_delete` — путь корректный и `catalog_writer()`; для 5б и уборки после сбоя сида.
4. **`catalog_put`** — `create or replace` с **подлинным текстом из G** (`20261017150000_order_catalogs.sql:381–451`). Единственная правка: `'garmentFlats'` в `v_admin_pair` (только admin и director). `revoke` и `grant` повторить.
5. **`catalog_value_check`** — `create or replace` с текстом G (`:180–333`) и новой веткой `app_config.garmentFlats` (код ошибки 22023, русский текст):
   - значение — объект с `version = 1` и массивом `flats`;
   - у флэта `id` по `^[a-z0-9][a-z0-9-]{0,62}$`, id уникальны;
   - `version` — целое ≥ 1, `active` — boolean;
   - `views` — массив, `kind` из перечня, виды внутри флэта уникальны;
   - **`svg_path` = `'flats/' || id || '/v' || version || '/' || kind || '.svg'`** — клиент не может направить флэт на чужой объект;
   - `scale_mm_per_unit > 0`;
   - `print_areas` — непустой массив, `id` уникальны в пределах вида, `polygon_mm` — массив из ≥ 3 пар чисел, `zone_id` — строка или `null`, `methods` и `default_method` — из 8 кодов CHECK `order_item_prints_method_check`.
6. **`order_item_prints_layout_check`** — `check (layout is null or (jsonb_typeof(layout) = 'object' and octet_length(layout::text) <= 8192)) not valid;` затем `validate constraint`. Сейчас все `layout` равны `null`.
7. **`drop function if exists public.sales_set_staff(uuid, boolean);`** Клиент зовёт только трёхаргументную (`api/salesStaff.ts`, проверено grep).
8. `notify pgrst, 'reload schema'`. Без DDL по `erp_*`.
9. Шапка — откат: удалить объекты бакета через API, `drop policy` ×4, `delete from storage.buckets`, вернуть `catalog_put`/`catalog_value_check` текстом G, `drop constraint`, `drop function garment_flat_path_ok`. Перегрузку не возвращать.

**Interfaces — Produces (клиент), `api/garmentFlats.ts`:**
- константы `FLATS_BUCKET`, `FLAT_MIME = 'image/svg+xml'`, `FLAT_MAX_BYTES = 1048576`;
- `flatSvgPath(id, version, kind)` и `isFlatPath(p)` — та же форма, что в SQL;
- `uploadFlatSvg(path, svgText)` — `upsert: false`, «Duplicate» → `'exists'`;
- `downloadFlatSvg(path): Promise<string | null>`.

Ошибка — `toast.error` и `null`.

**Сторожа:**
- `garmentFlatsBucket.test.ts` (node) — константы TS равны SQL: имя, лимит, mime, регулярное выражение пути;
- `flatsWrites.test.ts` — `.from('garment-flats').upload|remove` только в `api/garmentFlats.ts`;
- `catalogWrites.test.ts` уже требует писать `app_config` только через `catalogAdmin`.

**Мок e2e:**
- белый список `catalog_put` (строка 883) += `garmentFlats`;
- `extra.storageObjects: Record<'<bucket>/<path>', { type, body: Buffer }>`;
- загрузка кладёт тело в карту;
- GET `object/authenticated/<bucket>/<path>` и `object/sign/<bucket>/<path>` отдают тело, если оно есть, иначе 404, как раньше — снимки детерминированы;
- фикстура `e2e/fixtures/flats/{tshirt-freefit-front,back}.svg` и `catalogs.app_config.garmentFlats` с одним флэтом.

**Пробы `garment_flats.sql`** (около 40; шапка `fails=0 total=N`; роли и uuid — как в `order_artworks.sql`):
- бакет: `public = false`, mime только SVG, лимит;
- insert:
  - admin и director → OK;
  - rop, продавец, МС, начальник цеха, неодобренный → отказ RLS;
  - `anon` → permission denied;
  - путь с кириллицей, `..`, `.png`, без `v1`, `v0`, вид `sleeve` → отказ даже у admin;
- select: продавец и начальник цеха видят объект; неодобренный и отключённый — 0 строк;
- update у admin → 0 строк (restrictive, в том числе против временной широкой permissive `tmp_probe_any_update`, как в `order_artworks.sql`);
- delete: rop → 0, admin → 1;
- `catalog_put('app_config', 'garmentFlats', …)`:
  - admin и director → OK; rop, продавец → 42501;
  - не объект, дубль id, `svg_path` чужого флэта, `../`, метод `screenprint`, `polygon` из двух точек → 22023;
  - изменённая база → P0001;
- `sales_set_staff(uuid, boolean)` → 42883; трёхаргументная у rop → OK;
- `layout` массивом и `layout` больше 8 КБ через `order_v4_save_full` → 23514.

- [ ] **Step 1.** Пробы и сторожа — красные.
- [ ] **Step 2.** Мутация: снять `garment_flat_path_ok` из insert — проба `admin_cyrillic_path` краснеет.
- [ ] **Step 3.** Реализация.
- [ ] **Step 4.** Коммит. Контроллер готовит `1-dryrun-H.sql` / `2-apply-H.sql`.

**Выкатка:** H — **до мерджа**. Миграция только добавляет, плюс удаление неиспользуемой перегрузки. Сид флэтов — после выкладки фронта.

### Task 3: Ядро дизайна — перенос чистого кода DM (∥ T1, T2)

**Files (Create, тест рядом с каждым)** — `src/orderstudio/design/`:
- `types.ts`:
  - `GarmentFlatsCatalog { version: 1; flats: GarmentFlat[] }`;
  - `GarmentFlat { id, name, garment_type, typical: boolean, active: boolean, version: number, sku_codes: string[], categories: string[], fits: string[], base_size, sizes, views: FlatView[] }`;
  - `FlatView { kind, svg_path, scale_mm_per_unit, anchors, size_anchors?, grade_rule?, print_areas: PrintArea[] }`;
  - `PrintArea { id, name, zone_id: string | null, tz_row?: string, polygon_mm, safe_inset_mm, default_method?: SalesPrintMethod, methods?: SalesPrintMethod[], max_print_mm?, min_print_mm? }`;
  - `Placement` — модель вида: `print_key` вместо `id`/`asset_id`;
  - `AssetMeta`, `PrintLayoutV1`.
- `geometry/{coords,dimension,dimensionLines,gradeRule,grading,gradingReview,view,zone}.ts` — копия DM 1:1 с заменой `@/types` → `../types`. Тесты: `geometry` (577 строк), `dimensionLines`, `gradeRule`, `gradingReview`, `zoneFit`, `fitOrder`.
- `catalog/printMethod.ts` — профили 8 методов: короткая метка, цветовая модель, Pantone, `dpi?`, `detail?` (см. решение 8); `resolveMethod`, `methodAllowedInZone`, `allowedMethods(area, rules)`.
- `catalog/dpi.ts`.
- `catalog/flatsSchema.ts` — zod 4 (`z.record(k, v)`, `superRefine`; инвариант «`default_method` ∈ `methods`» из DM). `parseFlatsCatalog(raw)` → `{ ok, catalog, issues }`: битый справочник не роняет экран.
- `catalog/svgMeta.ts`.
- `catalog/pickFlat.ts`.
- `catalog/categoryMap.ts` — DM-тип ↔ категория PH: tshirt→tshirts, longsleeve→longsleeves, sweatshirt→sweatshirts, hoodie→hoodies, zip_hoodie→ziphoodies, half_zip→halfzips, polo→polo, olympic→polo, bomber→bombers, pants→pants, shopper→accessories. Сторож: у каждого типа DM есть категория из `skuCatalog`.
- `assets/sniff.ts`, `assets/sanitizeSvg.ts`, `assets/loadAsset.ts` — без PDF-ветки; `readPngDpi`, `parseSvgSizeMm` — тесты DM.
- `model/layout.ts`:
  - `parseLayout(raw): PrintLayoutV1 | null` — терпимый: битый → «не размещено», без перезаписи;
  - `placementOf(print, flat)`;
  - `applyPlacement(print, pl, ctx)` → новый `SalesPrint` (зона по `getZoneName(zone_id, zonesCatalog)`, мм, отступ, `layout`);
  - `newPlacedPrint(asset, artworkPath, area, ctx)` — через `newSalesPrint`, `on` по виду позиции, как в `ItemTab`;
  - `remapToFlat(prints, from, to)`.
- `model/offset.ts` — таблица решения 4.
- `export/{flatMarkup,buildSceneSvg,buildPreviewSvg,preflight,resolveFlat}.ts` — с тестами DM. `preflight` получает метод нашего набора и `allowedZoneTechs`.
- `model/printMethods.ts` (вне `design/`, его читает и `wizardAdapter`) — экспорт `TECH_TO_METHOD`/`METHOD_TO_TECH`.

**Тесты (новые сверх DM):**
- **паритет цены:** `priceOrder` для позиции с нанесением из `applyPlacement` равен цене позиции с тем же нанесением, введённым строкой (DTG «Карман», DTF 120×80, шелкография A4);
- `offset`: горловина выше и ниже шва, панель;
- `pickFlat`: точный, типовой по крою, типовой по категории, снятый флэт, `null`;
- `remapToFlat`: зона найдена, не найдена;
- `sanitizeSvg`: `<script>`, `onload`, `<foreignObject>`, `xlink:href="javascript:"`, `<use href="http://…">`, `<image>`, `style="background:url(…)"` удалены; чистый флэт не меняется (снимок `<g id="garment">`);
- `sniff`: PNG под `.svg`, SVG с BOM, AI без `%PDF` → отказ;
- `parseLayout`: битая форма → `null`;
- `flatsSchema`: сид проходит, дубль id и чужой путь — нет.

- [ ] **Step 1.** Перенос тестов DM, красные. Исключить `admin/*`, `auth/*`, `mergedCatalog`, `dxf*`, `persistence`, `exportPng`, `seed.test` (заменяется задачей 4).
- [ ] **Step 2.** Перенос кода. Ни одного React-импорта, ни одного импорта `/erp/`.
- [ ] **Step 3.** Новые тесты, мутация паритета цены (подменить `zone` → тест краснеет).
- [ ] **Step 4.** Коммит.

### Task 4: Сид флэтов и вкладка «Флэты и зоны» (после T2, T3; ∥ T5)

**Files:**
- Create:
  - `design/seed/flats/*.svg` — 67 файлов из DM `public/seed/flats` как есть;
  - `design/seed/garmentFlats.seed.json` — сгенерирован из DM `skus.json` скриптом `scripts/flats-seed-convert.mjs`, скрипт в репо, разовый;
  - `design/seed/seedFlats.ts` (+тест);
  - `admin/tabs/FlatsTab.jsx` + `.module.css` + тест.
- Modify:
  - `admin/orderSettingsTabs.ts` (`{ id: 'flats', label: 'Флэты и зоны' }`);
  - `admin/OrderSettings.jsx` — панель вкладки, ленивая; `seedFlats` грузится `import()` по кнопке.

**Конвертер (сторож — тест на результат):**
- каждый SKU DM превращается во флэт: `id` = `sku.id`, `typical: true`, `active: true`, `version: 1`, `sku_codes: []`;
- `categories` — через `categoryMap`; `fits` — из id (freefit→free, oversize→oversize, regular→regular, classic→classic);
- `svg_path` по форме H;
- зоны: `chest` → `zone_id: 'front'`, `back` → `'back'`, `front` у шоппера → `'side-a'`, `label` → `zone_id: null` (название «Этикетка»);
- `tz_row` пуст (5б);
- эталон `tshirt-freefit` помечен в `name`, провизорные — как есть.

**Тест сида (node):**
- все 67 SVG проходят `sanitizeSvg` без изменений;
- у каждого есть `<g id="garment">`;
- каждый `svg_path` справочника имеет файл;
- json проходит `flatsSchema` и `catalog_value_check` в TS-зеркале;
- размер json ≤ 1 МБ (около 70 КБ).

**`seedFlats({ onProgress })`** (контракт из решения 1):
- `{ uploaded, existed, failed, catalog: 'saved' | 'conflict' | 'unchanged' | 'error' }`;
- при `failed > 0` справочник не пишется, тост называет число файлов.

**`FlatsTab({ readOnly })`:**
- список флэтов: название, тип, «типовой», виды, число зон;
- пустой справочник — «Флэтов в базе нет. Загрузите типовые флэты дизайн-мейкера — 35 моделей»;
- кнопка «Загрузить типовые флэты» (`admin`/`director`, не на ≤ 760) с прогрессом `aria-live`;
- rop — только просмотр и подпись «Флэты меняет администратор или директор».

- [ ] **Step 1. Тесты:**
  - вкладка из адреса;
  - rop без кнопки;
  - сид: частичный сбой → справочник не тронут; повтор дописывает; конфликт → плашка вкладок вехи 4 (`useCatalogEditor`).
- [ ] **Step 2.** Реализация.
- [ ] **Step 3.** Бюджет: `flats/*.svg` и `seedFlats` не в «оболочке Order» и не в «холсте».
- [ ] **Step 4.** Коммит.

### Task 5: Стор холста, картинки и загрузка логотипа (после T3; ∥ T4)

**Files (Create, тесты рядом):**
- `design/store/useDesignStore.ts` — zustand 5, скилл `zustand-store-ts`:
  - состояние: `{ itemKey, view, selectedPrintKey, past, future, zoom, pan }`;
  - действия: `bind(orderId, itemKey)`, `select`, `setView`, `commit(label, nextPrints, coalesceKey?)`, `undo`, `redo`, `reset`;
  - `commit` и `undo` пишут через `useSalesStore.getState().edit`, предварительно проверяют `isEditable` и `isTerminalSaveState`;
  - `registerAppReset(reset)`.
- `design/model/editItem.ts` — `setItemPrints(o, key, prints)`, `setItemFlat(o, key, flatId)` (чистые).
- `design/assets/artworkImages.ts`:
  - `useArtworkImage(path, hasPreview)` → `HTMLImageElement | null`;
  - `supabase.storage.from('order-artworks').download(path | path + '.preview.png')` → `Blob` → `createObjectURL`;
  - кэш на заказ, `revoke` в `reset`;
  - растр больше 4096 px уменьшается для показа через `createImageBitmap`, `px_w` для DPI — исходный;
  - ошибка → `toast.error` один раз на путь.
- `design/assets/flatImages.ts` — `useFlatImage(flat, view, colorHex)`: `downloadFlatSvg`, затем `sanitizeSvg`, `recolorGarment(sanitizeHex(hex))`, `Blob` `image/svg+xml`, object URL, `HTMLImageElement`. Цвет — `findPaletteColor(rows[0].color, suppliers)?.hex`, иначе нейтральный `#d9d9d9`.
- `design/assets/loadPdf.ts` — динамический `import('pdfjs-dist/build/pdf.mjs')`, воркер через `?url`, `isEvalSupported: false`; рендер 1-й страницы 300 dpi, предел 4096 px, белая подложка (из DM); `%PDF` в начале, иначе текст про «Create PDF Compatible File».
- `design/assets/useAddArtwork.ts`:
  1. файл → `sniffArtwork`;
  2. `loadAsset` (PDF/AI → `loadPdf`);
  3. **сразу** `uploadArtwork(order.id, 'logo', file)` — исходник;
  4. для PDF/AI дополнительно `uploadArtwork`-аналог с путём `<path>.preview.png` (новая `uploadArtworkAt(orderId, path, blob)` в `api/artworks.ts` с той же проверкой `isArtworkPath`);
  5. `newPlacedPrint` в текущий вид: зона по порядку DM `fitOrder`, размер — по `intrinsic_size_mm`, ужатый до зоны, позиция — `STANDARD_PLACEMENT`;
  6. `commit`, вместе с `flat_id`, если он ещё пуст.

  Не загрузилось — нанесение не создаётся.
- «Логотипы заказа» — `orderArtworks(order)`: уникальные `artwork_path` всех позиций с `layout.asset`; повторное использование без загрузки.

**Тесты:**
- undo и redo, слияние 800 мс, предел 50, сброс при смене позиции;
- не `draft` → `commit` ничего не пишет и не копит историю;
- загрузка:
  - сбой `uploadArtwork` → нанесения нет;
  - PDF → два пути, второй `…preview.png`;
  - PSD → отказ с текстом;
- object URL освобождаются (шпион на `revokeObjectURL`);
- `loadPdf` и `supabase` мокаются.

- [ ] Тесты → реализация → коммит.

### Task 6: Холст и панель — вкладка «Дизайн» (после T5; ∥ T7)

**Files:**
- Create: `design/ui/`:
  - `DesignTab.jsx` — ленивый вход, ≤ 250 строк, маркер `data-design-canvas`;
  - `DesignTab.module.css`;
  - `konva.ts` — ядро и фигуры, единственное место импорта konva;
  - `canvas/{EditorCanvas.jsx, useCanvasViewport.ts, useCanvasKeys.ts, canvasOverlays.jsx, PlacementNode.jsx}`;
  - `panel/{FlatPicker,ViewTabs,LayerList,LayerRow,GeometryInspector,UnplacedList,PreflightList,ArtworkPicker}.jsx`;
  - `DesignIcon.jsx`, `designIcons.ts`;
  - `DesignPreview.jsx` — ≤ 760 и только чтение: `buildPreviewSvg` → `svgToDataUrl` → `<img alt="…">`.
- Modify:
  - `workplace/OrderWorkplace.jsx`:
    - `TABS` = `item`, `design` («Дизайн»), `client`, `summary`;
    - `design` показывает `ItemList` + `<Suspense><DesignTab …/></Suspense>`, обёрнутый в `ErrorBoundary`;
    - `const DesignTab = React.lazy(() => import('../design/ui/DesignTab'))`;
    - пропсы: `order`, `item`, `price`, `readOnly`, `compact`;
  - `workplace/ItemTab.jsx` — `PrintRow` получает `placed={!!parseLayout(p.layout)}` и `onOpenDesign`;
  - `screens/PrintRow.jsx` — в режиме `placed` зона, мм и отступ только для чтения, ссылка «Изменить на холсте» ведёт на `?tab=design&item=…`; остальные поля как были;
  - `OrderWorkplace.test.jsx`, `workplaceSource.test.ts`.

**Перенос UI DM:**
- tailwind → CSS-модули на токенах (`--space-*`, `--type-*`; фолбэк `var(--x, X)` запрещён);
- lucide → `DesignIcon`;
- `useProjectStore` → `useDesignStore` + производные от `item`;
- `next/dynamic` → `React.lazy`;
- без `"use client"`.

**Состав экрана:**
- **слева** — список позиций (тот же `ItemList`);
- **центр** — холст: флэт в цвете позиции, зоны и safe-зона, размерные линии выбранного, гайды по осям, перетаскивание и `Transformer` (пропорции заперты по умолчанию, поворот шагом 15° с Shift);
- **справа:**
  - выбор флэта — «типовой» отмечен текстом;
  - вкладки видов «Перед» и «Спина»;
  - «Загрузить логотип» и «Логотипы заказа»;
  - список нанесений вида: выбор, вверх, вниз, удалить, дублировать — каждая кнопка с `aria-label`;
  - инспектор: метод (только допустимые в зоне, недопустимый — с пометкой), Ш × В мм, отступ от горловины, от центра, поворот, отражение;
  - под инспектором — поля `PrintRow` выбранного (Pantone, цвета, подложка, эффект, размеры, комментарий);
  - цена за штуку и замечания `ISSUE_LABELS`;
  - preflight-список;
  - «Без холста» — нанесения в зонах без вида, ссылкой на «Изделие»;
  - «Скачать PDF макета» (слот задачи 7).

**Клавиатура:**
- холст в контейнере `tabIndex=0`, `role="application"`, `aria-label="Холст: <модель>, вид <перед>"`, `aria-describedby` с подсказкой;
- стрелки — 1 мм, с Shift — 10 мм;
- Delete — удалить с подтверждением;
- Ctrl/Cmd+Z, Shift+Ctrl+Z — undo и redo;
- `aria-live` пересказ «Нанесение 1: 120 × 80 мм, 80 мм от шва горловины».

**Порядок слоёв = порядок `prints`** (номер нанесения в ТЗ). Вверх и вниз меняют оба.

**Только чтение:** холст без перетаскивания, кнопок правки нет, PDF доступен.

**Тесты (jsdom; `react-konva` мокается простыми div, konva проверяется в e2e):**
- вкладка `design` из адреса, клавиатура `tablist`, маркер готовности;
- открытие вкладки ничего не пишет: шпион на `edit` — 0 вызовов, `flat_id` не записан;
- не `draft` → кнопок правки нет;
- инспектор → `width_mm` и цена меняются;
- `PrintRow placed` — поля зоны и мм `readOnly`;
- нет флэта → плашка;
- смена флэта → подтверждение и перенос.

- [ ] Тесты → реализация → `fileSizeRatchet` → коммит.

### Task 7: PDF макета (после T3, T5; ∥ T6)

**Files (Create):**
- `design/export/exportPdf.ts` — только динамический импорт: `exportMaketPdf(input): Promise<Blob>`, сохранение — у кнопки;
- `design/export/fonts/LiberationSans-{Regular,Bold}.subset.ttf` + `OFL.txt`;
- `design/export/svgForPdf.ts`;
- `design/ui/panel/ExportPdfButton.jsx`.

**Шрифты:** подмножество латиницы, кириллицы, цифр и знаков: около 60–90 КБ вместо 410 КБ, `pyftsubset` разово, команда — в README модуля. Подключаются через `?url` (хешированный `/assets/`, кэш service worker).

**Содержимое:**
- страница на каждый вид с размещениями — `buildSceneSvg` DM;
- шапка: номер заказа, клиент, позиция (`itemTitle`), цвет, «по типовому флэту», если `typical`;
- размерные линии Ш, В и отступа;
- шкала 1:1.

**Логотипы:**
- PNG — `blob` → `data:` URL;
- SVG — `sanitizeSvg`; если что-то вырезано, растр 300 dpi и пометка в шапке «логотип N — растр».

**Сборка без `innerHTML`:** `DOMParser` → `document.importNode` → скрытый holder → `pdf.svg()`.

**Имя файла** — ASCII, `asciiFileName`: `PH-1234-<item>-maket.pdf`.

**Кнопка:**
- перед сборкой показывает preflight: предупреждения не блокируют (решение DM №6);
- состояние «Готовлю PDF…» с `aria-busy`;
- ошибка → `toast.error`.

**Тесты:**
- `svgForPdf`: вредный SVG → растр, чистый → вектор;
- имя файла;
- кнопка с мок-модулем: вызывает `exportMaketPdf` только по клику — ленивость проверяется шпионом на `import()` через `vi.mock`.

- [ ] Тесты → реализация → бюджет «PDF макета» → коммит.

### Task 8: e2e, axe, эталоны, финальный бюджет (после T1, T4, T6, T7)

**Files:**
- Create: `e2e/order-design.spec.ts`, фикстуры:
  - `e2e/fixtures/logo-300dpi.png` (pHYs);
  - `logo-evil.svg` (`<script>`, `onload`);
  - `logo.pdf`.
- Modify:
  - `e2e/visual.spec.ts` (`studio-design`, `studio-settings-flats`);
  - `e2e/order-workplace.spec.ts`;
  - `e2e/order-settings.spec.ts`.

**Сценарии:**
1. Черновик с T-004 → «Дизайн» → типовой флэт FreeFit, вид «Перед», запросов записи нет.
2. Загрузка PNG → в журнале мока `storage` `order-artworks/orders/<id>/logo/…`. Нанесение 1 — «Грудь (перед)». В `order_v4_save_full` уходит `layout.v = 1`, `flat_id`, `offset_from = 'neck_seam'`, `item.flat_id`.
3. Ширина 200 в инспекторе → цена на панели меняется. Стрелка вниз ×3 → отступ +3. Ctrl+Z → назад.
4. «Спина» → `logo-evil.svg`: нет диалога, нет ошибки в консоли, размещение есть.
5. PDF:
   - `waitForEvent('download')`;
   - байты начинаются с `%PDF`;
   - размер < 8 МБ;
   - разбор `pdfjs-dist` в Node даёт текст «Грудь» и номер заказа (кириллица извлекается).
6. `logo.pdf` → два пути, второй `….preview.png`.
7. Заказ `ready_to_launch` → холст только для чтения, PDF скачивается.
8. 390 px → превью-картинка, холста нет.
9. Admin на `/order-settings?tab=flats` → «Загрузить типовые флэты» → 67 загрузок в `garment-flats/flats/…/v1/…` и один `catalog_put('app_config', 'garmentFlats')`. rop кнопки не видит.
10. axe (serious/critical = 0) на «Дизайн» и вкладке «Флэты».

**Эталоны:** `studio-design` — холст с одним логотипом, допуск как у прочих `studio-*`.

**Бюджет:** вход и оболочка ERP побайтно равны замеру T0; «холст» ≤ 100000; «PDF» и «pdfjs» — в своих потолках. Числа — в шапку `bundle-budget.mjs` с историей, как принято.

- [ ] Сценарии → axe → снимки → бюджет → коммит.

### Task 9: Документы и выкатка

**Документы:**
- `CLAUDE.md` (корневой и `pinhead-react/`):
  - структура `orderstudio/design/`;
  - маршрут `/sales/:id?tab=design` и вкладка `flats` в «Справочниках заказа»;
  - Storage: строка `garment-flats`;
  - схема `app_config.garmentFlats`;
  - `catalog_put` += `garmentFlats` (admin и director);
  - `layout` — форма v1 и CHECK;
  - перегрузки `sales_set_staff(uuid, boolean)` больше нет;
  - Lazy loading += `DesignTab`, `exportPdf`, `loadPdf`, `seedFlats`;
  - стек: konva и react-konva, jspdf и svg2pdf, pdfjs-dist, zod.
- Правило `docs/rules/pravila-dizain-meikera-veha-5a-<дата>.md`:
  - холст пишет только через `edit`, источник правды — заказ;
  - путей в `layout` нет, превью — `<path>.preview.png`;
  - SVG: санитайзер, `<img>`, `DOMParser`;
  - флэты неизменяемы по версии;
  - сид — кнопкой, справочник последним;
  - бюджет холста и маркер.

  Плюс строка в `docs/rules/INDEX.md` и `docs/rules/react/INDEX.md`.
- `docs/DESIGN.md` — вкладка «Дизайн», иконки Order.
- Спека — строка вехи 5 → 5а и 5б.
- `docs/changelog/2026-10.md`, `SESSION-STATE.md`, `PROJECT.md`.
- Бэклог:
  - уборка ничьих логотипов `order-artworks` (удаление и undo оставляют файлы) — по образцу `storage-gc`;
  - DTF и шелкография без DPI-контроля — ждёт решения владельца;
  - рукава и прочие виды — 5б;
  - per-size флэты и ростовка — геометрия перенесена, интерфейса нет.

**Выкатка:**
1. Сухой прогон `1-dryrun-H.sql` (`PROBE_RESULT fails=0`) → `2-apply-H.sql` → пробы `garment_flats.sql` и `order_v4_rights.sql` на бою → `APPLIED.json` + `npm run migrations:verify`.
2. PR → `update_snapshots` → мердж. Флаг `orderStudio` для людей не включается (веха 8).
3. Владелец в проде: «Справочники заказа» → «Флэты и зоны» → «Загрузить типовые флэты».
4. Конец сессии по CLAUDE.md, в том числе уборка `tmp_*`.

---

## Риски и откат

| Риск | Чем закрыт |
|---|---|
| Холст больше 100 кБ (konva около 35 + reconciler около 25 + наш код + zod) | Core-импорты konva; `zod/mini` или разбор схемы отдельным чанком (решение в T0); страж «холст» |
| В `react-konva` 19 нет подпути `lib/ReactKonvaCore` | Спайк T0. Запасной путь: полный `react-konva` + `konva/lib/Core` через alias — замер |
| `svg2pdf` не рисует вложенный SVG-логотип | Спайк T0. Запасной путь: растр 300 dpi с пометкой (уже в T7) |
| Воркер pdfjs и CSP (`worker-src 'self'`, `script-src 'self'`) | Воркер из `/assets/` через `?url`, `isEvalSupported: false`; CSP в режиме report-only — сверить отчёты |
| Запас оболочки ERP 618 Б | Дизайн ничего не берёт из ERP (сторож); побайтная сверка в T0 и T8 |
| Расхождение строки нанесения и холста | `PrintRow` в режиме `placed`; мм и зона — только в стандартных полях; `layout` — только геометрия |
| Битый `layout` или флэт сменили в 5б | `parseLayout` → «не размещено» без перезаписи; `flat_version` в `layout`, пометка «флэт обновлён» |
| Поток автосохранений при перетаскивании | Запись на `dragend` и `transformend`; пауза 1 с и одиночный полёт уже в `useSalesStore` |
| Утечка памяти object URL и больших растров | Кэш на заказ, `revoke` в `reset`, уменьшение больше 4096 px |
| Ничьи файлы после удаления и undo | Осознанно: undo может вернуть нанесение; уборка — в бэклог; `artworkInUse` уже есть |
| Частичный сид | Идемпотентно, справочник пишется последним, повтор дописывает |
| Лицензии | LiberationSans — OFL (`OFL.txt` рядом); иконки lucide — ISC (атрибуция) |

**Откат:**
- фронт — реверт PR: вкладка исчезает, `layout` в заказах остаётся и никому не мешает, PDF ТЗ ещё нет;
- база — `down`-блок из шапки H (порядок: фронт → миграция не требуется, H безопасна и без фронта);
- перегрузку `sales_set_staff(uuid, boolean)` не возвращать: клиент её не зовёт.

## Порядок исполнения (воркфлоу)
T0 → (T1 ∥ T2 ∥ T3, worktree) → слияние → (T4 ∥ T5) → слияние → (T6 ∥ T7) → слияние → T8 → T9 → финальное ревью.

Перед одобрением — проверка скиллами по правилу 17.10:
- `system-design` / `architecture`;
- `testing-strategy`;
- агент-атакующий: Storage `garment-flats`, `catalog_put`, SVG, `layout`;
- `deploy-checklist` (H);
- `tech-debt`;
- `design-critique`, `accessibility-review`, `ux-copy` — для вкладки «Дизайн».

## Нужно от владельца
- Сухой прогон и применение H в SQL Editor до мерджа.
- После выкладки — нажать «Загрузить типовые флэты».
- `update_snapshots`.

---

### Critical Files for Implementation
- /home/user/PinheadOS/pinhead-react/src/orderstudio/workplace/OrderWorkplace.jsx
- /home/user/PinheadOS/pinhead-react/src/orderstudio/store/useSalesStore.ts
- /home/user/PinheadOS/supabase/migrations/20261017150000_order_catalogs.sql (подлинный текст `catalog_put` / `catalog_value_check` для миграции H)
- /home/user/PinheadOS/pinhead-react/scripts/bundle-budget.mjs
- /home/user/margolinilya-create/pnhd-design-maker/lib/geometry/view.ts (источник переноса: `placementInfo`, `fitToZone`, опоры отступа)

Ещё понадобятся:
- `/home/user/PinheadOS/pinhead-react/src/orderstudio/api/artworks.ts`
- `/home/user/PinheadOS/pinhead-react/src/orderstudio/screens/PrintRow.jsx`
- `/home/user/PinheadOS/pinhead-react/src/orderstudio/api/catalogAdmin.ts`
- `/home/user/PinheadOS/pinhead-react/e2e/support/mockSupabase.ts`
- `/home/user/PinheadOS/supabase/probes/order_v4_rights.sql`
- `/home/user/margolinilya-create/pnhd-design-maker/public/seed/skus.json`

## Проверка безопасности (агент-атакующий, 17.10): правки внесены в задачи
Critical нет. Принято:
- **H1 (T3, T7) XSS через сцену PDF.** `parseLayout` — строгий zod (конечные числа в границах, enum, id-регулярки, `source_file` ≤ 255, лишние ключи прочь); сборщик сцены — `num()` (не-число → исключение) и `esc`/`escAttr` для всех строк (клиент, позиция, цвет, зона, флэт); готовая сцена → `sanitizeSvg` режим `scene` (+`text`,`tspan`,`image` только с `data:image/(png|svg+xml);base64,`); holder не в `document.body` — спайк T0(в) проверяет svg2pdf на узле `document.implementation.createHTMLDocument()`, иначе `inert`-holder с очищенной сценой. Тесты: строка в числе → `null`; клиент с `"><image onerror>` → текст; e2e — экспорт с вредным `layout`: нет dialog и внешних запросов.
- **H2 (T5) blob: URL от неочищенного SVG.** Тип по байтам (`sniffArtwork`), не по ответу; SVG → `sanitizeSvg` → новый Blob; растр — новый Blob с типом по сигнатуре; превью — только при сигнатуре PNG. Сторож: в `design/**` нет `window.open`, `href` с object URL, `iframe/object/embed`. e2e: текст за blob-URL evil-логотипа без `<script`/`on…=`.
- **M1 (T3) санитайзер — белый список:** атрибуты по `localName`; `href` любого префикса — только `#…`; `url(` только `#…` во всех атрибутах; `style` удалить; `xml:base` удалить, `xmlns:*` только svg/xlink; только элементы и текст (без комментариев, CDATA, PI); `<!DOCTYPE`/`<!ENTITY` и `parsererror` → отказ; элементы только SVG_NS; `<use>` ≤ 500 без цепочек; SVG ≤ 5 МБ. Тест на каждый пункт + `animate`, `set`, `a`, `style @import`.
- **M2 (T3, T5) бомбы.** `sniff` читает размеры из заголовка (PNG IHDR, JPEG SOF, WEBP) — сторона > 12000 px или > 80 Мп → отказ, и при загрузке, и при скачивании; `loadPdf`: `maxImageSize` ≈ 16 Мп, `isEvalSupported:false`, `enableXfa:false`, без scripting/аннотаций, таймаут 30 с → `destroy()`.
- **M3 (T5) превью.** Вместо общего `uploadArtworkAt` — `uploadArtworkPreview(orderId, sourcePath, png)`: путь вычисляется, `isArtworkPath`, исходник не `.preview.png`, сигнатура PNG, `image/png`, `upsert:false`. Сторож: `.from('order-artworks').upload` только в `api/artworks.ts`. Удаление исходника удаляет и превью (`missingOk`). В правило и бэклог: уборка `order-artworks` и копирование в ERP (вехи 6–7) обязаны знать `.preview.png`.
- **M4 (T2)** тексты `catalog_put`/`catalog_value_check` — сверка с боем `pg_get_functiondef` в dryrun; пробы регресса (admin `sku_catalog` OK, rop `suppliers`/`labelLibrary` OK, rop `zonesCatalog` 42501).
- **M5 (T3, T5)** клиент не доверяет справочнику (прямая запись admin в `app_config` мимо RPC): `flatsSchema` сверяет формулу `svg_path`, `downloadFlatSvg` — `isFlatPath`.
- **L1** политику delete у `garment-flats` в 5а НЕ заводить (неизменяемость версий); в 5б — delete только неупомянутых версий.
  **Отменён решением К5 вехи 5б (18.10):** в 5б DELETE версий не заводится (ни политики, ни RPC «версия не упомянута») — старые версии нужны заказам, PDF и вехе 6, открытые вкладки держат справочник до 10 минут. Уборка ничьих версий `garment-flats` — в бэклоге с условиями К5: возрастной гейт и проверка ссылок (`history`, `layout`, `order_items.flat_id`) на сервере; туда же — сироты сохранений, сорвавшихся на P0001 после загрузки. Правило — `docs/rules/pravila-flety-i-zony-veha-5b-18-10.md`.
- **L2** пробы += отключённый admin, `copy` из чужого бакета, `move` наружу, `upsert:true`, путь с `\n`, верхний регистр, `v10000`; `catalog_value_check` += `version` 1…9999, `scale_mm_per_unit` ≤ 10, |коорд.| ≤ 5000, ≤ 256 точек, `name` ≤ 200.
- **L3** CHECK `order_items.flat_id` (`'' или ^[a-z0-9][a-z0-9-]{0,62}$`, not valid → validate); CHECK `layout->>'v' = '1'`.
- **L4** удаление `sales_set_staff(uuid,boolean)` безопасно; дописать README проб, SESSION-STATE, мок отвечает 404 PGRST202 на двухаргументный вызов.
- **L5** pdfjs: явный `workerPort = new Worker(url, {type:'module'})`; T8 — сценарий экспорта с CSP enforce через `page.route`, 0 нарушений.
- **L6** jspdf: optional-зависимости не в чанке, `npm audit`; запрет `pdf.html`, `addJS`, `output('bloburl'|'dataurlnewwindow')`; `svg2pdf` с `loadExternalStyleSheets:false`.
- **L7** pdfjs 4.10.38 — CVE-2024-4367 исправлена; без внешних `cMapUrl`/`standardFontDataUrl`.
- **L8** object URL освобождать и при замене картинки по пути.


## Проверка скиллами (архитектура, тесты, выкатка, техдолг, дизайн, доступность, тексты; 17.10): правки внесены
**Архитектура:**
- **T4 конвертер зон:** `chest` и `front` у одежды → `'front'`; `front` у шоппера → `'side-a'`; `back` → `'back'`; `label` → `null`. Сторож: у одежды нет зон без `zone_id`, каждый `zone_id` есть в `ZONES_CATALOG_DEFAULT`. Файлы DM `freefit-front.svg` переименовываются по `views[].flat_svg`; таблица точных `sku_codes` (T-006 → `tshirt-oversizecrop`, H-005 → `hoodie-reglan`, LS-001 → `longsleeve-classic-w`, BAG-* → `shopper-*`…); `pickFlat` детерминирован при равенстве.
- **T5 без задвоения:** логотип в зону, где уже есть неразмещённая строка с тем же `zone`, дописывает ей `layout`/`artwork_path`/мм — новое нанесение не создаётся (тест: цена та же).
- **`pickFlat`** проверяет, что флэт подходит текущей модели (`sku_codes` либо `category`+`fit`); сменили модель в «Изделии» → плашка «Модель сменилась — перенесите на новый силуэт» (`remapToFlat`), ничего не пишется само.
- **Цвет ткани:** `colorCodeOf(label, …)` (экспорт из `wizardAdapter.ts:76`) → `findPaletteColor(code, …)`.
- **`garmentFlats` не в общем `loadAllCatalogs`** (`lib/catalogs.ts:38` → `.neq('key','garmentFlats')`, T2); дизайн читает его сам — `design/catalog/useFlatsCatalog.ts` (`fetchCatalogKey` + `parseFlatsCatalog`, T5).
- **Undo** — снимок `{ prints, flat_id }`; `commit(fn)` от свежих `prints`; `orderId`/`itemKey` запоминаются до `await` загрузки — сменилась позиция → нанесение не создаётся (тест).
- **Отступ — по зоне и категории:** `zone_id = null` (этикетка) → `top_edge`; штаны → `top_edge` «от пояса»; иначе горловина (тесты).
- `ErrorBoundary key={item.key} fallback={…}`; T1 += `store/slices/orderSlice.ts:77–85`; перенос `TECH_TO_METHOD`/`METHOD_TO_TECH` — в T1 (не T3), чтобы T1 ∥ T3 не конфликтовали.
- 5б: версии геометрии флэта (`history[]`) — в бэклог.

**Тесты:** `sanitizeSvg` → `{ svg, removed[] }`, тест сида в jsdom по `removed.length === 0`; холст на эталоне — `data-ready` после декодирования, `Konva.pixelRatio = 1`, холст под маской, сцена проверяется снимком строки `buildPreviewSvg`; мутации += автозапись `flat_id` при монтировании, `foreignObject` разрешён, `commit` без `isEditable`, импорт `/erp/` в `design/**`; геометрия мм→px→мм с поворотом/отражением; пробы `order_v4_rights` 291/303/315 → трёхаргументная `'sales'`, 42883 — только 152/255/289/290/331 + новая; `catalogKeys.test.ts` читает последнюю миграцию с `catalog_put` + сторож «тело H = тело G, кроме `v_admin_pair`»; политики `garment-flats` начинаются с `bucket_id = 'garment-flats'`.

**Выкатка:** dryrun H — `count(*) where layout is not null` (ожидание 0), CHECK сразу `add constraint` (таблица малая); откат — объекты бакета удаляет владелец в панели, затем down-блок; сид — один ленивый чанк (`import.meta.glob(..., { eager: true, query: '?raw' })` внутри `seedFlats`), чтобы не вытеснять кэш SW (`public/sw.js`, лимит 150); `uploadFlatSvg` — `contentType: 'image/svg+xml'`.

**Техдолг:** методы — один модуль `model/printMethods.ts` (профили + маппинг; подписи из `METHOD_LABELS`); правила справочника — общий набор случаев `flatsCases.ts` для zod и проб, без TS-зеркала; `preflight` — только геометрия и файл, цена — `ISSUE_LABELS`, всё предупреждения; ростовку (`gradeRule`, `grading`, `gradingReview`) в 5а не переносить; T6 разрезан на **T6а** (холст) и **T6б** (панель + встройка), контракт слота `ExportPdfButton` — заранее; `zod` точно `4.3.6`; проверить пир react-konva против `react ^19.2.0`; растр в PDF ≤ 300 dpi от размера печати, превью ≤ 2048 px.

**Дизайн / доступность / тексты (минимум действий):**
- пресеты одной кнопкой «Центр груди», «Левая грудь», «Центр спины» (`presetPosition`/`STANDARD_PLACEMENT` DM); перетаскивание файла на холст и Ctrl+V; новое нанесение сразу выбрано, фокус в «Ширина»; Ш/В связаны пропорцией, замок-переключатель; в «Изделии» у строки — «Поставить на изделие →»;
- на «Дизайне» список изделий свёрнут в выпадающий «Изделие»; силуэт и «Перед / Спина» — в шапке холста, «Скачать PDF макета» — в шапке вкладки; поля `PrintRow` под раскрытием «Цвета, Pantone, эффект»; маркер вкладки «— не размещено N»; «Далее: клиент и доставка»;
- на холсте действие «Снять с изделия» (`layout = null`, строка остаётся) без подтверждения, тост «Нанесение снято с холста · Вернуть»; удаление строки — только в «Изделии»;
- `aria-live` с задержкой ~500 мс, видимое кольцо фокуса, фокус на строку слоя после загрузки/снятия, Esc снимает выбор;
- тач: `anchorSize` ≥ 24 и `hitStrokeWidth` на `pointer: coarse`, `touch-action: none`, кнопки слоёв ≥ 44 px; на 375 px вкладки — прокрутка/короткие подписи;
- цвета Konva — из токенов через `getComputedStyle` (две темы); обводка зоны по яркости ткани;
- тексты: «Типовых силуэтов пока нет. Загрузите 35 моделей одной кнопкой»; «Для этой модели нет силуэта — задайте нанесения строками» + «Открыть нанесения»; AI: «Пересохраните в Illustrator с флажком „Создать PDF-совместимый файл“ или в PDF/PNG»; PSD/TIFF: «Этот формат нельзя поставить на изделие — сохраните в PNG, SVG или PDF. Приложить файл можно на вкладке «Изделие»»; в PDF: «силуэт типовой, не лекало модели»; пустые: «Сначала выберите модель на вкладке «Изделие»», «Перетащите логотип сюда или нажмите «Загрузить логотип»».


## Ответы владельца после проверки (17.10)
- **DPI — как в дизайн-мейкере:** DTF и шелкография 300/150 (предупреждение/серьёзное предупреждение), DTG и флекс 300/150, вышивка — подсказка о мелких деталях; ничего не блокирует (T3 `model/printMethods.ts`, `preflight`).
- **Отдельные зоны штанов:** `pants-front` «Штанина перед» и `pants-back` «Штанина зад», `forCategories: ['pants']`, опора — пояс (`top_edge`).
  - T1/T3: `ZONES_CATALOG_DEFAULT` (`data/constants.js`), а у `front`/`back` — исключение штанов, если поле позволяет; иначе по `forCategories` (проверить `zonesForSku`).
  - T2, миграция H: дописать две зоны в живой `app_config.zonesCatalog`, если ключ есть и зон нет (идемпотентно, `jsonb`), с пробой.
  - T4: конвертер у `pants-*` даёт `zone_id` `pants-front`/`pants-back`.
  - Сторож сида: каждый `zone_id` есть в справочнике зон.

