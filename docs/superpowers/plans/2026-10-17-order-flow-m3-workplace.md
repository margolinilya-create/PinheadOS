# Веха 3: рабочее место заказа — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** заказ v4 оформляется на одном экране — рабочем месте `/sales/:id`. На нём:
- список изделий;
- вкладка «Изделие» на панелях визарда;
- вкладка «Клиент и доставка»;
- вкладка «ТЗ и цена» без PDF;
- «Копия в другом цвете»;
- список заказов.

Продавцов отмечают явно, в новой админке «Менеджеры продаж». Старый путь уходит: визард v3 на `/`, перенос, старая карточка, мастер позиции.

**Architecture:**
- Общий стор визарда `useStore` становится **буфером одной позиции**. Визард v3 уходит, делить стор больше не с кем.
- **Загрузка позиции в буфер:** при переходе к позиции она грузится в буфер (`salesItemToWizard` + поставщик палитры).
- **Обратная запись по разнице:** правки «одежды» в буфере пишутся в заказ функцией `garmentPatch(prev, next, base)`. Поле позиции меняется, только если сменился его источник: модель, ткань, цвет, размеры или обработки. Запись идёт через `useSalesStore.edit`.
- Нанесения и бирки до дизайн-мейкера (веха 5) правятся прежними строками `PrintRow` и `LabelRow`, по ключу позиции. Буфер их не трогает.
- **Сервер отказывает** в двух случаях:
  - вкладке со старой сборкой — по номеру ревизии клиента;
  - сохранению поверх чужой правки — по `expected_updated_at`.
- Продавец — новый признак `profiles.is_sales`, его ставит admin/director.

**Tech Stack:** React 19, Zustand 5 (`subscribeWithSelector`, `useShallow`), react-router 7, Supabase (миграции только на стороне Order), Vitest + Testing Library, Playwright на моке.

**Spec:** `docs/superpowers/specs/2026-10-16-unified-order-flow-design.md` — разделы «Решения ревью 16.10», «Экраны Order», таблица вех (веха 3).

## Решения владельца (17.10)
1. Вкладка «Изделие» — **панели визарда**: `SkuList`, `FabricGrid`, `ColorPicker`, `SizeTable`, `ExtrasAccordion`. Правка сразу пишется в заказ.
2. `/` ведёт на список заказов. Визард v3 как отдельный экран уходит. Экспресс остаётся.
3. Доступ к заказам v4 (за флагом `orderStudio`) имеют:
   - **продавцы** — профиль с признаком «Менеджер продаж»: создают и правят свои;
   - **`rop`** — «Заказы отдела», все заказы с фильтром «Мои / Все»;
   - **`admin` и `director`** — «Все заказы» с тем же фильтром.
   - Остальные роли, в том числе начальники цехов с профилем `manager` без признака, в разделе ТЗ сразу попадают в «Производство».
4. **Продавец — явный признак в админке.** Только отмеченные создают и правят заказы. Сервер и интерфейс считают одинаково.
5. **Один цвет = одна позиция.** Позицию с несколькими цветами нельзя править как изделие, пока её не разнесли по цветам: плашка и кнопка «Разнести по цветам».
6. **Скидку и ручную цену ставит менеджер сам.** Ниже порога маржи — предупреждение. МС в вехе 7 видит цену, пересчитанную заново.
7. **Старые черновики визарда v3** (`pinhead_draft`) из браузера удаляются.

## Решения контроллера (по проверке скиллами и безопасности)
- `client_rev` проверяется в **обеих** функциях: `order_v4_save_full` и `order_v4_save`. Это защита совместимости, а не права доступа: подделка даёт только порчу своего черновика.
- Конкурентная правка: `order_v4_save_full` принимает `expected_updated_at`. При расхождении — `P0001` «Заказ изменён в другой вкладке — обновите страницу».
- Открытие заказа ничего не пишет. Новая позиция — только по кнопке «+ Изделие». «Новый заказ» не создаёт второй черновик, пока свой пустой черновик (без позиций и клиента) уже есть: открывает его.
- Перетаскивание в `SkuList` на рабочем месте выключено (`reorderable={false}`), цена в `SizeTable` скрыта (`showPrice={false}`): цена одна — из `priceOrder`.
- Макет, общий у нескольких позиций, не удаляется из бакета, пока на него есть ссылка (`artworkInUse`).

