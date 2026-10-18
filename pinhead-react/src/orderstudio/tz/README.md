# ТЗ в PDF и запуск (веха 6+7)

План: `docs/superpowers/plans/2026-10-18-order-flow-m67-tz-launch.md`. Здесь будут модель ТЗ
(`model/`, T2), движок PDF (`pdf/`, T3) и экранные обёртки (`ui/`, T3/T5). Этот файл ведёт
задача 0: сверка имён после 5а и 5б и замеры. T3 и T7 дописывают только свои строки замеров.

## Сверка с 5а и 5б (задача 0, 18.10)

База ветки `m67-local` — 5а + 5б (`a0705727`, 5б локально `84b13441`). Смысл плана не меняется,
расходятся имена и номера строк. Исполнителям — брать имена из этой таблицы.

| В плане | В коде на базе 6+7 | Что делать |
|---|---|---|
| `catalog/tzRows.ts`: `TZ_ROW_LABELS`, `tzRowOfArea`, `tzRowOfZone`, `TZ_ROW_CODES` | есть все четыре. Ещё: `TZ_MATRIX_ROWS` (9 строк матрицы без `other`), тип `TzRow`, `asTzRow`, `DEFAULT_TZ_ROW_BY_ZONE`, `ZONE_ID_RE`. `tzRowOfArea(area, zones)` — переопределение зоны флэта → зона справочника → умолчание по `zone_id` → `'other'` | Строки матрицы ТЗ (К7) — `TZ_MATRIX_ROWS` + `'other'`; подписи — `TZ_ROW_LABELS` |
| `design/catalog/flatVersion.ts`: `flatAtVersion` | `flatAtVersion(flat, version): GarmentFlat \| null`; рядом `itemFlatVersion(prints, flat)` → `{ version, mixed, known }` | Версию флэта позиции брать `itemFlatVersion`, затем `flatAtVersion` |
| `design/catalog/useFlatsCatalog.ts` | есть: `useFlatsCatalog()`, `loadFlatsCatalog({ force })`, `FLATS_SAVED_EVENT` | — |
| `exportPdf.ts`: экспорт `loadPdfFonts`; `registerFonts`, `ensureMeasureFonts`, `pageMm`, `sceneElement`, `SCENE_IMAGES` приватны | так и есть (`exportPdf.ts:56/106/121/158/166`); экспорт: `loadPdfFonts`, `exportMaketPdf(input, deps)`, `MSG_*`, `PdfFonts`, `ExportDeps` | T3 выносит в `pdfCore.ts`; сторож `pdfGuards.test.ts:60–61` держит `loadImages: SCENE_IMAGES` и литерал регулярки — двигать вместе |
| `buildSceneSvg.ts` | `buildSceneSvg(input: SceneInput): string`, `PDF_FONT_FAMILY = 'PHMaketSans'`, `TYPICAL_FLAT_NOTE` | — |
| `maketPages.ts`: `placedEntries`, `maketCaption`, внутренний `offsetText` | `placedEntries(item, flat): MaketEntry[]`, `maketPages`, `maketCaption(e)`, `maketFileName`, `MaketPdfError`; `offsetText` — строка 81, не экспортирован | — |
| `svgForPdf.ts`: `logosForPdf` | `logosForPdf(orderId, entries: LogoEntry[], deps?): Promise<PdfLogosResult>`; `LogoEntry = { n, placement }` | — |
| `design/ui/panel/maketExport.ts` | `pdfEngine = { load: () => import('../../export/exportPdf') }`, `loadPdfEngine()`, `hasMaketPages(item, flat)` | Образец загрузчика для `tz/ui/tzExport.ts` |
| `model/printMethods.ts`: `METHOD_LABELS` | 8 техник: `silkscreen` Шелкография, `embroidery` Вышивка, `dtf` DTF, `heat_transfer` Флекс / термоперенос, `dtg` DTG, `sublimation` Сублимация, `patch` Шевроны / нашивки, `other` Прочее / подряд; порядок — `METHOD_ORDER` | Столбцы матрицы (`tzColumnOf`) — из этого перечня |
| `isSafeHttpUrl` | нет нигде | T2 создаёт в `tz/model/safeUrl.ts` |
| `sniff` | `sniffArtwork(bytes, fileName): SniffResult` и `ARTWORK_MIME` в `design/assets/sniff.ts` | — |
| `PrintMethod` | тип `SalesPrintMethod` (`model/types.ts:41`), значения — `SALES_PRINT_METHODS` | — |
| `offsetText` — три копии | `design/export/maketPages.ts:81`, `design/ui/canvas/canvasText.ts:40` (в плане 34), `screens/PrintRow.jsx:27` (в плане 16) | T2 сводит в `model/printOffset.ts` |
| `order_artwork_path_ok` | только SQL (`20261017053703`); в TS — `artworkPath` (`api/artworks.ts`) | — |
| `itemPackaging` | `pricing/priceOrder.ts:258` (его зовёт и `workplace/SummaryTab.jsx`) и `erp/utils/packaging.ts:68` | T2 выносит в `model/packaging.ts` с реэкспортом |

