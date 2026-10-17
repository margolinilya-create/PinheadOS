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

## Ядро (задача 3, 17.10) — чистый код без React

| Модуль | Что |
|---|---|
| `types.ts`, `limits.ts` | флэт, вид, зона (`zone_id`), раскладка `PrintLayoutV1`, размещение; границы данных (общие с SQL H) и формула пути SVG |
| `geometry/` | перенос DM 1:1: `coords`, `dimension`, `zone`, `view` (пресеты, `placementInfo`, `yForNecklineOffset`), `dimensionLines`. Ростовка (`grading*`, `gradeRule`) — веха 5б |
| `catalog/` | `flatsSchema` (`zod/mini`, терпимый `parseFlatsCatalog`), `flatsCases` (случаи для zod и проб H), `pickFlat`, `categoryMap`, `dpi`, `svgMeta`, `fitOrder`, `zoneFit` |
| `assets/` | `sanitizeSvg` (белый список, режим `scene`), `sniffArtwork` (тип и размер по байтам), `loadAsset` (без PDF) |
| `model/` | `layout` (`parseLayout` строгий, `placementOf`, `applyPlacement`, `newPlacedPrint`, `remapToFlat`), `offset` (таблица решения 4) |
| `export/` | `resolveFlat`, `flatMarkup`, `buildPreviewSvg`, `buildSceneSvg` (лист PDF), `preflight`; строки — `svgText` (`num`, `esc`, `safeImageHref`) |

Профили техник — в `model/printMethods.ts` (задача 1): ядро берёт их аргументом
(`ProfileOf`, `methodAllowed`) и своих не держит. Сторожа модуля — `designGuards.test.ts`
(нет импортов ERP, нет HTML-строкой в DOM, ядро без React); паритет цены холста и строки —
`model/pricingParity.test.ts`.

## PDF макета (задача 7, 17.10)

| Модуль | Что |
|---|---|
| `export/maketPages` | листы PDF (вид с размещениями, перед раньше спины), номер нанесения = место в позиции, строка легенды, ASCII-имя `PH-1234-<модель>-<цвет>-maket.pdf`, `MaketPdfError`. Лёгкий: его статически читает кнопка |
| `export/svgForPdf` | логотипы для сцены: SVG без вырезанного — вектором; что-то вырезано — растр 300 dpi от размера печати и пометка «логотип N — растр»; PNG как есть (крупнее 300 dpi — уменьшается), JPEG/WEBP → PNG; PDF/AI — превью `<путь>.preview.png`, пометка «растр из PDF» |
| `export/exportPdf` | движок: jsPDF 4 + svg2pdf 2.8, лист на вид, сцена `buildSceneSvg` (+ легенда и пометки), шрифты. **Только `import()` по клику** (`pdfGuards.test.ts`) |
| `ui/panel/ExportPdfButton` | слот «Скачать PDF макета» для T6б: `<ExportPdfButton order item flat disabled />`; preflight (вопрос, не запрет), «Готовлю PDF…», файл — `utils/saveBlob` |

Растр SVG-логотипа рисует браузер в `<img>` из `data:`-URL (не `blob:`): скрипты в картинке
не исполняются, сеть не трогается. Рисуется исходник (цвета из `style`, которые режет
санитайзер, сохраняются), а с усилителями (`<use>`, вложенные `<image>`, `<foreignObject>`)
— очищенный текст. Сцена — `DOMParser` + `importNode` в `createHTMLDocument()`, вне страницы.

**svg2pdf меряет ширину текста шрифтом БРАУЗЕРА** (canvas/`getBBox` по имени семейства):
движок регистрирует тот же TTF через `FontFace` из байтов, иначе правый край шапки и центр
плашек съехали бы на ширину запасного шрифта. Жирный в сцене — только `bold`: «800» svg2pdf
ищет как отдельное начертание и уходит на Times без кириллицы.

### Шрифты PDF макета

`export/fonts/LiberationSans-{Regular,Bold}.subset.ttf` — подмножество Liberation Sans 2.1.5
(тот же файл, что в DM `public/fonts`): латиница, Latin-1, кириллица (+ Ґґ), типографика,
№, €, ™, −, ≈, ≠, ≤, ≥; без хинтинга и таблиц вёрстки — **23 332 / 23 404 Б** (было 410 КБ).
У изменённой версии основное имя не может быть зарезервированным «Liberation» (OFL, условие 3),
поэтому внутреннее имя — «PH Maket Sans», семейство в jsPDF — `PHMaketSans`
(`PDF_FONT_FAMILY`); лицензия — `fonts/OFL.txt`. В шрифте нет ₽ (его нет и в исходнике).

Как получено (fontTools 4.67, разово):

```bash
U='U+0020-007E,U+00A0-00FF,U+0400-045F,U+0490-0491,U+2010-2027,U+2030,U+2032-2033,U+2039-203A,U+20AC,U+20BD,U+2116,U+2122,U+2212,U+2248,U+2260,U+2264-2265'
for s in Regular Bold; do
  pyftsubset LiberationSans-$s.ttf --unicodes="$U" --layout-features='' --no-hinting \
    --drop-tables+=GDEF,GPOS,GSUB,FFTM --name-IDs='0,1,2,3,4,5,6,13,14' \
    --name-languages='0x409' --name-legacy --output-file=LiberationSans-$s.subset.ttf
done
# имена: 1 «PH Maket Sans», 4 «PH Maket Sans[ Bold]», 6 «PHMaketSans-<Regular|Bold>»,
# 3 «PHMaketSans-<…>;2.1.5-subset»; 0 (copyright) и 13/14 (OFL) — как в исходнике
python3 -c "
import sys; from fontTools.ttLib import TTFont
for s in ('Regular','Bold'):
    f=TTFont(f'LiberationSans-{s}.subset.ttf'); n=f['name']
    for i in (1,3,4,6,16,17): n.removeNames(nameID=i)
    full='PH Maket Sans' + ('' if s=='Regular' else ' Bold')
    for i,v in ((1,'PH Maket Sans'),(3,f'PHMaketSans-{s};2.1.5-subset'),(4,full),(6,f'PHMaketSans-{s}')): n.setName(v,i,3,1,0x409)
    f.save(f'LiberationSans-{s}.subset.ttf')"
```