## Global Constraints
- **ERP не меняется.** Сторожа `erpFrozen` и `erpImports` зелёные. ERP-примитивы — только из `ERP_PRIMITIVES`.
- npm-зависимости не добавляются.
- **Lint.** Сейчас 38 предупреждений при лимите 38. Новых предупреждений 0. После удалений в задаче 6 лимит `--max-warnings` снижается до фактического значения.
- **Бюджет:** оболочка ERP ≤ 195000 Б JS / 16000 Б CSS gzip, вход ≤ 155000. Рабочее место — ленивый чанк.
- **Правила кода:**
  - `useShallow` для объектных селекторов;
  - `toast.error` при ошибке Supabase;
  - optimistic update — только с откатом;
  - нет `dangerouslySetInnerHTML`.
- **CSS:** модули и токены `:root`, без `!important`. Тач-цели ≥ 44 px на `pointer: coarse`, переопределения для панелей визарда — внутри обёртки рабочего места.
- **Раскладка:** у экрана с таблицей — компактная раскладка на ступенях 760 и 480.
- **Адрес:** вкладка и позиция в адресе — `?tab=item|client|summary&item=<key>`.
- **Тексты:** русский; кнопки называют результат.
- **Миграции на бой** — сухой прогон и применение файлами в SQL Editor владельцем. Применённую миграцию не правим. Тексты функций берём с боя: `pg_get_functiondef`.
- Сторожа, читающие файлы, — `// @vitest-environment node`.

## Review Focus
1. **Быстрый переход между позициями** при несохранённой правке. Правка позиции A не попадает в B; отложенный таймер `SizeTable` после перехода ничего не пишет. Тест — задача 3.
2. **Загрузка позиции и загрузка каталогов ничего не пишут.** Модель, ткань и цвет не из каталога, а также ручной текст `main_fabric` и `color_supplier` сохраняются при правке размеров. Тест — задача 3.
3. **Заказ не в `draft`, вкладка устарела, заказ изменён в другой вкладке.** Автосохранение останавливается в конечном состоянии, потока RPC нет, текст объясняет, что делать. Тест — задача 2.
4. **Выход и вход другим пользователем в той же вкладке.** Ни заказа, ни буфера в памяти не остаётся, а отложенное сохранение не уходит. Тест — задача 2.
5. **Роль без продаж с включённым флагом.** Нет петли редиректов, человек попадает в «Производство». Тест — задача 6.

---

### Task 0: Признак «Менеджер продаж» (миграция E) и админка продавцов

**Files:**
- Create: `supabase/migrations/<ts>_sales_staff_flag.sql`
- Create: `orderstudio/admin/SalesStaff.jsx`, `orderstudio/api/salesStaff.ts`
- Modify: `OrderStudioApp.jsx` (маршрут `/sales-staff`, admin/director), `layout/orderNav.ts` (пункт «Менеджеры продаж» в «Настройки»)
- Modify: `supabase/probes/order_v4_rights.sql`. Роли проб: `SELLER`/`SELLER2` получают признак внутри транзакции; новая роль `HEAD` — начальник цеха без признака.
- Test: `orderV4Rights.test.ts` (сторож), `api/salesStaff.test.ts`, `admin/SalesStaff.test.jsx`

**Interfaces:**
- Produces (SQL):
  - `profiles.is_sales boolean not null default false`;
  - `sales_is_seller()` — новая редакция: активный и одобренный профиль с `is_sales`;
  - RPC `sales_set_staff(p_profile uuid, p_on boolean) returns void` — `security definer`, только admin/director, иначе `42501`;
  - страж на `profiles`: `is_sales` меняется только внутри этой RPC (флаг `sales.rpc` + `current_user <> 'authenticated'`, как у `order_v4_guard`);
  - `revoke … from public, anon`.
