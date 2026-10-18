# CLAUDE.md — Pinhead Order Studio

## Проект

Pinhead — внутренняя ERP/CRM-система для типографии (печать на одежде).
Пользователи: менеджеры, дизайнеры, производство, директор.
Цель: оформление заказов через визард, управление на Kanban-доске, аналитика, интеграция с Bitrix24 и 1С.

## Логика продукта (решение заказчика, 2026-07-17)

Два раздела с переключением в шапке (единая админка):
1. **✏️ ТЗ (Order Studio)** — создание технического задания к заказу.
   Формат ТЗ: docs/erp/tz-format-analysis.md. Генерация ТЗ-PDF — здесь (позже).
2. **🏭 Производство (ERP)** — заказ попадает сюда ПОСЛЕ создания ТЗ
   и движется по цехам до сдачи.

Поток: **ТЗ → Производство**. Текущий приоритет — производство (ERP):
поля ТЗ (размерная сетка, нанесения, упаковка/бирки) живут в производственном
заказе, цеха видят полное ТЗ в карточке. Этап-мост «ТЗ → авто-создание
производственного заказа» и генерация PDF — следующая очередь.

## Приложения

| Приложение | Путь | Назначение |
|---|---|---|
| **pinhead-react** | `pinhead-react/` | SPA — основной фронтенд |
| **Supabase** | `supabase/` | БД, auth, edge functions, миграции |
| **Vercel** | `vercel.json` | Хостинг и деплой фронтенда |

## Стек

- **Язык:** TypeScript (store, utils, lib) + JSX (компоненты)
- **Фреймворк:** React 19 + Vite 7
- **Стейт:** Zustand 5 (слайсы), useShallow для селекторов
- **Роутинг:** react-router-dom 7 (Routes/Route в App.jsx)
- **БД/Auth:** Supabase (supabase-js)
- **Графики:** библиотеки графиков нет. Chart.js и react-chartjs-2 убраны вместе
  с аналитикой продаж (веха 1 единого потока, 16.10; решение владельца); Recharts
  не было никогда. Понадобятся графики — обсудить библиотеку заново
- **Дизайн-мейкер (веха 5а, вкладка «Дизайн»):** `konva` 9.3.22 + `react-konva` 19.2.7 (холст,
  только Core-импорты), `jspdf` 4.2.1 + `svg2pdf.js` 2.8.1 (PDF макета), `pdfjs-dist` 4.10.38
  (логотипы PDF/AI), `zod` 4.3.6 (только `zod/mini`, схема флэтов) — все в ленивых чанках
- **Тесты:** Vitest + Testing Library (unit), Playwright (e2e)
- **Линтинг:** ESLint 9, Husky + lint-staged
- **CSS:** Vanilla CSS + CSS Modules (*.module.css), CSS-токены

## Структура файлов

