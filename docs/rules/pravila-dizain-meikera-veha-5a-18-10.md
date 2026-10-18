# Правила дизайн-мейкера во вкладке «Дизайн» (веха 5а, 17–18.10)

План — `docs/superpowers/plans/2026-10-17-order-flow-m5a-design.md` (с разделами «Проверка
безопасности», «Проверка скиллами», «Ответы владельца после проверки»). Миграция **H**
`20261017185435_garment_flats` — на бой ДО мерджа, сухим прогоном с пробами в SQL Editor
владельцем. Пробы — `supabase/probes/garment_flats.sql` (`total=127`) и
`supabase/probes/order_v4_rights.sql` (`total=155`, перегрузки `sales_set_staff(uuid, boolean)`
больше нет). Код — `pinhead-react/src/orderstudio/design/` (карта модуля и замеры бюджета —
`design/README.md`), API флэтов — `orderstudio/api/garmentFlats.ts`, файлы заказа —
`orderstudio/api/artworks.ts`, вкладка справочника — `orderstudio/admin/tabs/FlatsTab.jsx`.
Веха 5б (админка «Флэты и зоны»: загрузка своих флэтов, правка зон) — отдельный план.

---

## Источник правды — заказ, холст пишет только через `edit`

- Холст ничего не хранит у себя. Размещения ВЫВОДЯТСЯ из `item.prints[].layout`, флэт позиции —
  `item.flat_id`. Локально (`design/store/useDesignStore.ts`) живут только выбор, вид, масштаб
  и история отмены.
- **Любая правка нанесений и флэта — `useDesignStore.commit(label, fn, coalesceKey?)`**: `fn`
  получает СВЕЖУЮ позицию и возвращает `{ prints?, flat_id? }` или `null`; запись — только
  `useSalesStore.getState().edit`. Своего пути записи у холста нет, буфер визарда (`useStore`,
  `itemBuffer`) не участвует: на вкладке «Дизайн» `ItemTab` не смонтирован.
- Запись — на `dragend`/`transformend`, не на `dragmove`; поля инспектора — `MmField` (blur/Enter,
  Esc — отмена); стрелки — каждое нажатие (автосохранение и так с паузой 1 с).
- **Открытие заказа и вкладки ничего не пишет**, в том числе `flat_id`: подобранный по умолчанию
  флэт (`catalog/pickFlat.ts`) записывается тем же `commit`, что и первое размещение, либо явным
  выбором силуэта. Сторож — `DesignTab.test.jsx` (шпион `edit` — 0 вызовов) и e2e «открытие
  ничего не пишет».
- **Правка — только в черновике и не в конечном состоянии сохранения** (`isEditable`,
  `isTerminalSaveState`): иначе холст только для чтения, история не копится, снимок не пишется.
- **Undo** — снимки `{ prints, flat_id }`, предел 50, слияние по ключу 800 мс. История
  сбрасывается при смене позиции или заказа, при уходе с вкладки и на выходе (`registerAppReset`).
  `orderId`/`itemKey` запоминаются ДО `await` загрузки логотипа: сменилась позиция — нанесение
  не создаётся.

## Нанесение = размещение; путей в `layout` нет

- Одно `SalesPrint` — одно размещение. **Стандартные поля** (их читают `priceOrder`,
  `tzToErpDraft`, будущее ТЗ): `zone` (название зоны из `zonesCatalog` по `zone_id`), `width_mm`,
  `height_mm` (целые), `method`, `artwork_path`, `offset_mm` / `offset_from` / `offset_dir`.
  Поэтому нанесение с холста и то же нанесение, введённое строкой, дают ОДНУ цену (сторож
  `design/model/pricingParity.test.ts`).
- **`layout` — только геометрия холста**, форма v1 (`design/types.ts`, `PrintLayoutV1`):
  `v: 1`, `flat_id`, `flat_version`, `view` (`front`/`back`), `area_id`, `x_mm`/`y_mm`,
  `rotation_deg`, `flip_h`/`flip_v`, `asset` (тип, исходное имя файла, размеры, DPI,
  `has_preview`). Сервер держит CHECK `order_item_prints_layout_check`: `null` или объект
  с `v = '1'` не больше 8 КБ; `order_items_flat_id_check`: `''` или id флэта.
