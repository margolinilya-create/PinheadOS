# BUGREPORT.md — состязательный QA/security-аудит PINHEAD Order Studio

> Дата: 2026-07-22. Метод: чтение кода + read-only интроспекция прод-БД (`pg_policies`,
> Supabase `get_advisors`) + **живое воспроизведение** через REST под anon-ключом и
> одноразовым тест-аккаунтом (создан, использован, удалён; боевые 146 заказов не тронуты).
> Карта и модель угроз — в `TESTMAP.md`. Воспроизведение — `pinhead-react/tests/security/`.

## Дисклеймер об архитектуре (определяет severity)
Приложение — SPA (Vite/React) без серверного слоя: браузер ходит в Supabase напрямую под
`anon`-ключом. **Единственная граница безопасности — Postgres RLS.** Любая проверка в React —
косметика: эндпоинты открыты для прямого вызова с валидным JWT в обход всего UI. Всё ниже
доказано именно прямыми REST-запросами, а не «через интерфейс».

---

## 1. Сводка

Найдено **17** значимых дефектов (+ 6 проверок, где защита держится — см. §5).

| Severity | Кол-во | Тема |
|---|---|---|
| 🔴 Critical | 1 | Открытая регистрация + отсутствие авторизации ERP → внешний доступ к боевым данным |
| 🟠 High | 3 | approved/active не enforce'ятся; нет ролевого разграничения записи ERP; обход произв. переходов |
| 🟡 Medium | 5 | загрузка→XSS на storage-origin; спуф аудита; публичные бакеты; цена legacy с клиента; клиентские гейты снимаются |
| 🟢 Low | 8 | нет CSP/X-Frame; director не пишет profiles; цены читают все; слабые пароли; mutable search_path; EXECUTE на триггер-фн; краевые qty; QA-по-проду |

**Ключевой вывод:** серверная граница различает лишь три уровня — «любой `authenticated`»
(читает+пишет почти весь ERP), «admin/director» (цены/подряд/удаление/профили) и «без JWT».
Шесть продуктовых ролей на сервере **не различаются** для основного потока производства, а
`approved`/`active` не проверяются нигде. На кону боевые данные (146 заказов).

---

## 2. Топ-5 критичных

### 🔴 #1 — Открытая само-регистрация + отсутствие авторизации в ERP → любой посторонний получает полный доступ к боевым данным
**Severity: Critical.** Цепочка CR-1 + HI-1 + HI-2.

Регистрация открыта (`disable_signup=false`), а RLS всех `erp_*` таблиц —
`SELECT/INSERT/UPDATE` для любого `authenticated` без проверки профиля/approve/роли
(подтверждено адвайзером Supabase `rls_policy_always_true` на ~15 таблицах). Посторонний
регистрируется → подтверждает почту → получает `authenticated` JWT → читает и меняет **все
146 заказов**, минуя экран «Ожидание подтверждения» (он чисто клиентский, `App.jsx:59`).

**Воспроизведение (живое, прод):**
```
GET  /auth/v1/settings                → disable_signup:false, mailer_autoconfirm:false
POST /auth/v1/signup                  → 200, создан authenticated-пользователь
# пользователь БЕЗ строки в profiles (approve не пройден):
GET  /rest/v1/profiles?select=id      → []                (нет профиля)
GET  /rest/v1/erp_orders?select=title → 146 строк, напр. "BOX39 свитшоты"   ← УТЕЧКА
```
Полный сценарий — `pinhead-react/tests/security/authz-rls-probe.mjs`.

**Фикс (любой из, лучше оба):**
1. **Инвайт-онли:** `disable_signup=true` в Auth-настройках проекта (или явный blocklist по
   домену). Убирает внешний вектор одной настройкой.
2. **Настоящая авторизация в RLS.** Ввести функцию-предикат и заменить `using(true)/with
   check(true)`:
   ```sql
   create or replace function public.erp_is_member() returns boolean
   language sql stable security definer set search_path=public as $$
     select exists(select 1 from profiles
       where id = auth.uid() and active is true and approved is true);
   $$;
   -- на каждой erp_* политике: using (erp_is_member()) [+ ролевые предикаты для записи]
   ```
   Тогда неподтверждённый/без-профиля пользователь не читает и не пишет ничего.