## Вкладка «Дизайн» — панель и встройка (задача 6б, 17.10)

| Модуль | Что |
|---|---|
| `ui/DesignTab.jsx` | ленивый корень чанка холста (`React.lazy` в `OrderWorkplace`, маркер `data-design-canvas`): шапка (силуэт, «Перед / Спина», отмена/возврат, «Скачать PDF макета»), холст, панель; плашки «нет модели / нет силуэта / модель сменилась» |
| `ui/konvaCore.ts` | ядро konva без `Tween`/`Animation`/`FastLayer` — подмена `konva/lib/Core` (`vite.config.js`, `resolve.alias`) |
| `assets/imageLayer.ts` | кэши картинок по требованию (`flatImagesModule`/`artworkImagesModule`, освобождение — только загруженного); `assets/garmentHex.ts` — цвет ткани синхронно |
| `ui/useDesignTab.js` | данные и действия вкладки: `pickFlat`, привязка стора (`bind`), отложенный `reset` при уходе (смена позиции перемонтирует вкладку — картинки не качаются заново), правки холста через `commit`, смена силуэта (подтверждение + `remapToFlat`) |
| `ui/useArtworkActions.js` | конвейер логотипа (`assets/useAddArtwork`) — `import()` по действию |
| `ui/DesignPreview.jsx` | ≤ 760 px: `buildPreviewSvg` → `<img>` (ленивый чанк) |
| `ui/panel/*` | `DesignSide` (панель; `React.lazy` из `DesignTab`), `ArtworkPicker`, `LayerList`/`LayerRow` (порядок = номер в ТЗ, «Снять с изделия» + «Вернуть»), `GeometryInspector` (ленивый; техника, пресеты, Ш × В с замком, отступы, поворот, отражение, DPI), `MmField` (правка на blur/Enter), `PreflightList`, `UnplacedList` («Без холста»; раскладка, которую холст не показывает, — «Освободить раскладку»: `layout = null`, иначе строка на «Изделии» заперта), `FlatPicker`, `ViewTabs`, `panelOps` (чистые правки), `maketExport` (лёгкие загрузчики и `hasMaketPages`) + `maketTools` (листы, проверка, имя файла — по клику) |
| `model/layoutMark.ts` | **строгий разбор раскладки без zod** (`parseLayout`, `hasPlacedLayout`, `unplacedCount`): его читают холст и оболочка Order (строка `PrintRow placed`, маркер вкладки). Совпадение с прежней схемой `zod/mini` — тест-эталон `layoutMark.test.ts` |

Встройка: `OrderWorkplace` — вкладка `design` (`?tab=design&item=`), позиции выпадающим списком,
`ErrorBoundary key={item.key}`; `ItemTab` → `PrintRow placed` (зона, мм — только чтение,
«Изменить на холсте»; без раскладки — «Поставить на изделие →»).

### Бюджет холста после 6б, раунд 1 ревью (сборка с фиксированным SHA)

До раунда 1 граф холста был 109 904 Б из 100 000 (красный). Потолок спеки **не поднят**:

| Что | Б gzip | Потолок |
|---|---:|---:|
| `vendor-konva` (ядро без `Tween`/`Animation`/`FastLayer`: `ui/konvaCore.ts`, подмена `konva/lib/Core` в `vite.config.js`) | 76 274 | |
| `DesignTab` (холст 6а, стор 5, шапка, кнопка PDF) | 20 289 | |
| **Холст итого** | **96 563** | 100 000 |
| Кэши картинок (`flatImages` + `artworkImages` с `sanitizeSvg`, `sniff`; `assets/imageLayer` грузит их по первой картинке) | 8 542 | 9 400 |
| Панель (`ui/panel/DesignSide` — `React.lazy` рядом с холстом, + `preflight`) | 5 292 | 5 800 |
| Листы PDF (`ui/panel/maketTools`: листы, проверка, имя файла — по клику) | ≈ 900 | в PDF макета |

**Честно:** вкладка при открытии (холст + картинки + панель) — ≈ 110,4 кБ, столько же,
сколько было. Реально меньше стало только ядро konva (−3,1 кБ); остальное — разнос
по чанкам, которые грузятся параллельно (панель) или по требованию (картинки — только
при флэте/логотипах, листы PDF — по клику). `bundle-budget` печатает сумму справочно.
PDF макета и pdfjs считаются за вычетом кэшей картинок: PDF доступен только с флэтом
и размещениями, а их холст (или превью телефона) к этому моменту уже показал.

Правила дальше: новое в холст — только то, что нужно для первой отрисовки; Tween/Animation
не возвращать мимо `konvaCore.ts` (сторож `konva.test.ts` сверяет и подмену в конфиге).
`vendor-react` +64 Б (прогноз задачи 0: `vendor-konva` берёт из него `scheduler` и
помощники CommonJS): вход 151 753 → ≈ 151 820, оболочка ERP 194 369 → ≈ 194 430 —
в пределах потолков; вынести эти привязки — правка `manualChunks` (T8), не раунда 1.

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