- Produces (клиент):
  - `fetchSalesStaff(): Promise<SalesStaffRow[] | null>` — профили: id, name, email, role, active, approved, is_sales;
  - `setSalesStaff(id, on): Promise<boolean>` с `toast.error`;
  - `SalesStaff.jsx` — таблица с переключателем; optimistic update с откатом.
- Перед написанием проверить живые политики `profiles` (SELECT `pg_policies`): может ли пользователь сейчас UPDATE свой профиль.

- [ ] **Step 1.** Пробы:
  - `head_insert_v4` → `42501`;
  - `seller_insert_v4` → OK;
  - `self_set_sales` (прямой UPDATE `is_sales`) → `42501`;
  - `seller_set_staff` → `42501`;
  - `admin_set_staff` → OK;
  - `pending_save` (неодобренный) → `42501`.
- [ ] **Step 2.** Тесты клиента:
  - `setSalesStaff` вызывает RPC, при ошибке — `toast.error` и `false`;
  - `SalesStaff` откатывает переключатель при отказе.
- [ ] **Step 3.** Миграция, клиент, сторож.
- [ ] **Step 4.** `npx vitest run src/orderstudio --maxWorkers=3` — PASS. Локальный PG (если есть) — пробы `fails=0`.
- [ ] **Step 5.** Коммит. Контроллер готовит `4-dryrun-E.sql` / `5-apply-E.sql`.

**Выкатка:**
- E применяется **до** мерджа вехи 3: клиент вехи 2 продавцов не проверяет, а запрет для начальников цехов нужен сразу.
- После применения владелец отмечает продавцов в админке. Админка появится только после мерджа, поэтому до него — одним SQL от владельца по списку людей.

### Task 1: Ревизия клиента и конкурентная правка (миграция D)

**Files:**
- Create: `supabase/migrations/<ts>_order_v4_client_rev.sql` — новые редакции `order_v4_save_full` и `order_v4_save`, тексты с боя.
- Create: `scratchpad/6-rollback-D.sql` — прежние тела функций.
- Modify:
  - `api/salesOrders.ts`: `salesOrderToPayload` получает `client_rev` и `expected_updated_at`; `saveSalesOrder` возвращает тип ошибки;
  - `store/useSalesStore.ts`;
  - `e2e/support/mockSupabase.ts`;
  - `supabase/probes/order_v4_rights.sql`.
- Test: `api/salesOrders.test.ts`, `api/saveSalesOrder.test.ts`, `store/useSalesStore.test.ts`, `orderV4Rights.test.ts`.

**Interfaces:**
- Produces:
  - `export const SALES_CLIENT_REV = 3`;
  - `export type SaveFailure = 'outdated' | 'conflict' | 'locked' | 'other'`;
  - `saveSalesOrder(payload): Promise<{ ok: true; saved: SaveResult } | { ok: false; kind: SaveFailure; message: string }>`. Разбор по тексту и коду:
    - `P0001` «Вышло обновление» → `outdated`;
    - `P0001` «изменён в другой вкладке» → `conflict`;
    - `42501` «правка закрыта» → `locked`;
    - иначе → `other`.
  - Стор хранит `current.updated_at` из ответа сохранения и шлёт его как `expected_updated_at`.
  - SQL: обе функции первой строкой проверяют `coalesce((p_order->>'client_rev')::int, 0) < 3` → `P0001` «Вышло обновление — обновите страницу, правка не сохранена». Обёртка для существующего заказа берёт строку `for update` и сравнивает `updated_at` с `(p_order->>'expected_updated_at')::timestamptz`, если ключ передан.

- [ ] **Step 1.** Тесты:
  - payload содержит `client_rev: 3` и `expected_updated_at`;
  - каждый из четырёх видов ошибки распознаётся;
  - сторож: обе функции содержат проверку `client_rev`.
