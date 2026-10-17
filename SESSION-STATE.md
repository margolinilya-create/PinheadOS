# SESSION-STATE — память проекта PinheadOS

> Живой документ: обновляется в конце КАЖДОЙ сессии (правило в CLAUDE.md).
> Здесь — текущее состояние и решения ДВУХ последних сессий плюс открытые долги.
> История старше — `docs/sessions/` (по файлу на сессию, указатель
> `docs/sessions/INDEX.md`), changelog — `PROJECT.md`. Сторож
> `src/sessionsIndex.test.ts` не даёт истории снова копиться здесь.

## Состояние на 2026-10-17 (сессия 84) — веха 2 единого потока: данные, права, бакет, прототип запуска

Ветка `claude/exciting-galileo-uk2po2` (коммиты `74ae03b9`…HEAD, запушены; PR в main). План —
`docs/superpowers/plans/2026-10-17-order-flow-m2-data-rights.md` (с поправками проверки
скиллами и безопасности), ledger — `.superpowers/sdd/2026-10-17-order-flow-m2-data-rights/`.
Экранов в вехе нет, ERP не менялся (сторож «ERP заморожен» зелёный).

### Что сделано

- **Мок Storage** e2e различает `object/sign|list|move|copy`, `sign` отвечает подписанной ссылкой.
- **Миграция A** `20261017053703_order_v4_tz_fields` (на бою 17.10): поля ТЗ у заказа,
  позиции, нанесения (метод `other` — «Прочее / подряд»), бирок; `order_notes_cards`;
  новая `order_v4_save` (пути файлов только `orders/<id>/…`, видимость родителя).
- **Миграция B** `20261017062110_order_v4_rights` (на бою 17.10): `sales_is_lead/ms/seller`,
  RLS `orders_*` на команду с `active and approved`, `order_events`, RPC
  `order_v4_transition` / `order_v4_launch_check` / `order_v4_set_payment`, стражи
  `order_v4_guard` (белый список) / `order_v4_delete_guard` / `order_v4_child_guard`,
  `order_number_format` + уникальный индекс номера. Клиент — `api/salesTransitions.ts`.
- **Миграция C** `20261017070826_order_artworks_bucket` (на бою 17.10, пробы на бою 67/0):
  приватный бакет `order-artworks` (25 МБ, `orders/<uuid>/…`, подписанные ссылки 600 с,
  SVG только `<img>` и скачиванием, UPDATE запрещён restrictive-политикой), в ночной копии.
  Клиент — `api/artworks.ts`.
- **Прототип запуска** `bridge/launch.ts`: `launch_check` → `createOrder` стора ERP →
  `transition`; три модуля ERP динамически (сторож импортов), сирота/конфликт, двойной
  клик. e2e `order-launch.spec.ts`. Экрана нет — веха 7.
- **Пробы в репозитории** `supabase/probes/` (`order_v4_rights.sql` — 83, `order_artworks.sql`
  — 67, README) + сторож `orderstudio/probesFiles.test.ts`.
- **Документы**: правила — `docs/rules/pravila-prav-i-strazhey-order-v4-veha-2-17-10.md`
  и `pravila-hranilishcha-faylov-zakaza-veha-2-17-10.md`; CLAUDE.md (схема, Storage, правила
  кода), история сессии 82 — в `docs/sessions/`.

### Решения

- МС = активная строка `erp_employees.role = 'manager'`; профиль `manager` ≠ МС.
- ERP удаляет свой заказ — v4 остаётся в своём статусе без связи (ветка FK set null).
- Подделанный номер при прямой вставке заменяется свежим; номер уникален.
- Перенос файла из `order-artworks` в соседние бакеты закрыт restrictive-политикой
  (обходил MIME и лимиты публичных бакетов); `copy` наружу — «прочитал — опубликовал», принят.
- Миграции на бой — сухой прогон и применение файлами через SQL Editor владельцем,
  пока MCP `execute_sql` виснет на `delete`/`drop`.

### Следующие шаги — веха 3 (рабочее место заказа, по спеке)

- Рабочее место заказа: изделие, клиент, ТЗ и цена без PDF; «Дублировать в другом цвете»;
  список «Мои заказы»; удаление переноса из визарда и старой карточки.
