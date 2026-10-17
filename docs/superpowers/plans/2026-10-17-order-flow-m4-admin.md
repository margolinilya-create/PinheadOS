# Веха 4: админка раздела ТЗ — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** справочники заказа ведутся в разделе ТЗ. Руководство продаж (admin, director, rop) правит:
- поставщиков и их палитры;
- бирки и схемы притачивания;
- упаковку;
- правила цены;
- текст подвала ТЗ;
- «Сотрудников продаж» (менеджер продаж и МС).

Заказ берёт значения из справочников.

**Architecture:**
- Справочники лежат в `catalog_config` и `app_config`, как остальные каталоги.
- Новые экраны пишут через две `security definer` RPC с защитой от затирания. Защита — сравнение с базой на сервере (`where value = p_base`, равенство jsonb смысловое), без md5 на клиенте. Это ловит и запись из ERP, и запись мимо RPC.
- Прямая запись в таблицы остаётся (решение владельца), но требует `active and approved`.
- Чтение справочников — только одобренным; прайс — только продажам, МС и руководству.
- МС переезжает на сторону ТЗ: `profiles.is_ms`. ERP не меняется.

**Tech Stack:** React 19, Zustand 5, Supabase (миграции F и G — общие таблицы и таблицы Order, без DDL по `erp_*`), Vitest + Testing Library, Playwright на моке.

**Spec:** `docs/superpowers/specs/2026-10-16-unified-order-flow-design.md` — строки 40–55, раздел «Формат ТЗ», таблица вех (веха 4).

## Решения владельца (17.10)
1. **Поставщики и палитры — полный редактор.**
   - Палитра — группы и цвета. Цвета добавляются и снимаются с продажи, не удаляются.
   - Палитры Медас и Коттонпром переносятся как есть.
   - Одна палитра отмечена «по умолчанию»: сейчас это Коттонпром, как сегодня для всех поставщиков, кроме Медас.
   - В заказе предлагается только палитра поставщика ткани (или палитра по умолчанию) плюс «свой цвет текстом».
   - Цвета из другой палитры, уже выбранные в заказах, сохраняются как есть.
2. **Один экран «Сотрудники продаж»:** «Ведёт заказы» (`is_sales`) и «МС» (`is_ms`). МС без признака продавца тоже попадает в раздел ТЗ: видит заказы в работе, своих не создаёт.
3. **Бирки — справочник и схемы.** Справочник: вид, варианты, материалы с надбавкой. Отдельно — набор схем притачивания. Строка бирки в заказе: вариант и материал из справочника, флажок «Бланк», схема. Превью бирок — в вехе 5.
4. **Значения вносит владелец.** Порог маржи по умолчанию пуст («не предупреждать»), подготовка — 0, подвал ТЗ — текст из образцов.
5. **Прямую запись в таблицы справочников не закрываем.** Добавляем только `active and approved`.
6. **Кто правит:**
   - справочники заказа (поставщики, бирки, упаковка, правила цены, подвал) и «Сотрудников продаж» — admin, director, **rop**;
   - каталог моделей, тканей и общий прайс (`/sku`) — admin, director, как сейчас.

## Решения контроллера (по проверке скиллами и безопасности)
- **Поставщики** — один ключ `catalog_config.suppliers` с палитрой внутри: `{ groups, colors }`.
- **Бирки** — новый ключ `app_config.labelLibrary`. Старый `labelsCatalog` читает v3 `orderSlice`, его не трогаем.
- **Подвал** — ключ `app_config.tzSettings`.
- **Правила цены** — `prices.packOptions`, `prepFees`, `minMarginPct`.
- **Ключи справочников уникальны по двум таблицам**, это проверяет сторож. Старые `catalog_config.{prices,labels,extras,fabrics}` в белый список записи не входят.
- **`catalog_put` и `prices_patch` проверяют форму записи:**
  - тип значения по ключу;
  - лимит 1 МБ;
  - белый список — статическими ветками, без склейки строк;
  - для прайса: только существующие ключи плюс три новых; тип не меняется; `null` разрешён только у `minMarginPct`; ключи упаковки — подмножество CHECK;
  - hex цвета — `^#[0-9A-Fa-f]{6}$`;
  - сами ставят `updated_at`, у `catalog_config` ещё `updated_by`.