- [ ] **Step 2.** Пробы:
  - `s_save_no_rev` → `P0001`, данные позиции с `supplier` не изменились;
  - `s_save_inner_no_rev` (прямой `order_v4_save`) → `P0001`;
  - `s_save_stale` → `P0001 изменён`;
  - `s_save_ok` → OK.
  - Обновить `total`.
- [ ] **Step 3.** Миграция, клиент. Мок e2e отвечает как сервер.
- [ ] **Step 4.** Тесты зелёные.
- [ ] **Step 5.** Коммит.

**Выкатка:**
- D применяется **после** мерджа и выкладки клиента вехи 3: клиент вехи 2 `client_rev` не шлёт. Лишний ключ старый сервер игнорирует.
- **Откат фронта на веху 2 ⇒ сначала `6-rollback-D.sql`.** Правило «откат = выключить флаг» к D не применяется.

### Task 2: Состояния сохранения, только чтение, сброс при выходе

**Files:**
- Modify: `store/useSalesStore.ts`, `leaveGuard.ts`.
- Create: `model/editable.ts`.
- Test: `store/useSalesStore.test.ts`, `model/editable.test.ts`, `leaveGuard.test.ts`.

**Interfaces:**
- Consumes: `SaveFailure` (задача 1).
- Produces:
  - `isEditable(order): boolean` — только `draft`.
  - `SaveState` = `'clean' | 'dirty' | 'saving' | 'error' | 'locked' | 'outdated' | 'conflict'`. Последние три — конечные: `edit` — no-op, таймер не ставится, повторов нет.
  - `open(id, { force?: boolean })` — `force` обходит короткий путь «тот же id».
  - На `locked` — один `open(id, { force: true })`.
  - На `outdated` — `useAppUpdateStore.getState().markAvailable()`.
  - Открытие заказа не в `draft` сразу ставит `locked`.
  - `registerAppReset` для `useSalesStore`: сброс таймера и `inFlight`, `session += 1`, `current = null`, `list = []`.
  - `registerAppReset` для буфера `useStore`: `resetItemFields()`.
  - `salesHasUnsaved` — истина для `dirty`, `saving`, `error`, `outdated`, `conflict`.

- [ ] **Step 1.** Тесты:
  - `edit` на `ready_to_launch` не меняет `current` и не зовёт RPC;
  - `locked` даёт ровно один `fetchSalesOrder`;
  - `outdated` даёт `markAvailable` и останавливает дальнейшие сохранения;
  - `conflict` — повторов нет;
  - после `runAppResets()`: `current === null`, `list` пуст, `open(sameId)` идёт в сеть, отложенный save не вызывается;
  - `isEditable` по каждому статусу.
- [ ] **Step 2.** Убедиться, что тесты красные.
- [ ] **Step 3.** Реализация.
- [ ] **Step 4.** Тесты зелёные.
- [ ] **Step 5.** Коммит.

### Task 3: Буфер позиции

**Files:**
- Modify: `wizard/wizardAdapter.ts` (`garmentPatch`), `components/steps/garment/FabricGrid.jsx` (вынести `colorSupplierOf`).
- Create: `utils/colorSupplier.ts`, `orderstudio/workplace/itemBuffer.ts`.
- Test: `wizard/wizardAdapter.test.ts`, `workplace/itemBuffer.test.ts`, `utils/colorSupplier.test.ts`.