### Белый список типов `order-artworks` — литерал для J

Живая база (SELECT 18.10) и миграция C `20261017070826` совпадают:

```sql
array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml',
      'application/pdf', 'application/postscript', 'application/illustrator',
      'image/vnd.adobe.photoshop', 'image/tiff']
```

Бакет `order-artworks`: private, 26 214 400 Б. `erp-attachments`: public, 20 971 520 Б, `allowed_mime_types = null`.

### Функции на бою — md5 `prosrc` (SELECT 18.10)

| Функция | md5 | Литерал Global Constraints |
|---|---|---|
| `order_v4_transition(uuid,text,text)` | `7b4bc1a8f82abb838c08b7161a727074` | совпадает |
| `order_v4_launch_check(uuid)` | `b070898856f442412c65fa543aab0edc` | совпадает |
| `order_v4_set_payment(uuid,text,text)` | `3e8b3d32bd3a8f8e2be4f44b1bb32c7d` | совпадает |
| `sales_set_staff(uuid,text,boolean)` | `e63f055a14f0118e17643d570a5a1a5f` | совпадает |
| `sales_set_staff(uuid,boolean)` (пятая) | `21f5353bf5813c28513641402434c3a5` | в предусловие J не входит: её удаляет H (`drop function if exists`, раздел 8). Откат J её не возвращает |

H (`20261017185435_garment_flats.sql`) и I (`20261018090000_flats_admin.sql`) ни одну из четырёх функций
не пересоздают (проверено поиском по файлам) — литералы остаются верными и после их применения.
`order_v4_erp_authentic` на бою нет.

### Миграции

Последняя запись `schema_migrations` на бою — `20261017150000` (order_catalogs); H и I на бою нет.
В репозитории после неё — H `20261017185435`, I `20261018090000`. Имя J `20261018120000_order_v4_launch.sql`
сортируется после обеих — сдвигать не нужно. Предусловие J «H и I есть» обязательно.

### Сторож импортов ERP и тесты

`testutil/sourceFiles.ts`: `sourceFiles(dir)` по умолчанию исключает `.test.`, `.testutil.` и `.d.ts`
(`tests: true` — только явно). `erpImports.test.ts` ходит по `sourceFiles(ORDER_DIR)` без тестов.
Значит, тест паритета `bridge/erpKeys.test.ts` (T6) может импортировать `erp/utils/{tz,storageKey}` —
регулярки по тексту не нужны. В `design/**` импортов `/erp/` нет и не будет (`designGuards.test.ts`).

## Замеры 6+7 (задача 0, база 5а + 5б, 18.10)

`npm run build && npm run bundle:budget`, gzip (node `zlib` по умолчанию):

