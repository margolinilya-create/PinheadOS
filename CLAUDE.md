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
│   ├── useConfirmStore.ts   # Imperative confirm dialog
│   └── useAppUpdateStore.ts # «Вышло обновление»: признак + «Позже» на полчаса
├── hooks/
│   ├── useDraft.js          # Авто-сохранение черновика
│   ├── useFocusTrap.js      # Focus trap для модалок
│   └── useEffectiveRules.ts # Resolved category rules для визарда
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
│   ├── skuRules.ts          # CategoryRules резолюция, getEffectiveRules, динамические зоны (29 тестов)
│   ├── validate.ts          # Валидация заказа
│   ├── mockup.ts            # SVG-мокап генерация
│   ├── deadline.ts          # Расчёт дедлайнов
│   └── i18n.ts              # Pluralize, translateSupabaseError
├── styles/                  # CSS: auth, kanban, wizard, forms, layout, garment, editors, extras-zones
└── orderstudio/             # Order v4: model/ (заказ, имена полей как DraftItem, ряды размеров),
                             # pricing/priceOrder, bridge/ (tzToErpDraft + erpNames), api/salesOrders,
                             # store/useSalesStore (автосохранение), screens/ (/sales, /sales/:id,
                             # ItemWizard), wizard/ (wizardAdapter, itemSession,
                             # wizardOrderToSales + transferToSales — «Оформить как заказ v4»), leaveGuard
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
| `/sales`, `/sales/:id` | Order v4: SalesList, SalesCard (пилот) | admin, director |
| `/sales/:id/item/:key` | ItemWizard — шаги визарда «Изделие»/«Дизайн» для позиции v4 (`key` = `new` или ключ) | admin, director |

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
| `orders` | id, order_number (PH-XXXX: `generate_order_number()` из `order_number_seq`; её же зовёт умолчание колонки — формат в одном месте, сессия 68), status, data JSONB, bitrix_deal; `schema_version` — 3 визард, 4 Order v4 (колонки шапки v4, итог в `price_total`, НЕ в `total_sum` — его пишет в аудит `log_order_changes`; старый список читает только 3) |
| `order_items` / `order_item_prints` / `order_item_labels` | Order v4 (миграция 20260928213529): позиции, нанесения, бирки; RLS на команду через родителя; запись — только `order_v4_save(jsonb)` (security invoker) |
| `profiles` | id, name, email, role, approved, active |
| `order_comments` | Комментарии к заказам |
| `order_audit` | Лог изменений статусов |
| `app_config` | SKU (sku_catalog), цены (prices), обработки (extrasCatalog), фурнитура (hardwareCatalog), правила (categoryRules), зоны (zonesCatalog) |
| `catalog_config` | Ткани (fabricsCatalog), отделка (trimCatalog) |

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
| `storage-backup` | Ночная копия двух бакетов выше (workflow «Storage backup», серверный `copy`, только новое, ничего не удаляется). **Private**, политик нет — только `service_role` (сессия 68) |

Уборка ничьих объектов `erp-attachments` — edge-функция `storage-gc` либо
`npm run storage:gc`; носителей ключа четыре, уборщиков два, ошибка проверки =
ничего не удалять. Подробно — `docs/rules/pravila-shemy-erp-podrobno.md`.

Статусы заказа: draft → review → approved → production → done

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
- Визард внутри «Заказов v4» — только через сессию позиции (`orderstudio/wizard/itemSession.ts`)
- ERP: доступ — `useErpAccess`, кнопки этапа — `useStagePermissions`; прогресс в штуках;
  финальный ОТК (`qc`) зависит от ВСЕХ терминальных этапов
- ERP, realtime: `useErpStore()` без селектора запрещён; **живой канал ровно один**
- Сторож, читающий файлы, — `// @vitest-environment node` первой строкой
- Дата для показа — `utils/date.parseDateLocal`; байт 0x00 — только `CELL_SEP`
- ERP: боковая карточка заказа — в адресе (`?order=`)
- Необратимое действие этапа: последствия считает утилита и называет текстом
- Справочники — подсказка, значения отключаются, не удаляются; статусы не в справочнике
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
| `docs/rules/INDEX.md` | **Указатель правил по темам** (67 файлов, перенос 15.09) |
| `docs/rules/react/INDEX.md` | **Карта подсистем React-приложения** (48 файлов, «где что лежит») |
| `pinhead-react/CLAUDE.md` | Контекст для Claude (вложенный, детали React-приложения) |
| `PROJECT.md` | История, статистика, roadmap |
| `docs/changelog/INDEX.md` | **Changelog** — записи сессий по файлу на месяц (перенос 26.09) |
| `docs/OPERATIONS.md` | Эксплуатация: инциденты, окружения, доступы |
| `SESSION-STATE.md` | Память проекта: текущее состояние, решения, next steps (две последние сессии) |
| `docs/sessions/INDEX.md` | **История сессий** — разделы «Состояние на …» по файлу на раздел (84 файла, перенос 24.09) |
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
