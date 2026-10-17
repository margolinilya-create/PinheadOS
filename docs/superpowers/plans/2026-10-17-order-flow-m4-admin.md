# Веха 4: админка раздела ТЗ — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin/director ведут справочники заказа в разделе ТЗ — поставщики и их палитры, бирки и схемы притачивания, упаковку, правила цены, текст подвала ТЗ — и сотрудников продаж (менеджер продаж, МС); заказ берёт значения из справочников.

**Architecture:** справочники живут в `catalog_config`/`app_config` (как остальные каталоги), запись — через две `security definer` RPC с гейтом admin/director и защитой от затирания (`md5` прежнего значения / слияние ключей прайса). Экран — `/order-settings` (вкладки в адресе), сотрудники — `/sales-staff`. МС переезжает на сторону ТЗ: `profiles.is_ms` вместо `erp_employees.role='manager'`. ERP не меняется.

**Tech Stack:** React 19, Zustand 5, Supabase (миграции F, G — только Order/общие таблицы), Vitest + Testing Library, Playwright на моке.

**Spec:** `docs/superpowers/specs/2026-10-16-unified-order-flow-design.md` (строки 40–55 «Каталоги Order», раздел «Формат ТЗ», таблица вех — веха 4).

## Решения владельца (17.10)
1. Поставщики и палитры — **полный редактор**: у поставщика своя палитра (код, название, цвет, группа; цвета добавляются и отключаются, не удаляются). Текущие палитры Медас и Коттонпром переносятся как есть. Цвет в заказе выбирается из палитры поставщика ткани; поставщик без палитры — свободный текст цвета.
2. **Один экран «Сотрудники продаж»**: «Менеджер продаж» и «МС» в одной таблице. Признак МС хранится на стороне ТЗ (`profiles.is_ms`), ERP не трогаем.
3. Бирки — **справочник + схемы притачивания**: вид, варианты, материалы, цена; набор схем. В строке бирки заказа — варианты из справочника, флажок «Бланк», схема. Превью бирок (картинки) — веха 5.
4. Значения (порог маржи, подготовка, подвал ТЗ) владелец вносит сам; поля стартуют пустыми: порог выключен, подготовка 0, подвал — текст из образцов ТЗ.

## Решения контроллера
- Поставщики хранятся одним ключом `catalog_config.suppliers` с палитрой внутри (вместо пары `suppliers` + `supplierPalettes` из спеки): одна запись — одна правка, без рассинхрона.
- Справочник бирок — новый ключ `app_config.labelLibrary` (`{ kinds, schemes }`), а не `labelsCatalog`: старый массив читает `orderSlice` v3 — не ломаем.
- Подвал ТЗ — ключ `app_config.tzSettings` (`{ footerText }`); правила цены — в `prices` (`packOptions`, `prepFees`, `minMarginPct`).
- Затирание: целые ключи пишет `catalog_put(table, key, value, expected_md5)` (отказ «Справочник изменён в другой вкладке — обновите»), прайс — `prices_patch(patch)` (слияние верхних ключей). `SkuEditor` переходит на те же RPC (сейчас перезаписывает `prices` целиком).
- Сиды — миграцией G из констант кода (`MEDASTEX_COLORS`, `COTTONPROM_COLORS`, `LABEL_CONFIG`, `PACK_OPTIONS`); сторож сверяет сид с кодом. Привязка поставщиков ткани сохраняет нынешнее поведение: «Медас» → палитра Медас, остальные семь → Коттонпром.
- Ключи упаковки фиксированы CHECK ERP (none/bopp/zip/other) — в админке правится только цена и подпись; сторож `packagingValues` остаётся.

