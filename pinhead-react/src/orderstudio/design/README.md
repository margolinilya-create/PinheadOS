# `orderstudio/design/` — вкладка «Дизайн» (веха 5а)

План: `docs/superpowers/plans/2026-10-17-order-flow-m5a-design.md`. Этот файл — карта
модуля и замеры бюджета (задачи 0–8, 17–18.10). Правила (что можно и чего нельзя) —
`docs/rules/pravila-dizain-meikera-veha-5a-18-10.md`.

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

## Сид флэтов и вкладка «Флэты и зоны» (задача 4, 17.10)

| Модуль | Что |
|---|---|
| `seed/flats/*.svg`, `seed/garmentFlats.seed.json` | 35 флэтов и 67 SVG дизайн-мейкера в нашем формате; получены `scripts/flats-seed-convert.mjs` (разово, правила зон и таблица точных моделей — в шапке скрипта) |
| `seed/seedFlats.ts` | кнопка сида: свежее чтение `garmentFlats` → по каждому недостающему флэту `sanitizeSvg` → `uploadFlatSvg` (`upsert:false`, «уже есть» = успех, по 4 одновременно) → последним `putCatalog`; SVG — `import.meta.glob(..., { eager: true, query: '?raw' })` внутри модуля, один ленивый чанк |
| `seed/seedInfo.ts` | `SEED_FLATS_COUNT`, `SEED_FILES_COUNT` — тексты вкладки без загрузки сида |
| `admin/tabs/FlatsTab.jsx` (вне `design/`) | `/order-settings?tab=flats`: таблица силуэтов, кнопка «Загрузить типовые флэты» (admin, director; не на ≤ 760), прогресс и прореженные объявления |

Сторож сида — `seed/garmentFlatsSeed.test.ts` (схема, санитайзер без вырезанного, `zone_id` в справочнике
зон, подбор силуэта для каждой модели каталога), правила конвертера — `seed/flatsSeedConvert.test.ts`.

## Стор, ассеты, загрузка логотипа (задача 5, 17.10)

| Модуль | Что |
|---|---|
| `store/useDesignStore.ts` | выбор, вид, масштаб, история; `bind(orderId, itemKey)` ничего не пишет; `commit(label, fn, key?)` — правка от свежей позиции, запись только `useSalesStore.edit`, снимок `{ prints, flat_id }`, предел 50, слияние 800 мс; только черновик и не конечное состояние сохранения; `reset()` и `registerAppReset` |
| `model/editItem.ts`, `model/placeArtwork.ts`, `model/orderArtworks.ts` | правки позиции; размещение логотипа «без задвоения» (неразмещённая строка той же зоны получает раскладку); «Логотипы заказа» |
| `assets/artworkImages.ts`, `assets/flatImages.ts` (+ хуки `useArtworkImage`, `useFlatImage`) | кэши картинок: скачивание → `sniff` по байтам → SVG через санитайзер в новый Blob, растр — новый Blob с типом по сигнатуре; > 4096 px — уменьшение; object URL освобождаются при сбросе и замене |
| `assets/loadPdf.ts` | pdfjs только `import()`: свой воркер (`workerPort`), без eval/XFA, `maxImageSize` 16 Мп, таймаут 30 с, один PDF за раз; превью 300 dpi, ≤ 2048 px |
| `assets/useAddArtwork.ts` | конвейер: проверка → загрузка в `order-artworks` при выборе → превью PDF/AI `<путь>.preview.png` (`uploadArtworkPreview`) → один `commit` вместе с `flat_id`; сменилась позиция — нанесение не создаётся |
| `catalog/useFlatsCatalog.ts` | свежий `fetchCatalogKey('app_config','garmentFlats')` + схема своим ленивым чанком, кэш 10 мин |

Сторожа: `assets/assetGuards.test.ts` (pdfjs только в `loadPdf`, `createObjectURL` только в кэшах,
без `href`, нет подписанных ссылок, zod — только `zod/mini`), `orderstudio/artworkWrites.test.ts`
(запись `order-artworks` — только `api/artworks.ts`).

## Холст (задача 6а, 17.10)