- Автосохранение выключено, если статус не `draft` (иначе поток 42501); макеты — только
  через `api/artworks` (SVG — `<img>` и скачивание). «Отправить в работу» и оплата — веха 6,
  «К запуску» — веха 7. Флаг `orderStudio` людям — после вехи 8.

### Отложено

- **До вехи 3:** `order_v4_save` пишет умолчание вместо отсутствующего ключа — вкладка со
  старой сборкой сотрёт новые поля ТЗ позиций, нанесений и бирок (`supplier`, `tz_comment`,
  `artwork_path`, `blank`, `preview_paths`…). Новой миграцией: «нет ключа — прежнее значение»
  (как у `notes_cards`), либо опереться на плашку `appVersion`.
- Визуальный эталон `studio-*` после оболочки вехи 1 снимает только первый экран
  (прокрутка внутри `.orderMain`) — снимать прокручиваемый контейнер целиком.
- Запаса нет: lint 38/38, оболочка ERP JS 194175/195000 Б.
- Уборщик ничьих файлов `order-artworks` и срок хранения.
- Копия макетов в публичный `erp-attachments` при запуске — вехи 6–7 (`tz.documents`).
- Копия ВНУТРЬ `order-artworks` из `erp-attachments` обходит MIME и размер бакета (Low).
- `launch_started_at` сдвигается при каждом `launch_check`: две вкладки одного заказа дадут
  ложный конфликт (двойной клик в одной вкладке закрыт).
- Явное поле `launched` в ответе `launch_check` вместо различения по `launch_started_at`.
- `NewOrderInput` без `tz_order_id`/`tz_number` (приведение типа в `launch.ts`) — при разморозке ERP.
- Сторож ERP `domainSlices.test.ts` обходится загрузчиками `() => import` — научить отличать
  модули `screens/**` без компонентов при разморозке ERP.
- Мок переходов в e2e повторяет белый список сервера вручную — держать в паре.
- Мелочи ревью: `jsonb_typeof` для `part_colors`/`layout`; сегмент «.» в пути; циклы родителей;
  номер сеанса в пуле PostgREST (LOW); дубль ветки загрузки POST/PUT в моке Storage.

### Задачи владельца

- Назначить роль МС (`erp_employees.role = 'manager'`) реальным людям — до вехи 7.
- Обновить эталоны `studio-*` (Actions → CI → `update_snapshots`).
- Включить Leaked password protection в Supabase.
- Дымовой прогон бакета на бою: менеджер под своей учёткой загружает файл, получает ссылку
  и удаляет файл. Экрана до вехи 3 нет — прогон вместе с вехой 3.

## Состояние на 2026-10-16 (сессия 83) — веха 1 единого потока: уборка и оболочка Order

Ветка `claude/exciting-galileo-uk2po2` (продолжение сессии 82). Спека —
`docs/superpowers/specs/2026-10-16-unified-order-flow-design.md`, план вехи —
`docs/superpowers/plans/2026-10-16-order-flow-m1-cleanup-shell.md`. Решение владельца:
«убрать аналитику продаж»; ERP не трогаем. PR не создавался (только по просьбе).

### Что сделано

- **Сторож «ERP заморожен»** — `orderstudio/erpFrozen.test.ts` + `erpFrozenCheck.ts` +
  манифест `erpFrozen.json` (641 файл `src/erp` и миграции ERP) + запрет DDL по `erp_*`
  в новых миграциях. Обновить манифест после одобренной владельцем правки ERP:
  `npm run erp:freeze`.
- **Сторож импортов** `erpImports.test.ts`: Order берёт из ERP только `erp.module.css`,
  белый список `ERP_PRIMITIVES` (`erp/components`) и стор для моста; реэкспорт и
  динамический `import()` учитываются.
- **Уборка.** Убраны превью роли (`RolePreviewBar`/`previewRole`), онбординг, палитра
  команд, старая шапка Order, декоративный SVG, `--preview-bar-h`; канбан v3
  (`components/orders`), аналитика (`Dashboard`, `chart.js`, `react-chartjs-2`), `/print`
  (`components/output`). Старые адреса: `/orders` → `/sales` (admin/director) или `/`,
  `/print` и `/analytics` → `/`. В StepSummary нет кнопок печати; «Все заказы» →
  `/sales` для admin/director. **Сохранение v3 из визарда остаётся до вехи 3.**