---

### 🟠 #2 — `approved`/`active` не проверяются на сервере: отключённый/неподтверждённый сотрудник сохраняет полный доступ
**Severity: High.**

Ни одна политика не ссылается на `approved`/`active` (проверено по `pg_policies`). Soft-delete
(`AdminPanel.jsx:55`, `EmployeesScreen.jsx:75` — `active=false`) и «ожидание подтверждения» —
только UI-состояния. JWT остаётся валидным (Supabase auth не знает про `active`), поэтому
уволенный/непринятый сотрудник продолжает читать и менять все заказы через прямой REST, пока
не удалён его **auth-аккаунт**. Уже сейчас в проде 3 auth-пользователя при 2 профилях — то есть
аккаунт «без авторизации в приложении» существует и имеет доступ к данным (доказано в #1).

**Фикс:** предикат `erp_is_member()` из #1 (active AND approved) на всех политиках; при
soft-delete **отзывать доступ на уровне auth** — банить/удалять пользователя через Admin API
(`auth.admin.updateUserById({ban_duration})` или delete), а не только ставить `active=false`.

---

### 🟠 #3 — Нет ролевого разграничения записи в ERP: designer/production меняют любой заказ, этап, количество, справочник цехов
**Severity: High.**

`erp_orders/_order_items/_item_stages/_materials/_departments/_item_prints/…` —
`update … using(true) with check(true)` для `authenticated`. Ни один слайс стора не проверяет
роль (`ordersSlice.ts:217`, `stagesSlice.ts:29`, `ordersSlice.ts:253`). Значит `designer` или
`production` (низшие роли) через прямой API правят чужие заказы, двигают статусы этапов, меняют
`qty_done`, переименовывают/выключают цеха (`erp_departments`) — всё, кроме `delete` (он
admin-only) и `erp_subcontracting`/`erp_procurement_tasks(update)` (ужесточены до admin/director).

**Воспроизведение (живое, на собственном тест-заказе):**
```
POST /rest/v1/rpc/erp_create_order      → 200 (не-админ создал заказ)
PATCH /rest/v1/erp_orders?id=eq.<oid>   {"priority":999} → 200, priority=999
```

**Фикс:** ролевые предикаты в RLS по действию (напр. запись этапов — только производственные
роли + «свой цех» через серверную привязку сотрудника к участку, а не `localStorage`);
справочник `erp_departments` — запись только admin/director.

---

### 🟠 #4 — Обход производственных переходов и границ количеств (отгрузка незавершённого, `qty_done > qty`, `done→waiting`)
**Severity: High (целостность данных).**

Легальность переходов живёт только в React (группировка карточек + `isOrderReadyToShip`,
`stageUi.ts:42`); в БД — лишь enum-CHECK, без запрета переходов и без `check (qty_done<=qty)`.
`setStageStatus`/`updateOrder`/`shipOrder` — сквозные passthrough (`stagesSlice.ts:29`,
`ordersSlice.ts:217/253`).

**Воспроизведение (живое, тест-заказ):**
```
PATCH /rest/v1/erp_orders?id=eq.<oid>
      {"status":"done_early","shipped_status":"shipped"} → 200
# заказ «отгружен» в обход isOrderReadyToShip (нет этапов, нет полученных материалов)
```
Аналогично прямой апдейт `erp_item_stages.qty_done = 999999` не имеет клампа
(кламп только в `reportProgress`/`reportDefect`).

**Фикс:** сделать смену статусов/отгрузку **единственным путём через SECURITY DEFINER RPC** с
валидацией легального перехода и готовности (deps done + материалы received), а прямой
`update` статусов закрыть; добавить `check (qty_done <= qty)` / триггер на `erp_item_stages`.

---

### 🟡 #5 — Небезопасная загрузка файлов → исполнение скрипта на storage-origin + произвольный контент в публичном бакете
**Severity: Medium.**

`uploadOrderAttachment`/`uploadOrderPreview` (`ordersSlice.ts:288-333`) кладут файл в
**публичный** бакет `erp-attachments`, беря `contentType` **прямо из клиентского `file.type`**,
без allowlist типа и лимита размера; файл затем открывается ссылкой `<a target="_blank">`
(`OrderDrawer.jsx:191`). Загрузив `.svg`/`.html` как `image/svg+xml`/`text/html`, аутентифициро-
ванный пользователь добивается **исполнения своего JS на `*.supabase.co`** (фишинг/раздача
малвари с доверенного домена). `sku-photos` (`lib/storage.ts:110-123`): SVG проходит
`image/*`-проверку, `upsert:true` по предсказуемому пути `${code}_${i}.${ext}` — перезапись
чужого фото. (DOM-XSS в самом приложении при этом невозможен — см. §5.)

**Фикс:** allowlist MIME (`jpg/png/webp`) + лимит размера **в самих upload-функциях** (не в
обёртке UI); не передавать клиентский `file.type` как `contentType` для не-картинок; для
вложений — приватный бакет + signed URLs или `Content-Disposition: attachment`.

---

## 3. Полный список остальных дефектов

### 🟡 Medium
- **ME-2 — Спуф аудита/личности.** `erp_order_comments.author`, `order_comments.author_role`
  (`useCommentsStore.ts:56`), ERP `actor/uploaded_by` (`shared.ts:28`, `ordersSlice.ts:*`),
  `erp_create_order.created_by` — клиентские строки. *Живое подтверждение:* комментарий
  сохранён с автором «Директор (СПУФ)». Журнал «кто сделал» недостоверен. **Фикс:**
  проставлять актора на сервере из `auth.uid()` (в триггере/RPC), игнорируя клиентское поле.
- **ME-3 — Публичные бакеты с макетами клиентов.** `erp-attachments`, `sku-photos` —
  `public:true`; клиент может создать публичный бакет (`storage.ts:110`). Арт/макеты читаются
  по URL без авторизации. **Фикс:** приватные бакеты + signed URLs; убрать `createBucket` из клиента.
- **ME-4 (legacy price) — Цена в `orders.total_sum` авторитетна с клиента.** Пишется как есть
  (`useOrdersStore.ts:183/211`), колонка — голый `integer` без CHECK; отрицательное/произвольное
  принимается; сервер не пересчитывает. OrderStudio за флагом, но таблица живая (12 заказов) и
  менеджер правит цену/статус своего заказа без серверной проверки. **Фикс:** пересчитывать
  сумму на сервере (RPC/триггер) из позиций и прайса; `check (total_sum >= 0)`.
- **ME-6 — Клиентские гейты снимаются тривиально.** `orderStudio` включается `?studio=1`/
  `localStorage`/`window.setFeature` (`features.ts`); `setPreviewRole('admin')` не защищён и
  влияет на роутинг Studio (`useAuthStore.ts:140`); `canAct` даёт доступ пользователю без
  привязки к цеху, привязка — из `localStorage['erp_my_dept']` (`DepartmentQueue.jsx:121`);
  `ProductionBoard`-advance без гейта. Открывает скрытый UI (SkuEditor/AdminScreen-оболочки);
  реальный вред ограничен RLS. **Фикс:** гейты капабилити — от серверной роли; `previewRole`
  не должен влиять на способности; привязка к цеху — серверная.

### 🟢 Low
- **LO-1 — Нет CSP/X-Frame-Options/X-Content-Type-Options** (`vercel.json`). HSTS есть
  (дефолт Vercel), но приложение фреймится (clickjacking) и нет mitigation-in-depth для XSS.
  *Проверено:* `curl -I https://pinhead-os.vercel.app/`. **Фикс:** `headers` в `vercel.json`.
- **LO-2 — Director не может писать `profiles`** (функц. баг): UI пускает director в
  EmployeesScreen, но RLS-запись `profiles` = `is_admin()` = `role='admin'` только → правки
  ролей у director молча падают. **Фикс:** привести `is_admin()`/политику к admin+director.
- **LO-3 — `app_config.prices` читают все authenticated** (`app_config_read_authenticated`
  без per-key guard, в отличие от `catalog_config`) → утечка себестоимости/наценки
  production/designer. **Фикс:** price-guard по ключу, как в `catalog_config`.
- **LO-4 — Leaked-password protection выключена** (адвайзер `auth_leaked_password_protection`).
  **Фикс:** включить HIBP-проверку в Auth-настройках.
- **LO-5 — Mutable `search_path`** у `erp_set_updated_at`/`erp_procurement_task_derive`/
  `erp_is_manager` (адвайзер `0011`). **Фикс:** `set search_path=public` в объявлении.
- **LO-6 — EXECUTE на триггер-функциях** (`erp_log_order_changes`/`_stage_plan_changes`/
  `erp_warehouse_task_derive`, адвайзер `0028/0029`). *Проверено:* через `/rest/v1/rpc/` эти
  функции **не** вызываются (PostgREST 404 — trigger-возврат не экспонируется), т.е. удалённо
  не эксплуатируется; это гигиена. **Фикс:** `revoke execute … from anon, authenticated`.
- **LO-7 — Краевые qty в legacy-ценообразовании** (`pricing.ts`): отрицательный тираж →
  отрицательный итог; нет верхнего клампа; сырая строка в per-row size-инпутах
  (`SizeTable.jsx:135/206`). Вторично (сумма и так пишется напрямую — ME-4). **Фикс:** клампы
  `Math.max(0, …)` и валидация qty при вводе/сохранении.
- **LO-8 — QA против прода (процесс).** `qa-supabase-bridge.mjs` таргетит прод-проект
  `glhwbkt…`; SESSION-STATE упоминает временные `tmp_*` RLS-политики в проде. Риск забытых
  ослаблений RLS. **Фикс:** QA на preview-ветке; регламент удаления `tmp_*`; периодический
  прогон `get_advisors`.

---

## 4. Что НЕ смог проверить (и почему)

1. **Реальный прод-бандл `DEV=false`.** `useAuthStore.ts:9,43` в dev-режиме даёт хардкод-админа
   без пароля. Vite вырезает в прод-сборке, но подтвердить нужно по задеплоенному JS (нужен
   доступ к бандлу/деплою). — *Не проверял: не хотел скачивать/парсить прод-бандл без нужды.*
2. **Storage-политики `storage.objects`** для обоих бакетов в проде целиком (в репо — часть).
   Не гонял загрузку вредоносного файла **по проду** (это запись-мусор в публичный бакет) —
   ME-1 описан по коду; воспроизводится на preview.
3. **Настройки JWT/сессии** (TTL, ротация refresh) — конфиг проекта, не в коде.
4. **Забытые `tmp_*` политики** — не делал отдельный полный срез всех политик (снял только
   ключевые таблицы); стоит прогнать `get_advisors` + аудит `pg_policies` целиком.
5. **Нагрузка/DoS, N+1, поведение на объёме** — по правилам не гонял по проду; нужен
   preview/локальная сборка.

---

## 5. Проверено — защита ДЕРЖИТСЯ (важно для честности)

Живыми тестами и интроспекцией подтверждено, что **эти** векторы закрыты — их не надо «чинить»:
- **Самоэскалация роли через `profiles` невозможна.** INSERT/UPSERT своего профиля с
  `role:admin` → **403 RLS**; UPDATE → 0 строк. Политики: `own_profile` (SELECT свой),
  `admin_all_profiles` (запись только `is_admin()`).
- **Удаление заказов — только admin.** delete не-админом → 0 строк (RLS `is_admin()`).
- **Запись цен/каталога — только admin/director.** `app_config.prices` не-админом → **403**.
- **Аноним без сессии не читает данные.** `erp_orders` анонимно → `[]` (RLS требует `authenticated`).
- **Stored-XSS через DOM невозможен.** Все 7 `dangerouslySetInnerHTML` идут через санитайзенный
  `getGarmentSVG` (цвет через `sanitizeHex`, тип — ключ поиска); прочий текст экранирует React.
- **Секретов в коде/бандле нет** (service_role/JWT); RLS включён на всех публичных таблицах;
  open redirect нет.

---

## 6. Пять быстрых побед (чинить первыми)

1. **`disable_signup=true` (инвайт-онли)** — одна настройка Auth, закрывает внешний вектор #1.
2. **Ролевой предикат в RLS.** Добавить `erp_is_member()` (active AND approved) и заменить
   `using(true)/with check(true)` на `using(erp_is_member())` [+ ролевые для записи] на всех
   `erp_*` — закрывает #1/#2/#3 системно. Заодно отзывать auth-доступ при soft-delete.
3. **Security-заголовки в `vercel.json`** (CSP с `frame-ancestors 'none'`, X-Frame-Options,
   X-Content-Type-Options, Referrer-Policy) — LO-1, минут работы.
4. **Allowlist MIME+размер в upload-функциях** (`uploadOrderAttachment/Preview`, `uploadSkuPhoto`)
   и не доверять клиентскому `content-type`; вложения — приватный бакет/signed URL — #5/ME-3.
5. **Гигиена БД по адвайзеру:** включить leaked-password protection, `set search_path=public`
   у функций, `revoke execute` на триггер-функциях, `check (qty_done<=qty)` и
   `check (total_sum>=0)` — LO-4/LO-5/LO-6/#4/ME-4 пачкой.

---

## 7. Статус исправлений (эта сессия)

Применено к проду `pinhead-os-v2` (миграции в `supabase/migrations/20260722180000..180200`)
и коду `pinhead-react/`. Все изменения — **только ужесточение**.

| Находка | Что сделано | Проверка |
|---|---|---|
| #1/#3 тотальный доступ к ERP | RLS всех `erp_*` переведён с `using(true)` на `erp_is_member()` (active AND approved); `delete` admin-only и manager-гейты сохранены | ✅ живьём: посторонний → **0** заказов и **42501** на запись; админ → **146** |
| #2 approved/active не enforce | `erp_is_member()`/`erp_is_manager()` требуют active AND approved | ✅ advisor: **15** `rls_policy_always_true` исчезли |
| onboarding | триггер `on_auth_user_created` создаёт PENDING-профиль → регистрант заблокирован до одобрения, но виден админу | ✅ применено |
| #4 qty_done | триггер-кламп `qty_done` в `[0, item.qty]` | ✅ |
| ME-4 цена legacy | `check (total_sum >= 0)` на `orders` | ✅ |
| ME-1 загрузки | allowlist MIME (jpg/png/webp) + лимит + канон. ext + content-type из allowlist в `uploadOrderPreview/Attachment`/`uploadSkuPhoto` (`lib/uploadGuard.ts` + 7 тестов) | ✅ 1025 тестов зелёные, build/lint ок |
| LO-1 заголовки | CSP `frame-ancestors 'none'` + X-Frame-Options/X-Content-Type-Options/Referrer-Policy/Permissions-Policy в `vercel.json` | ✅ (применится при деплое) |
| LO-5/LO-6 гигиена БД | пин `search_path` + `revoke execute` на триггер-функциях; revoke anon на предикатах | ✅ advisor: warn ушли |

**Осталось (ручное действие / продуктовое решение):**
- **disable_signup + leaked-password protection** — настройки Auth в Supabase Dashboard (не через SQL/MCP). RLS-фикс уже нейтрализует утечку данных даже при открытой регистрации, но инвайт-онли рекомендуется.
- **Полный content-CSP** (`script-src`/`style-src`/`connect-src` с Supabase+Google Fonts) — нужен тест-прогон против собранного бандла; отгружены безопасные заголовки, строгий CSP — следующим шагом.
- **#3 глубже** — вход «посторонним/неодобренным» закрыт; различение 6 ролей на запись внутри команды — продуктовое решение.
- **ME-3** (публичные бакеты → приватные + signed URLs), **ME-2** (серверный стамп актора), **HI-4** (пересчёт цены на сервере) — архитектурные, следующей волной.
- **LO-2** (director не пишет `profiles`) — намеренно не трогал (расширение прав = продуктовое решение).
- Advisor-warn «is_admin/erp_is_member/erp_is_manager executable by authenticated» — **by-design**: RLS-политики вызывают эти предикаты, поэтому роль `authenticated` обязана иметь на них EXECUTE.

---

*Приложения: `TESTMAP.md` (карта атаки, матрица ролей, модель угроз),
`pinhead-react/tests/security/authz-rls-probe.mjs` (+ README) — воспроизводимый прогон.*
