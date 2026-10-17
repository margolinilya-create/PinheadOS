# `orderstudio/design/` — вкладка «Дизайн» (веха 5а)

План: `docs/superpowers/plans/2026-10-17-order-flow-m5a-design.md`. Этот файл — карта
модуля и замеры задачи 0 (спайк 17.10). Код модуля появляется в задачах 3–7.

## Карта (целевая, по плану)

| Папка | Что | Задача |
|---|---|---|
| `types.ts`, `catalog/` | типы, `flatsSchema` (zod), `flatsCases`, `pickFlat`, `useFlatsCatalog` | T3, T5 |
| `assets/` | `sanitizeSvg`, `sniffArtwork`, `loadPdf` (pdfjs, ленивый) | T3, T5 |
| `seed/` | `seedFlats` + `flats/*.svg` + `garmentFlats.seed.json` — только кнопка сида | T4 |
| `store/` | `useDesignStore` (выбор, вид, масштаб, undo) | T5 |
| `ui/` | `DesignTab` (ленивый корень, маркер `data-design-canvas`), `canvas/`, `panel/` | T6а, T6б |
| `export/` | `exportPdf` (jsPDF + svg2pdf, ленивый по клику), сцена | T7 |

**Из ERP в `design/**` — ни одного импорта** (план, решение 9).

## Зависимости (задача 0, точные версии)

| Пакет | Версия | Чанк |
|---|---|---|
| `konva` | 9.3.22 | `vendor-konva` |
| `react-konva` | 19.2.7 (пир `react ^19.2.0`, у нас 19.2.4; 19.3.x требует `^19.3.0`) | `vendor-konva` |
| `jspdf` | 4.2.1 | `vendor-pdf` |
| `svg2pdf.js` | 2.8.1 | `vendor-pdf` |
| `pdfjs-dist` | 4.10.38 | `vendor-pdfjs` |
| `zod` | 4.3.6 (был транзитивно у `eslint-plugin-react-hooks` — дедуп, одна копия) | в чанке потребителя |

`npm audit` после установки — 0 уязвимостей (17.10). `react-reconciler` 0.33.0 и `scheduler`
0.27.0 — одна копия с `react-dom` 19.2.4.

**Необязательные зависимости jsPDF** (`html2canvas`, `dompurify`, `canvg`) ставятся npm,
но в сборку не попадают: плагин `jspdfWithoutOptional` в `vite.config.js` заменяет их
`import()` отказом. Без него (замер спайка) помощник предзагрузки `__vitePreload` уезжал
в `vendor-pdf`, и **вход статически импортировал весь jsPDF: 151 → 303 кБ**. `pdf.html`,
`addJS`, `output('bloburl' | 'dataurlnewwindow')` запрещены (проверка безопасности L6).

## Базовый замер (до задачи 0, сборка с `VERCEL_GIT_COMMIT_SHA=000000000000base`)

Маркер сборки (`__BUILD_ID__`) зашит во вход: при сборке без фиксированного SHA длина
ISO-времени даёт другой gzip входа (±20 Б), поэтому сравнивать — только с фиксированным SHA.

| Что | Б gzip | Потолок |
|---|---:|---:|
| Вход, JS | 151 750 | 155 000 |
| Оболочка ERP, JS | 194 369 | 195 000 |
| Оболочка ERP, CSS | 15 905 | 16 000 |
| Оболочка Order, JS (вход + OrderStudioApp + OrderWorkplace) | 267 043 | — (справочно) |

**После задачи 0 (зависимости + `manualChunks` + плагин) — побайтно то же**: тот же набор
файлов `dist/assets` с теми же хешами, те же числа. Пока код модуля пакеты не импортирует,
сборка их не видит.

## Спайк (17.10, на выброс — в коммит не вошёл)

Проверено в Chromium (Playwright, страница на dev-сервере) и сборкой Vite 7:

- **(а) Core-импорты.** `konva/lib/Core` + `konva/lib/shapes/{Image,Rect,Line,Text,Transformer}`
  и `react-konva/lib/ReactKonvaCore` работают: у `konva` 9 нет `exports` (подпути свободны),
  у `react-konva` 19 подпуть `./lib/*` отдаёт `./es/*.js`. Alias не нужен.
  Внимание: `konva/lib` в 9.x — CommonJS, дерево не трясётся по экспортам, только по файлам.
- **(б) pdfjs.** `pdfjs-dist/build/pdf.mjs` (не legacy) + `pdf.worker.min.mjs?url` +
  `GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' })` (L5),
  `isEvalSupported: false`, `enableXfa: false`, `maxImageSize` — страница отрисована
  в canvas, ошибок консоли нет. Воркер — ассет `assets/pdf.worker.min-<hash>.mjs`,
  1 375 838 Б (402 121 Б gzip), в JS-граф не входит.
