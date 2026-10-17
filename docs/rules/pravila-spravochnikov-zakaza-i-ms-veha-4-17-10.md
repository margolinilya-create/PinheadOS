# Правила справочников заказа и МС на стороне ТЗ (веха 4, 17.10)

План — `docs/superpowers/plans/2026-10-17-order-flow-m4-admin.md`. Миграции:
**F** `20261017142210_sales_ms_flag` (МС на стороне ТЗ) и **G** `20261017150000_order_catalogs`
(справочники заказа). Обе — на бой ДО мерджа вехи 4, сухим прогоном с пробами в SQL Editor
владельцем. Пробы — `supabase/probes/order_v4_rights.sql` (F, `total=151`) и
`supabase/probes/order_catalogs.sql` (G, `total=93`). Клиент — `orderstudio/api/catalogAdmin.ts`,
`orderstudio/admin/useCatalogEditor.ts`, `orderstudio/admin/OrderSettings.jsx` (`/order-settings`),
`orderstudio/admin/SalesStaff.jsx` (`/sales-staff`), `orderstudio/catalog/` (типы, сиды,
поставщики, бирки).

---

## Справочники заказа: где лежат и кто правит

- Справочники заказа — те же две таблицы, что остальные каталоги. **Ключ уникален по ОБЕИМ
  таблицам** (сторож `orderstudio/catalog/catalogKeys.test.ts`):
  - `catalog_config.suppliers` — поставщики с палитрой внутри (`{ groups, colors }`), ровно один
    `isDefault` (сегодня Коттонпром), привязка по `fabricSupplierNames`;
  - `app_config.labelLibrary` — бирки: виды, варианты, материалы с надбавкой, схемы притачивания.
    Старый `labelsCatalog` читает v3 `orderSlice` — его не трогаем;
  - `app_config.tzSettings` — подвал ТЗ (`footerText`);
  - правила цены — ключи прайса `app_config.prices`: `packOptions`, `prepFees`, `minMarginPct`
    (и `flexMatrix` — его правит вкладка «Флекс» в `/sku`).
- Типы и сиды — только `orderstudio/catalog/types.ts` и `seeds.ts`. JSON сидов в миграции
  равен `seeds.ts` (сторож `catalog/seedsMatch.test.ts`, там же — цены бирок сида равны
  `pricingCore` для всех комбинаций и ключи упаковки равны CHECK ERP).
- **Кто правит:** справочники заказа и «Сотрудников продаж» — admin, director, **rop**
  (`canManageOrderCatalogs`, `canManageSalesStaff` в `layout/orderNav.ts`); каталог моделей,
  тканей и общий прайс (`/sku`) — admin, director, как раньше.
- **Справочник — подсказка.** Цвет, вариант бирки, вид упаковки снимаются с продажи
  (`active: false`), не удаляются. Значение, уже стоящее в заказе, показывается как есть
  с пометкой «снят с продажи» и не стирается. Цвет вне палитры («Белый (5001)» у ткани Медас,
  свободный текст «розовый») загружается в буфер позиции как есть — открытие ничего не пишет.

## Запись — только две RPC, защита от затирания по базе

- Справочник — ОДНА строка jsonb. Клиентское «прочитать → поправить → записать» молча затирает
  чужую правку (вторая вкладка, второй администратор, `erp_sku_catalog_upsert` из ERP). Поэтому
  новые экраны пишут только через `security definer` RPC с условной записью:
  - `catalog_put(p_table, p_key, p_value, p_base) returns timestamptz` — справочник целиком;
  - `prices_patch(p_patch, p_base) returns jsonb` — только изменённые верхние ключи прайса,
    `p_base` — прежние значения ТЕХ ЖЕ ключей, сверка по каждому.
- **Защита — сравнение с базой НА СЕРВЕРЕ:** `update … where key = p_key and value = p_base`.
  Равенство jsonb смысловое (порядок ключей и `1.0`/`1` не важны), md5 на клиенте не нужен.
  Не совпало — `P0001` «Справочник изменён — загрузите свежую версию». Так ловится и запись
  из ERP, и запись мимо RPC. `p_base = null` — только для отсутствующей строки.