| Граф | Б gzip | Потолок |
|---|---|---|
| Вход, JS | 151 793 (без сжатия, нормализованно — 498 594) | 155 000; против базы — побайтно, Δ 0 |
| Оболочка ERP, JS | 194 396 (нормализованно — 615 662) | 195 000; против базы — побайтно, Δ 0 |
| Оболочка ERP, CSS | 15 905 (нормализованно — 75 587) | 16 000; против базы — побайтно, Δ 0 |
| Оболочка Order (вход + OrderStudioApp + OrderWorkplace) | 269 676 | справочно |
| **Рабочее место** (OrderWorkplace минус вход и OrderStudioApp) | **79 705** | **94 705** (замер + 15 000; T7 — окончательно) |
| Холст «Дизайн» | 99 888 | 100 000 — **99,9 %, запаса нет** |
| Кэши картинок | 9 120 | 9 400 |
| Панель «Дизайн» | 5 363 | 5 800 |
| PDF макета (exportPdf; из них `vendor-pdf` 151 533) | 159 332 | 160 000 — 99,6 % |
| pdfjs | 99 921 | 104 000 |
| Вкладка «Флэты и зоны» | 18 681 | справочно |
| Редактор флэта | 48 349 | 53 200 |

База `scripts/bundle-baseline.json` (5б, задача 0) не переписывалась: вход и оболочка ERP на базе 6+7
совпадают с ней побайтно — это и есть «сравнение с шагом 3 по критерию 5б».

**Для T3:** PDF макета — 99,6 % потолка, а вынос `pdfCore` по плану может добавить до 2 КБ. Укладываться
или объяснять рост у константы `designPdf` в `bundle-budget.mjs`. Холст — 99,9 %: в граф `DesignTab`
ничего из 6+7 класть нельзя.

## Стражи бюджета 6+7 (`scripts/bundle-budget-m67.mjs`)

Подключены из `bundle-budget.mjs` (`checkTzLaunch`), тесты — `tz/bundleBudgetM67.test.ts`.

1. **«Рабочее место»** = граф `workplace/OrderWorkplace.jsx` минус вход и `OrderStudioApp`; потолок
   `WORKPLACE_BUDGET` = 94 705.
2. **«ТЗ PDF»** = граф `tz/pdf/tzPdf.ts` минус оболочка Order, граф `SummaryTab` (если у него своя
   запись) и `vendor-pdf`. `vendor-pdf` (≈ 151 кБ) общий с PDF макета и сторожится его потолком —
   иначе временный потолок плана 60 000 Б был бы превышен самим jsPDF. Потолок `TZ_PDF_BUDGET` —
   временно 60 000; T7 ставит замер T3 + 10 %.
3. `vendor-pdf` не в статическом графе оболочки Order и `SummaryTab` — красный «ТЗ PDF в оболочке».
4. **«Экран запуска»** = граф `launch/LaunchScreen.jsx`: без `vendor-pdf`, `vendor-konva` и стора ERP;
   размер — минус вход и `OrderStudioApp`, потолок `LAUNCH_BUDGET` — временно 25 000.
   Стор ERP своей записи в манифесте не имеет (Rollup вклеивает его в общий чанк, на 18.10 —
   `statusUi`), поэтому признаки — ключ `src/erp/store/useErpStore.ts` (если появится) и литерал
   `[loadBootstrap]` из `erp/store/slices/bootstrapSlice.ts` (ERP заморожен — литерал не уедет).

**Когда проверка включается (контракт для T3, T5, T6):**
- `tzPdf` считается подключённым, когда `workplace/SummaryTab.jsx` или `launch/LaunchScreen.jsx`
  содержит строку `tzExport` (загрузчик `tz/ui/tzExport.ts` по образцу `maketExport.pdfEngine`).
  До этого — «⧗». Подключён, а в манифесте нет — красный: загрузчик обязан жить в живом коде
  (неиспользуемый экспорт Rollup выбрасывает вместе с `import()`).
- `LaunchScreen` — когда `OrderStudioApp.jsx` содержит строку `LaunchScreen` (T6, `React.lazy`).
- T7 ставит `M67_REQUIRED = true` и окончательные потолки, затем при необходимости переписывает
  базу (`npm run bundle:budget -- --write-baseline`, решение вслух) — в ней появятся справочные
  `workplace`, `tzPdf`, `launchScreen`.

