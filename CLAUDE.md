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
- **Графики:** Chart.js + react-chartjs-2. Recharts здесь числился ошибочно:
  его нет ни в `package.json`, ни в `node_modules`, ни в одном импорте — при
  этом два теста продолжали его мокать, а `vi.mock` несуществующего модуля
  это тихий no-op. Остаток миграции на chart.js, снят вместе с моками
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
│   ├── layout/              # Header, ProgressBar
│   ├── steps/               # Wizard: StepGarment → StepDesign → StepItems → StepDetails → StepSummary
│   │   └── garment/         # SkuList, FabricGrid, ColorPicker, SizeTable, ExtrasAccordion
│   ├── orders/              # KanbanBoard, KanbanCard, OrderDrawer
│   ├── editors/             # SkuEditor (8 табов), ExpressCalc
│   │   └── sku/             # SkuItemsTab, SkuFabricsTab, SkuTrimsTab, ExtrasEditor, SkuHardwareTab, PricingTabContent, CategoryRulesTab, ZonesCatalogTab, AddSkuModal, ZonesModal, SkuDetailModal
│   ├── output/              # PrintPreview (PDF)
│   ├── analytics/           # Dashboard
│   └── shared/              # ErrorBoundary, Toast, PageHeader, PriceBreakdown, RolePreviewBar, Skeleton, OnboardingTips, CommandPalette
├── store/                   # Все файлы — TypeScript (.ts)
│   ├── useStore.ts          # Главный Zustand store (собирает слайсы)
│   ├── slices/              # wizardSlice, productSlice, designSlice, itemsSlice, detailsSlice, catalogSlice, orderSlice — все .ts
│   ├── useAuthStore.ts      # Auth + роли
│   ├── useOrdersStore.ts    # CRUD заказов, Kanban
│   ├── useCommentsStore.ts  # Комментарии к заказам
│   ├── useToastStore.ts     # Уведомления
│   └── useConfirmStore.ts   # Imperative confirm dialog
├── hooks/
│   ├── useDraft.js          # Авто-сохранение черновика
│   ├── useFocusTrap.js      # Focus trap для модалок
│   └── useEffectiveRules.ts # Resolved category rules для визарда
├── lib/
│   ├── supabase.ts          # Supabase client
│   ├── api.ts               # API-функции (orders, comments, templates)
│   ├── storage.ts           # localStorage/sessionStorage обёртки + storageClearAll + Supabase Storage (sku-photos)
│   └── catalogs.ts          # Загрузка каталогов из Supabase (catalog_config + app_config)
├── data/                    # Статические данные: цвета, ткани, цены, SKU, extras
├── types/                   # TypeScript типы: order, catalog, auth, pricing
├── utils/
│   ├── pricing.ts           # Расчёт цен (покрыт 88 тестами), TECH_TABS, priceMultiplier
│   ├── skuRules.ts          # CategoryRules резолюция, getEffectiveRules, динамические зоны (29 тестов)
│   ├── validate.ts          # Валидация заказа
│   ├── mockup.ts            # SVG-мокап генерация
│   ├── deadline.ts          # Расчёт дедлайнов
│   └── i18n.ts              # Pluralize, translateSupabaseError
└── styles/                  # CSS: auth, kanban, wizard, forms, layout, garment, editors, extras-zones
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
| `/purchasing`, `/warehouse`, `/subcontracting`, `/experimental` | Закупка, Склад, Подряд, Эксперим. цех | admin, director |
| `/admin` | AdminScreen (пользователи, права, цеха, мощность, справочники, аварийный режим, заказы ТЗ) | admin, director |

### ✏️ ТЗ (Order Studio) — за флагом `orderStudio`