- **Белый список — статическими ветками**, без склейки строк. Продажи (admin, director, rop):
  `catalog_config.suppliers`, `app_config.labelLibrary`, `app_config.tzSettings`. Только admin,
  director: `catalog_config.{fabricsCatalog, trimCatalog}`, `app_config.{sku_catalog,
  extrasCatalog, hardwareCatalog, categoryRules, zonesCatalog}`. Прайс через `catalog_put`,
  `feature_flags`, старые `catalog_config.{prices, labels, extras, fabrics}`, иной регистр
  и чужая таблица — `22023`.
- **Форма записи проверяется на сервере** (`catalog_value_check`, `prices_rule_check`): тип
  значения по ключу, лимит 1 МБ, hex `^#[0-9A-Fa-f]{6}$`, обязательные поля, уникальность id
  (код цвета — по всем палитрам), одна палитра по умолчанию. В прайсе: только существующие
  ключи плюс три новых, тип ключа не меняется, `null` — только у `minMarginPct`, ключи упаковки —
  подмножество CHECK ERP (`none/bopp/zip/other`). rop через `prices_patch` правит только
  `packOptions`, `prepFees`, `minMarginPct`. RPC сами ставят `updated_at`, у `catalog_config` —
  и `updated_by`.
- **Клиентский писатель один** — `orderstudio/api/catalogAdmin.ts` (`putCatalog`, `patchPrices`,
  виды отказа `conflict` / `forbidden` / `other`, `toast.error` на каждый). Сторож
  `orderstudio/catalogWrites.test.ts`: в `src` вне него нет
  `.from('app_config'|'catalog_config').upsert|update|insert|delete`. `SkuEditor`
  и `PricingTabContent` пишут только изменённые ключи через эти RPC с базой от момента открытия;
  при частичном отказе флаги не сбрасываются и «Сохранено локально» не пишется.
- **Прямая запись в таблицы не закрыта** (решение владельца), но требует `active and approved`
  (`catalog_writer()`: admin/director). Отсюда правило выкатки: **между применением G и выкладкой
  фронта не сохранять каталог в `/sku`** — старый редактор upsert-ом перезапишет прайс целиком
  (без `packOptions` / `prepFees` / `minMarginPct` / `flexMatrix`). Окно держать коротким: G — непосредственно
  перед выкладкой фронта, после выкладки сверить ключи прайса на бою.
- Цена бирки по библиотеке — `max(0, цена варианта + надбавка материала)`: надбавка бывает минусом.
- Коды цвета палитры сравниваются после обрезки пробелов — и клиентом (`validateSuppliers`),
  и сервером (`catalog_put`, `btrim`).

## Редактор справочника (`useCatalogEditor`)

- Справочник читается **свежим запросом** `fetchCatalogKey` мимо кэша `pinhead_catalogs_v1`;
  прочитанное и есть база записи.
- **Конфликт** — плашка `role="alert"` («Справочник «…» уже изменили — в другой вкладке или
  другой администратор…»), кэш каталогов сброшен, правки остаются на экране, сохранение закрыто
  до «Загрузить свежую версию»; свежая версия заменяет правки, их вносят заново.
- **Запасной путь** (справочник не загрузился: сбой, строки нет, значение из localStorage или
  сидов) — состояние `fallback`, «Справочник не загрузился. Заказы пока считают по встроенным
  значениям.», **сохранение заблокировано**: сиды поверх базы не пишутся. Заказы при этом
  считаются по встроенным значениям (`catalogSource: 'fallback'` в `catalogSlice`).
- Несохранённые правки отмечаются в `leaveGuard` — уход со страницы и смена вкладки
  подтверждаются. Вкладка экрана — в адресе (`?tab=suppliers|labels|packaging|pricing|tz`),
  реестр — `admin/orderSettingsTabs.ts`.
- **На телефоне (≤ 760 px) справочники только для просмотра**; правка — с компьютера.
- hex из справочника в стиль — только через `utils/sanitizeHex` (не `#RGB`/`#RRGGBB` → `#ccc`),
  не в CSS-переменных и не строкой в `style` без проверки.

## Права чтения справочников

- `app_config` и `catalog_config` читает только активный и одобренный профиль
  (`catalog_reader()`): неодобренный и отключённый видят 0 строк, `anon` — `permission denied`
  (у `anon` к таблицам справочников ничего нет; у `authenticated` нет
  `truncate/references/trigger`).
- `app_config.prices` — дополнительно продажи, МС и руководство (`catalog_price_reader()` =
  `sales_is_lead() or sales_is_seller() or sales_is_ms()`). Начальник цеха видит `sku_catalog`,
  но не прайс; клиент без прайса считает по `PRICES` из кода. Старый `catalog_config.prices` —
  только руководству продаж.