**Мутации (18.10, на настоящей сборке, откачены):**
- заглушки `tz/pdf/tzPdf.ts` (jsPDF), `tz/ui/tzExport.ts` (`import()`), `launch/LaunchScreen.jsx`
  (`React.lazy` в `OrderStudioApp`) — зелёный: ТЗ PDF 146 Б, экран запуска 149 Б, вход и оболочка ERP
  как в базе;
- статический `import { … } from '../tz/pdf/tzPdf'` в `SummaryTab` — красный: «ТЗ PDF в оболочке»,
  `vendor-pdf` в оболочке Order, «Рабочее место» 231 353 из 94 705, `tzPdf.ts` подключён, но не в манифесте;
- статический `import { useErpStore } from '../../erp/store/useErpStore'` в `LaunchScreen` — красный:
  «стор ERP в статическом графе LaunchScreen» (Rollup вынес стор в свой чанк `useErpStore-*.js`,
  литерал поймал его), плюс вход и оболочка ERP разошлись с базой.
- мутации кода стража (5 штук: без графа SummaryTab, без литерала стора, без вычета `vendor-pdf`,
  без вычета входа у экрана запуска, «никогда не подключён») — каждая краснит `bundleBudgetM67.test.ts`.

## Часовой пояс тестов

`process.env.TZ = 'Europe/Moscow'` — первой строкой `src/setupTests.js`; Playwright — `use.timezoneId`
в `playwright.config.ts`. Сторож — `src/testTimezone.test.ts` (граница: пятница 23:30 UTC = суббота
в Москве); мутация «без строки в setupTests» его краснит. Полный `vitest` с поясом — зелёный (задача 0).

## Замеры задачи 3 (движок PDF ТЗ и `pdfCore`, 18.10)

`npm run build && npm run bundle:budget`, gzip. Экран движок ТЗ ещё не подключает (это задача 5),
поэтому «ТЗ PDF» замерен **пробой**: во временную копию `SummaryTab.jsx` добавлены `tzExport`
и статический импорт `tzDocument` + `sendChecklist` (как будет после задачи 5), сборка, откат.

| Граф | Без подключения | Проба (как после T5) | Потолок |
|---|---|---|---|
| Вход / оболочка ERP JS / CSS | побайтно как в базе (Δ 0) | — | без изменений |
| PDF макета | 159 515 (+183 к T0) | 160 059 (+727 к T0) | **161 380** = T0 + 2 048 (план: вынос ≤ +2 КБ) |
| **ТЗ PDF** (tzPdf минус оболочка Order, SummaryTab и `vendor-pdf`) | ⧗ | **26 741** | 60 000 временно; T7 — замер +10 % ≈ 29 500 |
| из них `pdfCore` (общий чанк двух движков) | — | 5 612 | — |
| Холст «Дизайн» | 99 780 | 98 870 | 100 000 |
| Рабочее место | 79 792 | 89 756 (модель ТЗ статически — задача 5) | 94 705 |

**Ловушка для задачи 5.** Проба только с `tzExport` (модели ТЗ в графе рабочего места нет) давала
холст 100 297 — **красный**: `garmentHex` и `flatVersion` становились общими чанками холста и движка.
С моделью ТЗ в графе рабочего места (`tzDocument` → `flatAtVersion` уезжает в оболочку Order)
холст 98 870. Подключать `tzExport` в задаче 5 — тем же коммитом, что статический импорт модели
ТЗ (`sendChecklist`/`tzDocument`), и сразу гонять `bundle:budget`.

**Движок для задачи 5** (`tz/ui/tzExport.ts`): `loadTzEngineOrNull()` (сбой чанка — тост или
«Вышло обновление», `null`), затем `buildTzPdf({ order, groups: [группа], catalogs, issuedOn, appOrigin })`
→ `{ blob, hash12, doc }`; все ТЗ черновика — `buildAllTzPdf`. Отказ, понятный человеку, —
`TzPdfError` (`tz/pdf/tzPdfError.ts`, без импортов — экран различает его, не загружая движок);
текст продолжает «ТЗ не собрано: …» (`TZ_PDF_FAIL`). Предел — `TZ_MAX_BYTES` = 8 МБ (как в J).