- **Сиды только добавляют.**
  - Новый ключ — `on conflict do nothing`.
  - Прайс — `jsonb_build_object(новые) || value`, существующее значение побеждает.
  - Проба проверяет, что после G прежние ключи не изменились (сверка md5 до и после на сервере).
- **Цена бирки.** Источник для v4 — библиотека. Запасной путь — нынешняя `salesLabelPrice`. Варианты сида повторяют `pricingCore` (сторож на все комбинации). Экспресс и старый визард остаются на константах — запись в бэклог.
- **Подпись упаковки** берётся из одного источника — `prices.packOptions` из стора. Его читают `displayNames`, `PACKAGING_OPTIONS` и сводка.
- **Редакторы читают справочник свежим запросом**, мимо кэша `pinhead_catalogs_v1`.
  - На конфликт: сброс кэша, кнопка «Загрузить свежую версию», правки остаются на экране.
  - Если справочник загрузился запасным путём (localStorage или сиды), сохранение заблокировано.
- **`SkuEditor` и `PricingTabContent`** пишут только изменённые ключи через новые RPC, с базой от момента открытия.
  - При частичном отказе флаги не сбрасываются, «Сохранено локально» не пишется.
  - Мёртвая запись перестановки в `SkuList` удаляется.
- **На телефоне (≤ 760 px) справочники только для просмотра.** Правка — с компьютера.

## Global Constraints
- **ERP не меняется** (сторожа `erpFrozen`, `erpImports`); npm не добавлять.
- **Lint** ≤ 34, новых предупреждений 0.
- **Бюджет бандла:** вход ≤ 155000, оболочка ERP ≤ 195000 Б JS / 16000 Б CSS. Экраны — ленивые чанки. Вкладки — примитивы `Tabs`/`TabPanel` из `ERP_PRIMITIVES`, каждый новый импорт сверять с `bundle:budget`.
- **Код:**
  - `useShallow`;
  - `toast.error` при ошибке Supabase;
  - optimistic только с откатом;
  - без `dangerouslySetInnerHTML`;
  - hex в стили — только через `sanitizeHex`, не в CSS-переменных.
- **RLS:**
  - политика на каждую команду;
  - `revoke … from public, anon` + `grant … to authenticated`;
  - страж перечисляет исключения;
  - страж и клиентский гейт — в одном PR.
- **Справочники — подсказка:** значение снимается с продажи (`active: false`), а не удаляется. В заказе снятое показывается с пометкой «снят с продажи».
- **Интерфейс:**
  - вкладка экрана — в адресе (`?tab=`);
  - тексты по-русски, кнопки называют результат («Сохранить поставщиков»);
  - тач-цели ≥ 44 px;
  - цвет не единственный носитель смысла;
  - рамка образца с контрастом ≥ 3:1.
- **Миграции на бой** — файлами в SQL Editor владельцем: сухой прогон с пробами → применение → `APPLIED.json`.

## Review Focus
1. **Две вкладки (или вкладка и ERP) правят один справочник.** Вторая получает отказ, правки на экране не теряются, после «Загрузить свежую версию» снова можно сохранять. Тест — задачи 1, 2, 5.
2. **Снятый цвет или вариант бирки уже стоит в заказе.** Заказ показывает его как есть, с пометкой, и не стирает. Тест — задачи 3, 4.
3. **Справочник не загрузился.** Заказы считаются по встроенным значениям, редактор не даёт сохранить сиды поверх базы. Тест — задачи 1, 2.
4. **Цвет вне палитры.** Это «Белый (5001)» у ткани Медас (живые данные) или свободный текст «розовый». Загрузка позиции в буфер без правки ничего не пишет, код и подпись сохраняются. Тест — задача 3.
5. **Посторонний вызывает RPC или читает прайс.** Продавец, начальник цеха, неодобренный профиль или `anon` получают отказ, либо 0 строк. Проба — задачи 0, 1.