- **(в) jsPDF 4 + svg2pdf 2.8.** Узел сцены — в `document.implementation.createHTMLDocument()`
  (через `DOMParser` + `importNode`, НЕ в `document.body`): `svg2pdf(svg, pdf, {
  loadExternalStyleSheets: false })` рисует, holder в основном документе не появлялся.
  Кириллица — LiberationSans через `?url` + `addFileToVFS`/`addFont`: `pdftotext` извлёк
  «Макет: Футболка «Оверсайз», грудь 280×120 мм», шрифт встроен (CID TrueType, Identity-H).
  Вложенный SVG-логотип `<image href="data:image/svg+xml;base64,…">` svg2pdf рисует
  **вектором** (в PDF нет Image XObject, цвета логотипа есть в растре страницы) — запасной
  растр 300 dpi нужен только для логотипов, у которых санитайзер что-то вырезал (план, §10).
  Шрифт: полный LiberationSans-Regular — 410 820 Б; подмножество (латиница, кириллица,
  типографика, №, ₽, ×) — 42 648 Б (27 624 Б gzip) — его и класть в T7 (+ `OFL.txt`).
- **(г) zod.** В ленивом чанке Rollup: `zod` (classic) ≈ 19 кБ gzip на схеме флэтов,
  `zod/mini` ≈ 6,5 кБ. **Решение: `zod/mini`** (`z.strictObject`, `.check(z.regex(…))`,
  `z.safeParse(schema, v)`); проверки формы — те же.

### Замеры чанков (Rollup, gzip)

| Граф | Состав | Б gzip | Потолок в `bundle-budget` |
|---|---|---:|---:|
| Холст (`DesignTab` минус оболочка Order) | konva core + 6 фигур + `Arrow` + reconciler + zod | 107 187 | 100 000 ✗ |
| то же | без `Arrow`, `zod/mini` | **86 758** (konva 79 266 + 7 492) | 100 000 ✓ |
| PDF макета (`exportPdf` минус холст и Order) | jsPDF + svg2pdf + fflate + fast-png (+ pako, iobuffer) | 152 500 | 160 000 |
| pdfjs (`loadPdf` минус холст и Order) | pdfjs-dist | 98 808 | 104 000 |

**Холст тесный.** Пол — konva + reconciler 79,3 кБ (из них `react-reconciler` ≈ 35 кБ);
`zod/mini` 6,5 кБ; нашему коду холста, панели, стора и геометрии остаётся ≈ 14 кБ gzip.
Отсюда правила для T3/T5/T6:
1. **Не импортировать `konva/lib/shapes/Arrow`** — он тянет `Path` + `BezierFunctions`
   (+8,5 кБ). Стрелку отступа рисовать `Line` (+ треугольник `Line closed`).
2. Только Core-импорты (`konva/lib/Core`, `react-konva/lib/ReactKonvaCore`), не `konva`
   и не `react-konva` целиком.
3. Если код холста не влезает — **разбор схемы флэтов уходит в свой ленивый чанк**
   (`import('../catalog/flatsSchema')` из `useFlatsCatalog`; тот же чанк нужен вкладке
   «Флэты и зоны» T4), а не поднимается потолок: потолок 100 кБ — из спеки, не по замеру.
4. `sanitizeSvg`/`sniffArtwork` (нужны и холсту, и PDF) лягут в граф холста — PDF-чанк
   их не дублирует (`minus` в страже).

### Цена для оболочки ERP, когда холст появится (прогноз T6)

`vendor-konva` импортирует из `vendor-react` ещё 4 привязки (`react`, `scheduler`,
помощники CommonJS) — список экспорта общего чанка растёт: **`vendor-react` +64 Б gzip**,
оболочка ERP 194 369 → ≈ 194 412–194 434 (запас 631 → ≈ 570 Б). Это не код дизайна
в оболочке (страж и маркер это подтверждают), а цена общего React-чанка; ERP и наш код
на это не влияют. Варианты, если запаса не хватит (решение владельца/контроллера, не T0):
сжать вход (`index-*.js` 13,9 кБ: `AuthScreen` 6,2 кБ сырого, `useAuthStore` 5,0,
`ErrorBoundary` 2,2) — ERP не трогается.

## Стражи бюджета (`scripts/bundle-budget.mjs`)

- `FORBIDDEN_IN_SHELL` += `vendor-konva`, `vendor-pdf`, `vendor-pdfjs` (вход и оболочка ERP).
- **Оболочка Order** (вход + `OrderStudioApp` + `OrderWorkplace`, ключи по `name`): нет трёх
  вендоров дизайна; нет сида флэтов (ключи `design/seed/**` и строки `./flats/<имя>.svg`
  ключей `import.meta.glob` — статический импорт вклеивается без записи в манифесте).
- **Маркер `data-design-canvas`** (литерал в `DesignTab.jsx` — T6а обязан его оставить)
  не встречается ни во входе, ни в оболочках ERP и Order.
- **Холст** ≤ 100 000, **PDF макета** ≤ 160 000, **pdfjs** ≤ 104 000 Б gzip.
- Пока исходника модуля нет — «⧗ проверка пропущена»; есть исходник, нет в манифесте —
  красный. T8 ставит `DESIGN_REQUIRED = true`.

Проверено мутацией на спайке (17.10):
- статический импорт `DesignTab` в `OrderWorkplace` → красный (`vendor-konva` в оболочке
  Order и маркер в чанке `OrderWorkplace`);
- `Arrow` + полный `zod` → красный (холст 107 187 из 100 000);
- статический импорт `seedFlats` в `OrderWorkplace` → красный (по содержимому; по манифесту
  этот случай не виден).