**Interfaces:**
- Produces:
  - `export type GarmentSnap = { sku, fabric, color, colorSupplier, sizes, customSizes, extras, fit, clientFabric }` — выборка из `useStore`.
  - `export function garmentPatch(prev: GarmentSnap, next: GarmentSnap, base: SalesItem, cat: WizardCatalogs): SalesItem | null`. Возвращает `null`, если по разнице менять нечего. Правила:
    - сменилась модель → `sku_code`, `product_type`, `fit`;
    - сменилась ткань → `fabric_code`, `main_fabric`, `color_supplier`; при `client_fabric` эти поля не пишутся;
    - сменился цвет → подпись единственной строки и `color_supplier`;
    - сменились размеры → `sizes` строки;
    - сменились обработки → `extras`.
    - Пустое значение буфера при непустом значении позиции не перезаписывает его: модель или цвет не из каталога сохраняются.
    - `prints` и `labels` — из `base` по ссылке.
  - `export function loadItemIntoBuffer(item, cat): void`:
    - `resetItemFields()`;
    - `selectSku(sku)`, если модель есть в каталоге;
    - наложить `salesItemToWizard`;
    - `colorSupplier = colorSupplierOf(fabric)`;
    - `skuFilter` не сбрасывать.
  - `export function bindBuffer(getBase: () => SalesItem | undefined, cat, onItem: (next: SalesItem) => void): () => void`:
    - `useStore.subscribe(selectGarment, listener, { equalityFn: shallow })`, без пропуска первого срабатывания;
    - запись только через `garmentPatch(prev, next, getBase())`, если результат не `null`;
    - если позиция пропала, ничего не пишет.
  - Позиция с несколькими строками сетки в буфер не грузится. Экран показывает плашку (задача 5).

- [ ] **Step 1.** Тесты `garmentPatch`:
  - правка только размеров не меняет `main_fabric`, `product_type`, `color_supplier` с ручным текстом;
  - цвет свободным текстом сохраняется при правке размеров;
  - модель не из каталога сохраняется;
  - смена ткани переписывает `main_fabric`;
  - `client_fabric` — ткань не пишется;
  - нанесения тождественны по ссылке;
  - нет разницы → `null`.
- [ ] **Step 2.** Тесты буфера:
  - `load` + `bind` + загрузка каталогов (`set({ skuCatalog })`) → `onItem` не вызван;
  - смена цвета → один вызов;
  - отписка, загрузка B, правка → A не меняется;
  - правка `zones` → не вызван;
  - `colorSupplier` выставлен по ткани Коттонпром.
- [ ] **Step 3.** Убедиться, что тесты красные.
- [ ] **Step 4.** Реализация.
- [ ] **Step 5.** Тесты зелёные.
- [ ] **Step 6.** Коммит.

### Task 4: Операции с позициями и список изделий

**Files:**
- Create: `model/itemOps.ts`, `workplace/ItemList.jsx`, `workplace/Workplace.module.css`, `workplace/ColorCopyDialog.jsx`.
- Test: `model/itemOps.test.ts`, `workplace/ItemList.test.jsx`.

**Interfaces:**
- Produces:
  - `duplicateInColor(item, color: string): SalesItem` — новые ключи позиции, нанесений и бирок (uuid); одна строка сетки этого цвета, размеры те же, штук 0; `tz_pdf_path = ''`, `manual_unit_price = null`; `artwork_path` нанесений копируется.
  - `splitByColor(item): SalesItem[]` — одна позиция на строку; первая сохраняет `key`; нанесения и бирки копируются с новыми ключами; сумма штук та же.
  - `artworkInUse(order, path, exceptPrintKey): boolean`.
  - `itemTitle(item)`:
    - «Худи · Чёрный · 45 шт»;
    - без цвета — «Худи · цвет не выбран»;
    - без модели — «Новое изделие».
  - `<ItemList order selectedKey onSelect onAdd onCopyColor onRemove onSplit readOnly />`:
    - `role="list"`, у выбранной позиции `aria-current="true"`;
    - у кнопок `aria-label` с названием позиции;
    - после удаления или разнесения фокус переходит на соседнюю позицию.
  - Тексты:
    - меню: «Копия в другом цвете…»;
    - окно копии: «Цвет новой позиции», кнопка «Создать позицию»;
    - подтверждение разнесения: «Позиция станет N позициями: <цвета>. Нанесения скопируются в каждую», кнопка «Разнести на N позиций»;
    - подтверждение удаления: «Удалить «<название>»? Нанесения и бирки удалятся вместе с ней», кнопка «Удалить позицию».
- Удаление нанесения и замена макета не зовут `removeArtwork`, пока `artworkInUse` истинно. Это правило для вехи 5; здесь — функция и тест.