---

### Task 0: МС на стороне ТЗ (миграция F) и «Сотрудники продаж»

**Files:**
- Create: `supabase/migrations/<ts>_sales_ms_flag.sql`, `supabase/probes/` — новые пробы в `order_v4_rights.sql`.
- Modify:
  - `orderstudio/admin/SalesStaff.jsx`, `api/salesStaff.ts`;
  - `layout/orderNav.ts` (`canUseSales`, `SalesProfile`, подпись «Сотрудники продаж», пункт и для rop);
  - `types/auth.ts`, `store/useAuthStore.ts` (`is_ms`, dev-пользователь);
  - `OrderStudioApp.jsx` (доступ к `/sales-staff` для rop).
- Test: `admin/SalesStaff.test.jsx`, `api/salesStaff.test.ts`, `layout/orderNav.test.ts`, `orderV4Rights.test.ts`.
- Мок e2e не трогать.

**Interfaces — Produces:**
- `profiles.is_ms boolean not null default false`.
- `sales_is_ms()` — `create or replace`, active + approved + `is_ms`; `erp_employees` больше не читает.
- `sales_set_staff(p_profile uuid, p_kind text, p_on boolean)`:
  - статические ветки `'sales'` и `'ms'`, иначе 22023;
  - у `p_kind` нет умолчания;
  - доступ admin, director, rop (active + approved), иначе 42501.
- Перегрузка `sales_set_staff(uuid, boolean)` остаётся тонкой обёрткой с kind `'sales'` до вехи 5. Обе сигнатуры получают `revoke` и `grant`; каждая закрывает метку `sales.rpc`.
- `sales_staff_list()` пересоздаётся (`drop function` + `create or replace function`, `revoke` и `grant`):
  - отдаёт роль, `is_sales`, `is_ms`;
  - доступ admin, director, rop.
- Страж `profiles_sales_guard`:
  - ранний выход только если не изменился ни один из двух признаков;
  - INSERT — если оба не `true`.
- `notify pgrst, 'reload schema'`.
- Клиент:
  - `setSalesStaff(id, kind, on)`;
  - `canUseSales` = `is_sales` || `is_ms` || роль lead, при active + approved;
  - серверное зеркало в комментарии: `sales_is_seller() or sales_is_lead() or sales_is_ms()`;
  - таблица: колонки «Ведёт заказы» и «Запускает в производство (МС)», роль профиля, счётчики «Продавцов: N · МС: M»;
  - сохранение — по ключу `${id}:${kind}`, откат только своего признака;
  - подзаголовок переписан.

- [ ] **Step 1. Пробы:**
  - `ms_is_ms` через `is_ms`;
  - `self_set_ms` → 42501;
  - прямой `update profiles set is_ms` у admin → 42501;
  - `insert` и `on conflict do update` с `is_ms` → 42501;
  - rop `set_staff` → OK;
  - продавец, МС, начальник цеха → 42501 на обеих сигнатурах;
  - `p_kind` равный `'role'`, `'MS'` или `null` → 22023;
  - `is_ms` + `active=false` → нет доступа к `ready_to_launch`;
  - МС не видит `draft` и не может делать UPDATE `orders`.
  - Обновить `total`.
- [ ] **Step 2. Тесты клиента:**
  - доступ МС в раздел;
  - два переключателя с откатом;
  - сторож.