| Путь | Компонент | Доступ |
|---|---|---|
| `/` | WizardPage (5 шагов) | Все |
| `/orders` | KanbanBoard | Все |
| `/print` | PrintPreview | Все |
| `/express` | ExpressCalc | Не production/designer |
| `/prices` | → redirect `/sku?tab=pricing` | admin, director |
| `/sku` | SkuEditor (8 табов) | admin, director |
| `/admin` | AdminPanel | admin, director |
| `/analytics` | Dashboard | admin, director, rop, production |

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
- Lazy loading: KanbanBoard, ExpressCalc, AdminPanel, Dashboard, StepDesign, StepItems, StepDetails, StepSummary
- Ошибки: toast уведомления через useToastStore
- Коммиты: на русском или английском, формат conventional commits

## Supabase — схема

| Таблица | Назначение |
|---------|-----------|
| `orders` | id, order_number (PH-XXXX), status, data JSONB, bitrix_deal |
| `profiles` | id, name, email, role, approved, active |
| `order_comments` | Комментарии к заказам |
| `order_audit` | Лог изменений статусов |
| `app_config` | SKU (sku_catalog), цены (prices), обработки (extrasCatalog), фурнитура (hardwareCatalog), правила (categoryRules), зоны (zonesCatalog) |
| `catalog_config` | Ткани (fabricsCatalog), отделка (trimCatalog) |

**ERP (префикс `erp_*`, проект pinhead-os-v2)** — полная схема в
`pinhead-react/src/erp/types.ts` (зеркало таблиц) и в `supabase/migrations/`.
Ядро: `erp_departments` · `erp_orders` (+ `customer`) · `erp_order_items`
(+ техблок изделия: `fit`, `trim_material`, `cutting_note`, `sewing_note`,
`labels_note`, и упаковка позиции `packaging`/`packaging_note`, где `inherit` —
«как в заказе») · `erp_item_stages` (граф `depends_on`, `queue_position` —
приоритет в очереди цеха, `assignee` — исполнитель, `executor`/`contractor`/
`operation` — наш цех или подрядчик) · `erp_materials` (+ разделение полей
менеджера и закупщика: `manager_note`, `qty_ordered`, `ordered_on`). Сопровождение: `erp_item_prints`,
`erp_stage_events` (история этапов), `erp_order_audit`/`_comments`/`_attachments` (у вложений есть `item_id` и вид
`preview|attachment|packaging|tech|purchase`),
`erp_procurement_tasks`, `erp_subcontracting` (карточка подрядчика ПРИ этапе:
`stage_id`, фаза `planned…ready_at_contractor…closed`, материалы
`pinhead|contractor|mixed`, журнал `erp_subcontract_moves`), `erp_warehouse_ops`/`_tasks`,
`erp_experimental`(+`_ops`), `erp_employees`, `erp_role_permissions` (матрица прав),
`erp_dictionaries` (справочники админки: причины блокировок, типы проблем, типы изделий,
поставщики, единицы измерения, крой изделия, операции маршрута), `erp_stage_reports` (журнал результатов этапов и складских
задач), `erp_material_receipts` (частичная приёмка материалов), `erp_subcontract_moves`
(перемещения по подряду), `erp_settings` (настройки производства key/value: общая мощность
в изделиях за месяц), `erp_calendar_slots` (производственный план: этап × день,
план/факт/брак, проблема) + `erp_plan_comments` (переписка по задаче дня), `erp_material_suppliers` (варианты поставщиков на позицию закупки, ровно один
`is_selected`), `erp_tz_documents` (ТЗ в PDF: версии внутри `group_id`, документ
принадлежит позиции — `item_id`, либо всему заказу при `item_id = null`),
`erp_experimental.branding_note` («Комментарий по проработке» — необязательный
результат этапа проработки, который читает цех нанесения в своём задании,
правка 13.09),
`erp_order_items.garment_source` третьим значением `stock` («Склад готовой
продукции», правка 14.09: закупки нет, склад ВЫДАЁТ изделие — в отличие
от `customer`, где он его ПРИНИМАЕТ), вид вложения `production` («Файлы
производства») со стражем `erp_attachment_guard` (правится только `kind`
и только между `attachment` и `production`), право `files.manage` и роль
`designer`,
`erp_chat_threads`/`erp_chat_messages`/`erp_chat_mentions`/`erp_chat_reads`
(чат внутри сделки, правка 14.09: сообщение принадлежит ТРЕДУ — тогда привязка
разработки к сделке не требует копирования переписки; единственный писатель —
`erp_chat_send`, у сообщений нет ни INSERT-, ни UPDATE-, ни DELETE-политики;
отметок прочтения две — на тред и на этап), вид вложения `chat`
с `erp_order_attachments.message_id`, `erp_notifications` (+`message_id`,
уникальность `(user_id, message_id)`),
`erp_sku_cards`/`erp_sku_card_versions`/`erp_sku_card_files` (каталог моделей
ERP, правка 14.09: карточка отвечает на «как это шьётся», прайс-каталог
визарда `app_config.sku_catalog` — на «сколько стоит», связь по `code`;
`experimental_id` уникален, `card_version` и `pattern_version` — РАЗНЫЕ
величины; историю пишет триггер, DELETE-политики нет) + `erp_order_items.sku_card_id`
(ссылка, а не замена полей),
`erp_experimental_tasks` (задачи разработки: параллельные, необязательные,
`depends_on` внутри разработки, `cycle` — круг доработки, `stage_id` — задача,
ушедшая в цех; её статус ведёт триггер).
`erp_tz_assignments` и `erp_experimental_ops` **удалены 2026-08-12** вместе
с фазовой моделью: первая была пуста с 03.08, вторая перенесена в задачи.