- [ ] **Step 1.** Тесты:
  - ключи — валидные uuid, уникальны по всему заказу после копии и разнесения;
  - сумма штук сохраняется;
  - `artworkInUse`;
  - `ItemList`: кнопки и тексты, `readOnly`, `aria-current`, фокус после удаления;
  - XSS: название `<img src=x onerror=…>` выводится текстом.
- [ ] **Step 2.** Убедиться, что тесты красные.
- [ ] **Step 3.** Реализация.
- [ ] **Step 4.** Тесты зелёные.
- [ ] **Step 5.** Коммит.

### Task 5: Рабочее место `/sales/:id`

**Files:**
- Create:
  - `workplace/OrderWorkplace.jsx` — экран, вкладки, адрес, `useOrderPrice(order)`, `flush` при размонтировании;
  - `workplace/ItemTab.jsx`;
  - `workplace/GarmentPanel.jsx`;
  - `workplace/ClientTab.jsx`;
  - `workplace/SummaryTab.jsx`;
  - `workplace/SaveIndicator.jsx`.
- Modify:
  - пять панелей визарда — проп `readOnly`; у `SkuList` — `reorderable`, у `SizeTable` — `showPrice`; у кнопок «−» и «+» — `aria-label="Уменьшить M"`;
  - `OrderStudioApp.jsx` — маршрут `/sales/:id` → ленивый `OrderWorkplace`.
- Test: `workplace/OrderWorkplace.test.jsx`.

**Interfaces:**
- Consumes: задачи 2, 3 и 4.
- **Вкладки:** `role="tablist"`, у вкладок `role="tab"` с `aria-selected` и `aria-controls`, панели `role="tabpanel"`. Roving `tabindex`, стрелки, Home и End; фокус не теряется при смене `?tab`. На вкладках маркер готовности: «Изделие ✓», «Клиент — не заполнено». Внизу «Изделия» — кнопка «Далее: клиент и доставка».
- **`ItemTab`:**
  - `GarmentPanel` (флажок «Ткань клиента (в цену не входит)»; при нём `FabricGrid` скрыта);
  - нанесения `PrintRow`, бирки `LabelRow`;
  - `<details>` «Доп. поля ТЗ» и «Упаковка позиции»;
  - цена позиции и ручная цена.
  - Все правки — по `item.key`.
  - Позиция с несколькими строками сетки: вместо `GarmentPanel` плашка «В позиции N цветов — разнесите по цветам, чтобы править изделие» и кнопка.
  - При смене позиции — `loadItemIntoBuffer`, затем `bindBuffer`; отписка в cleanup.
- **`ClientTab`:** шапка, доставка и упаковка заказа, срочность, скидка. `manager_name` только для чтения — имя из профиля автора.
- **`SummaryTab`:** таблица позиций (название, штук, цена за шт, сумма), пометки `issues` ссылкой на позицию, `PricePanel`, скидка, предупреждение «Маржа ниже порога».
- **`SaveIndicator`** (`role="status"`):
  - «Сохранено»;
  - «Сохраняю…»;
  - «Не сохранено — повторим при следующей правке»;
  - «Вышло обновление — обновите страницу, последняя правка не сохранена» + кнопка «Обновить страницу»;
  - «Заказ изменён в другой вкладке — обновите страницу»;
  - только чтение по статусу: «Отправлен в работу — правка закрыта», «В производстве — только просмотр», «Готов — только просмотр», «В архиве — только просмотр».
- **Ширина ≤ 760:** список позиций — выпадающий список и рядом меню «Действия с изделием» и «+ Изделие». На 480 вкладки прокручиваются.
- **Пустой заказ:** состояние `EmptyState` с кнопкой «Добавить изделие». Открытие заказа ничего не пишет.
- **Переопределения панелей визарда под `pointer: coarse`** (тач-цели ≥ 44) — в `Workplace.module.css`, внутри обёртки.