| Модуль | Что |
|---|---|
| `ui/konva.ts`, `ui/konvaCore.ts` | Core-импорты konva и react-konva; ядро без `Tween`/`Animation`/`FastLayer` |
| `ui/canvas/EditorCanvas.jsx` | холст: контракт `<EditorCanvas flat view prints selectedKey readOnly onSelect onCommit onDropFile orderId colorHex onUndo onRedo />` (шапка файла); `role="application"`, сброс и вставка файла, `aria-live` с задержкой 500 мс, `data-ready` |
| `ui/canvas/PlacementNode.jsx`, `canvasOverlays.jsx` | узел размещения (на `pointer: coarse` — `hitStrokeWidth`), сетка, зоны, оси, размеры, привязки |
| `ui/canvas/useCanvasViewport.ts`, `useCanvasKeys.ts`, `useCanvasTheme.ts`, `usePlacementImages.ts` | масштаб и сдвиг (мм ↔ px), клавиши (стрелки, Esc, Delete, Ctrl+Z), цвета из токенов, картинки размещений |
| `ui/canvas/canvasMath.ts`, `canvasChange.ts`, `canvasText.ts` | чистая математика, правки `dragend`/`transformend` → поля нанесения, тексты для читалки |
| `ui/DesignIcon.jsx`, `ui/designIcons.ts` | свой набор иконок Order (20 форм по Lucide, ISC) |

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
| PDF макета (`exportPdf` минус холст и Order) | jsPDF + svg2pdf + fflate + fast-png (+ pako, iobuffer) | 152 500 | 160 000 (с вехи 6+7 — 161 380: вынос `pdfCore`, замер T0 + 2 КБ) |
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
- **Холст** ≤ 100 000, **PDF макета** ≤ 160 000 (с вехи 6+7 — ≤ 161 380: общий движок `export/pdfCore.ts` с ТЗ, замер задачи 0 вехи 6+7 + 2 048), **pdfjs** ≤ 104 000 Б gzip.
- Пока исходника модуля нет — «⧗ проверка пропущена»; есть исходник, нет в манифесте —
  красный. T8 ставит `DESIGN_REQUIRED = true`.

Проверено мутацией на спайке (17.10):
- статический импорт `DesignTab` в `OrderWorkplace` → красный (`vendor-konva` в оболочке
  Order и маркер в чанке `OrderWorkplace`);
- `Arrow` + полный `zod` → красный (холст 107 187 из 100 000);
- статический импорт `seedFlats` в `OrderWorkplace` → красный (по содержимому; по манифесту
  этот случай не виден).

## Задача 8 (18.10): e2e, axe, эталоны, финальный бюджет

- **e2e** — `e2e/order-design.spec.ts` (открытие ничего не пишет; PNG 300 dpi → бакет заказа
  и раскладка v1; техника и ширина меняют цену; стрелки и Ctrl+Z; «Спина» + SVG со `<script>`
  и `onload` — в blob только очищенное, PDF собирается, ни диалога, ни внешних запросов;
  PDF макета — `%PDF`, < 8 МБ, текст «Грудь» и номер заказа извлекается pdfjs в Node;
  логотип PDF → исходник и `<путь>.preview.png`; `ready_to_launch` — только чтение, PDF
  скачивается; 390 px — превью `<img>` без холста; axe; **CSP боя в режиме enforce** на
  собранном приложении — логотип PDF (воркер pdfjs) и PDF макета без нарушений). Сид флэтов
  и rop без кнопки — `order-settings.spec.ts`; строка `PrintRow placed` → «Изменить на холсте» —
  `order-workplace.spec.ts`. Фикстуры — `e2e/fixtures/logo-300dpi.png` (pHYs 11811 px/м),
  `logo-evil.svg`, `logo.pdf`; флэты — из сида (`e2e/support/flatsFixture.ts`).
- **Эталоны** `studio-design` (холст под маской — пиксели konva зависят от растеризатора)
  и `studio-settings-flats`: пока PNG нет, тест пропускается (`skipUntilBaseline`), снимает
  владелец `update_snapshots`.