- [ ] **Step 3.** Мутация: снять `is_ms` из стража — проба краснеет.
- [ ] **Step 4.** Реализация.
- [ ] **Step 5.** Проверки: vitest, typecheck, lint. Коммит.

**Выкатка:** F — до мерджа. Файлы `1-dryrun-F` / `2-apply-F` готовит контроллер.

### Task 1: RPC справочников, права чтения и записи, сиды (миграция G), загрузка в стор

**Files:**
- Create:
  - `supabase/migrations/<ts>_order_catalogs.sql`;
  - `supabase/probes/order_catalogs.sql`;
  - `orderstudio/catalog/types.ts` — все типы: `Supplier`, `Palette`, `LabelLibrary`, `TzSettings`;
  - `orderstudio/catalog/seeds.ts` — из `MEDASTEX_COLORS`/`COLOR_GROUPS`, `COTTONPROM_*`, `LABEL_CONFIG` + цены `pricingCore`, packOptions из 4 ключей CHECK;
  - сторожа: `catalog/seedsMatch.test.ts` (сид миграции = `seeds.ts`; цены бирок сида = `pricingCore` для всех комбинаций; ключи упаковки = CHECK) и `catalog/catalogKeys.test.ts` (уникальность ключей по таблицам);
  - `orderstudio/api/catalogAdmin.ts`.
- Modify:
  - `lib/catalogs.ts` — `fetchCatalogKey(table, key)` мимо кэша;
  - `store/slices/catalogSlice.ts` — новые ключи и признак `catalogSource: 'db' | 'fallback'`;
  - `e2e/support/mockSupabase.ts` — `catalog_config`, `app_config` с состоянием и RPC справочников; на `sales_staff_*` тоже ответить;
  - `supabase/probes/README.md`.
- Test: `api/catalogAdmin.test.ts`, `store/slices/catalogSlice.test.ts`.

**Interfaces — Produces (SQL):**
- **`catalog_put(p_table text, p_key text, p_value jsonb, p_base jsonb) returns timestamptz`:**
  - белый список пар:
    - продажи (admin, director, rop): `catalog_config.suppliers`, `app_config.labelLibrary`, `app_config.tzSettings`;
    - только admin, director: `catalog_config.fabricsCatalog`, `catalog_config.trimCatalog`, `app_config.{sku_catalog, extrasCatalog, hardwareCatalog, categoryRules, zonesCatalog}`;
  - условный `update … where key = p_key and value = p_base returning`. Пусто → `P0001` «Справочник изменён — загрузите свежую версию»;
  - `p_base = null` допустим только для отсутствующей строки;
  - проверки формы — из «Решений контроллера»;
  - 42501 — «Справочники меняет администратор, директор или руководитель продаж».
- **`prices_patch(p_patch jsonb, p_base jsonb) returns jsonb`:**
  - `p_base` — прежние значения тех же верхних ключей; сравнение `value->k = p_base->k` по каждому, при расхождении — P0001;
  - rop может менять только `packOptions`, `prepFees`, `minMarginPct`; admin и director — все существующие ключи и эти три.
- **RLS:**
  - SELECT `app_config` и `catalog_config` — `public.catalog_reader()`: active + approved, `definer`, `(select …)`;
  - ключ `app_config.prices` — дополнительно `sales_is_lead() or sales_is_seller() or sales_is_ms()` или admin;
  - INSERT/UPDATE/DELETE — admin/director с active + approved.
- **Гигиена:** `revoke truncate, references, trigger` у `anon` и `authenticated`; у `anon` — всё.
- **Сиды:** новые ключи плюс три ключа прайса — только добавление.

**Interfaces — Produces (клиент):**
- `putCatalog(table, key, value, base): Promise<{ ok: true } | { ok: false; kind: 'conflict' | 'forbidden' | 'other'; message: string }>`;
- `patchPrices(patch, base): Promise<…то же…>`;
- стор: `suppliers`, `labelLibrary`, `tzSettings`, `catalogSource`. При отсутствии ключей — сиды, `catalogSource: 'fallback'`. Если `prices` не пришёл (нет права), считаем по `PRICES` из кода.