- [ ] **Step 1.** Тесты (стор и каталоги замоканы):
  - выбор цвета пишет в сетку выбранной позиции;
  - позиция B не трогает A;
  - `?tab=client` открывает клиента, клавиши стрелок переключают;
  - правка на «Изделии» сохраняется с `price_total ≠ null`;
  - `SummaryTab` — итог и пометка «нужна ручная цена»;
  - `locked` — панели `readOnly`, `aria-disabled` у образцов, текст по статусу;
  - открытие любого заказа не зовёт RPC сохранения;
  - многоцветная позиция — плашка вместо панели;
  - в рабочем месте нет записи в `app_config`;
  - нет `useStore()` без селектора.
- [ ] **Step 2.** Убедиться, что тесты красные.
- [ ] **Step 3.** Реализация.
- [ ] **Step 4.** Тесты зелёные; lint — новых предупреждений 0; `build` + `bundle:budget`.
- [ ] **Step 5.** Коммит.

### Task 6: Список заказов, навигация, доступ и уборка старого пути

Задача идёт **до задачи 5 в порядке выкатки коммитов** (промежуточные коммиты не выкатываются). Буфер не должен затирать визард v3 и `pinhead_draft`.

**Files:**
- Modify:
  - `OrderStudioApp.jsx`:
    - `/` → `/sales`;
    - роль без продаж (не `canUseSales`) → переключение раздела на «Производство»; так же для `RoleGuard`;
    - убрать `WizardPage`, восстановление `pinhead_draft`, `shouldBlockLeave`;
    - разовое `storageRemove('pinhead_draft')` при старте раздела.
  - `layout/orderNav.ts`, `layout/OrderLayout.jsx` (без `useDraft`), `screens/SalesList.jsx`, `leaveGuard.ts`.
  - `lib/storage.ts`: `'pinhead_draft'` остаётся в `APP_KEYS` с пометкой «наследие».
  - `pricing/wizardParity.test.ts`: сверка через `salesItemToWizard`/`garmentPatch` вместо `wizardOrderToSales`.
  - e2e: `dark-mode.spec.ts`, `navigation.spec.ts`, `routes-smoke.spec.ts`, `order-shell.spec.ts` («Новый заказ» — кнопка), `order-launch.spec.ts`, `order-artworks.spec.ts` (проверить после редиректа).
- Delete (перед каждым — `grep` импортов):
  - `screens/SalesCard.jsx`, `ItemEditor.jsx`, `ItemWizard.jsx`, `GridEditor.jsx`;
  - `wizard/itemSession.ts`, `transferToSales.ts`, `wizardOrderToSales.ts`;
  - `hooks/useDraft.js`;
  - `StepGarment`, `StepDesign`, `StepItems`, `StepDetails`, `StepSummary`, `layout/ProgressBar`, а также `LabelConfigurator`, `ZoneTechBlock`, `ZoneMockup` и прочее, что станет недостижимым;
  - тесты удаляемого; e2e `wizard-flow.spec.ts`.
  - Сценарий обработок из `wizard-extras.spec.ts` переносится в задачу 7.
  - Слайсы `useStore` не удаляются (бэклог: сузить до буфера и каталогов после вехи 5).
- Test:
  - `layout/orderNav.test.ts`;
  - `screens/SalesList.test.jsx`;
  - `OrderStudioApp.test.jsx` (роли);
  - сторож `orderstudio/deadCode.test.ts` (node): никто не импортирует удалённые модули.

**Interfaces:**
- Produces:
  - `canUseSales(profile): boolean` — `is_sales` либо роль `admin`/`director`/`rop`. Зеркало `sales_is_seller() or sales_is_lead()`, тест-зеркало перечисляет случаи.
  - `navFor(profile)`:
    - продавец — «Новый заказ», «Мои заказы», «Экспресс»;
    - `rop` — «Новый заказ», «Заказы отдела», «Экспресс»;
    - admin/director — «Новый заказ», «Все заказы», «Экспресс», «Каталог», «Менеджеры продаж», «Админка».
  - «Новый заказ» (кнопка) открывает свой пустой черновик, если он есть, иначе `createNew()`; затем `/sales/:id?tab=item`.
  - `SalesList`:
    - колонки: номер, клиент, название, менеджер (у руководства), статус, сумма, срок, обновлён;
    - поиск по клиенту и номеру, фильтр статуса, фильтр «Мои / Все» у руководства;
    - `EmptyState`, компактная раскладка.