- **Замок пропорций** (`panelOps.resized`) берёт пропорцию файла, если стороны — её округление
  до мм: e2e поймал 51 × 25 → 200 × 98 (логотип сплющен на 2 %).
- **Бюджет**: `DESIGN_REQUIRED = true`. Вход 151 780 / оболочка ERP 194 405 против замера
  задачи 0 151 750 / 194 369 — кодом выросла только `vendor-react` (+22 Б: привязки React
  и `scheduler` для react-reconciler, экземпляр React один), остальное — длина хешей имён чанков.
  Было +64 Б: помощник `commonjsGlobal` для konva жил в `vendor-react` — его снимает плагин
  `konvaWithoutNodeGlobal` (`vite.config.js`, сторож — `ui/konva.test.ts`). Холст 96 627,
  картинки 8 545, панель 5 297, PDF макета 159 426, pdfjs 99 991 — все в потолках.

## Замеры 5б (веха 5б, задача 0, 18.10)

**Сверка путей с 5а (шаг 1) — расхождений нет.** На месте: `ui/DesignTab.jsx`, `ui/konva.ts`,
`ui/panel/ViewTabs.jsx`, `ui/canvas/useCanvasViewport.ts`, `ui/DesignIcon.jsx`, `ui/designIcons.ts`,
`ui/DesignPreview.jsx`, `export/exportPdf.ts`. Сверх плана 5а есть `ui/konvaCore.ts` — ядро konva
без `Tween`/`Animation`/`FastLayer` (подмена `konva/lib/Core` в `vite.config.js`): редактор флэта
(T6а) берёт konva только через `ui/konva.ts` и тоже получает это ядро. Фигуры `konva.ts` —
`Image`, `Rect`, `Line`, `Text`, `Transformer` (+ `Stage`, `Layer`, `Group` из ядра); новых не
заводить (К14: ручки — `Rect` с `cornerRadius`, многоугольник — `Line closed`).

**Базовый замер (шаг 2)** — база 5а на ветке 5б (`ca25e9c1`), сборка с
`VERCEL_GIT_COMMIT_SHA=000000000000base`. Записан в `scripts/bundle-baseline.json`:

| Что | Б gzip | Потолок | В базе (без сжатия, нормализовано) |
|---|---:|---:|---:|
| Вход, JS | 151 780 | 155 000 | 498 594 (gzip 151 563) |
| Оболочка ERP, JS | 194 405 | 195 000 | 615 662 (gzip 192 908) |
| Оболочка ERP, CSS | 15 905 | 16 000 | 75 587 (gzip 15 905) |
| Оболочка Order, JS | 269 093 | — | справочно |
| Холст «Дизайн» (`DesignTab` минус оболочка Order) | 96 627 | 100 000 | справочно |
| из него `vendor-konva` | 76 258 | — | справочно |
| Кэши картинок | 8 545 | 9 400 | справочно |
| Панель «Дизайн» | 5 297 | 5 800 | справочно |
| PDF макета | 159 426 | 160 000 | справочно |
| pdfjs | 99 991 | 104 000 | справочно |
| Вкладка «Флэты и зоны» (`FlatsTab` минус `OrderSettings` и оболочка Order) | 12 826 | — | справочно |
| Редактор флэта | — (ещё нет) | 45 000 (временный, T7 — замер +10 %) | — |

Числа «В базе» — gzip НОРМАЛИЗОВАННОГО текста (хеши имён → `-HASH`, маркер сборки → `BUILD`),
поэтому они ниже фактического gzip (вход −217 Б, оболочка ERP JS −1 497 Б): строки короче.

**Стражи 5б (шаг 3, `scripts/bundle-budget-5b.mjs`, подключён из `bundle-budget.mjs`):**
- **Вход и оболочка ERP против базы:** размер без сжатия с нормализованными хешами
  (`-[A-Za-z0-9_-]{8}.js|css|…` → `-HASH`) и маркером сборки (из `dist/version.json`) — побайтно,
  gzip нормализованного текста — ±16 Б. Иначе красный: «⚠ … изменилось на N Б» и список файлов
  (`+` новый, `−` пропал, `~` изменился). Разбор — до мерджа, правка ERP запрещена. Осознанный
  рост — решение вслух: `npm run bundle:budget -- --write-baseline` и строка с причиной здесь.