- **Оболочка Order** — `orderstudio/layout/` (OrderLayout, OrderSidebar, orderNav:
  `legacyRedirect`/`navFor`/`ORDER_NAV`): бренд «PINHEAD ORDER», заголовок «Оформление
  заказа», переключатель в Производство, тема, выход. `OrderLayout.module.css` — снимок
  CSS оболочки ERP (импорт `erp.module.css` поднимал CSS оболочки ERP до 16309 > 16000);
  сторож `orderLayoutCss.test.ts`. Палитра ERP `.shell` теперь красит и визард (DESIGN.md).
- **e2e-мок** знает v4 (`salesOrders`, журнал `calls`, `order_v4_save_full`,
  `erp_create_order`, Storage upload); новая спека `e2e/order-shell.spec.ts`.
- **Финальная волна по ревью ветки.** Автосохранение черновика визарда вернулось:
  `useDraft()` зовёт `OrderLayout` (жил в удалённой шапке — `pinhead_draft` не писался);
  на `/` и `/express` в шапке — статус черновика и «Сбросить черновик» с подтверждением.
  Сторож импортов видит двойные кавычки; сторож «ERP заморожен» хэширует текст с
  CRLF→LF (`frozenHash`, одинаково в скрипте), пропускает скрытые файлы (`.DS_Store`),
  DDL-шаблон видит `public."erp_orders"` и списки в `drop table`/`truncate`. Мёртвый CSS
  канбана v3 убран (живы `.kanban-page` и `.kb-search`).
- **Флаг `orderStudio` менеджерам НЕ включать до вехи 3:** у менеджера нет списка
  своих заказов — канбан убран, `/sales` только admin/director.
- **Числа.** Оболочка ERP: JS 194312 → 194176 B gzip, CSS 15932 → 15905; ESLint
  44 → 38, лимит `--max-warnings 38`. Остальное — changelog 2026-10.

### Следующие шаги

- **Веха 2 — данные и права, прототип запуска** (см. спеку): права и данные Order,
  прототип запуска заказа в производство (мост по-прежнему без правок ERP до решения).
- Эталоны `studio-*` обновить workflow `update_snapshots` (локально в контейнере не
  обновлялись; `studio-sku` ожидаемо расходится).
- Осознанно: `frozenMessage` для DDL советует `erp:freeze` — скрипт вносит новую
  миграцию с `erp_` в манифест, и дальше она сверяется только по хэшу. Заморозка =
  одобрение правки ERP владельцем; без одобрения не запускать.
- Отложенные мелочи вехи 1: предикат «миграция содержит `erp_`» живёт только в скрипте;
  `stripSqlComments` не учитывает строки с `--`; белый список — только прямые импорты
  (`ErpStates` → `lib/appUpdate` → `useConfirmStore`); `useAuthStore.ts` — устаревший заголовок «Preview role» над
  `effectiveRole`; лишняя пустая строка в `index.css` на месте `body.has-preview-bar`;
  `vite.config.js` `manualChunks` `vendor-charts` и `FORBIDDEN_IN_SHELL` в bundle-budget —
  мёртвая конфигурация; мёртвый CSS `.pp-*` (печать v3) и `.dash-*` (аналитика) в
  `editors.css`, `utils.css`, `responsive.css`; комментарий про канбан у `SOON_DAYS` в `deadline.ts`; закрытый
  мобильный сайдбар остаётся в табуляции (`inert`); сторож снимка покрывает только
  палитру `.shell`, каркас/шапка/сайдбар — ручная сверка; Storage-мок считает
  `object/sign|list|move|copy` загрузкой (понадобится в вехе 2); в `order-shell.spec.ts`
  избыточный второй `expect` URL и `import('/src/lib/supabase.ts')` зависит от dev-сервера.
- Владелец (с сессии 82): удалить 73 старые ветки и включить «Automatically delete head
  branches»; Leaked password protection в Supabase; ключи Supabase для превью Vercel;
  значения `prices.minMarginPct` и `prepFees`.

## История

Разделы сессий 82 и старше — `docs/sessions/INDEX.md` (92 файла, перенос
дословный). В конце сессии старший из разделов здесь переезжает
туда же, чтобы в этом файле оставались две последние сессии.
