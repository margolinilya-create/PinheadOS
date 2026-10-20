# Правила включения раздела, рестайла и хвостов (веха 8, 18.10)

План — `docs/superpowers/plans/2026-10-18-order-flow-m8-polish-enable.md` (решения К1–К13, 20 пунктов
«Решено контроллером за владельца», «Проверка безопасности», «Проверка скиллами»). Заметки контроллера —
`.superpowers/sdd/2026-10-18-order-flow-m8/controller-notes.md`. Миграции **L** `20261018150000`, **K**
`20261018160000`, **M** `20261018170000` — файлы выкатки `supabase/rollout/m8/` (README), порядок выкатки и
чек-лист включения — `supabase/rollout/m8/CHECKLIST.md`. Правила вех 2–6+7 действуют; здесь — что добавила 8.
ERP не менялся (сторожа `erpFrozen`, `erpImports`), npm не добавлялся.

Людям раздел называется **«Оформление заказа»**. «ТЗ» и «Order Studio» — только внутренние имена в коде и планах.

---

## Решения К1–К13 коротко

- **К1. Выбор оболочки — по профилю и адресу, один раз за загрузку.** Чистая `chooseShell({ search, path,
  stored, env, profile })` (`src/config/shellChoice.ts`), единственный вызывающий — `ShellGate` в `App.jsx`
  с `useState(() => chooseShell(…))` и `key={user.id}`. Правила по порядку: выключатель (`env` `'0'`/`'false'`,
  `?studio=1` его не обходит) → `?studio=1|0` на заход → путь только раздела + `canUseSales` → выбор
  устройства (`pinhead_feature_orderStudio`; продавцу/МС/rop записанный `'0'` не мешает — осознанное отступление
  от текста К1: `'0'` пишут только `LeaveToProduction` и кнопка admin/director, а в «Производстве» у продавца
  кнопки обратно нет, и чужой `'0'` запер бы его там) → умолчание профиля
  (`canUseSales` и роль не admin/director) → env `'1'`/`'true'` (dev, e2e) → ERP. Пересчёт на ходу
  размонтировал бы раздел посреди работы (автосохранение, буфер позиции, `locked`/`conflict`) — запрещён.
  `canUseSales` во входе — из `orderstudio/layout/salesAccess.ts` без рантайм-импортов (импорт из `orderNav`
  переносил всё меню во вход и ронял потолок оболочки ERP — замер T5); `orderNav.ts` его реэкспортирует.
  Кнопка «Производство» в шапке — всем с доступом; у продавца/МС/rop уводит `/?studio=0` без записи.
  Каждый `FeatureName` классифицирован в `lib/storage.ts`: `pinhead_feature_orderStudio` — `APP_KEYS`
  (выход стирает выбор), `pinhead_feature_styleguide` — `KEEP_ON_LOGOUT`. Маркер сборки = SHA + значение
  `VITE_FEATURE_ORDER_STUDIO` (`scripts/build-id.mjs`): смена флага с redeploy даёт «Вышло обновление».
  Отвергнуто: глобальная переменная `=1`, правка кнопки в `ErpLayout.jsx` (Task 13 — только по «да»
  владельца), серверный флаг в `profiles`.
- **К2. `/sku` на ≤ 760 px — только просмотр** (`role="note"` «На телефоне каталог только для просмотра.
  Править — с компьютера.»; «Выгрузить в Excel» остаётся, загрузка и сохранение скрыты; поля — `fieldset
  disabled` ВНУТРИ прокручиваемой области, иначе область недостижима с клавиатуры).
- **К3. Рестайл на месте.** `SkuEditor` и `ExpressCalc` остались в `components/editors/**`; сторож импортов ERP
  покрывает `orderstudio`, `components/editors`, `components/steps/garment` (пути от `src`, цель — `path.resolve`).
- **К4. Глобальные CSS → модули.** `editors.css`, `express.css`, `garment.css`, `PageHeader.jsx` удалены;
  `AdminPanel` («Заказы ТЗ») — на примитивах ERP, без глобальных CSS, без `PageHead` (h1 даёт `AdminScreen`).
  Остаются `forms-buttons.css`, `wizard.css`, `extras-zones.css`, `kanban.css`, `responsive.css`, пока у них есть
  потребители (мёртвые правила в них — бэклог; `deadCss.test.ts` сторожит только удалённые три).
