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
- **Графики:** Recharts
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
│   ├── editors/             # PriceEditor (wrapper), SkuEditor (8 табов), ExpressCalc
│   │   └── sku/             # SkuItemsTab, SkuFabricsTab, SkuTrimsTab, ExtrasEditor, SkuHardwareTab, PricingTabContent, CategoryRulesTab, ZonesCatalogTab, AddSkuModal, ZonesModal, SkuDetailModal
│   ├── output/              # PrintPreview (PDF)
│   ├── analytics/           # Dashboard
│   ├── production/          # TechCard
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
| `/queue`, `/queue/:deptCode` | DepartmentQueue (очередь участка) | Все |
| `/task/:stageId` | ProductionTask (производственное задание) | Все |
| `/plan` | PlanScreen (недельный план производства) | Все (правка — `plan.manage`) |
| `/load` | DeptLoad (загрузка цехов из плановых дат этапов) | Все |
| `/purchasing`, `/warehouse`, `/subcontracting`, `/experimental` | Закупка, Склад, Подряд, Эксперим. цех | admin, director |
| `/admin` | AdminScreen (пользователи, права, цеха, справочники, заказы ТЗ) | admin, director |

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

admin, director, manager, rop, designer, production

## Правила и стиль

- Общение с пользователем: всегда на русском языке
- Язык интерфейса: русский
- CSS: vanilla + CSS Modules, токены в `styles/index.css`
- Компоненты: `.jsx`, утилиты/типы: `.ts`
- Стейт: Zustand слайсы, useShallow обязателен для объектных селекторов
- Тесты рядом с файлами: `Component.test.jsx`, `util.test.ts`
- Lazy loading: KanbanBoard, PriceEditor, ExpressCalc, AdminPanel, Dashboard, StepDesign, StepItems, StepDetails, StepSummary
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
Ядро: `erp_departments` · `erp_orders` (+ `customer`) · `erp_order_items` ·
`erp_item_stages` (граф `depends_on`, `queue_position` — приоритет в очереди цеха,
`assignee` — исполнитель) · `erp_materials`. Сопровождение: `erp_item_prints`,
`erp_stage_events` (история этапов), `erp_order_audit`/`_comments`/`_attachments`,
`erp_procurement_tasks`, `erp_subcontracting`, `erp_warehouse_ops`/`_tasks`,
`erp_experimental`(+`_ops`), `erp_employees`, `erp_role_permissions` (матрица прав),
`erp_dictionaries` (справочники админки: причины блокировок, типы проблем, типы изделий,
поставщики), `erp_calendar_slots` (производственный план: этап × день, план/факт/брак,
проблема) + `erp_plan_comments` (переписка по задаче дня), `erp_material_suppliers` (варианты поставщиков на позицию закупки, ровно один
`is_selected`), `erp_tz_documents` (ТЗ в PDF: версии внутри `group_id`, документ
принадлежит позиции — `item_id`, либо всему заказу при `item_id = null`).
`erp_tz_assignments` **устарела с 2026-08-03** и осталась пустой: поцеховое назначение
ТЗ отменено, код её не читает и не пишет.

**Storage:**
| Bucket | Назначение |
|--------|-----------|
| `sku-photos` | Фото моделей (до 4 на SKU), public read |
| `erp-attachments` | Превью макетов, вложения заказов и ТЗ в PDF (префикс `tz/`), public read |

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
  колонкам (`erp_calendar_guard` для плана, `erp_stage_guard` для этапов), а не
  политикой: RLS работает на уровне строки. Пустой `auth.uid()` в таком страже —
  это service_role, его пропускаем: он и так минует RLS, и запирать починку
  через SQL нельзя
- Страж разрешает ровно то, что разрешает интерфейс. Строже клиента — «кнопка есть,
  а действие падает», и виноватым выглядит цех; мягче — дыра. Поэтому переход
  в `done` принимает `stage.progress` (факт добрал тираж и закрыл этап сам) и
  `stage.move_department` (перенос закрывает исходный этап), а не только `complete`
- Плановые даты этапа (`planned_*`) стражем НЕ охраняются: колонка «План» в карточке
  заказа правами не гейтится вовсе, и проверка на сервере отобрала бы у менеджера
  то, что он делает сегодня. Гейт нужен, но вместе с гейтом в интерфейсе
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