- [ ] **Step 1. Пробы:**
  - admin, director и rop пишут ключи продаж;
  - rop на `sku_catalog` → 42501;
  - продавец → 42501;
  - отключённый admin делает прямой upsert → отказ;
  - `p_base` с другим порядком ключей и `1.0` → проходит;
  - изменённая база → P0001;
  - запись `erp_sku_catalog_upsert` между чтением и записью → P0001;
  - пары `('app_config','prices')`, `('app_config','feature_flags')`, `('catalog_config','prices')`, `('App_config','sku_catalog')`, `('profiles','x')` → 22023;
  - `anon` → permission denied;
  - неверный тип или hex, лишний ключ упаковки, `null` → 22023;
  - неодобренный → 0 строк;
  - начальник цеха получает `sku_catalog`, но не `prices`;
  - продавец, rop и МС получают `prices`;
  - md5 прежних ключей до и после G равны.
- [ ] **Step 2. Тесты:**
  - `catalogAdmin` — виды отказов;
  - `catalogSlice` — запасной путь даёт `fallback`, отсутствие `prices` не роняет расчёт;
  - мок с состоянием.
- [ ] **Step 3.** Реализация.
- [ ] **Step 4.** Коммит.

**Выкатка:**
- G — до мерджа.
- **Владельцу:** между применением G и выкладкой фронта не сохранять каталог в `/sku` — старый редактор перезапишет прайс целиком.

### Task 2: Экран «Справочники заказа» — оболочка

**Files:**
- Create: `orderstudio/admin/OrderSettings.jsx` (+ `.module.css`, тест), `orderstudio/admin/useCatalogEditor.ts` (+ тест), заглушки `orderstudio/admin/tabs/{Suppliers,Labels,Packaging,PricingRules,Tz}Tab.jsx`.
- Modify:
  - `OrderStudioApp.jsx` — ленивый `/order-settings`, доступ admin, director, rop;
  - `layout/orderNav.ts` — «Справочники заказа» в «Настройках»; «Каталог» → «Каталог моделей и цен»;
  - `orderstudio/screens/useOrderPrice.ts` и `pricing/priceOrder.ts` — заготовка: `labelLibrary` и `packOptions` в селекторе и сигнатуре, поведение прежнее.

**Interfaces — Produces:**
- `<OrderSettings />`: вкладки `suppliers | labels | packaging | pricing | tz` в `?tab=`, на `Tabs`/`TabPanel`. Реестр вкладок фиксирован здесь.
- Вкладка: `({ readOnly }) => JSX`, на ≤ 760 — `readOnly`.
- Шапка экрана — ссылка «Ткани и цены моделей — в «Каталоге моделей и цен»».
- `useCatalogEditor(table, key)` → `{ value, setValue, dirty, save, reload, state: 'loading' | 'ready' | 'saving' | 'conflict' | 'error' | 'fallback' }`:
  - свежий `fetchCatalogKey`, база — значение из загрузки;
  - на конфликт — `clearCatalogsCache()`, правки на месте;
  - на успех — стор и кэш обновлены;
  - уход и смена вкладки при `dirty` — подтверждение (`leaveGuard`).
- Тексты:
  - конфликт (`role="alert"`): «Справочник «…» уже изменили — в другой вкладке или другой администратор. Ваши правки не сохранены. Загрузите свежую версию и внесите их снова.»;
  - не загрузилось: «Справочник не загрузился. Заказы пока считают по встроенным значениям.», кнопка «Загрузить снова».

- [ ] **Step 1. Тесты:**
  - вкладка из адреса, клавиатура;
  - rop видит пункт, продавец — нет, маршрут уводит;
  - `useCatalogEditor`: конфликт, fallback (сохранение заблокировано), уход с несохранённым.