Правки 20.09 (сессия 64) добавили **идемпотентную отгрузку, экономику
и поштучное прочтение чата**: уникальность `erp_order_shipments` переехала
на `(client_key, item_id)` (одна попытка = одна строка НА ПОЗИЦИЮ; прежний
ключ без `item_id` ронял `23505` на любом заказе из ≥2 позиций),
`erp_materials.size_grid_ordered` (факт «сколько заказано у поставщика
по размерам» — отдельно от `size_grid`, где лежит потребность из заказа),
`erp_stage_reports.assembly_cost_per_unit` (цена ЭТОЙ сдачи; колонка позиции
остаётся итоговой, иначе средневзвешенную не посчитать),
`erp_departments.cost_role` (`fabric`/`assembly` — роль участка
в себестоимости, свойство В ДАННЫХ рядом с `result_detail`),
права `stage.force_complete` (админ и директор; RPC `erp_stage_force_complete`
с обязательной причиной + ветка в `erp_stage_guard`) и `economics.view`
(вкладка «Экономика позиции», функции `erp_item_economics`/
`erp_order_economics`; отбор «основное полотно» fail-open — `role = 'main'`
ЛИБО `role is null и kind = 'fabric'`, потому что `role` заполнена
у одной строки из двадцати пяти).
Чат: `erp_chat_message_reads` (прочтение ПОШТУЧНО: `(message_id, user_id)`;
watermark `erp_chat_reads` остаётся — по ней считаются текущие счётчики),
`erp_chat_subscriptions` (режим на заказ: `all`/`mentions`/`none`, отсутствие
строки = `mentions`, то есть сегодняшнее поведение), вид уведомления
`chat_message`, `erp_chat_unread` переписана на формулу «позже водяной
отметки И без строки receipts» (одна проверка «нет receipt» в утро выката
вывалила бы всю историю как непрочитанную) и отдаёт `mentions`
и `first_unread_id`; плюс `erp_chat_unread_many` (счётчики списка заказов
одним запросом), `erp_chat_mark_seen`, `erp_chat_read_receipts`
(`security definer`: «Прочитали N» иначе не собрать — свои строки видит
только автор).