## Global Constraints
- ERP не меняется (сторожа `erpFrozen`, `erpImports` зелёные); npm не добавлять.
- Lint ≤ 34 (новых предупреждений 0); бюджет: вход ≤ 155000, оболочка ERP ≤ 195000 Б JS / 16000 Б CSS — экран настроек и редакторы — ленивые чанки; новый импорт ERP-примитива — сверить `bundle:budget`.
- `useShallow`; `toast.error` при ошибке Supabase; optimistic только с откатом; не optimistic delete.
- RLS на команду; `revoke … from public, anon` + `grant … to authenticated`; страж перечисляет исключения; страж и клиентский гейт — одним PR.
- Справочники — подсказка: значения отключаются (`active: false`), не удаляются.
- Вкладка экрана в адресе (`?tab=`); тексты по-русски; кнопки называют результат; тач-цели ≥ 44 px; компактная раскладка 760/480 у таблиц.
- Миграции на бой — файлами в SQL Editor владельцем (сухой прогон с пробами → применение → `APPLIED.json`).

## Review Focus
1. **Две вкладки админки правят один справочник** — вторая получает отказ, правки первой не теряются. Тест — задача 1.
2. **Отключённый цвет/вариант бирки уже стоит в заказе** — заказ показывает его как есть (с пометкой «снят»), не стирает. Тест — задачи 2, 3.
3. **Справочник не загрузился / пуст** — заказ работает на палитрах из кода (сид), цена — на умолчаниях; экран настроек показывает «не загрузилось — повторить». Тест — задачи 1, 2.
4. **Поставщик ткани не привязан ни к одной палитре** — цвет вводится текстом, буфер позиции его не стирает. Тест — задача 2.
5. **Неадмин открыл `/order-settings` или вызвал RPC** — маршрут уводит, RPC отвечает 42501. Тест/проба — задачи 0, 1.

---

### Task 0: МС на стороне ТЗ (миграция F) и «Сотрудники продаж»
**Files:** Create `supabase/migrations/<ts>_sales_ms_flag.sql`; Modify `orderstudio/admin/SalesStaff.jsx`, `orderstudio/api/salesStaff.ts`, `store/useAuthStore.ts` (тип), `layout/orderNav.ts` (подпись «Сотрудники продаж»), `supabase/probes/order_v4_rights.sql`; Test `admin/SalesStaff.test.jsx`, `api/salesStaff.test.ts`, `orderV4Rights.test.ts`.
**Interfaces — Produces:** `profiles.is_ms boolean not null default false`; `sales_is_ms()` новой редакции = active + approved + `is_ms` (больше не читает `erp_employees`); `sales_set_staff(p_profile uuid, p_kind text /* 'sales'|'ms' */, p_on boolean)` (прежняя сигнатура удаляется в той же миграции); `sales_staff_list()` отдаёт `is_ms`; страж `profiles_sales_guard` охраняет `is_sales` и `is_ms`. Клиент: `setSalesStaff(id, kind, on)`; таблица — две колонки-переключателя.
- [ ] Пробы: `ms_is_ms` через `is_ms`; `self_set_ms` → 42501; `admin_set_ms` → OK; МС без `is_ms` не видит `ready_to_launch`. Обновить `total`.
- [ ] Тесты клиента (переключатель МС с откатом), сторож.
- [ ] Миграция + клиент; `npx vitest run src/orderstudio --maxWorkers=3`, typecheck, lint; коммит. Файлы SQL Editor (`1-dryrun-F.sql`, `2-apply-F.sql`) готовит контроллер.
**Выкатка:** F до мерджа (клиент вехи 3 `sales_set_staff` с тремя аргументами не знает → в той же миграции оставить перегрузку `(uuid, boolean)` = kind 'sales' до вехи 5; удалить в бэклоге).