```
pinhead-react/src/
├── App.jsx                  # Роутинг, guards, layout
├── main.jsx                 # Entry point
├── components/
│   ├── auth/                # AuthScreen, AdminPanel
│   ├── steps/               # Шаги визарда v3 убраны в вехе 3 (17.10); остались панели:
│   │   └── garment/         # SkuList, FabricGrid, ColorPicker, SizeTable, ExtrasAccordion — вкладка «Изделие» рабочего места (readOnly, reorderable, showPrice)
│   ├── editors/             # SkuEditor (8 табов), ExpressCalc
│   │   └── sku/             # SkuItemsTab, SkuFabricsTab, SkuTrimsTab, ExtrasEditor, SkuHardwareTab, PricingTabContent, CategoryRulesTab, ZonesCatalogTab (просмотр, веха 5б), AddSkuModal, ZonesModal, SkuDetailModal
│   └── shared/              # ErrorBoundary, Toast, PageHeader, Skeleton, UpdateBanner, ConfirmDialog
├── store/                   # Все файлы — TypeScript (.ts)
│   ├── useStore.ts          # Zustand store визарда — с вехи 3 БУФЕР ОДНОЙ позиции рабочего места (resetItemFields)
│   ├── appReset.ts          # registerAppReset: сторы регистрируют сброс, выход зовёт все
│   ├── slices/              # wizardSlice, productSlice, itemsSlice, detailsSlice, catalogSlice, orderSlice — все .ts (действия зон визарда убраны в вехе 5а)
│   ├── useAuthStore.ts      # Auth + роли
│   ├── useOrdersStore.ts    # CRUD заказов v3 (вкладка ERP «Заказы ТЗ»; канбан v3 убран)
│   ├── useCommentsStore.ts  # Комментарии к заказам
│   ├── useToastStore.ts     # Уведомления
│   ├── useConfirmStore.ts   # Imperative confirm dialog
│   └── useAppUpdateStore.ts # «Вышло обновление»: признак + «Позже» на полчаса
├── hooks/
│   ├── useFocusTrap.js      # Focus trap для модалок
│   ├── useMediaQuery.js     # Раскладка по ширине (компактный список изделий ≤ 760)
│   └── useEffectiveRules.ts # Resolved category rules для панелей визарда
├── lib/
│   ├── supabase.ts          # Supabase client
│   ├── api.ts               # API-функции (orders, comments, templates)
│   ├── storage.ts           # localStorage/sessionStorage обёртки + storageClearAll + Supabase Storage (sku-photos)
│   ├── appUpdate.ts         # Распознавание пропавшего чанка (устаревшая вкладка) — реакция ПОСЛЕ отказа
│   ├── appVersion.ts        # Сверка /version.json с маркером сборки — плашка ДО отказа (27.09)
│   └── catalogs.ts          # Загрузка каталогов из Supabase (catalog_config + app_config)
├── data/                    # Статические данные: цвета, ткани, цены, SKU, extras
├── types/                   # TypeScript типы: order, catalog, auth, pricing
├── utils/
│   ├── pricing.ts           # Расчёт цен — API визарда (88 тестов), обёртки над pricingCore
│   ├── pricingCore.ts       # Формула цены без стора: цены аргументом (Order v4, срез 0)
│   ├── costRules.ts         # Себестоимость, накладные, группы наценки, срочность по дням (правки CRM 13.10)
│   ├── printRules.ts        # DTF-раскладка, DTG-таблица, вышивка, надбавки шелкографии (13.10)
│   ├── materialSearch.ts    # Поиск тканей: модель + поставщик + ткань
│   ├── skuDescription.ts    # Описание изделия из выбранной ткани
│   ├── skuRules.ts          # CategoryRules резолюция, getEffectiveRules, динамические зоны (29 тестов)
│   ├── validate.ts          # Валидация заказа
│   ├── mockup.ts            # SVG-мокап генерация
│   ├── deadline.ts          # Расчёт дедлайнов
│   ├── displayNames.ts      # Показ: ткань названием, надбавка «+N ₽/шт», вид упаковки (16.10)
│   └── i18n.ts              # Pluralize, translateSupabaseError
├── styles/                  # CSS: auth, kanban (остаток: .kanban-page, .kb-search), wizard, forms, layout, garment, editors, extras-zones
└── orderstudio/             # Order v4: layout/ (оболочка раздела: OrderLayout, OrderSidebar, orderNav — снимок CSS оболочки ERP), model/ (заказ, имена полей как DraftItem, ряды размеров),
                             # pricing/priceOrder, bridge/ (tzToErpDraft + erpNames; launch — прототип запуска через стор ERP,
                             # динамический импорт трёх модулей ERP), api/salesOrders, api/salesTransitions (переходы,
                             # проверка запуска, оплата), api/artworks (бакет order-artworks),
                             # store/useSalesStore (автосохранение, состояния сохранения, сброс при выходе),
                             # model/editable (правка только в draft), model/itemOps (копия в другом цвете,
                             # разнесение по цветам, удаление), screens/ (SalesList /sales, newOrder, строки
                             # PrintRow/LabelRow, PricePanel), workplace/ (рабочее место /sales/:id: OrderWorkplace,
                             # ItemList, ItemTab + GarmentPanel, ClientTab, SummaryTab, SaveIndicator, itemBuffer —
                             # буфер позиции), wizard/wizardAdapter (salesItemToWizard, garmentPatch),
                             # admin/SalesStaff (/sales-staff), api/salesStaff, leaveGuard, switchToProduction;
                             # веха 4: catalog/ (типы и сиды справочников, suppliers — палитры, labels — бирки),
                             # api/catalogAdmin (catalog_put/prices_patch — единственный писатель справочников),
                             # admin/OrderSettings (/order-settings) + useCatalogEditor + tabs/ (вкладки справочников);
                             # веха 5а: design/ — вкладка «Дизайн» одним ленивым чанком (карта и бюджет — design/README.md):
                             # types/limits, geometry/ (перенос DM), catalog/ (flatsSchema на zod/mini, pickFlat,
                             # useFlatsCatalog), assets/ (sanitizeSvg, sniff, loadPdf, кэши картинок, useAddArtwork),
                             # model/ (layout + layoutMark — разбор без zod, placeArtwork, offset), store/useDesignStore
                             # (выбор, вид, undo; запись — только commit → useSalesStore.edit), ui/ (DesignTab, canvas/,
                             # panel/, DesignPreview, свои иконки designIcons), export/ (PDF макета, сцена, шрифты),
                             # seed/ (35 флэтов, 67 SVG, seedFlats — только по кнопке); api/garmentFlats (бакет
                             # garment-flats), model/printMethods (профили 8 техник, DPI, TECH_TO_METHOD),
                             # admin/tabs/FlatsTab (/order-settings?tab=flats);
                             # веха 5б: design/edit/ — чистое ядро правки флэта без React и сети (flatEdit, flatSizes,
                             # flatAreas, flatIds, newFlat, mirrorSleeve, calibrate, validateFlat); design/catalog/
                             # flatVersion (history[], flatAtVersion, geometryOf, releaseFlat, mergeFlatIntoRaw) и
                             # flatLabels; catalog/tzRows (строки матрицы ТЗ, ZONE_ID_RE); admin/flats/ — редактор
                             # флэта (ленивые FlatEditor с холстом canvas/ и FlatPreview без konva для телефона,
                             # saveFlat + useFlatEditor — файлы → версия → справочник, ZonesCatalogEditor + zonesEdit,
                             # свои иконки flatIcons); api/garmentFlatsRead (чтение бакета для холста)
```

```
supabase/
└── migrations/              # SQL-миграции (Supabase CLI)
```

## Роутинг

`App.jsx` выбирает оболочку по флагу `orderStudio` (`src/config/features.ts`):
по умолчанию **ErpApp** (Производство), с флагом — **OrderStudioApp** (ТЗ).
Переключатель — в шапке обоих разделов (admin/director).

### 🏭 Производство — `src/erp/ErpApp.jsx`

| Путь | Компонент | Доступ |
|---|---|---|
| `/` | ErpDashboard (обзор производства) | Все |
| `/orders`, `/orders/:orderId` | OrdersScreen, OrderCard | Все |
| `/board` | ProductionBoard (таблица + канбан цехов) | Все |
| `/queue/:deptCode` | DepartmentQueue (очередь участка; `/queue` без кода убран 07.09) | Все |
| `/task/:stageId` | ProductionTask (производственное задание) | Все |
| `/plan` | PlanScreen (недельный план производства) | Все (правка — `plan.manage`) |
| `/load` | DeptLoad (загрузка цехов из плановых дат этапов) | Все |
| `/gantt` | GanttScreen (этапы полосами во времени) | Все |
| `/orders/:orderId/purchase-list` | PurchaseListPrint (печатный лист закупки) | Все |
| `/leftovers` | FabricLeftovers (остатки полотна по рулонам) | `warehouse.manage`, `material.receive`, `order.manage` |
| `/purchasing`, `/warehouse`, `/subcontracting`, `/experimental` | Закупка, Склад, Подряд, Эксперим. цех | admin, director |
| `/admin` | AdminScreen (пользователи, права, цеха, мощность, справочники, аварийный режим, заказы ТЗ, ошибки интерфейса) | admin, director |