## Правила ERP (код-ревью 05.08)

- Счётчики этапа (`qty_done`, `qty_rework`) пишутся ТОЛЬКО приращением, на сервере
  (`erp_stage_report_progress`, `erp_stage_apply_defect`). Абсолют с клиента —
  потерянное обновление: два планшета в одном цехе читают своё значение и
  затирают запись друг друга. Для цеха с несколькими исполнителями это обычный
  день, а не редкая гонка
- Действие из нескольких записей — ОДНА транзакция (RPC), а не `Promise.all`.
  Пачка независимых UPDATE с общим откатом интерфейса откатывает поверх уже
  закоммиченных: возврат брака оставлял позицию в состоянии, которого никто
  не выбирал. У переноса этапа это же правило раньше решалось компенсирующей
  записью — с транзакцией она не нужна
- Логику маршрута (какие этапы затронуты) считает КЛИЕНТ и остаётся её
  единственным источником. Сервер отвечает за атомарность и арифметику: вторая
  реализация обхода `depends_on` на SQL — та самая рассинхронизация, из-за
  которой текст подтверждения когда-то разошёлся с фактом
- Перенос между цехами переводит на целевой этап ВСЕХ, кто зависел от исходного.
  Без этого финальный ОТК открывался раньше перенесённой работы: исходный этап
  закрыт, ОТК видит зависимость выполненной, а новый цех ещё не начинал
- Страж этапов проверяет и ПРИНАДЛЕЖНОСТЬ ЦЕХУ (`erp_can_act_in_dept`, зеркало
  `canActInDept`) — интерфейс гейтит дважды, право И цех, и матрица второго
  не отменяет. Право `stage.move_department` проверку снимает: целевая строка
  по определению в чужом цехе, а перенос интерфейс гейтит по цеху-ИСТОЧНИКУ
- Плановые даты этапа — под `order.manage`, НО взятие задания в работу пишет
  `planned_end` под `stage.take`: форма «Взять в работу» просит план завершения
  и пишет его тем же действием. Без исключения каждый рабочий получал 42501
  на каждом взятии, а вместе с датой терялся расчёт просрочки
- Сторожевой тест, читающий миграцию ПО ИМЕНИ, сторожит файл, а не базу: функции
  пересоздаются целиком, и прежняя миграция остаётся со СТАРЫМИ правилами. Брать
  последнюю миграцию, определяющую функцию (`latestDefining` в
  `serverPermissions.test.ts`)
- Каждый `supabase.rpc(...)` сверяется с сигнатурой в миграциях
  (`rpcContract.test.ts`): опечатка в имени функции или параметра не ломает
  ни сборку, ни один тест — она отвечает PGRST202 в проде, на том действии,
  которое никто не прокликал
- Постраничная выборка обязана иметь УНИКАЛЬНЫЙ доводчик сортировки, а смещение
  вести своим счётчиком, а не считать из стора: `due_date` не уникален, а в стор
  архивные заказы попадают мимо пагинации (диплинк, realtime) и сдвигают
  смещение. Дубль гасит дедуп по id — пропуск не видно ничем
- `started_at` ставится ОДИН раз, при первом входе в работу. Снятие блокировки,
  переоткрытие после брака и открытие этапа при переносе её не сдвигают: от неё
  считается бейдж «ТЗ обновлено», и сдвиг прятал предупреждение, ради которого
  бейдж и сделан
- Файл, загруженный в бакет и не привязанный к строке БД, убирается за собой
  (`removeOrphanUpload`, политика `erp_att_delete_own` — автор удаляет СВОЙ
  объект). Прежде в трёх местах стоял комментарий «удалять политика не даёт»,
  и сироты копились навсегда
- Ошибки Supabase во ВСЕХ слайсах идут через `erpError` — он называет причину
  (офлайн, отказ прав, конфликт). Плоский `toast.error('Не удалось …')` делает
  42501 от стража неотличимым от обрыва сети

## Документация

| Файл | Назначение |
|------|-----------|
| `CLAUDE.md` | Контекст для Claude (этот файл) |
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