### Task 1: RPC справочников и сиды (миграция G), загрузка в стор
**Files:** Create `supabase/migrations/<ts>_order_catalogs.sql`, `orderstudio/api/catalogAdmin.ts`, `orderstudio/catalog/seeds.ts` (сиды из констант кода), `orderstudio/catalog/seedsMatch.test.ts` (сторож: сид миграции = `seeds.ts`); Modify `store/slices/catalogSlice.ts` (ключи `suppliers`, `labelLibrary`, `tzSettings`), `lib/catalogs.ts`, `e2e/support/mockSupabase.ts` (`catalog_config`, `app_config` новые ключи, RPC); Test `api/catalogAdmin.test.ts`, `catalogSlice` тест.
**Interfaces — Produces:**
- SQL: `catalog_put(p_table text, p_key text, p_value jsonb, p_expected_md5 text) returns text` (новый md5) — белый список `(table,key)`: `catalog_config.suppliers`, `catalog_config.fabricsCatalog`, `catalog_config.trimCatalog`, `app_config.{labelLibrary,tzSettings,sku_catalog,extrasCatalog,hardwareCatalog,categoryRules,zonesCatalog}`; расхождение md5 → `P0001` «Справочник изменён в другой вкладке — обновите страницу»; `prices_patch(p_patch jsonb) returns jsonb` (`value || patch` для `app_config.prices`); обе — admin/director active+approved, иначе 42501.
- Сиды: `catalog_config.suppliers`, `app_config.labelLibrary`, `app_config.tzSettings`; `prices` дополняется `packOptions`/`prepFees: {}`/`minMarginPct: null` только если ключей нет.
- Клиент: `putCatalog(table, key, value, expectedMd5): Promise<{ok:true, md5} | {ok:false, kind:'conflict'|'other', message}>`; `patchPrices(patch): Promise<Record<string,unknown> | null>`; `catalogMd5(value): string` (тот же md5, что `md5(value::text)` — сторож на совпадение форматирования jsonb).
- Стор: `suppliers: Supplier[]`, `labelLibrary: LabelLibrary`, `tzSettings: TzSettings`; при отсутствии ключей — сиды из кода.
- [ ] Пробы (`supabase/probes/order_catalogs.sql`, README, сторож `probesFiles`): admin put/patch OK; seller → 42501; устаревший md5 → P0001; ключ вне белого списка → 22023.
- [ ] Тесты, реализация, коммит. Файлы SQL Editor (`3-dryrun-G`, `4-apply-G`) — контроллер.
**Выкатка:** G до мерджа (только добавляет).

### Task 2: Экран «Справочники заказа» — оболочка и вкладки
**Files:** Create `orderstudio/admin/OrderSettings.jsx` (+ `.module.css`, тест); Modify `OrderStudioApp.jsx` (ленивый маршрут `/order-settings`, admin/director), `layout/orderNav.ts` («Справочники заказа» в «Настройки»).
**Interfaces — Produces:** `<OrderSettings />` с вкладками `suppliers | labels | packaging | pricing | tz` (`?tab=`, `role="tablist"`, стрелки, Home/End); каждая вкладка — ленивый компонент из `orderstudio/admin/tabs/<Name>Tab.jsx` с контрактом `({ readOnly }) => JSX`, сохранение — своё (через `catalogAdmin`); заглушки вкладок для задач 3–5. Общий `useCatalogEditor(table, key)` → `{ value, setValue, dirty, save, state: 'idle'|'saving'|'conflict'|'error' }` (md5 из загрузки).
- [ ] Тесты: вкладка из адреса, клавиатура, неадмин → редирект, `useCatalogEditor` (конфликт → состояние conflict без затирания).
- [ ] Реализация, коммит.

### Task 3: Поставщики и палитры (вкладка + выбор цвета в заказе)
**Files:** Create `orderstudio/admin/tabs/SuppliersTab.jsx`, `orderstudio/catalog/suppliers.ts`; Modify `components/steps/garment/ColorPicker.jsx`, `FabricGrid.jsx`, `utils/colorSupplier.ts`, `orderstudio/wizard/wizardAdapter.ts` (`colorLabel`/`colorCodeOf` через палитры каталога), `orderstudio/workplace/itemBuffer.ts`; Test рядом с каждым (+ первые тесты `ColorPicker`, `FabricGrid`).
**Interfaces — Produces:** `type Supplier = { id: string; name: string; fabricSupplierNames: string[]; palette: PaletteColor[]; active: boolean }`, `type PaletteColor = { code: string; name: string; hex: string; group: string; active: boolean }`; `supplierForFabric(fabric, suppliers): Supplier | null`; `findPaletteColor(code, suppliers): PaletteColor & {supplierId} | null`. `colorSupplier` в буфере — id поставщика или `null` (свободный текст). `ColorPicker` — вкладки по поставщикам с палитрой; отключённые цвета не предлагаются, но выбранный отключённый показывается с пометкой «снят».
- [ ] Тесты: палитра по ткани; поставщик без палитры → поле текста цвета, буфер не стирает подпись; отключённый цвет в позиции сохраняется; редактор (добавить цвет, отключить, привязать поставщика ткани; hex валидируется; конфликт md5).
- [ ] Реализация, коммит.