### ✏️ ТЗ (Order Studio) — за флагом `orderStudio`

Весь раздел — только профилю с продажами (`canUseSales` в `orderstudio/layout/orderNav.ts`:
active + approved и `is_sales`, `is_ms` или роль admin/director/rop — зеркало `sales_is_seller() or
sales_is_lead() or sales_is_ms()`; МС без `is_sales` видит «Заказы в работе», своих не заводит). Остальных `LeaveToProduction` один раз переводит в «Производство»
(флаг выключается, `location.replace('/')`, петли нет).

| Путь | Компонент | Доступ |
|---|---|---|
| `/` | → redirect `/sales` (визард v3 как экран убран в вехе 3) | С продажами |
| `/express` | ExpressCalc | С продажами |
| `/prices` | → redirect `/sku?tab=pricing` | admin, director |
| `/sku` | SkuEditor (8 табов; «Зоны нанесения» с вехи 5б — только просмотр со ссылкой на `/order-settings?tab=flats&part=zones`) | admin, director |
| `/admin` | AdminScreen (единая админка ERP) | admin, director |
| `/orders`, `/print`, `/analytics`, `*` | → redirect `/sales` (`legacyRedirect`; старый `/sales/:id/item/:key` — тоже) | С продажами |
| `/sales` | SalesList — «Мои заказы» (продавец) / «Заказы отдела» (rop) / «Все заказы» (admin, director) с фильтром «Мои / Все», поиск и статус в адресе | С продажами |
| `/sales/:id` | OrderWorkplace — рабочее место: список изделий + вкладки «Изделие» / «Дизайн» / «Клиент» / «ТЗ и цена»; вкладка и позиция в адресе `?tab=item\|design\|client\|summary&item=<key>`. «Дизайн» (веха 5а) — холст konva с флэтом позиции, логотипы, «Скачать PDF макета»; на ≤ 760 px — превью `<img>` | С продажами |
| `/sales-staff` | SalesStaff — «Сотрудники продаж»: «Ведёт заказы» (`is_sales`) и «Запускает в производство (МС)» (`is_ms`), `sales_set_staff(id, kind, on)` | admin, director, rop |
| `/order-settings` | OrderSettings — «Справочники заказа»: вкладки `?tab=suppliers\|labels\|packaging\|pricing\|tz\|flats` (поставщики и палитры, бирки и схемы, упаковка, правила цены, подвал ТЗ, «Флэты и зоны» — веха 5а: список силуэтов и кнопка «Загрузить типовые флэты» для admin/director; веха 5б — редактор флэта `?tab=flats&flat=<id>&view=<вид>` (`flat=new` — новый из SVG), режим «Зоны нанесения» `?tab=flats&part=zones`; правят admin/director, rop — просмотр); на ≤ 760 px — только просмотр (флэт — `FlatPreview` картинкой) | admin, director, rop |

## Роли

Учётная запись (`profiles.role`): admin, director, manager, rop, designer, production

Должность в ERP (`erp_employees.role`) — ДРУГОЙ перечень и другой вопрос
(«что человек делает на фабрике»): worker, foreman, dispatcher, purchaser,
storekeeper, hr, manager, director, production_head, technologist, dtf,
silkscreen, embroidery, designer, pending. Совпадение имени `designer`
в обоих списках не делает их одной величиной: профильный `designer`
резолвится в цехового `worker` (`PROFILE_ROLE_FALLBACK`), поэтому роль ERP
и заведена отдельно (правка 14.09).

## Правила и стиль

- Общение с пользователем: всегда на русском языке
- Язык интерфейса: русский
- CSS: vanilla + CSS Modules, токены в `styles/index.css`
- Компоненты: `.jsx`, утилиты/типы: `.ts`
- Стейт: Zustand слайсы, useShallow обязателен для объектных селекторов
- Тесты рядом с файлами: `Component.test.jsx`, `util.test.ts`
- Lazy loading: ExpressCalc, AdminPanel, SkuEditor, SalesList, OrderWorkplace, SalesStaff, OrderSettings;
  веха 5а — DesignTab (холст), DesignSide, DesignPreview, exportPdf, loadPdf, seedFlats, FlatsTab, схема флэтов;
  веха 5б — FlatEditor (редактор флэта с холстом konva), FlatPreview (телефон, без konva)
- Ошибки: toast уведомления через useToastStore
- Коммиты: на русском или английском, формат conventional commits
- **После каждого плана — проверка скиллами до одобрения** (решение владельца, 17.10):
  архитектура (`engineering:architecture`/`system-design`), тесты (`testing-strategy`),
  безопасность (отдельный агент-атакующий для прав, RLS, Storage, RPC), выкатка
  (`deploy-checklist`, если трогается база или прод), техдолг (`tech-debt`); для экранов —
  `design-critique`, `accessibility-review`, `ux-copy`. Находки вносятся в план, и только
  потом план идёт на одобрение

## Supabase — схема