**Решения движка (ревью задачи 3, раунд 1).**
- Мокап (`outputScale ≠ 1`) рисуется **без шапки, шкалы «масштаб 1:1» и метки размера**: лист уменьшен
  под ячейку, и «1:1» было бы ложью. Лист мокапа — флэт с полями (`mockupSceneMm`).
- Все отказы движка — `TzPdfError`: шрифт (текст ядра) и мокап/превью, не легшие в PDF
  (`MSG_TZ_SCENE`, а не текст листа макета).
- Ширина текста для раскладки (`fontMeasure`) — жирным начертанием **плюс отступ ячейки
  `CELL_PAD` с двух сторон**: раскладка задачи 2 отступа не знает, жирная строка впритык заходила на рамку.
- Растр, уменьшенный под ячейку, встраивается с алиасом `путь#ШxВ`: jsPDF кэширует картинку
  по алиасу, и одно фото в двух ячейках разного размера получало бы байты первой.
- Шапка листа макета вставляется в заполнитель `@@BG@@` **функцией** замены: строка замены
  разбирает `$&`, `$'`, `` $` ``, `$$` из текста клиента (`esc()` знак `$` не трогает).

## Замеры задачи 7 (бюджет, шлюз запуска, 18.10)

**Красный после задачи 6 и его причина.** На 516eb346 оболочка ERP — 195 186 Б gzip при потолке
195 000 (+1 001 Б без сжатия против базы 5б), вход +72 Б. ERP не менялся ни строкой: виноваты
**три прямых `import()` модулей ERP в `bridge/launch.ts`**, ставших достижимыми, когда экран
«К запуску» подключил запуск (в базе `launch.ts` никто не импортировал, и Rollup выбрасывал его
вместе с `import()`). Rollup режет чанки по набору точек входа, из которых модуль достижим:
- `import('…/useErpStore')` — новая точка входа, достающая ядро стора ERP, но не
  `erp/utils/statusUi`: общий чанк ядра (`statusUi-*.js`, 47 кБ) распался на два;
- `import('…/orderPayload')` и статический `tzToErpDraft` экрана достают
  `erp/utils/garmentSource` без ядра — третий чанк;
- `import()` модуля внутри общего чанка добавляет туда объект пространства имён (`lazyScreen` —
  в `useTheme`, стор — в ядро).
Итог: +3 чанка в оболочке ERP, длиннее списки импортов `ErpApp` и предзагрузки входа.

**Исправление — шлюз `bridge/erpGateway.ts`**: одна точка входа (`import('./erpGateway')` из
`launch.ts`), чей граф совпадает с ядром стора ERP: `lazyScreen`, стор, `orderPayload`,
`garmentSource` и `statusUi` (якорь графа — запуску не нужен, держит ядро одним чанком).
Правило закупки (`itemNeedsPurchase`) мост получает аргументом от шлюза, а не импортом:
`tzToErpDraft` больше не тянет `garmentSource` в граф экрана. Сторож `erpImports.test.ts`:
шлюз — ровно пять модулей ERP, грузит его только `launch.ts` и только `import()`.

| Проба (сборка, `npm run bundle:budget`) | Вход | Оболочка ERP |
|---|---|---|
| 516eb346 (задача 6, три `import()`) | +72 Б | +1 001 Б, 195 186 gzip ✗ |
| `import()` с деструктуризацией (объекты имён остаются) | +72 Б | +841 Б ✗ |
| шлюз из одних реэкспортов | 0 Б | +13 Б ✗ (чанк шлюза вклеен в соседний, имена экспортов ядра плывут) |
| **шлюз с кодом + якорь `statusUi` + правило закупки аргументом** | **0 Б** | **0 Б, 194 424 gzip ✓** |
| мутация: без якоря `statusUi` | +35 Б ✗ | +148 Б ✗ |
| контроль: без единого `import()` ERP | 0 Б | 0 Б |

«Размер тот же, содержимое другое» у входа и оболочки — переставленные однобуквенные имена
экспортов общих чанков (порядок их выдачи зависит от всех импортёров, в том числе Order); то же
даёт и контроль без запуска. Критерий 5б — байты без сжатия и gzip ±16 — выполнен.

**Потолки после задачи 7** (`scripts/bundle-budget-m67.mjs`, `M67_REQUIRED = true`):

| Граф | Замер | Потолок |
|---|---|---|
| Вход / оболочка ERP JS / CSS | 151 802 / 194 424 / 15 905; против базы 5б Δ 0 Б | 155 000 / 195 000 / 16 000 |
| Рабочее место | 91 557 | 94 705 (= T0 + 15 000; 97 %) |
| ТЗ PDF (без `vendor-pdf`) | 28 255 | **31 100** (замер + 10 %) |
| Экран запуска (минус вход и `OrderStudioApp`) | 52 679 | **57 950** (замер + 10 %) |
| Холст «Дизайн» | 98 376 | 100 000 |
| PDF макета | 160 090 | 161 380 |

Экран запуска больше временных 25 000 плана: в граф входят общие с рабочим местом
`salesTransitions` (7,0 кБ), `ErpStates` (6,7 кБ), `styles` (5,0 кБ), `sendChecklist` (3,5 кБ),
`PaymentPanel` — сам экран 13,0 кБ. Стора ERP, `vendor-pdf` и `vendor-konva` в нём нет (страж).

## Замер шага `files` на образце 67108 (задача 7, шаг 4b; окно метки К15)

Проба — `launchToErp` в странице (настоящий стор ERP и `launchFiles`, мок сети, 18.10): заказ из
`fixtures/67108.json`, PDF ТЗ собран движком (`buildTzPdf`), макеты — PNG/SVG фикстур e2e.

| Что | Замер |
|---|---|
| Копий в `erp-attachments` | 6 (PDF ТЗ на 1 позицию ERP + 5 макетов из 6 нанесений; «прочее» без файла) |
| PDF ТЗ | 49 390 Б, 10 страниц |
| Шаг `files` (скачать из `order-artworks` + загрузить) | 144 мс на моке; весь запуск — 630 мс |

Окно чужой метки — 10 минут от последнего продления, продлевает его `recheck` сразу после `files`.
Худший случай по правилам: 5 макетов по 20 МБ (предел копии) — около 100 МБ туда и 100 МБ обратно;
на канале 10 Мбит/с это ≈ 2,7 мин, на 2 Мбит/с ≈ 13 мин — **дольше окна**: второй МС сможет взять
метку, и первый запуск остановит `recheck` (заказ ERP не создаётся, копии остаются сиротами для
`storage-gc`). Обычный заказ (макеты по 1–3 МБ) укладывается в секунды. Продление метки во время
длинного `files` — бэклог вехи 8.

## e2e 6+7 (задача 7)

- `e2e/order-flow.spec.ts` — сквозной поток по экранам: продавец (новый заказ → изделие → логотип →
  клиент и срок → предоплата → предпросмотр → «Отправить в работу»), PDF ТЗ из мока Storage (текст,
  страницы = `layoutTz`, ≤ 8 МБ, без цен), МС («К запуску» в меню → «Запустить в производство»);
  сбои посреди запуска (500 на `erp_create_order`, 500 на переход) и отказы (конфликт вкладки, знак
  вне шрифта, МС без прав ERP, возврат с причиной и повторная отправка без загрузок, второй МС,
  SVG со `<script>`); axe и тач-цели на 375/760/768/1280.
- Клиента в PDF ТЗ нет — по формату образцов (цеху он не нужен): e2e проверяет название заказа
  в заголовке, модель и зону вместо имени клиента, как ждал план.
- «SVG под именем .png» отказывает уже загрузка логотипа (тип по байтам, `sniff`), до копий в ERP;
  очищенный SVG в `erp-attachments` проверяет сценарий с настоящим `.svg`.
- Эталоны `visual.spec.ts`: `studio-tz-summary`, `studio-launch` (desktop и 375 px), `tz-pdf-67108-p1/p3`
  (canvas pdfjs, масштаб 2), допуск 1 %. Снимает владелец (`update_snapshots`), до этого — пропуск.