- Предикаты — функции-обёртки в `(select …)`, политика на каждую команду.

## МС на стороне ТЗ (миграция F)

- МС (менеджер сопровождения, запускает заказы в производство) — **явный признак
  `profiles.is_ms`**, а не должность `erp_employees.role = 'manager'`. Должность в ERP — вопрос
  «что человек делает на фабрике», её правят в ERP, а ERP заморожен.
- `sales_is_ms()` = активный, одобренный, `is_ms`; строки ERP не читает. Политики `orders_*`,
  Storage `order-artworks` и RPC `order_v4_transition` / `_launch_check` / `_set_payment` зовут
  её — их не пересоздавали.
- Признак ставит руководство продаж (admin, director, rop) на экране «Сотрудники продаж»
  (`/sales-staff`): колонки «Ведёт заказы» (`is_sales`) и «Запускает в производство (МС)»
  (`is_ms`). RPC `sales_set_staff(p_profile uuid, p_kind text, p_on boolean)` — статические
  ветки `'sales'` / `'ms'`, иначе `22023`; у вида нет умолчания; чужая роль — `42501`.
  Перегрузка `sales_set_staff(uuid, boolean)` — тонкая обёртка с видом `'sales'` для вкладок,
  открытых до выкладки; **уходит в вехе 5**. Объявлена ПЕРЕД трёхаргументной: замороженный
  сторож ERP `rpcContract.test.ts` берёт последнюю сигнатуру имени.
- `sales_staff_list()` отдаёт роль, `is_sales`, `is_ms`; видят admin, director, rop.
- Страж `profiles_sales_guard` перечисляет ИСКЛЮЧЕНИЯ — `is_sales` и `is_ms`: прямая запись
  любого из них отклоняется даже у админа; ранний выход — только если не изменился ни один.
- МС без признака продавца входит в раздел ТЗ (`canUseSales` = `is_sales || is_ms || роль lead`
  при active + approved — зеркало `sales_is_seller() or sales_is_lead() or sales_is_ms()`),
  видит «Заказы в работе», своих не заводит (`canCreateOrders` / `orders_insert`).
- **После применения F МС нет ни одного** — запуск доступен только admin/director, пока
  руководство не отметит МС. Нынешних МС по ERP выбирает запрос из шапки миграции F; отметить
  можно в той же транзакции, что и миграция.

## Порог маржи — только подсказка

- `prices.minMarginPct` (процент; `null` — не предупреждать, умолчание) — **подсказка
  продавцу** в `PricePanel` («Маржа ниже порога — проверьте скидку и ручные цены»), а не запрет. Скидку и ручную цену продавец
  ставит сам.
- **Сервер доверяет `price_total`**, который прислал клиент: ни `order_v4_save_full`, ни стражи
  маржу не проверяют. Сделать порог запретом — отдельное решение владельца и серверная проверка,
  а не клиентский гейт.
- Подготовка (`prepFees`, ₽ на заказ по технике нанесения, пусто — 0) и упаковка
  (`packOptions`: цена и подпись четырёх ключей CHECK ERP) входят в расчёт заказа
  (`rulesFromPrices`, `priceOrder`). Подпись упаковки — из одного источника `prices.packOptions`
  в сторе (её читают `displayNames`, `PACKAGING_OPTIONS`, сводка).

## Тексты справочников в PDF (веха 6) — только текстовый API

- Подвал ТЗ, названия цветов, бирок, схем и упаковки — свободный текст, который вводит
  руководство продаж. В ТЗ-PDF вехи 6 они попадают **только через текстовый API генератора**
  (вывод строки как текста), никогда не через HTML-разметку, `innerHTML`,
  `dangerouslySetInnerHTML` или рендер HTML в картинку.
- Схема притачивания у бирки хранит id (`neck`, `inseam`…); имя для PDF брать из библиотеки,
  неизвестный id показывать как есть (старый свободный текст — с пометкой «нет в справочнике»).

## Бэклог, оставленный вехой 4

- Перегрузка `sales_set_staff(uuid, boolean)` — убрать до вехи 5.
- Цены бирок в экспрессе и старом визарде — на константах `pricingCore`, не из библиотеки.
- `SkuColorPicker` / `allowedColors` знают только палитру Медастекс.
- Старые ключи `catalog_config.{prices, labels, extras, fabrics}` — вне белого списка записи;
  решить, убирать ли.