- **Путей в `layout` нет**: стражи `order_v4_child_guard`/`order_v4_save` проверяют `artwork_path`,
  а jsonb не смотрят. Превью PDF/AI лежит по ВЫВОДИМОМУ пути `<artwork_path>.preview.png`
  (`api/artworks.ts`: `artworkPreviewPath`, `uploadArtworkPreview` — путь вычисляется,
  исходник не превью, сигнатура PNG, `upsert: false`). Удаление исходника удаляет и превью.
  **Уборка `order-artworks` и копирование файлов в ERP (вехи 6–7) обязаны знать `.preview.png`.**
- `parseLayout` строгий: конечные числа в границах (`design/limits.ts`, общие с SQL H), перечни,
  id-регулярки, `source_file` ≤ 255, лишние ключи прочь. Разбор — `design/model/layoutMark.ts`
  **без zod** (его читает и оболочка Order: строка `PrintRow placed`, маркер вкладки), совпадение
  с прежней схемой `zod/mini` держит тест-эталон `layoutMark.test.ts`. Битый `layout` = «не
  размещено» без перезаписи.
- Логотип в зону, где уже есть НЕразмещённая строка той же зоны, дописывает ей раскладку, файл
  и мм — новое нанесение не создаётся (без задвоения цены, `model/placeArtwork.ts`).
- Отступ — по опоре зоны (`model/offset.ts`): горловина → `neck_seam`; этикетка (`zone_id = null`),
  панель шоппера и штаны («от пояса») → `top_edge`; рукав (5б) → `part_seam`. `offset_note`
  холст не трогает.
- Техника — один модуль `orderstudio/model/printMethods.ts` (профили 8 методов, DPI,
  `TECH_TO_METHOD`/`METHOD_TO_TECH`, `allowedMethods`, `defaultMethod`); у `design/` своих
  профилей нет. DPI (ответ владельца): DTF, шелкография, DTG, флекс — 300/150, вышивка —
  подсказка о мелких деталях; ничего не блокирует.

## SVG: санитайзер, `<img>`, `DOMParser`

- `design/assets/sanitizeSvg.ts` — БЕЛЫЙ список элементов и атрибутов по `localName`; `href`
  любого префикса — только `#…`; `url(` — только `#…`; `style`, `xml:base`, `on*`, `<script>`,
  `<foreignObject>`, `<image>`, `<style>`, комментарии, CDATA, PI — прочь; `<!DOCTYPE>` и
  `parsererror` — отказ; `<use>` ≤ 500 без цепочек; ≤ 5 МБ. Возвращает `{ svg, removed[] }`.
  Режим `scene` (лист PDF) дополнительно пускает `text`/`tspan` и `image` только
  с `data:image/(png|svg+xml);base64,`.
- **Тип файла — по байтам** (`assets/sniff.ts`: PNG, JPEG, WEBP, `%PDF`, SVG), не по расширению
  и не по ответу Storage; размеры из заголовка: сторона > 12000 px или > 80 Мп — отказ и при
  загрузке, и при скачивании. PSD/TIFF/EPS на холст не идут («Этот формат нельзя поставить на
  изделие — сохраните в PNG, SVG или PDF»), в бакет — как раньше.
- **Флэты** — санитайзер при сиде и повторно перед показом. **Логотипы на холсте** — `Blob`
  (SVG — очищенный текст в новый Blob, растр — новый Blob с типом по сигнатуре) → object URL →
  `HTMLImageElement`. `createObjectURL` в `design/**` — только в кэшах картинок
  (`artworkImages.ts`, `flatImages.ts`), без `href`, `window.open`, `iframe/object/embed`
  (сторож `assets/assetGuards.test.ts`); object URL освобождаются при сбросе и при замене по пути.
  Сохранение файла пользователю — `utils/saveBlob.ts` вне `design/`.