Вторая очередь чата (та же сессия 64) добавила **правку, удаление, реакции
и поиск**: `erp_chat_messages.edited_at`/`deleted_at` (удаление ЗАТИРАЕТ `body`
и уносит упоминания, файлы и уведомления сообщения, но НЕ строку — на неё
ссылаются цитаты), RPC `erp_chat_edit`/`erp_chat_delete` (`security definer`,
гейт «только автор»: политик у сообщений по-прежнему нет),
`erp_chat_reactions` (ключ — тройка `(message_id, user_id, emoji)`; здесь
политики уместны, подделать можно ровно «Иван поставил палец») + `erp_chat_react`
(переключает по `row_count` самого `delete`) и `erp_chat_reaction_people`,
`erp_chat_search` (`pg_trgm` + GIN по `body`: в цеху ищут по обрывку, а
`to_tsvector` по части слова не находит; удалённые не ищутся), плюс
`erp_chat_reactions` в `supabase_realtime` — это единственное в переписке,
что меняется чужими руками без нового сообщения.

Правки 16.09 (сессия 63) добавили **размерный факт и рулоны**:
`erp_stage_report_sizes` (результат этапа по размерам: отчёт × ЦВЕТ × размер —
одна таблица на приёмку склада, раскрой и пошив, потому что по ней считается
аналитика и проверка «сшито+брак+переделка ≤ принято по размеру»),
`erp_material_rolls` (рулоны принятой партии: склад заводит приёмкой, номер
сквозной внутри материала, число рулонов НЕ хранится — это `count(*)`),
`erp_stage_report_rolls` (расход ткани с рулона; отдельно от размеров, потому
что расход у рулона ОДИН, а размеров несколько),
`erp_materials.kind = 'finished_good'` + `size_grid` (закупка готового изделия
одной строкой с разбивкой; `qty_expected` при сетке считает триггер),
`erp_material_receipts.size_grid` (факт прихода по размерам — складывается,
а не перезаписывается), `erp_departments.result_detail` (`rolls`/`sizes` —
детализация результата участка, свойство В ДАННЫХ рядом с `result_fields`),
`erp_order_items.assembly_cost_per_unit` (фактическая стоимость сборки,
единственный писатель — `erp_stage_submit_report` через узкую ветку стража),
право `analytics.view` и функции раздела «Аналитика» (`erp_analytics_released`
определяет выпуск ОДИН раз для всех сводок). Признак «единица учитывается
рулонами» — в `erp_dictionaries.meta.rolls`, а не списком в коде: в `unit`
на бою лежат и код («кг»), и имя («Килограммы») одного значения.

Правки 12.09 (вторая порция, сессия 57) добавили: `erp_warehouse_tasks.material_id`
(приёмка материалов принадлежит ПОЗИЦИИ закупки и заводится её переходом
в `in_transit`), `erp_item_stages.result_kind` (`embroidery_program` — результат
этапа файл, а не штуки), `erp_departments.allows_over_plan` (участок может сдать
больше тиража — включён у закроя), вид вложения `stage_result` (файл, который цех
СДАЁТ, в отличие от `subcontract` — тех, что подрядчику отдают) и функцию
`erp_stage_input_qty` (серверное зеркало клиентского `stageInputQty`).

Правки 07.09 (сессия 52) добавили: размер упаковки в мм у заказа и позиции
(`packaging_width_mm`/`packaging_height_mm`), `erp_item_prints.garment_kind`
(тип изделия у вышивки: на крое и полотне / на готовых / шевроны; эффект
шелкографии живёт в существующей `special`) и вид справочника `print_effect`.
Участок `dtg` ДЕАКТИВИРОВАН (`active = false`), роль `dtg` убрана из CHECK
`erp_employees.role` и `erp_invites.employee_role`; значение метода
`erp_item_prints.method = 'dtg'` осталось читаемым. Кладовщик получил
`stage.take` и `stage.complete` — у склада появился этап маршрута (приёмка
готового изделия перед нанесением). Плюс `erp_order_items.garment_source`
(п. 4: `customer` — давальческое, изделие клиента; `purchased` — закупаем мы;
NULL читается как `purchased`) — у давальческого из маршрута уходит `supply`,
а приёмка склада обязательна даже без нанесений. Не путать
с `material_source`: та про материал ПОДРЯДЧИКА.