- [ ] **Step 1.** Тесты:
  - `navFor` и `canUseSales` по ролям и признаку;
  - `production`/`designer` с флагом → переключение на «Производство», петли нет;
  - `/` → `/sales`;
  - «Новый заказ» при пустом своём черновике его открывает;
  - фильтры `SalesList`;
  - `pinhead_draft` удалён при старте;
  - сторож мёртвого кода.
- [ ] **Step 2.** Убедиться, что тесты красные.
- [ ] **Step 3.** Реализация и удаление.
- [ ] **Step 4.** Полный vitest `--maxWorkers=3`, lint (лимит снизить до факта), typecheck, build, `bundle:budget`; e2e из списка.
- [ ] **Step 5.** Коммит.

### Task 7: e2e рабочего места, axe, эталон

**Files:**
- Create: `e2e/order-workplace.spec.ts`.
- Modify: `e2e/support/mockSupabase.ts` (сохранённый payload отдаётся при следующем чтении), `e2e/visual.spec.ts` (`studio-workplace`), axe-проверка по образцу `erp-axe.spec.ts`.

- [ ] **Step 1. Спека, основной сценарий:**
  - «Новый заказ» → модель → ткань → цвет → размеры 10+5 → обработка;
  - «Копия в другом цвете»;
  - клиент на вкладке «Клиент и доставка»;
  - «ТЗ и цена» — итог > 0;
  - последний `order_v4_save_full` содержит две позиции, `client_rev: 3`, клиента и `price_total`;
  - перезагрузка открывает то же.
- [ ] **Step 2. Спека, особые случаи:**
  - заказ `ready_to_launch` из фикстуры — только просмотр, сохранений нет;
  - ответ «Вышло обновление» → плашка и кнопка «Обновить страницу»;
  - многоцветная позиция → «Разнести по цветам».
- [ ] **Step 3. Мутации:**
  - убрать `bindBuffer` → красный;
  - убрать отписку в cleanup → красный.
- [ ] **Step 4.** axe на рабочем месте — без нарушений `serious`/`critical`.
- [ ] **Step 5.** Снимок прокручиваемого контейнера `.orderMain`: `studio-workplace` (desktop/mobile). Эталоны — `update_snapshots` владельцем.
- [ ] **Step 6.** Коммит.

### Task 8: Документы, ревью, выкатка
- **Документы:**
  - `CLAUDE.md` — роутинг Order, структура `orderstudio/workplace`, схема `profiles.is_sales`, правило буфера и ревизии клиента;
  - `pinhead-react/CLAUDE.md`;
  - новое правило `docs/rules/`: «повышение `SALES_CLIENT_REV` — всегда пара клиент + миграция, миграция после выкладки; откат фронта — сначала откат миграции»;
  - changelog, SESSION-STATE (бэклог: сузить `useStore`, рестайл панелей визарда в вехе 8, закрыть запись v3, `order_comments` и `app_config` SELECT), PROJECT.
- **Выкатка:**
  1. Финальное ревью ветки.
  2. E: сухой прогон и применение до мерджа; владелец отмечает продавцов.
  3. PR → CI зелёный, эталоны → мердж.
  4. Выкладка фронта.
  5. D: сухой прогон, затем применение.
  6. `APPLIED.json`.
  7. Пробы на бою под продавцом и `rop`.
  8. Дымовой прогон бакета вехи 2 под продавцом: загрузить файл, получить ссылку, удалить.

## Нужно от владельца
- Сухие прогоны и применение E (до мерджа) и D (после выкладки) в SQL Editor.
- Список менеджеров продаж — отметить в админке (или SQL до мерджа).
- `update_snapshots` для `studio-workplace`.
