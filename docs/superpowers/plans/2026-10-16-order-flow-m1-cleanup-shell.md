# Веха 1: уборка Order Studio и оболочка в стиле ERP — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Раздел «ТЗ» (Order Studio) без мусора, в оболочке, которая выглядит и ведёт себя как ERP. Сторожа гарантируют, что ERP не изменился. e2e-мок готов к вехам 2–7: умеет v4, `erp_create_order` и Storage.

**Architecture:**
- Новая оболочка `orderstudio/layout/OrderLayout.jsx` собрана из классов `erp/erp.module.css` (`.shell/.sidebar/.rightcol/.topbar/.main`) и примитивов `erp/components/*` — импорт без правки ERP. Старые `Header`, `RolePreviewBar`, `OnboardingTips`, `CommandPalette`, канбан v3, аналитика и `/print` удаляются.
- Два сторожа (vitest, node):
  - «ERP заморожен» — хэши файлов `src/erp/**` и ERP-миграций против манифеста плюс запрет DDL по `erp_*` в новых миграциях;
  - «разрешённые импорты ERP» — список модулей Order, которым можно импортировать рантайм ERP.

**Tech Stack:** React 19, react-router-dom 7, Zustand 5, CSS Modules, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-unified-order-flow-design.md` (вехи — раздел «Порядок разработки», уборка — «Стиль ERP и уборка»).

## Global Constraints

- **ERP не меняется:**
  - ни одного изменения в `pinhead-react/src/erp/**`;
  - ни одной миграции, меняющей объекты `erp_*`;
  - ERP можно только импортировать.
- **Не трогать:**
  - `components/auth/AdminPanel` (`ordersOnly`) и `store/useOrdersStore` — их импортирует вкладка ERP «Заказы ТЗ»;
  - dev-автологин;
  - agentation (`components/shared/DevAnnotations`).
- **npm:** новых зависимостей нет. Удаляются только `chart.js` и `react-chartjs-2`: решение владельца «убрать аналитику продаж».
- **Бюджет бандла:** `npm run bundle:budget` — «Оболочка ERP» не растёт ни на байт относительно `main` (снять число до первой правки).
- **Линт:** `--max-warnings 44` не повышать; ратчет размеров файлов (`fileSizeRatchet.test.ts`) — строки удалённых файлов убираются, лимиты остальных не растут.
- **Стиль кода:**
  - CSS — токены из `:root`, без `!important`;
  - литерал, равный токену, и фолбэк `var(--x, X)` запрещены;
  - иконки — `erp/components/Icon`, без эмодзи.
- **Язык:** интерфейс и коммиты на русском, conventional commits. В коммитах — строки атрибуции сессии, идентификатора модели нет.
- **Тесты:**
  - сторож, читающий файлы, — первой строкой `// @vitest-environment node`;
  - полный прогон — `npx vitest run --maxWorkers=3`.
- **Флаг:** `FEATURES.orderStudio` по умолчанию `false`, это не меняется.
- **Сохранение v3 из визарда остаётся до вехи 3** (отступление от списка уборки спеки — см. Review Focus, п. 1).

## Review Focus

1. **У менеджера пропал единственный путь сохранить заказ.** Без флага admin/director и без рабочего места (веха 3) визард обязан и дальше сохранять заказ кнопкой «Сохранить». Удаляются только ссылки на `/print` и канбан. Тест в задаче 4: StepSummary у роли `manager` рисует кнопку сохранения и не рисует «Печать / PDF».
2. **Старая закладка `/orders`, `/print` или `/analytics`** должна вести на рабочий экран, а не на пустую страницу или 404. `/orders` → `/sales` для admin/director, остальным → `/`; `/print` и `/analytics` → `/`. Тест в задаче 4.
3. **Липкие панели визарда и каталога** (`ProgressBar`, `.pe-tabs`, `.sku-ed-rate-bar`) считали отступ от шапки высотой 52 px. В новой оболочке прокручивается `.main` под шапкой, и прежний отступ даст щель 52 px. Тест в задаче 5: внутри `OrderLayout` `--header-h` равно `0px`, `--preview-bar-h` в CSS больше не встречается.
4. **Узкий экран.** Сайдбар Order должен открываться кнопкой «Меню» и закрываться переходом, как в ERP. Иначе на телефоне раздел без навигации. Тест в задаче 5.
5. **Тот, кто чинит ERP в другой сессии,** получает красный сторож. Сообщение обязано назвать файлы и команду обновления манифеста (`npm run erp:freeze`), иначе сторож будут отключать. Тест в задаче 1 проверяет текст ошибки.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `pinhead-react/scripts/erp-freeze.mjs` | Создать: пишет манифест хэшей ERP |
| `pinhead-react/src/orderstudio/erpFrozen.json` | Создать: манифест `{ files: {path: sha256}, migrations: {name: sha256} }` |
| `pinhead-react/src/orderstudio/erpFrozen.test.ts` | Создать: сторож «ERP заморожен» |
| `pinhead-react/src/orderstudio/erpImports.test.ts` | Изменить: список разрешённых импортов ERP |
| `pinhead-react/src/orderstudio/layout/OrderLayout.jsx` | Создать: оболочка раздела |
| `pinhead-react/src/orderstudio/layout/OrderSidebar.jsx` | Создать: навигация раздела |
| `pinhead-react/src/orderstudio/layout/orderNav.ts` | Создать: пункты меню и фильтр по роли (чистая функция) |
| `pinhead-react/src/orderstudio/layout/OrderLayout.module.css` | Создать: только то, чего нет в `erp.module.css` (`--header-h: 0px` у `.main`) |
| `pinhead-react/src/orderstudio/layout/*.test.*` | Создать: тесты оболочки и меню |
| `pinhead-react/src/orderstudio/OrderStudioApp.jsx` | Изменить: оболочка, маршруты, удаление мусора |
| `pinhead-react/src/store/useAuthStore.ts` | Изменить: убрать `previewRole` и его действия |
| `pinhead-react/src/components/steps/StepSummary.jsx` | Изменить: роль без превью, без `/print`, «Все заказы» → `/sales` |
| `pinhead-react/e2e/support/mockSupabase.ts` | Изменить: v4, `erp_create_order`, Storage, журнал вызовов |
| `pinhead-react/e2e/order-shell.spec.ts` | Создать: e2e оболочки и мока |
| Удалить | `components/shared/{RolePreviewBar,OnboardingTips,CommandPalette}*`, `components/layout/Header*`, `components/orders/*`, `components/analytics/*`, `components/output/*`, `e2e/kanban-actions.spec.ts` |

---

### Task 1: Сторож «ERP заморожен»

**Files:**
- Create: `pinhead-react/scripts/erp-freeze.mjs`, `pinhead-react/src/orderstudio/erpFrozen.json`, `pinhead-react/src/orderstudio/erpFrozen.test.ts`
- Modify: `pinhead-react/package.json` (скрипт `"erp:freeze": "node scripts/erp-freeze.mjs"`)

**Interfaces:**
- Produces: `src/orderstudio/erpFrozenCheck.ts` с чистыми функциями:
  - `diffManifest(expected: Record<string,string>, actual: Record<string,string>): { changed: string[]; added: string[]; removed: string[] }`;
  - `erpDdlViolations(sql: string): string[]`.
  Скрипт и тест используют их обе.

Охват манифеста:
- **`files`** — все файлы `pinhead-react/src/erp/**`. Путь относительно `pinhead-react/src`, хэш sha256 содержимого.
- **`migrations`** — те файлы `supabase/migrations/*.sql` на момент заморозки, текст которых содержит `erp_`.
- **Новые миграции** (которых нет в `migrations`) не должны давать нарушений `erpDdlViolations`.

Запрещённый DDL (без учёта регистра, по всему тексту):
- `alter table [if exists] [public.]erp_…`;
- `drop (table|function|trigger|policy|index|view) [if exists] [public.]erp_…`;
- `create [or replace] (function|view|index) [public.]erp_…`;
- `create (trigger|policy) … on [public.]erp_…`;
- `insert into|update|delete from [public.]erp_…`.

Чтение `erp_*` в теле функции (`select … from erp_employees`) — НЕ нарушение.

- [ ] **Step 1: Write the failing test** — `erpFrozen.test.ts` (`// @vitest-environment node`):
  - `it('diffManifest видит изменённый, новый и удалённый файл')`: `diffManifest({a:'1',b:'2'},{a:'1',b:'3',c:'4'})` → `{changed:['b'],added:['c'],removed:[]}`.
  - `it('erpDdlViolations ловит правку таблицы ERP')`: `'alter table public.erp_orders add column x int;'` → длина 1; `'create policy p on erp_orders for select using (true);'` → длина 1; `'update erp_orders set x=1;'` → длина 1.
  - `it('erpDdlViolations пропускает чтение ERP в функции Order')`: `'create function public.sales_is_ms() returns boolean as $$ select exists(select 1 from erp_employees) $$;'` → `[]`.
  - `it('файлы src/erp совпадают с манифестом')`: обход `SRC_DIR/erp` через `testutil/sourceFiles`, `sha256` из `node:crypto`. При расхождении — `expect.fail` с текстом: `ERP изменён: <список>. ERP боевой и в работе над Order не меняется. Если правка ERP согласована владельцем — npm run erp:freeze и коммит манифеста вместе с правкой.`
  - `it('ERP-миграции не изменены, новые не трогают erp_*')`: та же схема для `../supabase/migrations`.
- [ ] **Step 2: Run** `npx vitest run src/orderstudio/erpFrozen.test.ts`. Expected: FAIL — нет модуля `erpFrozenCheck` и манифеста.
- [ ] **Step 3: Implement** `erpFrozenCheck.ts` (две функции выше) и `scripts/erp-freeze.mjs`. Скрипт пишет `erpFrozen.json` с ключами, отсортированными по алфавиту, — тогда диф манифеста в PR читается.
- [ ] **Step 4: Run** `npm run erp:freeze && npx vitest run src/orderstudio/erpFrozen.test.ts`. Expected: PASS.
- [ ] **Step 5: Мутационная проверка.** Дописать пробел в конец `src/erp/utils/time.ts` → тест FAIL с именем файла и командой в тексте. Откатить (`git checkout src/erp/utils/time.ts`) → PASS. Временная миграция с `alter table erp_orders …` → FAIL; удалить.
- [ ] **Step 6: Commit** `test(order-studio): сторож «ERP заморожен» — манифест хэшей и запрет DDL по erp_*`.

### Task 2: Сторож разрешённых импортов ERP

**Files:**
- Modify: `pinhead-react/src/orderstudio/erpImports.test.ts`

**Interfaces:**
- Produces: правило, на которое опираются задачи 5 и вехи 2–7.
  - `ALLOWED_FILES = new Set(['bridge/tzToErpDraft.ts', 'OrderStudioApp.jsx'])`.
  - `ALLOWED_TARGETS`: регулярки целей импорта, разрешённых любому модулю Order — `/\/erp\/components\/[A-Za-z]+(\.jsx)?$/`, `/\/erp\/erp\.module\.css$/`.
  - Запрещены по-прежнему: стор ERP (`/erp/store/`), утилиты, экраны. Их получат только `bridge/launch.ts` (веха 7) и оболочка.

Оговорка о бандле. Общий модуль у двух ленивых чанков сборщик может вынести в отдельный чанк. Поэтому задача 5 обязана подтвердить `bundle:budget` без роста.

- [ ] **Step 1: Write the failing test.** Добавить `it('примитивы и стили ERP разрешены, стор — нет')`:
  - `isAllowed('layout/OrderLayout.jsx', '../../erp/components/Button')` → `true`;
  - `isAllowed('layout/OrderLayout.jsx', '../../erp/erp.module.css')` → `true`;
  - `isAllowed('screens/SalesList.jsx', '../../erp/store/useErpStore')` → `false`;
  - `isAllowed('OrderStudioApp.jsx', '../erp/screens/AdminScreen')` → `true`.
- [ ] **Step 2: Run** `npx vitest run src/orderstudio/erpImports.test.ts`. Expected: FAIL — `isAllowed is not defined`.
- [ ] **Step 3: Implement** `isAllowed(rel: string, target: string): boolean` в тесте. Регулярку `runtimeErpImports` расширить на импорт без `from` (`import '…/erp/…css'`); основной `it` переписать на `isAllowed`.
- [ ] **Step 4: Run** — PASS. Мутация: временно добавить в `screens/SalesList.jsx` строку `import { useErpStore } from '../../erp/store/useErpStore';` → FAIL; убрать.
- [ ] **Step 5: Commit** `test(order-studio): сторож импортов ERP — примитивы и стили разрешены, стор только мосту`.

### Task 3: Убрать превью роли, онбординг, палитру команд, старую шапку

**Files:**
- Delete: `components/shared/RolePreviewBar.jsx` (+ `.module.css`), `components/shared/OnboardingTips.jsx` (+ css), `components/shared/CommandPalette.jsx` (+ css), `components/layout/Header.jsx` (+ `.module.css`, тест, если есть)
- Modify:
  - `store/useAuthStore.ts` — убрать `previewRole`, `setPreviewRole`, `clearPreviewRole`; `effectiveRole()` возвращает `get().user?.role`;
  - `store/useAuthStore.test.js`;
  - `components/steps/StepSummary.jsx:157-158` (`canSalesV4` по `user?.role`) и `StepSummary.test.jsx`;
  - `orderstudio/OrderStudioApp.jsx` — убрать импорты, декоративный SVG, `has-preview-bar`, `effectiveRole`;
  - `index.css` — удалить `--preview-bar-h` и `body.has-preview-bar`;
  - `components/layout/ProgressBar.module.css`, `styles/editors.css` — `+ var(--preview-bar-h)` вычеркнуть из `calc`;
  - `sticky-layers.test.js`, `styles/tokens.test.ts` (комментарии и константа превью), `fileSizeRatchet.test.ts` (строки удалённых файлов).

**Interfaces:**
- Produces: `useAuthStore` без `previewRole`. `effectiveRole()`, `isAdmin()`, `isROP()`, `isProduction()`, `isDesigner()` сохраняют имена и читают настоящую роль.

- [ ] **Step 1: Write the failing test** в `useAuthStore.test.js`:
  - `it('превью роли больше нет: effectiveRole — настоящая роль')`: `useAuthStore.setState({ user: { role: 'manager' } })` → `effectiveRole() === 'manager'`;
  - `expect('setPreviewRole' in useAuthStore.getState()).toBe(false)`.
- [ ] **Step 2: Run** `npx vitest run src/store/useAuthStore.test.js`. Expected: FAIL на `setPreviewRole`.
- [ ] **Step 3: Implement** правки стора и всех потребителей из списка выше. Удалить файлы. Проверить, что `grep -rn "previewRole\|preview-bar\|RolePreviewBar\|OnboardingTips\|CommandPalette\|layout/Header" src` пуст (ERP не затронут: в `erp/` этих имён нет).
- [ ] **Step 4: Run** `npx vitest run src/store src/components/steps src/sticky-layers.test.js src/styles src/fileSizeRatchet.test.ts src/orderstudio`. Expected: PASS. `npm run typecheck` — 0 ошибок, `npm run lint` — без роста предупреждений.
- [ ] **Step 5: Commit** `refactor(order-studio): убрать превью роли, онбординг, палитру команд и старую шапку`.

### Task 4: Убрать канбан v3, аналитику и `/print`; перенаправить старые адреса

**Files:**
- Delete: `components/orders/*`, `components/analytics/*`, `components/output/*`, `e2e/kanban-actions.spec.ts`
- Modify:
  - `orderstudio/OrderStudioApp.jsx` (маршруты);
  - `components/steps/StepSummary.jsx` — убрать обе кнопки «Печать / PDF» (стр. ~301 и ~475). «Все заказы» → `navigate('/sales')`, показывать только при `['admin','director'].includes(user?.role)`;
  - `utils/deadline.ts:58` (комментарий);
  - `package.json` — удалить `chart.js`, `react-chartjs-2` (`npm uninstall chart.js react-chartjs-2`, лок-файл обновит npm);
  - `src/setupTests.js` — заглушка canvas остаётся, если на неё опирается другой тест (проверить `grep -rn getContext src`), иначе удалить вместе с комментарием о Chart.js;
  - `e2e/navigation.spec.ts`, `e2e/routes-smoke.spec.ts` — удалить проверки `/orders`, `/analytics`, `/print`, добавить проверки перенаправлений;
  - `fileSizeRatchet.test.ts` — строки удалённых файлов.

**Interfaces:**
- Produces: маршруты раздела —
  - `/` (визард), `/express`, `/sku`, `/prices` → `/sku?tab=pricing`, `/admin`, `/sales`, `/sales/:id`, `/sales/:id/item/:key`;
  - `/orders` → `/sales` (admin/director) или `/`;
  - `/print`, `/analytics` → `/`;
  - `*` → `/`.
  Функция `legacyRedirect(path: string, role: string): string` в `orderstudio/layout/orderNav.ts` — чистая, её зовёт `OrderStudioApp`.

- [ ] **Step 1: Write the failing test** `orderstudio/layout/orderNav.test.ts`:
  - `legacyRedirect('/orders','admin')` → `'/sales'`; `legacyRedirect('/orders','manager')` → `'/'`;
  - `legacyRedirect('/print','admin')` → `'/'`; `legacyRedirect('/analytics','rop')` → `'/'`.
  Плюс в `StepSummary.test.jsx`:
  - `it('менеджер сохраняет заказ, печати v3 нет')` — у роли `manager` есть кнопка сохранения, `queryByText('Печать / PDF')` → `null`, `queryByText('Все заказы')` → `null`;
  - у `admin` «Все заказы» есть.
- [ ] **Step 2: Run** `npx vitest run src/orderstudio/layout src/components/steps/StepSummary.test.jsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `legacyRedirect`, маршруты (`<Route path="/orders" element={<Navigate to={legacyRedirect('/orders', user.role)} replace />} />` и так же для двух других), правки StepSummary. Удалить файлы и зависимости.
- [ ] **Step 4: Run** `npx vitest run --maxWorkers=3` — полный прогон зелёный. `npm run build && npm run bundle:budget` — оболочка ERP не выросла (сравнить с числом из Global Constraints). `npx playwright test e2e/navigation.spec.ts e2e/routes-smoke.spec.ts` — PASS.
- [ ] **Step 5: Commit** `refactor(order-studio): убрать канбан v3, аналитику и /print; старые адреса ведут на рабочие экраны`.

### Task 5: Оболочка `OrderLayout` в стиле ERP

**Files:**
- Create: `orderstudio/layout/OrderLayout.jsx`, `OrderSidebar.jsx`, `OrderLayout.module.css`, `OrderLayout.test.jsx`; дополнить `orderNav.ts` и `orderNav.test.ts`
- Modify: `orderstudio/OrderStudioApp.jsx` — тело оборачивается в `<OrderLayout user={user}>`; skip-link и `<main id="main-content">` переезжают в оболочку

**Interfaces:**
- Consumes:
  - `erp/erp.module.css` (`shell`, `rightcol`, `topbar`, `main`, `sidebar`, `sidebarOpen`, `sidebarScrim`, `sidebarBrand`, `sidebarLogo`, `sidebarBrandText`, `sidebarNav`, `navGroup`, `iconBtn`, `navToggle`, `userChip`, `userRole`);
  - `erp/components/Icon`;
  - `config/features.setFeature`;
  - `store/useAuthStore` (`logout`);
  - `store/useConfirmStore` (подтверждение выхода — как в `ErpLayout.jsx:403-414`);
  - `App.module.css` (`skipLink`).
  Тема — общий хук `hooks/useTheme.js` (`{ theme, toggleTheme }`), тот же, что у `ErpLayout.jsx:62`; кнопка — как `ErpLayout.jsx:363-370` (`iconBtn themeToggle`, иконки `moon`/`sun`).
- Produces:
  - `NavItem = { to: string; label: string; icon: string; roles?: string[]; end?: boolean }`;
  - `ORDER_NAV: { title: string; items: NavItem[] }[]`;
  - `navFor(role: string): { title: string; items: NavItem[] }[]` — группы с отфильтрованными пунктами, пустые группы выкинуты.
  Пункты:
  1. «Заказ»: `{to:'/', label:'Новый заказ', icon:'plus', end:true}`, `{to:'/sales', label:'Заказы v4', icon:'orders', roles:['admin','director']}`.
  2. «Инструменты»: `{to:'/express', label:'Экспресс-расчёт', icon:'tag', roles:['admin','director','rop','manager']}`.
  3. «Настройки»: `{to:'/sku', label:'Каталог', icon:'shirt', roles:['admin','director']}`, `{to:'/admin', label:'Админка', icon:'settings', roles:['admin','director']}`.
  Подписи «Мои заказы» и «К запуску» появятся в вехах 3 и 7, в этой вехе их нет.

Шапка (слева направо):
- кнопка «Меню» (`navToggle`);
- заголовок раздела «ТЗ»;
- кнопка «Производство» (иконка `board`, `aria-label="Перейти в Производство"`, только admin/director) — `setFeature('orderStudio', false); window.location.href = '/'`;
- тема;
- чип пользователя (имя + роль);
- «Выйти» с подтверждением «Выйти из системы?».

`.main` получает класс модуля `OrderLayout.module.css` `.orderMain { --header-h: 0px; }`. Прокручивается `.main`, а не окно: липкие панели визарда и каталога встают к верху области.

- [ ] **Step 1: Write the failing tests:**
  - `orderNav.test.ts`:
    - `navFor('manager')` содержит `/` и `/express`, не содержит `/sales`, `/sku`, `/admin`;
    - `navFor('director')` содержит все пять;
    - `navFor('production')` — только `/`;
    - у каждого пункта `icon` есть в `erp/components/icons.js` (импорт объекта иконок).
  - `OrderLayout.test.jsx` (MemoryRouter, `user={{role:'admin', name:'Илья'}}`):
    - видны ссылки «Новый заказ», «Каталог»;
    - кнопка «Перейти в Производство» вызывает `setFeature('orderStudio', false)` (мок `config/features`);
    - клик «Меню» ставит `aria-expanded="true"`, клик по ссылке сайдбара возвращает `"false"`;
    - у `user.role='manager'` кнопки «Перейти в Производство» нет;
    - `main#main-content` имеет класс `orderMain`.
- [ ] **Step 2: Run** `npx vitest run src/orderstudio/layout`. Expected: FAIL — модулей нет.
- [ ] **Step 3: Implement** `navFor`, `OrderSidebar` (разметка по образцу `erp/layout/Sidebar.jsx:170-258` без цехов, счётчиков и сворачивания), `OrderLayout`. Подключить в `OrderStudioApp`. `RoleGuard` и маршруты не менять, кроме обёртки.
- [ ] **Step 4: Run:**
  - `npx vitest run --maxWorkers=3`, `npm run typecheck`, `npm run lint` — зелёные;
  - `npm run build && npm run bundle:budget` — «Оболочка ERP» ≤ числа до вехи. Если выросла — общий модуль с ERP вынесен в отдельный чанк: найти его в `dist/.vite/manifest.json` и заменить проблемный импорт на копию стиля в `OrderLayout.module.css` (с комментарием, почему);
  - сторож задачи 1 — PASS (ERP не тронут).
- [ ] **Step 5: Проверить глазами.** `VITE_FEATURE_ORDER_STUDIO=1 npm run dev` (или `?studio=1`). На 1440 и 375 px: сайдбар, переходы, липкий `ProgressBar` визарда у верха области прокрутки, тёмная тема. Скриншоты — в scratchpad.
- [ ] **Step 6: Commit** `feat(order-studio): оболочка раздела в стиле ERP — сайдбар, шапка, переключатель в Производство`.

### Task 6: e2e-мок — v4, запуск и Storage; спека оболочки

**Files:**
- Modify: `pinhead-react/e2e/support/mockSupabase.ts`
- Create: `pinhead-react/e2e/order-shell.spec.ts`
- Modify: `pinhead-react/e2e/visual.spec.ts` — эталоны `studio-*` обновляются через workflow `update_snapshots` (не локально: шрифты контейнера дают другой растр)

**Interfaces:**
- Produces (для вех 2–7):
  - `MockExtras.salesOrders?: unknown[]` — строки `orders` с `schema_version: 4`, ответ на `GET rest/v1/orders`;
  - `MockExtras.calls?: MockCall[]`, где `type MockCall = { kind: 'rpc' | 'storage'; name: string; body: unknown }` — журнал, в который мок пишет каждый RPC и каждую загрузку в Storage (спека передаёт пустой массив и читает его после действий);
  - RPC `order_v4_save_full` → `{ id: body.p_order.id ?? 'mock-sales-1', order_number: 'PH-9001', updated_at: FX_CREATED }`;
  - RPC `erp_create_order` → `{ id: 'mock-erp-order-1', items: [] }`;
  - Storage `POST|PUT …/storage/v1/object/<bucket>/<path>` → `200 { Key: '<bucket>/<path>' }`;
  - `GET` в Storage — по-прежнему 404, детерминированно.
  Форму ответа `erp_create_order` сверить с `erp/store/slices/orderWriteSlice.ts` (что он читает из `data`) и записать в комментарии мока.

- [ ] **Step 1: Write the failing e2e** `order-shell.spec.ts`:
  - `test('оболочка раздела ТЗ: сайдбар и переход в заказы v4')` — `installSupabaseMock(page, { salesOrders: [<строка v4 «PH-9001», клиент «ООО Тест»>] })`, `page.goto('/sales?studio=1')`: видна навигация `role=navigation` со ссылкой «Новый заказ», в списке есть «PH-9001»;
  - `test('мок пишет журнал RPC и Storage')` — внутри страницы `supabase.rpc('erp_create_order', {p:1})` и `supabase.storage.from('order-artworks').upload('t/a.txt', new Blob(['x']))` через `page.evaluate` с `import('/src/lib/supabase.ts')`; `calls` содержит `{kind:'rpc', name:'erp_create_order'}` и `{kind:'storage', name:'order-artworks/t/a.txt'}`;
  - `test('старые адреса')` — `/orders?studio=1` у dev-админа → URL `/sales`; `/print?studio=1` → `/`.
- [ ] **Step 2: Run** `npx playwright test e2e/order-shell.spec.ts`. Expected: FAIL (`salesOrders` не обрабатывается, Storage отвечает 404).
- [ ] **Step 3: Implement** ветки мока (`dataForTable` — `case 'orders'` с фильтром `schema_version=eq.4`; `dataForRpc` — два новых `case`; маршрут Storage различает метод) и журнал `extra.calls?.push(...)`.
- [ ] **Step 4: Run** `npm run e2e`. Expected: все спеки зелёные. Падения `visual.spec.ts` на `studio-*` — ожидаемое изменение вида; эталоны обновить через workflow `update_snapshots` после пуша и проверить новые картинки глазами.
- [ ] **Step 5: Commit** `test(order-studio): e2e-мок знает v4, erp_create_order и Storage; спека оболочки раздела`.

### Task 7: Документы вехи и PR

**Files:**
- Modify:
  - `CLAUDE.md` (корень): таблица «ТЗ (Order Studio)» — без `/orders`, `/print`, `/analytics`; «Структура файлов» — без удалённых компонентов, плюс `orderstudio/layout/`; стек — без Chart.js; строка о стороже «ERP заморожен»;
  - `pinhead-react/CLAUDE.md` (те же разделы);
  - `docs/DESIGN.md` (оболочка Order = оболочка ERP);
  - `docs/changelog/2026-10.md`;
  - `SESSION-STATE.md` по правилу конца сессии (старший раздел — в `docs/sessions/`, строка в `INDEX.md`);
  - `PROJECT.md` (статистика тестов).

- [ ] **Step 1:** Обновить документы. Прогнать `npx vitest run src/sessionsIndex.test.ts src/changelogIndex.test.ts` — PASS.
- [ ] **Step 2:** Финальная проверка: `npm run lint && npm run typecheck && npx vitest run --maxWorkers=3 && npm run build && npm run bundle:budget && npm run e2e`. Записать числа (тесты, бюджет оболочки) в changelog.
- [ ] **Step 3:** Commit `docs: веха 1 единого потока — уборка и оболочка Order`; `git push -u origin claude/exciting-galileo-uk2po2`. PR — только по просьбе владельца.