- **PDF макета**: сцена собирается `DOMParser` + `importNode` в
  `document.implementation.createHTMLDocument()`, вне страницы; все строки — `esc`/`escAttr`,
  числа — `num()` (не-число → исключение). Логотип SVG без вырезанного — вектором; что-то вырезано —
  растр 300 dpi и пометка «логотип N — растр»; PDF/AI — превью и пометка «растр из PDF».
- **Нигде в `design/**`** — `innerHTML`, `outerHTML =`, `dangerouslySetInnerHTML`, импорты `/erp/`
  (сторож `design/designGuards.test.ts`). jsPDF: запрещены `pdf.html`, `addJS`,
  `output('bloburl' | 'dataurlnewwindow')`; svg2pdf — `loadExternalStyleSheets: false`.
- pdfjs (`assets/loadPdf.ts`, только `import()`): явный `workerPort = new Worker(url, { type:
  'module' })`, `isEvalSupported: false`, `enableXfa: false`, `maxImageSize` ≈ 16 Мп, без
  аннотаций, без внешних `cMapUrl`/`standardFontDataUrl`, таймаут 30 с → `destroy()`, один PDF
  за раз. CSP боя в режиме enforce проверяет e2e `order-design.spec.ts` на собранном приложении.

## Флэты неизменяемы по версии

- SVG флэтов — приватный бакет **`garment-flats`** (1 МБ, только `image/svg+xml`), путь
  `flats/<flat_id>/v<N>/<вид>.svg`, ASCII, версия 1…9999 (`garment_flat_path_ok`, клиент —
  `FLAT_PATH_RE` в `api/garmentFlats.ts`, сверка регулярок — `garmentFlatsBucket.test.ts`).
  Чтение — активным и одобренным (`catalog_reader()`), запись — admin и director
  (`catalog_writer()`), **UPDATE запрещён всем restrictive-политикой** (upsert, перенос, метаданные),
  **политики DELETE нет** (5б — delete только неупомянутых версий).
- Метаданные — `app_config.garmentFlats` (`{ version: 1, flats: [...] }`): флэт (`id`, `version`,
  `active`, `name`, `typical`, `categories`, `fits`, `sku_codes`), виды (`kind`, `svg_path`,
  `scale_mm_per_unit`, `print_areas[]` с `zone_id`, `polygon_mm`, `methods`, `default_method`,
  `tz_row`). `catalog_value_check` требует `svg_path` = путь, выведенный из id, версии и вида.
  Пишет только `putCatalog` (`catalog_put`, ключ в `v_admin_pair` — admin и director, rop нет).
- Новая версия флэта — НОВЫЙ путь; `layout` хранит `flat_version`, старые заказы и PDF ссылаются
  на «свою» картинку. Клиент не доверяет справочнику: `flatsSchema` (`zod/mini`) сверяет формулу
  `svg_path`, `downloadFlatSvg` — `isFlatPath`.
- `garmentFlats` НЕ входит в общую загрузку каталогов (`lib/catalogs.ts` — `.neq('key',
  'garmentFlats')`); вкладка «Дизайн» читает его сама (`catalog/useFlatsCatalog.ts`, схема — свой
  ленивый чанк), вкладка «Флэты и зоны» — свежим запросом. Запись бакета флэтов — только
  `api/garmentFlats.ts` (сторож `flatsWrites.test.ts`), запись `order-artworks` — только
  `api/artworks.ts` (сторож `artworkWrites.test.ts`).
- Подбор флэта (`pickFlat`): `item.flat_id`, если активен и подходит модели → точный по
  `sku_codes` → типовой по категории и посадке → по категории → нет («Для этой модели нет
  силуэта — задайте нанесения строками»). Модель сменилась — плашка «перенесите на новый
  силуэт» (`remapToFlat` по `zone_id`, ненайденные — `layout = null`, остаются строками);
  само ничего не пишется.

## Сид — кнопкой, справочник последним