Правки 24.08 (сессия 41) добавили: `erp_experimental.board_stage` (колонка
канбана ЭКС, поставленная технологом вручную; NULL — считается из задач),
`erp_order_attachments.task_id` + вид вложения `dev_task` (файл задачи
разработки), тип складской задачи `subcontract_send` («Передача подрядчику» —
зеркало приёмки, п. 3) и ключ `final_package.add_to_sku` (переключатель
карточки SKU, от него зависит обязательность её полей).

**Storage:**
| Bucket | Назначение |
|--------|-----------|
| `sku-photos` | Фото моделей (до 4 на SKU), public read |
| `erp-attachments` | Превью макетов, вложения заказов и ТЗ в PDF (префикс `tz/`), public read |

Уборка ничьих объектов `erp-attachments` — edge-функция `storage-gc`
(гейт `is_admin()`, сухой прогон по умолчанию, возрастной гейт сутки) либо
`npm run storage:gc` с ключом `service_role` из окружения. Правила — раздел
«Правила уборки данных и файлов».

Статусы заказа: draft → review → approved → production → done

Статусы профиля (ProfileStatus): active | pending_approval | disabled | no_profile
- `active`: approved + active
- `pending_approval`: active, но не approved
- `disabled`: active=false (soft-delete)
- `no_profile`: нет записи в profiles (user=null в store)

## Правило конца сессии (обязательное)

В конце КАЖДОЙ сессии обновить:
1. `SESSION-STATE.md` — текущее состояние, новые решения, next steps
2. `PROJECT.md` — запись сессии в Changelog (что сделано)
3. `docs/DESIGN.md` — если менялся визуал/компоненты
4. `CLAUDE.md` (корневой и pinhead-react/) — если менялась структура/правила
Также: удалить временные QA-политики из БД (tmp_*), остановить dev-серверы.

## Правила кода