- [ ] **Step 2.** Реализация.
- [ ] **Step 3.** Коммит.

### Task 3: Поставщики и палитры

**Files:**
- Create: `orderstudio/catalog/suppliers.ts`, реализация `admin/tabs/SuppliersTab.jsx`.
- Modify:
  - `components/steps/garment/ColorPicker.jsx`, `FabricGrid.jsx`;
  - `utils/colorSupplier.ts`;
  - `orderstudio/wizard/wizardAdapter.ts` — `colorLabel`/`colorCodeOf` берут палитры аргументом, `WizardCatalogs` + `suppliers`; `colorSupplierText` срезает «(…)» только у распознанного кода; в `salesItemToWizard` свободный текст цвета идёт в буфер как есть;
  - `orderstudio/workplace/itemBuffer.ts`.
- Test: рядом с каждым, в том числе первые тесты `ColorPicker` и `FabricGrid`.

**Interfaces — Produces:**
- `supplierForFabric(fabric, suppliers): Supplier | null`: привязка по `fabricSupplierNames`, иначе палитра по умолчанию.
- `findPaletteColor(code, suppliers)`: сначала палитра поставщика ткани, затем глобальный поиск.
- `colorSupplier` в буфере — id поставщика (`medastex`, `cottonprom`) или `''`.
- `ColorPicker`:
  - палитра поставщика ткани;
  - `<button aria-pressed>` с названием и кодом;
  - снятые не предлагаются, выбранный снятый — с пометкой;
  - поле «Свой цвет» с подсказкой «У поставщика нет палитры — впишите цвет, как в накладной».
- `SuppliersTab`:
  - поставщик, палитра по умолчанию (ровно одна), привязка имён тканей из `fabricsCatalog` (одно имя — не больше одной палитры, предупреждение о непривязанных);
  - группы;
  - цвета списком с правкой строки по клику, поиск, «Показать снятые», «Снять с продажи / Вернуть», образец рядом с hex;
  - уникальность кода по всем палитрам;
  - `aria-invalid` и `aria-describedby` у hex.

- [ ] **Step 1. Тесты (живые формы):**
  - «Белый (5001)» у Медас сохраняется;
  - «розовый» загрузка → `garmentPatch` = null;
  - снятый цвет в позиции остаётся;
  - палитра по умолчанию для непривязанного поставщика;
  - hex `'#fff" onload=…'` → `#ccc` (через `sanitizeHex`);
  - редактор: добавить, снять, привязать, дубль кода, конфликт.
- [ ] **Step 2.** Реализация.
- [ ] **Step 3.** Коммит.

### Task 4: Бирки и схемы

**Files:**
- Create: `orderstudio/catalog/labels.ts`, реализация `admin/tabs/LabelsTab.jsx`.
- Modify: `orderstudio/screens/LabelRow.jsx`, `pricing/priceOrder.ts` (`salesLabelPrice` через библиотеку, запасной путь — прежний расчёт).
- Test: рядом с файлами.

**Interfaces — Produces:**
- Варианты библиотеки: id = нынешние `variant_id` (`standard`, `my-logo`, `no-logo`, `custom`, `send-own`); `materials: { key, name, priceDelta }[]`.
- `LabelRow`:
  - вид, вариант и материал из библиотеки;
  - «Бланк» (`blank`);
  - «Схема притачивания» (`attach_scheme`);
  - снятый вариант — с пометкой.
- `LabelsTab`: виды, варианты, материалы, схемы.

- [ ] **Step 1. Тесты:**
  - цена из библиотеки = прежней для всех комбинаций (сид);
  - снятый вариант;
  - бланк и схема пишутся в позицию;
  - `wizardParity` зелёный;
  - редактор.
- [ ] **Step 2.** Реализация.
- [ ] **Step 3.** Коммит.

### Task 5: Упаковка, правила цены, подвал; SkuEditor без затирания