### Task 4: Бирки и схемы (вкладка + строка бирки)
**Files:** Create `orderstudio/admin/tabs/LabelsTab.jsx`, `orderstudio/catalog/labels.ts`; Modify `orderstudio/screens/LabelRow.jsx`, `pricing/priceOrder.ts` (`salesLabelPrice` — цена варианта, иначе `P.label`); Test рядом.
**Interfaces — Produces:** `type LabelLibrary = { kinds: LabelKind[]; schemes: AttachScheme[] }`, `LabelKind = { type: keyof typeof LABEL_TYPE_TO_ERP; name: string; variants: { id; name; materials: string[]; price: number | null; active: boolean }[]; active: boolean }`, `AttachScheme = { id; name; active }`. `LabelRow`: вид/вариант/материал из библиотеки, флажок «Бланк» (`blank`), «Схема притачивания» (`attach_scheme`).
- [ ] Тесты: вариант из библиотеки, отключённый вариант в позиции показан «снят», цена варианта в `priceOrder`, бланк и схема пишутся в позицию; редактор вкладки.
- [ ] Реализация, коммит.

### Task 5: Упаковка, правила цены, подвал ТЗ; SkuEditor без затирания
**Files:** Create `orderstudio/admin/tabs/PackagingTab.jsx`, `PricingRulesTab.jsx`, `TzTab.jsx`; Modify `components/editors/SkuEditor.jsx`, `editors/sku/PricingTabContent.jsx` (сохранение через `putCatalog`/`patchPrices`), `orderstudio/screens/useOrderPrice.ts` (тест `rulesFromPrices`); Test рядом.
**Interfaces — Produces:** упаковка — цена и подпись четырёх ключей CHECK (`patchPrices({packOptions})`); правила — `prepFees` по `SALES_PRINT_METHODS`, `minMarginPct` (пусто = выключен) → `patchPrices`; подвал — `tzSettings.footerText` (`putCatalog`). SkuEditor: прайс — `patchPrices` только изменённых ключей; массивы — `putCatalog` с md5.
- [ ] Тесты: `rulesFromPrices` (пусто/значения), предупреждение маржи в `PricePanel` при пороге, ключи упаковки = CHECK (сторож), SkuEditor не шлёт `prices` целиком, конфликт md5 в SkuEditor.
- [ ] Реализация, коммит.

### Task 6: e2e, axe, эталоны
**Files:** Create `e2e/order-settings.spec.ts`; Modify `e2e/visual.spec.ts` (`studio-settings`), `e2e/order-workplace.spec.ts` (цвет из палитры каталога, бирка с бланком).
- [ ] Сценарии: admin добавляет цвет поставщику → цвет доступен в заказе; правит подготовку → итог в «ТЗ и цена» меняется; конфликт двух вкладок → плашка; seller не видит пункт и `/order-settings`.
- [ ] axe без serious/critical; снимок; коммит.

### Task 7: Документы и выкатка
- CLAUDE.md (маршруты, схема: `is_ms`, ключи справочников, RPC), правило в `docs/rules/` (справочники заказа, md5-защита, МС на стороне ТЗ), changelog, SESSION-STATE, PROJECT.
- Выкатка: F и G до мерджа (сухие прогоны), PR → `update_snapshots` → мердж, `APPLIED.json`, пробы на бою.

## Порядок исполнения (воркфлоу)
0 ∥ 1 (worktree) → слияние → 2 → 3 ∥ 4 ∥ 5 (worktree) → слияние → 6 → 7 → финальное ревью.

## Нужно от владельца
- Сухие прогоны и применение F и G в SQL Editor (до мерджа).
- После выкладки: внести порог маржи, подготовку, подвал ТЗ, отметить МС.
- `update_snapshots` для `studio-settings`.