| Таблица | Назначение |
|---------|-----------|
| `orders` | id, order_number (PH-XXXX: `generate_order_number()` из `order_number_seq`; её же зовёт умолчание колонки — формат в одном месте, сессия 68), status, data JSONB, bitrix_deal; `schema_version` — 3 визард, 4 Order v4 (колонки шапки v4, итог в `price_total`, НЕ в `total_sum` — его пишет в аудит `log_order_changes`; старый список читает только 3). Веха 2 (миграции A `20261017053703`, B `20261017062110`): служебные колонки v4 — `paid_kind`/`paid_at`/`paid_override_reason`, `sent_at`, `launch_started_at`/`launch_by`, `launched_at`/`launched_by`, `erp_order_id`, `archived_at`, плюс `sticker_preview_path`; формат номера — `order_number_format(bigint)` (его зовёт `generate_order_number()`), уникальный индекс `orders_order_number_uniq`. Веха 3 (миграция D `20261017101513`, на бой — после выкладки фронта): `order_v4_save_full`/`order_v4_save` отказывают `client_rev` < 3 («Вышло обновление»), обёртка сверяет `expected_updated_at` с `updated_at` строки у заказа в `draft` («Заказ изменён в другой вкладке») |
| `order_items` / `order_item_prints` / `order_item_labels` | Order v4 (миграция 20260928213529): позиции, нанесения, бирки; RLS на команду через родителя; запись — только `order_v4_save_full(jsonb)` (security invoker: `order_v4_save` + дни срочности одной транзакцией, 16.10). С вехи 2 — поля ТЗ (поставщик, описание модели, цвета частей, комментарий и PDF ТЗ; раскладка, файл макета, отступ, эффекты, подрядчик; метод `other`; бирки — `blank`, превью, схема крепления). Веха 5а (миграция H `20261017185435`): `order_item_prints.layout` — только геометрия холста, форма v1 (`v`, `flat_id`, `flat_version`, `view`, `area_id`, `x_mm`/`y_mm`, поворот, отражения, `asset`; путей нет), CHECK `order_item_prints_layout_check` (null или объект `v = '1'` ≤ 8 КБ); `order_items.flat_id` — CHECK `order_items_flat_id_check` (`''` или id флэта) |
| `order_notes_cards` | Order v4 (веха 2): карточки заметок ТЗ (`order_id`, `item_id` null, группа, подпись, ссылка, картинка); составной FK `(item_id, order_id)`; RLS через родителя |
| `order_events` | Order v4 (веха 2): журнал статусов и оплаты (`kind` = `status` / `payment`, `actor` = `auth.uid()`); у клиента только SELECT через родителя, пишут только RPC |
| `profiles` | id, name, email, role, approved, active, `is_sales` (веха 3, миграция E `20261017093841`: «Менеджер продаж»; меняет только RPC `sales_set_staff` admin/director (с вехи 4 — и rop), страж `profiles_sales_guard`; список — `sales_staff_list()`; `sales_is_seller()` = active + approved + `is_sales`). Веха 4, миграция F `20261017142210`: `is_ms` — МС (менеджер сопровождения) на стороне ТЗ; `sales_is_ms()` = active + approved + `is_ms` (должность ERP больше не читает); `sales_set_staff(uuid, text, boolean)` — вид `'sales'`/`'ms'`, отмечают admin/director/rop (перегрузки `(uuid, boolean)` с вехи 5а, миграция H, нет — двухаргументный вызов отвечает 42883); `sales_staff_list()` — роль, `is_sales`, `is_ms`; страж — исключения `is_sales` и `is_ms` |
| `order_comments` | Комментарии к заказам |
| `order_audit` | Лог изменений статусов |
| `app_config` | SKU (sku_catalog), цены (prices; с вехи 4 в нём и правила цены `packOptions`/`prepFees`/`minMarginPct`, `flexMatrix`), обработки (extrasCatalog), фурнитура (hardwareCatalog), правила (categoryRules), зоны (zonesCatalog; с вехи 5а — `pants-front`/`pants-back`, миграция H дописывает их в живой справочник; с вехи 5б — `tz_row?` (код строки матрицы ТЗ из `catalog/tzRows.ts`) и `active?` (`false` — снята: не предлагается новым позициям, в старых заказах остаётся); правит ТОЛЬКО режим «Зоны нанесения» вкладки «Флэты и зоны», название зоны после сохранения неизменно); веха 4 — бирки `labelLibrary` (виды, варианты, материалы, схемы притачивания) и подвал ТЗ `tzSettings`; веха 5а — флэты изделий `garmentFlats` (`{ version: 1, flats: [{ id, version, active, name, typical, categories, fits, sku_codes, views: [{ kind, svg_path, scale_mm_per_unit, print_areas: [{ id, name, zone_id, polygon_mm, methods, default_method }] }] }] }`; `svg_path` = `flats/<id>/v<version>/<kind>.svg`; в общую загрузку каталогов не входит; веха 5б — виды `sleeve_left`/`sleeve_right`, у флэта `garment_type`, `history: [{ version, views }]` — геометрия прежних версий (неизменяема, читатели — `flatAtVersion`), у зоны `tz_row`, `safe_inset_mm`, якоря вида) |
| `catalog_config` | Ткани (fabricsCatalog), отделка (trimCatalog); веха 4 — поставщики с палитрами `suppliers` (`isDefault`, `fabricSupplierNames`, `palette: { groups, colors }`) |

**Справочники заказа (веха 4, миграция G `20261017150000`)** — подробно
`docs/rules/pravila-spravochnikov-zakaza-i-ms-veha-4-17-10.md`. Ключ уникален по обеим таблицам
(сторож `catalog/catalogKeys.test.ts`). Запись новых экранов — только `security definer` RPC
`catalog_put(p_table, p_key, p_value, p_base)` (справочник целиком; белый список статическими
ветками: `suppliers`/`labelLibrary`/`tzSettings` — admin, director, rop; каталог моделей и тканей —
admin, director; с вехи 5а — `app_config.garmentFlats`, только admin, director; с вехи 5б, миграция I `20261018090000` — форма `garmentFlats` с историей и `zonesCatalog` в `catalog_value_check`, триггер-страж `app_config_order_catalog_guard`: история и версии неизменяемы, флэт и зона не исчезают, название зоны неизменно, DELETE строк этих ключей — только `service_role`; подробно `docs/rules/pravila-flety-i-zony-veha-5b-18-10.md`) и `prices_patch(p_patch, p_base)` (верхние ключи прайса; rop — только три ключа
правил). Защита от затирания — на сервере `where value = p_base` (смысловое равенство jsonb), иначе
`P0001`; форма записи (тип, 1 МБ, hex, уникальность id) — `22023`. Прямая запись в таблицы —
admin/director с `active and approved` (`catalog_writer()`). Чтение — только активным и одобренным
(`catalog_reader()`), `app_config.prices` — продажам, МС и руководству (`catalog_price_reader()`),
старый `catalog_config.prices` — руководству; `anon` — ничего.