- **К5. `zone_id` у нанесения и `orders.notes` — пара «клиент + миграция K», ревизия 4.** CHECK `zone_id` —
  ровно `ZONE_ID_RE.source`; `22023` с понятным текстом в RPC до записи. Цена кармана DTG и строка матрицы ТЗ
  — по `zone_id` (`tzRowOfZone`), без кода — по имени. Клиент пишет `notes`/`zone_id`, ТОЛЬКО когда сервер их
  знает (`api/serverZoneNotes.ts`: ответ сохранения несёт `notes`, у нанесений есть колонка, проба
  `select('zone_id').limit(0)` без строк) — окно «фронт ревизии 4 → K» не теряет ввод молча.
  **Отступление T2 (принято):** K не пересоздаёт `order_v4_save` (в теле `delete`, MCP его не применит) —
  порог 4 держит только `order_v4_save_full`, внутренняя остаётся с порогом 3; прямой вызов внутренней в
  обход обёртки может стереть `zone_id` своего черновика (порча своих данных, не права; проба `zn_inner_*`).
  `order_v4_child_guard` колонок не перечисляет — `zone_id` покрыт без правки.
- **К6. L: v3 только чтение, `order_comments` закрыта, журнал признаков.** Отказ v3 — стражем, а не политикой,
  после веток служебного доступа и FK «родитель удалён»/«заказ ERP удалён», только клиенту. `notes` —
  поле черновика в `order_v4_guard` и CHECK `orders_notes_len` ≤ 2000 — в L (PATCH продавцом-автором в обход
  RPC → `23514`). `order_comments` — `revoke all` + политики `false`, без `drop`. `sales_staff_events` пишет
  AFTER UPDATE-триггер на `profiles` (видны и служебные смены: `actor` null, `source='service'`).
  `translateSupabaseError` для отказа v3 не заведён (строка легла бы во вход, а читателя нет — новый фронт v3
  не пишет).
- **К7. Старые ключи `catalog_config`** (`prices`, `labels`, `extras`, `fabrics`) удаляет M — файл владельца
  после снимка `supabase/snapshots/catalog_config_legacy_2026-10-18.json` (md5 каждой строки сверяется).
  `lib/catalogs.ts` до M читает их общим запросом, но пропускает (`LEGACY_CATALOG_CONFIG_KEYS`, сторож —
  `lib/catalogs.test.ts`): старый `prices` руководства не подменит `app_config.prices`, если тот не пришёл.
- **К8. Уборка файлов заказа — отдельная функция `order-files-gc`, режим отчёта.** `storage-gc` и её сторож
  в замороженном ERP не трогаются. Ворота — `is_admin()` вызывающего; удаление — только `apply: true` **и**
  секрет `ORDER_FILES_GC_DELETE` = `'1'` (решение владельца). Носители — колонки `*_path(s)` таблиц заказа
  (`orders.sticker_preview_path`, `order_items.tz_pdf_path`, `order_item_prints.artwork_path` (+ `.preview.png`),
  `order_item_labels.attach_image_path`/`preview_paths[]`, `order_notes_cards.image_path`) + текстовый носитель
  (ключ в JSON любой строки заказа: `orders`, `order_items`, `order_item_prints`, `order_item_labels`,
  `order_notes_cards`, `order_events`); постранично (1000) со сверкой `count`; заказ не `draft`, заказа нет,
  путь непонятной формы, моложе 7 суток — придержаны; ошибка любой выборки — ничего. `garment-flats` —
  кандидат только `flats/<id>/v<n>/…` с `n` выше текущей версии и истории и не из `order_item_prints.layout`.
  Еженедельный workflow — только отчёт, в summary только числа; путей в артефактах нет (репозиторий
  публичный). Носители выводит сторож `orderFilesGc.test.ts` из миграций.
- **К9. Бирок в экспрессе нет и не добавляем**; мёртвая ветка бирок визарда v3 (`getLabelConfigPrice`)
  удалена; цена бирки v4 — `salesLabelPrice` по библиотеке.
- **К10. `allowedColors` прежней формы** (`string[]` кодов); `allowedFor(rules, palette)` — пересечение с
  палитрой поставщика ткани, пустое пересечение → вся палитра. Карточка модели строит образцы по палитрам
  поставщиков тканей модели (`skuDetail/modelPalette.ts`).
- **К11. Бюджеты не поднимаются.** «Оболочка Order» — потолок T0 + 2 %, «Справочник моделей» и «Экспресс» —
  T0 + 5 %; новый импорт примитива ERP в ленивый экран без `ErpStates` режет общий чанк и роняет оболочку ERP —
  держать `EmptyResult` в графе (как `SkuItemsTab`) или снимок CSS в модуль (как `ExpressCalc`).
  Строгая база входа и оболочки ERP (`scripts/bundle-baseline.json`, `strict`) перезаписана ОДИН раз, решением
  вслух на финальном ревью: вход +1 245 Б без сжатия (gzip +482) — цена выбора оболочки К1 (`shellChoice`,
  `salesAccess`, `ShellGate`, ключи флагов) и подписи формы входа; вынос из входа добавил бы круг сети до первой
  отрисовки. Разбор по байтам — `orderstudio/design/README.md`, «Замеры 8». Потолки не поднимались.