- `useShallow` для объектных селекторов Zustand — обязательно
- `toast.error` при каждой Supabase ошибке
- `return null` из async при ошибке (не fallback объект)
- Optimistic update только с rollback
- НЕ optimistic delete — ждать ответ Supabase
- CSS токены из `:root` (--type-*, --space-*, --z-*)
- Autofocus на первом поле формы
- Не добавлять npm-зависимости без обсуждения
- Не `!important` в CSS
- Supabase ключи строго из `.env` (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- RLS: политика пишется НА КОМАНДУ (`for select/insert/update/delete`), а не `for all`
  рядом с отдельной `select` — иначе Postgres проверяет обе на каждый SELECT
  (advisor `multiple_permissive_policies`). `auth.uid()`/`auth.role()` в предикате
  оборачивать в `(select …)` — иначе вызов идёт на каждую строку (`auth_rls_initplan`)
- `is_admin()`, `erp_is_manager()`, `erp_is_member()` вызываемы через REST, и advisor
  на это ругается — **так и оставляем**: выражения RLS исполняются от лица вызывающего,
  и отзыв `EXECUTE` сломает сами политики. Утечки нет: функции без аргументов и
  возвращают булево о самом вызывающем. Не «чинить»
- При logout вызывать `storageClearAll()` — чистит все app-ключи
- Удаление пользователя: soft-delete (active=false), не hard delete
- Auth: ProfileStatus state machine (active/pending_approval/disabled/no_profile)
- Dev-mode created_by: фильтровать 'dev' → null (и в saveOrder, и в duplicateOrder)
- deleteSkuPhotoByUrl: проверять результат, показывать toast.error при ошибке
- ERP: доступ только через `useErpAccess` (право из матрицы + принадлежность цеху),
  кнопки этапа — через `useStagePermissions` (у каждого действия своё право);
  приоритет очереди — `reorderStageQueue`, перенос между цехами — `moveStageToDepartment`
  с подтверждением последствий; прогресс считается в штуках (`erp/utils/progress`)
- ERP: финальный ОТК (`qc`) — последний этап производственного маршрута, зависит от
  ВСЕХ терминальных этапов (нанесение на готовом = параллельные ветки); маршрут без
  производственных этапов ОТК не получает. Галочка «Финальный ОТК» живёт только
  в форме — этапы материализуются при создании заказа
- ERP: боковая карточка заказа ведётся в адресе (`?order=`) — открытие пушит запись
  истории, закрытие снимает её же, «Назад» и ✕ совпадают
- ERP, необратимое действие этапа: последствия считает чистая утилита с тестами и
  формулирует их текстом — `utils/stageDone` (закрытие с недосдачей),
  `utils/stageDefect` (возврат брака через промежуточные этапы). Записывать факт
  «по умолчанию весь тираж» / молча откатывать маршрут нельзя
- Справочники ERP (`erp_dictionaries`) — подсказка, а не ограничение; значения отключаются,
  а не удаляются. Статусы в справочник не выносятся — они часть маршрутной логики
- Материальный гейт — из данных: `erp_departments.gate_material_kinds` (какие виды
  материала блокируют запуск участка), правится в админке. Пусто = не гейтится
  (fail-open). Константы вида «ткань → закрой» в коде не держать
- Группы очереди: `awaiting_materials` (нет материалов) отделена от `waiting`
  (ждёт предыдущий этап, ТЗ или закупку) — это разные решения руководителя.
  На канбане у обеих и у `blocked` свои дорожки, «Ожидают материалы» — перед «Готово»
- Производственный план (`/plan`) — РУЧНОЙ инструмент: система план не составляет
  и остаток сама не переносит, она показывает отклонение, а новую дату ставит
  человек. Раскладка живёт в `erp_calendar_slots`; «убрать из плана» —
  `status='cancelled'`, не DELETE (факт и переписка остаются, повтор идёт upsert-ом)
- План ставит роль `production_head` (право `plan.manage`), факт вносит цех
  (`plan.fact` + принадлежность цеху). Диспетчеру `plan.manage` НЕ даётся —
  иначе снятая у одного галочка отключает работу другого
- Мощности цехов (`capacity_per_day`) не возвращать: удалены осознанно миграцией
  20260716170000, загрузка выражается в штуках
- Матрица прав действует и НА СЕРВЕРЕ: `erp_has_permission(право)` +
  `erp_role_of_caller()` — дословное зеркало `resolveErpRole` из
  `utils/permissions.ts`. Расхождение двух реализаций даёт худший отказ («кнопка
  есть, сервер отвечает 42501»), поэтому его сторожит тест `serverPermissions.test.ts`,
  читающий саму миграцию. Отсутствие права в матрице на сервере = запрет
  (на клиенте там работает `DEFAULT_PERMISSIONS`, но это защита от неудачной загрузки)
- Одна UPDATE-операция под разными правами разделяется ТРИГГЕРОМ по изменившимся
  колонкам (`erp_calendar_guard` для плана, `erp_stage_guard` для этапов,
  `erp_order_guard`/`erp_order_item_guard` для заказа и позиции), а не
  политикой: RLS работает на уровне строки. Пустой `auth.uid()` в таком страже —
  это service_role, его пропускаем: он и так минует RLS, и запирать починку
  через SQL нельзя
- **Страж и клиентский гейт ставятся ОДНИМ коммитом.** `erp_orders` UPDATE стоял
  на `erp_is_member()` без разбора колонок — рабочий цеха мог через REST сменить
  срок и менеджера любого заказа. Но и клиент инлайн-правки не гейтил: страж
  в одиночку дал бы запрещённое «кнопка есть, действие падает». Прежде чем
  закрывать дыру на сервере — проверьте, закрыта ли она в интерфейсе
- `revoke execute … from anon` сам по себе НЕ РАБОТАЕТ: право приходит от PUBLIC
  (`=X/postgres` в ACL), а `anon` его наследует. Отзывать нужно
  `from public, anon` и следом явно `grant … to authenticated` — иначе отберёте
  доступ у самих политик. После отзыва проверьте `set local role authenticated`
- Страж разрешает ровно то, что разрешает интерфейс. Строже клиента — «кнопка есть,
  а действие падает», и виноватым выглядит цех; мягче — дыра. Поэтому переход
  в `done` принимает `stage.progress` (факт добрал тираж и закрыл этап сам) и
  `stage.move_department` (перенос закрывает исходный этап), а не только `complete`
- **Плановые даты этапа охраняются С ОБЕИХ СТОРОН** — `order.manage` в `PlanCell`
  и `erp_stage_guard` на сервере. Прежняя редакция этого правила («стражем
  НЕ охраняются, гейт нужен») описывала состояние ДО того, как гейт поставили,
  и устарела: проверка на живой базе 07.09 показала 42501 у рабочего и на своём
  этапе, и на чужом. Устаревшее правило хуже отсутствующего — по нему пошли бы
  «закрывать дыру», которой нет, и ослабили рабочий гейт. Правила про гейты
  сверяйте с базой, а не с их прошлой формулировкой
- ТЗ в PDF принадлежит ПОЗИЦИИ и автоматически видно всем цехам её маршрута
  (`itemTzDocument`: своё ТЗ позиции → общее ТЗ заказа). Назначать документ каждому
  цеху не нужно — этот шаг отменён 2026-08-03. Гейт (`utils/tz`) требует ТЗ только
  у производственных цехов и только при `tz_required === true` (fail-open: остановка
  цеха не должна случаться из-за отсутствующего поля). Заказ с ТЗ создаётся одной
  транзакцией: файлы в бакет → `erp_create_order` с секцией `tz`
- Ключ объекта в Storage — строго ASCII (`tzFilePath` транслитерирует кириллицу).
  Supabase проверяет ключ регуляркой S3-safe символов, где `\w` без флага `u`, и на
  русское имя файла отвечает `InvalidKey`. На этом ломалось создание ЛЮБОГО заказа
  с ТЗ; человекочитаемое имя живёт в `erp_tz_documents.file_name`
- Файл, который человек видит приложенным, обязан быть в бакете: загрузка идёт при
  выборе файла, у каждого своё состояние (загружается/загружено/ошибка), и submit
  заблокирован, пока есть незавершённые. Грузить в сабмите нельзя — интерфейс
  показывал приложенным то, чего в Storage нет

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

## Документация

| Файл | Назначение |
|------|-----------|
| `CLAUDE.md` | Контекст для Claude (этот файл) |
| `docs/rules/INDEX.md` | **Указатель правил по темам** (60 файлов, перенос 15.09) |
| `docs/rules/react/INDEX.md` | **Карта подсистем React-приложения** (48 файлов, «где что лежит») |
| `pinhead-react/CLAUDE.md` | Контекст для Claude (вложенный, детали React-приложения) |
| `PROJECT.md` | История, changelog, roadmap |
| `SESSION-STATE.md` | Память проекта: текущее состояние, решения, next steps |
| `docs/DESIGN.md` | Дизайн-система (токены, компоненты, UX-правила) |
| `docs/erp/*` | ERP: план, разборы таблицы/kontora24/ТЗ |
| `docs/PINHEAD-PORTAL-LOGIC.md` | Логика визарда |
| `docs/2026-04-10-design-audit.md` | 5-агентный аудит UI/UX |
| `docs/2026-07-27-skills-audit.md` | Аудит по чек-листам скилов: 16 находок + план работ |

## Команды

```bash
cd pinhead-react
npm run dev        # Dev server
npm run build      # Production build
npm run test       # Vitest unit tests
npm run e2e        # Playwright e2e tests
npm run lint       # ESLint
npm run seed       # Seed catalog data
```