- **konva не в статическом графе** `OrderSettings`, `FlatsTab`, `FlatPreview` (чанк `vendor-konva`
  и модуль `design/ui/konva.ts`, если он станет общим чанком).
- **Редактор флэта** = граф `admin/flats/FlatEditor` минус оболочка Order минус граф холста
  `DesignTab`, ≤ 45 000 Б gzip.
- Модули 5б, которых ещё нет, — «⧗ ещё нет»; есть, но `FlatsTab` их ещё не грузит —
  «⧗ не подключён» (ветка зелёная между T6а и T6б); подключён и нет в манифесте — красный.
  T7 ставит `FLATS_REQUIRED = true`.
- Остальные графы печатаются с разницей против базы («Разница с базой (справочно)»).

Проверено (18.10):
- сборка **без** фиксированного SHA (маркер — ISO-время): фактический gzip оболочки 210 288
  против 210 310, а нормализованные числа — те же, «содержимое то же»;
- мутация «статический импорт `FlatEditor` (с `Stage`/`Rect` из `ui/konva`) в `FlatsTab`» —
  красный дважды: «konva в статическом графе FlatsTab» и «FlatEditor подключён, но не найден в
  манифесте»; вкладка флэтов 12 826 → 89 173. Тот же импорт через `lazy(() => import())` —
  зелёный, редактор считается отдельно (заглушка — 182 Б), вход и оболочка ERP «как в базе»
  при новом хеше `FlatsTab`;
- мутация «14 байт дописаны в `vendor-react`» — красный по входу и по оболочке ERP с именем файла.
- Юнит — `design/bundleBudget5b.test.ts` (нормализация, сравнение с базой, konva в графе, подключение).

**Граф оболочки ERP и входа (шаг 3б).** Сборка с `--sourcemap` во временный каталог, источники
карт файлов входа (3 файла) и оболочки ERP (13 файлов): `utils/skuRules.ts`,
`store/slices/catalogSlice.ts` и `types/catalog.ts` **не входят** ни во вход, ни в оболочку ERP.
`skuRules` и `catalogSlice` живут в чанке `OrderStudioApp`; `types/catalog.ts` — только типы,
в сборке его нет. Контроль метода: `store/useAuthStore.ts` найден в карте входа. Правки T4 вход
и оболочку ERP не трогают; `bundle:budget` T4 всё равно прогоняет (меняет экраны `/sku`).

**Сторож места konva (шаг 4)** уже есть с 5а — `ui/konva.test.ts`: `konva`/`react-konva`
импортирует только `ui/konva.ts` (и ядро `ui/konvaCore.ts`), фигуры — белый список. Мутации 18.10:
`import 'konva/lib/shapes/Circle'` в `FlatsTab.jsx` → красный («импортирует только konva.ts»),
в `konva.ts` → красный («только Core-подпути и фигуры из белого списка»).

### Итог 5б (задача 7, 18.10)

**Финальный замер** (сборка ветки после слияния T1–T6б, `npm run bundle:budget` — зелёный):

| Что | Б gzip | Потолок | База T0 | Δ |
|---|---:|---:|---:|---:|
| Вход, JS | 151 800 | 155 000 | — | без сжатия побайтно как в базе (498 594), gzip Δ 0 |
| Оболочка ERP, JS / CSS | 194 409 / 15 905 | 195 000 / 16 000 | — | как в базе (615 662 / 75 587), gzip Δ 0 |
| Холст «Дизайн» | 99 890 | 100 000 | 96 627 | +3 263 (рукава, версии позиции, `flatVersion`) |
| Кэши картинок | 9 118 | 9 400 | 8 545 | +573 |
| Панель «Дизайн» | 5 363 | 5 800 | 5 297 | +66 |
| PDF макета / pdfjs | 159 330 / 99 921 | 160 000 / 104 000 | 159 426 / 99 991 | −96 / −70 |
| Вкладка «Флэты и зоны» | 18 681 | — | 12 826 | +5 855 (зоны, «Новый флэт», колонка «Версия») |
| Редактор флэта | 48 343 | **53 200** (замер + 10 %) | — | — |
| `vendor-konva` | 76 258 | — | 76 258 | 0 |