**ERP (префикс `erp_*`, проект pinhead-os-v2)** — полная схема в
`pinhead-react/src/erp/types.ts` (зеркало таблиц) и в `supabase/migrations/`.
Ядро: `erp_departments` · `erp_orders` · `erp_order_items` · `erp_item_stages` ·
`erp_materials`. Таблицы и колонки — `docs/rules/pravila-shemy-erp-podrobno.md`;
**журнал правок схемы по датам** (24.08–05.10) —
`docs/rules/pravila-zhurnal-shemy-supabase-24-08-05-10.md`.

**Storage:**
| Bucket | Назначение |
|--------|-----------|
| `sku-photos` | Фото моделей (до 4 на SKU), public read |
| `erp-attachments` | Превью макетов, вложения заказов и ТЗ в PDF (префикс `tz/`), public read |
| `order-artworks` | Файлы заказа v4 (веха 2, миграция C `20261017070826`, применена 17.10): **private**, 25 МБ, пути `orders/<uuid>/…` (ASCII); подписанные ссылки 600 с по требованию, SVG — только `<img>` и скачиванием; UPDATE запрещён restrictive-политикой `order_artworks_no_update`. Правила — `docs/rules/pravila-hranilishcha-faylov-zakaza-veha-2-17-10.md` |
| `garment-flats` | Флэты изделий (веха 5а, миграция H `20261017185435`): **private**, 1 МБ, только `image/svg+xml`, путь `flats/<flat_id>/v<N>/<вид>.svg` (ASCII, версия 1…9999, `garment_flat_path_ok`); чтение — `catalog_reader()`, запись — admin/director (`catalog_writer()`), UPDATE запрещён restrictive `garment_flats_no_update`, DELETE-политики нет (версия неизменяема; L1 плана 5а «delete неупомянутых версий» отменён решением К5 вехи 5б). Пишет только `orderstudio/api/garmentFlats.ts` (`uploadFlatSvgOnce`: «уже есть» сверяется содержимым), читает холст через `api/garmentFlatsRead.ts`; наполняет кнопка «Загрузить типовые флэты», новые версии — редактор флэта (стартовая версия — и по занятым `v<N>` в бакете). Правила — `docs/rules/pravila-dizain-meikera-veha-5a-18-10.md` |
| `storage-backup` | Ночная копия бакетов выше (с вехи 5а — четырёх, `garment-flats` в `SOURCES`) (workflow «Storage backup», серверный `copy`, только новое, ничего не удаляется). **Private**, политик нет — только `service_role` (сессия 68) |

Уборка ничьих объектов `erp-attachments` — edge-функция `storage-gc` либо
`npm run storage:gc`; носителей ключа четыре, уборщиков два, ошибка проверки =
ничего не удалять. Подробно — `docs/rules/pravila-shemy-erp-podrobno.md`.

**Права Order v4 (веха 2; МС с вехи 4 — `profiles.is_ms`)** — подробно `docs/rules/pravila-prav-i-strazhey-order-v4-veha-2-17-10.md`:
- RPC (`security definer`, свой гейт): `order_v4_transition(p_id, p_to, p_reason)` — все переходы
  статуса v4; `order_v4_launch_check(p_id)` — проверка запуска до создания заказа ERP;
  `order_v4_set_payment(p_id, p_kind, p_override_reason)` — оплата и запуск без оплаты.
- Хелперы: `sales_is_lead()` (admin/director/rop), `sales_is_ms()` (МС: признак `profiles.is_ms`
  с вехи 4, миграция F; до неё — `erp_employees.role = 'manager'`), `sales_is_seller()` (признак
  `profiles.is_sales` с вехи 3); все требуют `active and approved`. Признаки ставит руководство
  продаж (admin/director/rop) через `sales_set_staff`, прямую запись отклоняет `profiles_sales_guard`.
- Стражи: `order_v4_guard` (`orders`, INSERT/UPDATE, белый список), `order_v4_delete_guard`
  (удалить — только черновик без связи с ERP), `order_v4_child_guard` (позиции, нанесения,
  бирки, карточки — только у черновика, пути `orders/<id>/…`).
- Пробы на бою — `supabase/probes/` (README там же).

Статусы заказа v3: draft → review → approved → production → done.
Переходы v4 (RPC вехи 2): draft → ready_to_launch → production → done; ready_to_launch → draft
(возврат с причиной); draft → archived. CHECK знает ещё `price_review`, `quoted`, `cancel_requested` —
переходов в них пока нет

Статусы профиля (ProfileStatus): active | pending_approval | disabled | no_profile
- `active`: approved + active
- `pending_approval`: active, но не approved
- `disabled`: active=false (soft-delete)
- `no_profile`: нет записи в profiles (user=null в store)

## Правило конца сессии (обязательное)

В конце КАЖДОЙ сессии обновить:
1. `SESSION-STATE.md` — текущее состояние, новые решения, next steps. В файле живут
   ДВЕ последние сессии: старший раздел переезжает в `docs/sessions/` и вписывается
   в `docs/sessions/INDEX.md` (сторож `src/sessionsIndex.test.ts`)
2. `docs/changelog/<YYYY-MM>.md` — запись сессии (что сделано), выше прежних;
   новый месяц — новый файл и строка в `docs/changelog/INDEX.md`
   (сторож `src/changelogIndex.test.ts`). `PROJECT.md` — только статистика и roadmap