- 35 типовых флэтов и 67 SVG из дизайн-мейкера лежат в `design/seed/` (`flats/*.svg`,
  `garmentFlats.seed.json`; конвертер — `scripts/flats-seed-convert.mjs`). Загружает их кнопка
  «Загрузить типовые флэты» на `/order-settings?tab=flats` (admin, director; не на ≤ 760 px):
  свежее чтение справочника → по каждому недостающему флэту `sanitizeSvg` → `uploadFlatSvg`
  (`upsert: false`, «уже есть» = успех; по 4 одновременно, после первого отказа новые не
  начинаются) → **последним** `putCatalog` с базой от чтения. Справочник никогда не ссылается на
  файл, которого нет; повтор после частичного сбоя идемпотентен, свои флэты не перезаписываются.
- SVG сида — `import.meta.glob(..., { eager: true, query: '?raw' })` ВНУТРИ `seedFlats.ts`: один
  ленивый чанк по кнопке (не вытесняет кэш service worker). Отвергнуто: SQL-миграция с SVG
  (байты Storage вне Postgres), Node-скрипт с service key (ещё один носитель ключа), ручная
  загрузка, SVG в `public/` (флэты стали бы публичными).
- Сторож сида `design/seed/garmentFlatsSeed.test.ts`: схема, каждый `zone_id` есть
  в `ZONES_CATALOG_DEFAULT` (у одежды нет зон без `zone_id`, кроме этикетки), все SVG проходят
  санитайзер с `removed.length === 0`, подбор силуэта для каждой модели каталога.

## Бюджет холста и маркер

- Холст — один ленивый чанк `DesignTab` (`React.lazy` в `OrderWorkplace`) + `vendor-konva`:
  **≤ 100 000 Б gzip** (потолок спеки, не по замеру; на 18.10 — 96 627). Панель (`DesignSide`),
  кэши картинок (`assets/imageLayer.ts`), инспектор, превью телефона, конвейер логотипа, листы
  PDF — свои чанки по требованию. PDF макета (`exportPdf`, jsPDF + svg2pdf) ≤ 160 000 и pdfjs
  (`loadPdf`) ≤ 104 000 — только `import()` по действию.
- Только Core-импорты konva (`konva/lib/Core` подменён `ui/konvaCore.ts` без `Tween`/`Animation`/
  `FastLayer`, `vite.config.js` `resolve.alias`), не импортировать `konva/lib/shapes/Arrow`; плагины
  `jspdfWithoutOptional` и `konvaWithoutNodeGlobal` в `vite.config.js` (сторож `ui/konva.test.ts`).
- **Маркер `data-design-canvas`** (литерал в `DesignTab.jsx`) не должен встречаться ни во входе,
  ни в оболочках ERP и Order; вендоры дизайна и сид — тоже (`scripts/bundle-budget.mjs`,
  `DESIGN_REQUIRED = true`). Вход и оболочка ERP не растут: на 18.10 151 780 / 155 000
  и 194 405 / 195 000 — кодом вырос только `vendor-react` (+22 Б: привязки react-reconciler).
- Новое в холст — только то, что нужно для первой отрисовки; иначе — в свой ленивый чанк,
  а не подъём потолка.

## Интерфейс вкладки

- Вкладка и позиция — в адресе (`/sales/:id?tab=design&item=<key>`); маркер вкладки
  «— не размещено N» / «✓». На «Изделии» строка с раскладкой — `PrintRow placed` (зона и мм
  только для чтения, «Изменить на холсте»), без раскладки — «Поставить на изделие →».
- ≤ 760 px — только просмотр: превью `<img>` из `buildPreviewSvg`, холста нет.
- Клавиатурная альтернатива холсту: список слоёв (порядок = номер в ТЗ), инспектор, стрелки,
  Esc снимает выбор; тач-цели ≥ 44 px; иконки — свой набор Order (`ui/designIcons.ts`, формы
  по Lucide, ISC), из ERP — ничего.
- «Снять с изделия» — `layout = null`, строка остаётся; отмена — строка-статус с «Вернуть»
  (тосты проекта кнопку действия не умеют). Раскладку, которую холст не показывает (силуэт снят,
  в новой версии нет зоны), освобождает «Освободить раскладку» в «Без холста».