**Что пришлось сделать, чтобы холст и кэши уложились.** До правки: холст 100 605 (> 100 000),
кэши 9 691 (> 9 400). Причина — модули, общие у холста и ленивого редактора флэта: Rollup
выносит такой модуль в отдельный чанк, граф холста считает его целиком и сжатым отдельно.
Запасной путь плана («Риски и откат»: `admin/flats` берёт у дизайна только `konva.ts`,
`flatVersion`, `resolveFlat`, прочее — свои модули):
- иконки редактора — свой набор `admin/flats/{flatIcons.ts,FlatIcon.jsx}`; иконки только
  редактора (`plus`, `trash`, `arrowUp`, `arrowDown`, `anchor`, `ruler`) ушли из `ui/designIcons`;
  общие имена (`close`, `warning`) сверяет `FlatIcon.test.jsx`;
- кэш справочника флэтов холста редактор сбрасывает событием окна `FLATS_SAVED_EVENT`, а не
  импортом `catalog/useFlatsCatalog` (строку события сверяет `saveFlat.test.ts`);
- чтение бакета флэтов — `api/garmentFlatsRead.ts` (холст берёт только его); писатель
  по-прежнему один — `api/garmentFlats.ts`, он реэкспортирует чтение (`flatsWrites.test.ts`:
  имя бакета строкой — в двух модулях бакета, модуль чтения не пишет);
- сторож `admin/flats/flatsAdminGuards.test.ts`: редактор не импортирует `ui/DesignIcon`
  и `catalog/useFlatsCatalog`.

Отвергнуто: `manualChunks` для общих модулей дизайна — Rollup затягивает в ручной чанк их
зависимости из входа (`lib/supabase`, `useToastStore`, `i18n`), и вход импортирует чанк
дизайна (+5,7 кБ gzip); `output.onlyExplicitManualChunks` меняет разрезку входа и
`vendor-supabase` (вход +142 Б без сжатия) — критерий T0 красный.

**Запас холста — 110 Б.** Следующий общий с редактором модуль (или рост `DesignTab`) выведет
холст за потолок. Ещё ≈ 0,3 кБ даёт вынос `catalog/flatLabels` (его делят холст, список флэтов
и редактор), но редактор и список, поделив свою копию, кладут её в чанк `FlatsTab`, и граф
редактора тянет `FlatsTab` + `OrderSettings` (+20 кБ в замере редактора) — поэтому не сделано.

**konva в e2e — второй рубеж, основной — `bundle-budget`.** e2e `order-flats-admin.spec.ts`
(8б: 390 px) ловит запрос `/konva|react-konva/` — в dev это `/node_modules/.vite/deps/konva*.js`
и `ui/konva.ts`, чанка `vendor-konva` там нет. Мутация «статический импорт `FlatEditor`
в `FlatsTab`» краснела (16 запросов konva). Сборку сторожит `bundle-budget` («konva не
в статическом графе OrderSettings / FlatsTab / FlatPreview»).

**Мутации e2e задачи 7 (18.10, все краснели и откачены):** статический `FlatEditor` в
`FlatsTab` → 8б; `uploadFlatSvgOnce` принимает «уже есть» как успех → 2б («Версия 2» вместо
«Версия 3»); `PlaceCtx.flat` = текущий флэт (`useDesignTab`) → 3 (`flat_version: 2` после
перетаскивания на позиции v1).

**Эталоны** `studio-settings-flat-editor` (1280 и 900 px, светлая и тёмная; телефон —
`FlatPreview` с `<img>`) и `studio-settings-zones` добавлены в `e2e/visual.spec.ts` с
`skipUntilBaseline`: снимает владелец (`update_snapshots`). Холст под маской, снимок ждёт
`data-ready`; сцену холста сторожит юнит `sceneText` (T6а).

