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