**Files:**
- Create: реализация `admin/tabs/PackagingTab.jsx`, `PricingRulesTab.jsx`, `TzTab.jsx`.
- Modify:
  - `utils/displayNames.ts` и `orderstudio/screens/labels.ts` — подписи упаковки из стора;
  - `components/editors/SkuEditor.jsx`, `editors/sku/PricingTabContent.jsx` — изменённые ключи через `putCatalog`/`patchPrices` с базой от открытия; частичный отказ показывается по справочникам;
  - `components/steps/garment/SkuList.jsx` — удалить запись перестановки.
- Test: рядом с файлами, плюс тест `rulesFromPrices`.

**Interfaces — Produces:**
- Упаковка: цена и подпись 4 ключей.
- Правила:
  - «Предупреждать, если маржа ниже, %» (пусто — не предупреждать);
  - подготовка по методам `SALES_PRINT_METHODS`.
- Подвал: `footerText`, по умолчанию «Допуск по размещению нанесения — до 2 см».
- Сторож: в `src` вне `catalogAdmin.ts` нет `.from('app_config'|'catalog_config').upsert|update|insert|delete`.

- [ ] **Step 1. Тесты:**
  - `rulesFromPrices`;
  - предупреждение маржи в `PricePanel`;
  - подпись упаковки из админки видна в сводке;
  - SkuEditor не шлёт `prices` целиком и не пишет умолчания кода;
  - частичный конфликт не сбрасывает флаги.
- [ ] **Step 2.** Реализация.
- [ ] **Step 3.** Коммит.

### Task 6: e2e, axe, эталоны

**Files:**
- Create: `e2e/order-settings.spec.ts`.
- Modify: `e2e/visual.spec.ts` (`studio-settings`, `studio-staff`), `e2e/order-workplace.spec.ts`.

- [ ] **Step 1. Сценарии:**
  - rop добавляет цвет поставщику → цвет доступен в заказе;
  - правка подготовки → итог «ТЗ и цена» меняется;
  - две вкладки → плашка конфликта, «Загрузить свежую версию»;
  - продавец не видит пункт;
  - МС без признака продавца заходит в раздел;
  - отметка МС на «Сотрудниках продаж».
- [ ] **Step 2.** axe без нарушений serious/critical, снимки.
- [ ] **Step 3.** Коммит.

### Task 7: Документы и выкатка
- **Документы:**
  - CLAUDE.md: маршруты; схема (`is_ms`, ключи справочников, RPC, права чтения); раздел «Права Order v4» — МС теперь `is_ms`;
  - правило в `docs/rules/`:
    - справочники заказа и защита по базе;
    - МС на стороне ТЗ;
    - порог маржи — только подсказка, сервер доверяет `price_total`;
    - в PDF вехи 6 — только текстовый API;
  - changelog, SESSION-STATE (бэклог: перегрузка `sales_set_staff(uuid, boolean)` — до вехи 5; цены бирок в экспрессе и визарде; `SkuColorPicker`/`allowedColors` знают только Медастекс; старые ключи `catalog_config`), PROJECT.
- **Выкатка:**
  1. F и G — сухие прогоны и применение до мерджа.
  2. PR → `update_snapshots` → мердж.
  3. `APPLIED.json`, пробы на бою.

## Порядок исполнения (воркфлоу)
0 ∥ 1 (worktree) → слияние → 2 → 3 ∥ 4 ∥ 5 (worktree; общие типы и сиды — только задача 1, реестр вкладок и сигнатура цены — только задача 2) → слияние → 6 → 7 → финальное ревью.

## Нужно от владельца
- Сухие прогоны и применение F и G в SQL Editor до мерджа.
- Между G и выкладкой не сохранять каталог в `/sku`.
- После выкладки: внести порог маржи, подготовку, подвал ТЗ, отметить продавцов и МС.
- `update_snapshots`.