## Замеры 8 (веха 8, финальное ревью, 18.10): перезапись базы `strict`

**Решение вслух: `npm run bundle:budget -- --write-baseline`.** Вход вырос на 1 245 Б без сжатия
(gzip +482, `index-HASH.js` 39 776 → 41 021), оболочка ERP JS — на 1 015 Б (gzip +390). Рост — цена
самого решения К1 вехи 8, а не утечка ERP или чужого модуля в критический путь. Разбор по минифицированному
входу (сумма сходится):
- `config/shellChoice.ts` + `orderstudio/layout/salesAccess.ts` (`chooseShell`, `canUseSales`) — ≈ 870 Б;
- `ShellGate` в `App.jsx` (`useState(() => chooseShell(…))`) вместо выбора `FEATURES.orderStudio` — ≈ +165 Б;
- `config/features.ts`: `FEATURE_NAMES`, `FEATURE_STORAGE_KEYS`, `readStoredFeature`, `featureEnv`
  (минус снятый геттер `orderStudio`) — ≈ +160 Б;
- подпись формы входа «Производство и оформление заказов» вместо «Order Studio» (обход, M-1) — +51 Б.

Вынести из входа нельзя без вреда: оболочку надо выбрать ДО загрузки ленивого `ErpApp`/`OrderStudioApp`,
и динамический импорт `chooseShell` добавил бы каждому пользователю ещё один круг сети перед первой
отрисовкой — дороже 482 Б gzip. Импорт из `orderNav` вместо `salesAccess` стоил бы +3 428 Б (замер T5).
Оболочка ERP сверх входа: `ErpApp-HASH.js` +41 Б (переименованные минификатором импорты из входа,
исходник ERP не менялся — сторож `erpFrozen`), `Skeleton-HASH.js` −271 Б (общий чанк похудел после
удаления `PageHeader.jsx`). CSS оболочки ERP — побайтно как в базе. Потолки не поднимались: вход 152 285
из 155 000, оболочка ERP JS 194 808 из 195 000 (запас 192 Б). Раздел `reference` базы не перезаписан —
справочная разница по-прежнему против замера 5б.

## Замеры 19.10 (правки 19.10, план A): потолок оболочки ERP 196 000, перезапись базы `strict`

**Решение владельца Р6: потолок `shellJs` поднят 195 000 → 196 000 Б gzip** (`scripts/bundle-budget-limits.mjs`),
**и `npm run bundle:budget -- --write-baseline`** — перезаписан только раздел `strict`, `reference` по-прежнему
против замера 5б. Оболочка ERP JS 194 808 → 195 057 Б gzip (+249; без сжатия 616 677 → 617 322, +645), CSS
15 905 → 15 938 (+33; без сжатия +311). Вход — побайтно как в базе. Рост — цена самих правок 19.10, а не утечка
экрана или доменного слайса в критический путь:
- `ErpStates-HASH.js` +277 Б (gzip +136) и `ErpStates-HASH.css` +311 Б (gzip +33) — `Button.ariaDisabledReason`:
  блок по условию с причиной для читалки (`aria-disabled` + `aria-describedby`, стиль заблокированной кнопки),
  общий примитив ERP, которым закрыт блок формы закроя и фаза программы вышивки;
- `statusUi-HASH.js` +308 Б (gzip +71) — `utils/embroideryPhase` (`isProgramPhase(stage, siblings)`) в ядре
  маршрута: фаза вышивки нужна гейтам этапа и прогрессу, тексты экранов вынесены в `embroideryPhaseText.ts`
  вне оболочки (поправка сборки `3bdb25d`);
- `ErpApp-HASH.js` +52 Б, `useTheme`/`stageUi` +8/+4 gzip — переименования минификатора.

Вынос `ariaDisabledReason` в отдельный чанк или `embroideryPhase` из ядра ломал бы раскладку чанков ради 57 Б
сверх прежнего потолка. Запас до нового потолка — 943 Б: он под раздел «Бизнес-задачи» (≤ 1 000 Б); всё, что
сверх, — снова разбор и решение вслух.