3. `docs/DESIGN.md` — если менялся визуал/компоненты
4. `CLAUDE.md` (корневой и pinhead-react/) — если менялась структура/правила
Также: удалить временные QA-политики из БД (tmp_*), остановить dev-серверы.

## Правила кода

Выжимка; полный текст длинных пунктов (история, замеры) — `docs/rules/pravila-koda-polnyy-tekst.md`.

- `useShallow` для объектных селекторов Zustand — обязательно
- `toast.error` при каждой Supabase ошибке; `return null` из async при ошибке (не fallback объект)
- Optimistic update только с rollback; НЕ optimistic delete — ждать ответ Supabase
- CSS токены из `:root` (--type-*, --space-*, --z-*); не `!important`
- Autofocus на первом поле формы; npm-зависимости — только после обсуждения
- Supabase ключи строго из `.env` (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- RLS: политика НА КОМАНДУ, не `for all` рядом с `select`; `auth.uid()`/`auth.role()`
  и функцию-обёртку в предикате — в `(select …)`
- `is_admin()`, `erp_is_manager()`, `erp_is_member()` открыты REST — **так и оставляем**, не «чинить»
- Logout — `storageClearAll()`; удаление пользователя — soft-delete (active=false);
  Auth — ProfileStatus state machine
- Dev-mode created_by: 'dev' → null (saveOrder и duplicateOrder); deleteSkuPhotoByUrl —
  проверять результат, toast.error при ошибке
- **Order v4 пишется, ERP не трогается**: Order только читает типы и чистые хелперы ERP
- Панели визарда внутри заказа v4 — только через **буфер позиции** (`orderstudio/workplace/itemBuffer.ts`):
  `useStore` — буфер ОДНОЙ позиции, в заказ пишется только разница (`garmentPatch`) через
  `useSalesStore.edit` по ключу; смена позиции — отписка → загрузка → подписка; многоцветная
  позиция в буфер не грузится («Разнести по цветам»); открытие заказа ничего не пишет
- **Ревизия клиента** `SALES_CLIENT_REV` (`api/salesOrders.ts`) — всегда пара «клиент + миграция»
  с тем же порогом в `order_v4_save_full` и `order_v4_save`; миграция — ПОСЛЕ выкладки фронта,
  откат фронта — СНАЧАЛА откат миграции. RPC, меняющее заказ, обязано вернуть новый
  `updated_at` в `current` (иначе ложный «изменён в другой вкладке»). Подробно —
  `docs/rules/pravila-rabochego-mesta-i-revizii-klienta-veha-3-17-10.md`
- Состояния сохранения v4 `locked`/`outdated`/`conflict` — конечные: без повторов и потока RPC;
  правка только в `draft` (`model/editable`); выход сбрасывает заказ и буфер (`registerAppReset`)
- Новый импорт ERP-примитива в Order — сверять `npm run bundle:budget`: бюджет оболочки ERP
  держится на том, как Rollup режет чанки `ErpStates`/`ErpSkeletons` (запас 595 Б на 18.10, после вехи 5а)
- **Статус, оплата и связь с ERP у v4 — только RPC** (`order_v4_transition` / `_launch_check` /
  `_set_payment`); прямую запись отклоняют стражи Order (`order_v4_guard` белым списком,
  `_delete_guard`, `_child_guard`). Новая колонка `orders` — классифицировать в страже (сторож
  `orderV4Rights.test.ts`). Подробно — `docs/rules/pravila-prav-i-strazhey-order-v4-veha-2-17-10.md`
- Миграции на бой, пока MCP `execute_sql` виснет на `delete`/`drop`: сухой прогон
  (`begin; …; PROBE_RESULT`) и применение — файлами через SQL Editor владельцем
- Сторож импортов разрешает `bridge/launch.ts` ровно три модуля ERP и только динамически
- ERP: доступ — `useErpAccess`, кнопки этапа — `useStagePermissions`; прогресс в штуках;
  финальный ОТК (`qc`) зависит от ВСЕХ терминальных этапов
- ERP, realtime: `useErpStore()` без селектора запрещён; **живой канал ровно один**
- Сторож, читающий файлы, — `// @vitest-environment node` первой строкой
- Дата для показа — `utils/date.parseDateLocal`; байт 0x00 — только `CELL_SEP`
- ERP: боковая карточка заказа — в адресе (`?order=`)
- Необратимое действие этапа: последствия считает утилита и называет текстом
- Справочники — подсказка, значения отключаются, не удаляются; статусы не в справочнике
- **Справочники заказа (веха 4) пишет только `orderstudio/api/catalogAdmin.ts`** — RPC `catalog_put` /
  `prices_patch` с базой от момента чтения (сторож `catalogWrites.test.ts`: вне него нет записи
  `app_config`/`catalog_config`); редактор читает справочник свежим запросом мимо кэша, на конфликт
  правки остаются на экране, запасной путь (сиды) сохранять нельзя. Новый ключ справочника — в белый
  список RPC и в `CATALOG_PUT_KEYS` одним коммитом. Порог маржи — подсказка, сервер доверяет
  `price_total`; тексты справочников в PDF — только текстовым API. Подробно —
  `docs/rules/pravila-spravochnikov-zakaza-i-ms-veha-4-17-10.md`
- **Вкладка «Дизайн» (веха 5а): источник правды — заказ.** Холст пишет только
  `useDesignStore.commit` → `useSalesStore.edit`; открытие заказа и вкладки ничего не пишет (и `flat_id`);
  не черновик — только чтение, undo не копит. Мм, зона, техника, отступ, файл — в стандартных полях
  нанесения (одна цена со строкой), `layout` — только геометрия v1, **путей в нём нет**; превью PDF/AI —
  `<artwork_path>.preview.png`. SVG — санитайзер белым списком, тип по байтам (`sniff`), на холсте только
  Blob → `<img>`, сцена PDF — `DOMParser` + `importNode`; в `design/**` нет `innerHTML` и импортов `/erp/`
  (сторож `designGuards.test.ts`). Флэты неизменяемы по версии; сид — кнопкой, справочник последним.
  Холст ≤ 100 000 Б gzip, маркер `data-design-canvas` не во входе и не в оболочках (`bundle:budget`).
  Подробно — `docs/rules/pravila-dizain-meikera-veha-5a-18-10.md`
- **Флэты и зоны (веха 5б): правка геометрии — новая версия, метаданные — нет.** Геометрия (`GEOMETRY_KEYS`
  в `design/catalog/flatVersion.ts`: виды, SVG, масштаб, якоря, зоны и их `polygon_mm`/`safe_inset_mm`/
  `zone_id`) выпускает версию N+1, прежние виды уходят в `history[]` записи; метаданные (`META_KEYS`) правятся
  без версии и накладываются на старые версии по `area.id`. Новое поле схемы — классифицировать (сторож).
  Читатели старой раскладки — `flatAtVersion(flat, V)` (версия результата = V). Сохранение — только
  `admin/flats/saveFlat.ts`: файлы ВСЕХ видов новой версии (`uploadFlatSvgOnce`: `'same'`/`'differs'`) →
  потом `putCatalog` одного флэта, прочие записи сырыми, проверка склеенного справочника до запроса;
  сбой файлов — справочник не тронут. `zonesCatalog` пишет только `ZonesCatalogEditor` (сторож
  `zonesWrites.test.ts`), зоны снимаются `active: false`, не удаляются. `design/edit/**` — без `api/`,
  стора и тостов; в `admin/flats/**` нет `/erp/`, konva — только в ленивом `FlatEditor`. Подробно —
  `docs/rules/pravila-flety-i-zony-veha-5b-18-10.md`
- Цена материала — `priceRub` за единицу `unit` (метр / штука); `priceUSD` у тканей был ценой ЗА КГ
  и в формулу не идёт (13.10). Формула цены одна — `costRules`/`printRules`; своих копий в экранах не заводить
- Материальный гейт — из данных (`gate_material_kinds`), пусто = fail-open
- Очередь: `awaiting_materials` ≠ `waiting`
- План (`/plan`) — РУЧНОЙ, «убрать» = `cancelled`, не DELETE; план ставит
  `production_head`, факт — цех; диспетчеру `plan.manage` не давать
- `capacity_per_day` не возвращать — загрузка в штуках
- Матрица прав действует и НА СЕРВЕРЕ (зеркало `resolveErpRole`); нет права = запрет
- Права по колонкам — ТРИГГЕР-страж, не политика. **Стражей девять, а не пять**
- **Страж перечисляет ИСКЛЮЧЕНИЯ, а не охраняемые колонки**
- `on delete set null` у таблицы со стражем — ветка «родитель удалён»
- **Страж и клиентский гейт — ОДНИМ коммитом**; страж разрешает ровно то, что интерфейс
- `revoke` — `from public, anon`, затем `grant … to authenticated`
- Плановые даты этапа охраняются С ОБЕИХ СТОРОН; гейты сверять с базой
- ТЗ в PDF принадлежит ПОЗИЦИИ, видно всем цехам маршрута; гейт ТЗ fail-open
- Ключ объекта в Storage — строго ASCII (`tzFilePath`)
- Файл, видимый приложенным, обязан быть в бакете: загрузка при выборе, не в сабмите
- **ERP заморожен** (веха 1, 16.10): сторож `orderstudio/erpFrozen.test.ts` сверяет
  хэши `src/erp` и миграций ERP с `erpFrozen.json` и запрещает DDL по `erp_*` в новых
  миграциях. Правка ERP с согласия владельца — затем `npm run erp:freeze`
- **Order импортирует из ERP** только `erp/erp.module.css`, белый список примитивов
  `ERP_PRIMITIVES` (`erp/components`) и стор для моста — сторож `erpImports.test.ts`
  (реэкспорт и динамический `import()` тоже считаются)
- Оболочка Order (`orderstudio/layout/`) — снимок CSS оболочки ERP (импорт `erp.module.css`
  раздувал CSS оболочки ERP за бюджет); палитру и `--header-h: 0` у `.orderMain`
  держит `orderLayoutCss.test.ts`. Меняете палитру `.shell` — обновите снимок

## Где искать правило

Накопленные за 60+ сессий правила ПЕРЕЕХАЛИ в `docs/rules/` (15.09) — один
файл на сессию, текст перенесён дословно. Тематический вход —
**`docs/rules/INDEX.md`**; поиск по слову — `grep -rn "слово" docs/rules/`.

Зачем: этот файл вместе с `pinhead-react/CLAUDE.md` весил ~207k токенов
и читался ЦЕЛИКОМ на каждом запросе любой сессии, притом что 60 секций
из 73 — журнал по датам, а не справочник. Теперь здесь остаётся то, что нужно
ВСЕГДА: устройство проекта, схема, правила кода и правило конца сессии.

| Тема | Где | Ключевое |
|------|-----|---------|
| RLS, стражи, права | `docs/rules/INDEX.md` → «RLS, стражи и права» | гейт живёт у писателя; страж разрешает ровно то, что разрешает интерфейс |
| Сторожа и тесты | → «Сторожа и тесты» | сторож, зелёный на сломанном коде, — не сторож; проверять мутацией |
| Миграции | → «Миграции и журнал» | применённую правят НОВОЙ; снимок сверяется с живой базой |
| Вёрстка и токены | → «Вёрстка, токены, контраст» | фолбэк `var(--x, X)` запрещён; литерал, равный токену, — тоже |
| Планшет и раскладка | → «Планшет цеха, раскладка, офлайн» | у экрана с таблицей обязана быть компактная раскладка; тач-цель ≥44px |
| Storage и уборка | → «Storage, уборка данных и мёртвого кода» | «ничей» файл считается по носителям; уборка с возрастным гейтом |
| Маршрут и цеха | → «Маршрут ERP, этапы, цеха» | подрядность читается по `executor`; прогресс в штуках |
| Доступ и роли | → «Доступ, роли и заведение сотрудников» | две стены доступа: подтверждение почты и одобрение админом |
| Чат и уведомления | → «Чат и уведомления» | сообщение принадлежит ТРЕДУ; realtime — звонок, а не письмо |

⚠️ Правило, записанное позже, отменяет более раннее, а сверять его надо
с ЖИВОЙ БАЗОЙ, а не с прошлой формулировкой: устаревшее правило хуже
отсутствующего (на этом в проекте ловились дважды).

## Инструменты Claude (`.claude/`)

С 06.10 подключён плагин **everything-claude-code** (`ecc@ecc`, закреплён
на теге `v2.2.3` в `.claude/settings.json`): агенты, скиллы, команды и хуки ECC.
Правила ECC для нашего стека скопированы в `.claude/rules/ecc/` (`common`,
`typescript`, `react`, `web`). **При расхождении правил ECC и этого файла прав
проект**: например, порога покрытия 80% у нас нет, язык общения — русский.
Наши `test-driven-development`, `finishing-a-development-branch`,
`using-git-worktrees`, `software-architecture` заменены `tdd-workflow`,
`verification-loop`, `git-workflow`, `architect`/`planner`; их Pinhead-часть
(карта ERP, шаблон спеки, где тесты) — `docs/skills-pinhead.md`. Свои остались:
`systematic-debugging`, `root-cause-tracing`, `subagent-driven-development`,
`changelog-generator`, `zustand-store-ts`, агент `pinhead-qa`.
Выключить ECC — `"ecc@ecc": false`; только хуки — опция плагина `hooks_enabled`.
Закрепление — тегом, а не коммитом: маркетплейс клонируется `git clone --branch <ref>`,
и полный SHA отвечает «Remote branch … not found» (проверено 06.10 в изолированном
конфиге). Тег автор может передвинуть, поэтому перед обновлением и при подозрении
сверять: `git ls-remote --tags https://github.com/affaan-m/everything-claude-code v2.2.3`
→ `c05b2d6614f62f6db0047669aa4eefb223d478f9` (строка `^{}`). Другой SHA — плагин
выключить и разобраться до следующей сессии.
**В облачных сессиях `settings.json` сторонний маркетплейс НЕ ставит** (06.10:
в контейнере известен только `claude-plugins-official`, `installed_plugins.json`
пуст; по той же причине там никогда не грузился и `agents-design-experience@buildwithclaude`).
В облаке ECC ставит **Setup script окружения** (правит владелец: меню окружения →
Edit → Setup script) — блок со сверкой SHA тега из абзаца выше, затем
`claude plugin marketplace add affaan-m/everything-claude-code#v2.2.3` и
`claude plugin install ecc@ecc` (проверено в изолированном конфиге: `ecc@ecc 2.2.3 enabled`).
Npm-зависимости плагина при этом не ставятся (у него `overrides`) — если хук ECC
падает на отсутствующем пакете, выключить хуки (`hooks_enabled`), а не чинить пакетами.

## Документация

| Файл | Назначение |
|------|-----------|
| `CLAUDE.md` | Контекст для Claude (этот файл) |
| `docs/skills-pinhead.md` | Pinhead-часть скиллов, заменённых ECC |
| `docs/2026-10-05-ecc-review.md` | Обзор everything-claude-code |
| `docs/rules/INDEX.md` | **Указатель правил по темам** (75 файлов, перенос 15.09) |
| `docs/rules/react/INDEX.md` | **Карта подсистем React-приложения** (48 файлов, «где что лежит») |
| `pinhead-react/CLAUDE.md` | Контекст для Claude (вложенный, детали React-приложения) |
| `PROJECT.md` | История, статистика, roadmap |
| `docs/changelog/INDEX.md` | **Changelog** — записи сессий по файлу на месяц (перенос 26.09) |
| `docs/OPERATIONS.md` | Эксплуатация: инциденты, окружения, доступы |
| `SESSION-STATE.md` | Память проекта: текущее состояние, решения, next steps (две последние сессии) |
| `docs/sessions/INDEX.md` | **История сессий** — разделы «Состояние на …» по файлу на раздел (96 файлов, перенос 24.09) |
| `docs/DESIGN.md` | Дизайн-система (токены, компоненты, UX-правила) |
| `docs/erp/*` | ERP: план, разборы таблицы/kontora24/ТЗ |
| `docs/erp/2026-09-27-order-v4-structure.md` | **Order v4** — целевая структура блока продаж, срезы 0–5; спека среза 0 и сверка с кодом 28.09 — рядом |
| `docs/PINHEAD-PORTAL-LOGIC.md` | Логика визарда |
| `docs/2026-07-27-erp-ux-audit.md` | Аудит UI/UX раздела ERP |
| `docs/2026-09-23-erp-code-review.md` | Код-ревью ERP: 13 находок, статус правок |
| `docs/2026-09-24-project-review.md` | Обзор проекта целиком: 15 находок по приоритетам, порядок работ |
| `docs/2026-09-26-project-review.md` | Обзор 26.09: 32 находки разведки, что сделано, бэклог |
| `docs/2026-07-29-full-audit.md`, `docs/2026-08-03-erp-audit.md`, `docs/2026-09-03-erp-audit.md`, `docs/2026-09-04-erp-ux-review.md`, `docs/2026-08-11-load-test.md` | Прежние аудиты — помечены superseded, читать как снимок на дату |

## Команды

```bash
cd pinhead-react
npm run dev        # Dev server
npm run build      # Production build
npm run test       # Vitest unit tests
npm run e2e        # Playwright e2e tests
npm run lint       # ESLint
```