- **К12. Обход — по ролям на моке.** Профиль — `localStorage['pinhead_dev_profile']`
  (`seller|ms|rop|designer|admin`), читается только при `import.meta.env.DEV && DEV_AUTOLOGIN` и без настоящей
  сессии; `store/devProfiles.ts` — только динамическим импортом из `devAutologin.ts` (сторожа исходников и сборки).
  Смены `e2e/walk/*.spec.ts` (`@walk`) утверждают следующее действие роли, снимки — дополнительно.
  Шкала: Critical — потеря данных, неверная цена, неверные права, тупик без выхода; High — тупик с обходом
  через адрес/F5, кнопка не то, обрезка действия на 375 px; Medium — текст, жаргон; Low — косметика.
- **К13. Эталоны — на фикстурах «из базы»**; пересъёмка CI только `studio-` (`snapshots_grep`), шаг-сторож
  падает, если тронут не-`studio-` эталон.
  Дополнение 19.10 (решение владельца, PR #211): осознанная пересъёмка эталонов вне `studio-` — только
  `workflow_dispatch` с флажком `allow_erp_snapshots=true` и `snapshots_grep` нужного префикса (например,
  `erp-`); сторож тогда пропускает ровно этот префикс, всё прочее вне `studio-` по-прежнему валит шаг
  (`ciVisualGuard.test.ts`).

## Включение и выключатель

- **Слияние кода ничего не включает**: продавцов и МС на бою 0, admin/director по умолчанию в Производстве.
- **Включение людям = отметка `is_sales`/`is_ms` в `/sales-staff` по списку, утверждённому владельцем**, и
  только после зелёного (или жёлтого) чек-листа «Готовность» (`supabase/rollout/m8/CHECKLIST.md`). Контроллер
  никого не отмечает. Хоть один красный пункт — не включать, отчитаться.
- **Выключатель** — `VITE_FEATURE_ORDER_STUDIO=0` (или `false`) в Production Vercel + redeploy: гасит только
  интерфейс у всех, `?studio=1` его не обходит. **Права на сервере выключатель не снимает** — серверный откат =
  снять отметки. По человеку — снять его отметку.

## Рабочее место и экраны

- Маркеры вкладок — `workplace/TabMarker.jsx` + `tabState.ts`: текст «— готово / — не заполнено / — не размещено:
  N» всегда в имени вкладки; на ≤ 480 px — точка/бейдж `aria-hidden` и `.srOnly`. Активная вкладка
  прокручивается в видимость только по горизонтали.
- Текст для читалки — `.srOnly` модуля (общий `orderstudio/ui/a11y.module.css`); `visually-hidden`/`sr-only`
  строкой — запрещены (`a11yGuards.test.ts`). Локальные копии `.srOnly` в 8 модулях — бэклог.
- Подложка нового нанесения (шелкография, DTG) — по цвету изделия (`model/garmentTextile.ts`: яркость ≥ 0,7 —
  «белое», иначе «цветное»); при смене цвета и в копиях меняется только подложка прежнего умолчания.
- Цена за штуку — вверх до 5 ₽ и порог шелкографии «от 50 шт» — одни для экспресса и рабочего места
  (`utils/quoteRules.ts`).
- У нового заказа `created_by = uid` сразу (как ставит сервер) — автор видит оплату и «Отправить в работу» без F5.

## Сторожа вехи 8

`config/shellChoice.test.ts`, `App.test.jsx` (оболочка), `storage.test.js` (классификация флагов),
`orderstudio/orderV4M8.test.ts` (L/K/M, md5-цепочка, лексика файлов контроллера), `orderV4Rights.test.ts`
(классификация `notes`, порог обёртки), `mockContract.test.ts` (тексты и порог K), `orderFilesGc.test.ts` +
`scripts/lib/orderFileHolders.test.mjs`, `store/ordersReadOnly.test.ts`, `store/devProfilesGuard.test.ts`,
`ui/a11yGuards.test.ts`, `skuGuards`, `expressGuards`, `garmentCss`, `deadCss`, `deadCode` (удалённые модули
вехи 8 и их упоминания в `CLAUDE.md`), `bundleBudgetM8`, `ciVisualGuard`, `e2e/order-axe.spec.ts` (axe и
тач-цели на 375/760/768/1280 в обеих темах), `e2e/killswitch.spec.ts` (сборка с флагом `0`).
