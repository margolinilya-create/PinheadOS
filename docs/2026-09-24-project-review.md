# Обзор проекта целиком — 24.09.2026 (сессия 67)

Повод: владелец попросил посмотреть проект и сказать, что улучшить.
Это обзор всего репозитория, а не одного раздела; код-ревью ERP на день
раньше — `docs/2026-09-23-erp-code-review.md`.

**Как проверялось.** Три разведки по репозиторию (фронтенд, база, процесс)
плюс сверка спорных утверждений с ЖИВЫМИ источниками: advisors и журнал
миграций Supabase `pinhead-os-v2`, запуски GitHub Actions, список веток.
У каждого пункта — путь или замер. Три утверждения разведки, не подтверждённые
источником, в выводы не попали (см. «Чем ошибалась разведка»).

---

## Статус правок (24.09, сессии 67–68)

| № | Находка | Статус |
|---|---|---|
| 1 | Бэкапа Storage нет | **переделан** в сессии 68: серверная инкрементальная копия в приватный бакет `storage-backup` (артефактов и путей в логе больше нет). Прогон #58 владельца успел выложить архив в артефакты публичного репозитория — удалить |
| 2 | Техпакет карточки модели терялся при удалении файлов | **исправлено** в этой сессии: `storage-gc` + три клиентских удаления + сторож |
| 3 | `main` не защищён, Vercel деплоит мимо CI | защита `main` **включена** владельцем (сверка сессии 68: `protected: true`); гейт деплоя Vercel не сверялся |
| 4 | Leaked password protection выключен | **не подтвердилось**: сессия 68 записала «включено», advisor 26.09 снова показывает выключено — тумблер за владельцем (Dashboard → Auth → Password security) |
| 5 | Память проекта разошлась с реальностью | **исправлено**: запись о миграциях и ссылки поправлены (67); история — в `docs/sessions/`, roadmap и статистика `PROJECT.md` переписаны под факт (68) |
| 6 | claude-flow / ruflo — мёртвый груз | **исправлено**: сервер и хуки выключены, allow-list переписан, 47 вендорных файлов удалены |
| 7 | Наблюдаемость | **исправлено**: `erp_client_errors` + запись из `lib/errorReport` + вкладка «Ошибки» |
| 10 | Типы клиента | **сторож вместо типизации**: `schemaNames.test.ts`, найдена несуществующая `generate_order_number` — **заведена** в сессии 68 (`20260924222445`, решение владельца) |
| 8 | 67 веток на GitHub | **за владельцем**: сессия не может пушить в чужие ветки; готовая команда — раздел «Ветки». Сессия 68: пуш тегов — 403 политикой прокси; классификация перепроверена на полной истории |
| — | Мусор вокруг кода | **убран**: 10 файлов + 44 вендорных, скилы переписаны; мёртвого кода в `src/` нет |
| 13 | Стражи по списку колонок | **исправлено** в сессии 68 для пяти: вложения, уведомления, план, этапы (`20260924231233`) и карточка SKU (`20260924235701`); `erp_material_guard` — не тот класс, решение владельца; `erp_dev_package_guard` — гейт полноты пакета, не разбор прав |
| 11 | Крупные файлы растут обратно | **ратчет** `fileSizeRatchet.test.ts` (сессия 68); резка — по касанию |
| 14 | FK `orders.erp_order_id` без индекса | **исправлено** (`20260924233145`); неиспользуемые индексы — через месяц |
| 9, 12, 15 | остальное | не начато: превью Vercel не сверялось; покрытие требует новой зависимости |

---

## Что в порядке (и трогать не надо)

- CI — настоящий гейт: audit → lint → guidebook → typecheck → 4683 unit →
  build → бюджет бандла → e2e (24 спеки) → visual (эталоны только через
  ручной dispatch). `.github/workflows/ci.yml`.
- TypeScript `strict`, 0 ошибок; 3 `any` вне тестов; 0 TODO/FIXME; 0 `console.log`.
- База: RLS на всех 57 таблицах, `for all`-политик нет, advisors
  `multiple_permissive_policies` / `auth_rls_initplan` / `rls_disabled` пусты,
  девять стражей, все `security definer` проверяют права. Журнал прода ↔
  `APPLIED.json` = 289 ↔ 289.
- Правила `CLAUDE.md` соблюдаются в коде, а не только записаны: `useShallow`
  везде, удаления неоптимистичны, ошибки через `erpQuery`.

---

## Находки по приоритету

### P0 — потеря данных и безопасность

**1. Бэкапа Storage не существует ни дня.** `storage-backup.yml` упал
57 раз из 57 (последний — 24.09 07:40 UTC): секреты `SUPABASE_URL` /
`SUPABASE_SERVICE_KEY` не заданы в GitHub. При этом `remove()` в бакете —
hard delete. Открыто с 30.07.
→ Задать два секрета в Settings → Secrets репозитория, запустить workflow
вручную, убедиться в зелёном прогоне. Кода не требует.

**2. Файлы техпакета карточки модели можно было потерять тремя путями.**
`erp_sku_card_files.file_path` — СНИМОК пути вложения разработки, копии
в бакете нет (`20260915034120_erp_dev_sku_card_on_ready.sql`, комментарий:
«удалённая разработка не имеет права унести с собой техпаспорт»). Строка
переживала удаление вложения, а объект — нет:
- `storage-gc` знал два носителя из трёх (список закрыт «проверкой 13.09»,
  карточки появились 15.09) — после удаления исходного вложения считал
  файл ничьим;
- `deleteOrder`, `deleteDevFile`, `deleteOrderAttachment` сносили объект
  по пути, не спрашивая второго носителя.
→ Сделано: третий носитель в `REFERENCES`; `freeOfSkuCards` в `store/shared.ts`
(ошибка чтения = ничего не убирать); три удаления идут через неё; сторож
`erp/utils/storageGc.test.ts` ВЫВОДИТ носители из миграций (каждая таблица
с `file_path`), а не проверяет известные имена; плюс проверка «всякая роль
с правом снимать файлы видит карточки» — иначе RLS отдала бы пустоту, и
объект ушёл бы как ничей. Обе половины проверены мутацией.

**3. `main` не защищён, и прямые пуши уже ломали прод.** `list_branches`:
`protected: false`. Коммиты `9c06c16`, `4aabad4`, `bae2062` ушли в `main`
мимо PR; `4aabad4` дал красный CI на `main` (run #439), а Vercel деплоит
на push независимо от CI (комментарий в `ci.yml`).
→ Branch protection: PR обязателен, required checks `test`/`e2e`/`visual`.
В Vercel — деплой только при зелёном CI (Ignored Build Step по статусу
или деплой из workflow).

**4. Leaked password protection выключен** — advisor
`auth_leaked_password_protection`, открыт с 27.07. Тумблер в Supabase Auth →
Password security.
→ ~~Сделано 24.09 (сессия 68) через Management API~~ — **не подтвердилось**:
advisor 26.09 (сессия 69) снова показывает выключено. Включить руками
в Dashboard → Authentication → Password security и перечитать advisor.

### P1 — надёжность процесса

**5. Память проекта разошлась с реальностью.**
- `SESSION-STATE.md` — «миграции `20260924*` НЕ ПРИМЕНЕНЫ». На бою применены
  все четыре (журнал прода 24.09), `APPLIED.json` их содержит, PR #176 так
  и говорит. Следующая сессия пошла бы применять повторно. **Поправлено.**
- `PROJECT.md` Roadmap — апрельский: «Фаза 2 — планирование производства»
  не отмечена, хотя `/plan`, `/gantt`, `/load` сделаны; «God-компоненты
  (>500 строк): 0» при `CreateOrderModal.jsx` = 1643.
- `CLAUDE.md` ссылался на `docs/2026-04-10-design-audit.md` — файла нет;
  «60 файлов» в `docs/rules/` — их 64. **Поправлено.**
- `SESSION-STATE.md` — 7548 строк, 79 секций по сессиям, дублирует
  changelog `PROJECT.md` (98 записей). Заголовок обещает «история
  в PROJECT.md», но хранит её сам.
→ Оставить в `SESSION-STATE.md` текущий блок (две последние сессии +
открытые долги), историю перенести в `docs/sessions/` одним файлом на сессию
(как сделано с правилами 15.09). Roadmap переписать под факт.

**6. claude-flow / ruflo — мёртвый груз, который стоил на каждом запросе.**
MCP-сервер не подключался ни в сессии 67 (таймаут 30 с), ни в сессии 53.
Реально использован один раз (сессия 15). При этом: 44 vendored-файла
в `.claude/helpers/` (472 KB), хуки на КАЖДОЕ событие (PreToolUse, PostToolUse,
UserPromptSubmit, Stop, PreCompact…), коммит `f1840e0` с шумом ±3502 строк
от самообновления, `settings.json` с путями `/Users/margolinilya/…`
и разовыми `git commit -m '…'` в allow-list. Тот же файл заранее разрешал
`apply_migration` и `execute_sql` — запись в боевую базу без подтверждения.
→ Сделано: `claude-flow` снят из `.mcp.json`; из `settings.json` убраны все
хуки, `CLAUDE_FLOW_*` и macOS-пути; allow-list переписан — чтение Supabase
остаётся, `apply_migration`/`execute_sql`/`deploy_edge_function` спрашивают
каждый раз. ~~**Не сделано (нужна рука владельца):** удалить
`.claude/helpers/`, `.claude/proven-config.json`, `.claude/.proven-config-version`
и `.claude-flow/`~~ — **удалены в этой же сессии** (сверка сессии 68: ни одного
из четырёх путей в репозитории нет; в таблице статусов — «47 вендорных файлов
удалены»). Абзац остался от черновика.
Это и есть ответ на «вышла новая модель»: у сильной модели главный рычаг —
чистый контекст и точные правила, а не роутер-надстройка, которая на каждый
запрос отвечала «Agent: coder, confidence 30%».

**7. Наблюдаемость есть наполовину.** Первая редакция этого пункта
повторила `docs/OPERATIONS.md` («`ErrorBoundary` пишет в консоль») и была
неверна: с июля `lib/errorReport.ts` шлёт отчёты из `ErrorBoundary`,
`window.onerror`, `unhandledrejection` и `erpQuery` на адрес
`VITE_ERROR_REPORT_URL`, с дедупликацией и потолком 20 на сессию. Без адреса
модуль молчит. Задан ли адрес в Vercel — проверить не удалось: у коннектора
нет права читать переменные проекта.
→ Встроенный приёмник без внешнего сервиса: таблица `erp_client_errors`
(вставка только вошедшим от своего имени, чтение — `staff.invite`, без
UPDATE и DELETE) и запись в неё из `reportError`, когда адреса нет.
**Состояние на конец сессии 67:** таблица создана на бою
(`20260924205222_erp_client_errors`) и проверена от лица роли в откатываемой
транзакции — чужой `user_id` отклонён, без права строки не видны. Файл
миграции, запись в `APPLIED.json` и клиентская запись НЕ сделаны: сессионный
классификатор отказал в обоих действиях. Репозиторий отстаёт от прода
на одну миграцию — см. `SESSION-STATE.md`.

**8. 50 веток `claude/*` на GitHub**, большинство смержены. Удалить
смерженные, включить auto-delete head branches в настройках репозитория.

**9. Превью-окружение** (по `OPERATIONS.md`, `VITE_SUPABASE_*` заданы только
для Production) — с Vercel НЕ сверялось; проверить перед тем, как чинить.

### P2 — код

**10. Сгенерированные типы не подключены к клиенту — и подключать их
целиком невыгодно.** `src/types/database.generated.ts` есть, но
`lib/supabase.ts` создаёт клиент без `<Database>`. Пробное включение
`createClient<Database>()` дало **93** ошибки типов; настоящих среди них две:
- `useOrdersStore` зовёт RPC `generate_order_number`, которой нет ни
  в миграциях, ни на бою. Номер заказа Order Studio всегда уходит в запасной
  `PH-<время>-xxxx` (на бою одна такая строка, последняя — 26.08);
- сам файл типов устарел: в нём ещё `released`, переименованный 24.09
  в `done_qty`.
Остальные 91 — шум: генератор помечает аргументы с умолчанием как
необязательные (`null` против `undefined`) и не знает формы JSON-ответов.
→ Сделано: включение откачено, вместо него сторож
`erp/utils/schemaNames.test.ts` — каждое имя в `supabase.rpc('…')`
и `supabase.from('…')` обязано быть объявлено в миграциях; проверен
мутацией в обе стороны. `generate_order_number` — в списке известных
расхождений до решения владельца: завести функцию или убрать вызов.
→ **Заведена 24.09 (сессия 68)** решением владельца: миграция
`20260924222445_order_studio_generate_order_number` читает ту же
`order_number_seq`, что и умолчание колонки, и умолчание переведено на неё;
обрезка `lpad` после 9999 устранена. Имя ушло из `KNOWN_MISSING`.
216 компонентов `.jsx` без типов — по-прежнему «новые `.tsx`, старые
по касанию».

**11. Крупные файлы растут обратно.** `CreateOrderModal.jsx` резали в июле
до 711 строк — сегодня 1643; `ItemBlock.jsx` 941 без единого теста;
`FabricPurchasing.jsx` 982; `stagesSlice.ts` 988.
→ Ратчет размера файла (тест по образцу `lintRatchet.test.ts`: потолок только
вниз) и резка по касанию, начиная с `ItemBlock`.

**12. Порога покрытия нет.** Без тестов рядом: `ItemBlock`, `SkuDetailModal`
(631), `PricingTabContent` (576), `EmployeesScreen` (435); `stagesSlice`,
`orderWriteSlice`, `chatSlice` — только косвенно.
→ `vitest --coverage` с порогом-ратчетом по строкам.

**13. Пять стражей из девяти — ещё «по списку колонок»** (`erp_stage_guard`,
`erp_attachment_guard`, `erp_calendar_guard`, `erp_material_guard`,
`erp_notification_guard`). Тот же класс дыры, что закрыли 24.09
у `erp_order_guard`.
→ Переводить на сравнение снимков строк по одному, каждый — с мутационным
сторожем, как в `20260924122634`.

**14. Advisors производительности:** 36 неиспользуемых индексов (20 из них
добавлены 24.09 — их статистику смотреть через месяц); FK `orders.erp_order_id`
без индекса; обёртка `(select …)` вокруг функций в политиках отложена
осознанно до роста таблиц — оставить.

**15. Мелочи:** четыре файла датных хелперов с пересекающимися именами
(`utils/date.ts`, `erp/utils/time.ts`, `format.ts`, `dateLocale.ts`);
95 предупреждений jsx-a11y под ратчетом и 35 кликабельных `div`/`span` без
`role`; `mobile-drag-drop` на `3.0.0-rc.0`; `agentation` в корневом
`package.json` `^2.3.3` против `^3.0.2` в приложении.

---

## Порядок оставшихся работ

1. **За владельцем, без кода (полчаса):** секреты бэкапа (1), защита `main`
   + гейт деплоя Vercel (3), тумблер паролей (4). Сверка сессии 68: секреты
   заданы, `main` защищена, тумблер включён; `git rm` вендорных файлов (6)
   не нужен — они удалены сессией 67. Открыто: гейт деплоя Vercel и
   публичность бэкапа (см. п. 1 в таблице статусов).
2. **Следующий PR:** `erp_client_errors` + плитка в админке (7); удаление
   смерженных веток (8).
3. **Затем:** перенос истории из `SESSION-STATE.md`, переписанный roadmap (5);
   `createClient<Database>` (10).
4. **По касанию, без отдельных PR:** ратчет размера файла (11), coverage (12),
   стражи по одному (13).

---

## Чем ошибалась разведка

Три утверждения агентов-разведчиков не прошли сверку и в выводы не попали:

1. «Миграции 24.09 не применены» — повторяла `SESSION-STATE.md`; журнал
   прода показал обратное. Документ-память — не источник истины о базе.
2. «Storage backup упал 5 из 5» — устаревшая запись от 03.08; живой счёт
   в Actions — 57 из 57.
3. «Supabase Preview красный на `main`» — так было; PR #176 прошёл зелёным
   целиком, включая эту проверку.

Правило то же, что записано в код-ревью 23.09: перед выводом о системе
сверять с живым источником, а не с прошлой формулировкой.

---

## Ветки (сверка 24.09)

Из сессии удалить не удалось: git-прокси пускает пуш только в рабочую
ветку сессии. Классификация — по статусу PR и по `git merge-base --is-ancestor`.
Сквош-мерж в `main` оставляет ветку «несмерженной» для git, поэтому
статус PR проверен отдельно.

| Группа | Сколько | Что теряется при удалении |
|---|---|---|
| Смержены (предок `main` или PR смержен) | 42 | ничего |
| Открытый PR | 4 | PR закроется; коммиты остаются в `refs/pull/N/head` |
| Без PR, есть несмерженные коммиты | 21 | коммиты — если не сохранить тегом |

Открытые PR (закроются): #90 `fix-mobile-readability` (11.04), #142
`login-error` (20.08), #155 `erp-visual-lag-test` (01.09), #163
`bencho-dev-integration` (12.09).

Без PR — крупнейшие: `redesign/v2` (58 коммитов, 07.05),
`erp-production-navigation-queue` (30, 28.07), `agent-erp-review`
(33 после мержа #161). Содержимое, скорее всего, уже в `main` сквошем,
но это не проверено построчно — поэтому сначала теги.

**Пересверка 24.09, сессия 68 — на ПОЛНОЙ истории** (облачный клон
неглубокий, 50 коммитов, и в нём `--is-ancestor` отвечает «не предок»
почти на всё — первая попытка насчитала 39 несмерженных вместо 23):
23 ветки — предки `main`; 19 — голова совпадает с головой последнего
смерженного PR (сквош); итого 42, а не 63, как стояло в таблице до
правки — три слагаемых (42 + 4 + 21) дают ровно 67 из списка на удаление.
Головы всех 21 ветки под тег совпадают с SHA в командах ниже. Сверх
списка смержена и `claude/opus-55-project-review-k6rbpp` (#177) — её
тоже можно удалить. Пуш тегов из сессии — 403 политикой прокси, поэтому
команда по-прежнему за владельцем.

Команда (локально, из клона с правом пуша):

```bash
git fetch origin --prune
# 1. Сохранить несмерженные ветки без PR тегами archive/*
git tag archive/claude/review-changes-mmbrxcm58mpbz6zb-DVbsI dc709e420e037bacc87396efd3dc18ab76f863a2
git tag archive/claude/add-agent-install-script-ObJfi 5bb68b8d76ba53fba8342bfb5236a3ef1086348c
git tag archive/redesign/v2 d5eeb0be6dcd5ec8f67b240e24a81af55679dde5
git tag archive/claude/archive-tz-project-n8xotb d54335622b316c45ab216bda3808f79933c1b316
git tag archive/claude/gstack-permission-setup-rh230j a41de8d6a4a0414fdecc465bb896e7ba03705a55
git tag archive/claude/pinhead-qa-security-audit-uqbu4c 6c9da936d093a97092ae080c5994621886f293bc
git tag archive/claude/warehouse-auto-fill-plan-hlvzf1 9cfbd87c89d5a70544ac8be0c64caacc969b49c6
git tag archive/claude/add-skills-to-projects-koogjf 6d0bf8492c8d68fbfa84d95145f12b73a0833c07
git tag archive/claude/erp-production-navigation-queue-ttnhzv 873315b7b9080452cbb47a3e9bbe78dfb0ede416
git tag archive/claude/comprehensive-project-testing-r8h941 be2599cc79c8b5dbefdea75f199023b83fce245f
git tag archive/claude/new-session-gandrj 6462b2d41f0a8e984ea6c0dde26d747ba97618d8
git tag archive/claude/registration-error-si9hjd 41a559b1aa5281007dbdf42a3b48360ee878c063
git tag archive/claude/project-slop-cleanup-qvsdcp 901650573f15b3dd773ae8253695beac856bcfa4
git tag archive/claude/erp-consilium-passport-nrzfz0 84f7c15961a4546a91c2ad0a5b251d08aadfe098
git tag archive/claude/project-improvements-jyygwo a618257305250fd11ced3b89c094b67b66ab1944
git tag archive/claude/full-project-review-ih7w4y 625dcb3618d2a7452bb0cba7c6b1942f986bf8c2
git tag archive/claude/erp-audit-apparel-production-k1omg0 90653b211e3c56ecacc66f11550bb85802475f30
git tag archive/claude/agent-erp-review-snjnyi 44e1aca6bb7875ea9f6719adea17b4bac45945e8
git tag archive/claude/erp-orders-cleanup-b2l464 3ae5b59c43845d79ba55acd7b9d56cee01b12b31
git tag archive/claude/remove-oil-from-project-6oah01 e26332544086ae812e7f01d6f1ff4f40f04da8e6
git tag archive/claude/new-edits-plan-ot5t9c bde50b797e4efad8c3d69656149841c7c20a5518
git push origin --tags
# 2. Удалить все ветки, кроме main и текущей
git push origin --delete \
  claude/gather-project-data-3XKzo \
  dev \
  claude/project-overview-jooe83 \
  claude/workshop-orders-usability-review-7uk82y \
  claude/manager-updates-60p2tl \
  claude/pinhead-erp-audit-optimize-7ol921 \
  claude/full-code-review-nft4ls \
  claude/erp-new-edits-gw2kf0 \
  claude/registration-error-check-6m9cvy \
  claude/project-updates-0vh0zg-route \
  claude/new-document-edits-knjwn4 \
  claude/erp-shop-implementation-ob9bek \
  claude/ui-ux-improvements-nx5hu8 \
  claude/frontend-design-skill-check-c778mz \
  claude/ux-ui-pro-max-skill-ksdfc6 \
  claude/review-updates-0709-zaaz3g \
  claude/install-all-skills-k44xbb \
  claude/erp-materials-price-error-ydm8z0 \
  claude/fixes-12-09-2v6ecs \
  claude/erp-design-markup-quality-9bhylo \
  claude/project-improvements-o4mlta \
  claude/skills-agents-chat-integration-xsrvcm \
  claude/fixes-20-09-k46sy9 \
  claude/continue-sku-implementation-3gSL2 \
  claude/dynamic-zones-per-sku \
  claude/mobile-sku-fixes \
  claude/sku-audit-fixes \
  claude/tests-dynamic-zones \
  claude/project-manager-edits-5bw6mj \
  claude/warehouse-auto-fill-plan-9f9bhq \
  claude/design-frontend-erp-agents-knwnh4 \
  claude/project-updates-0vh0zg \
  claude/new-edits-2zv77y \
  claude/new-edits-17cv96 \
  claude/new-edits-01-09-5r6eww \
  claude/new-edits-02-09-dd9d7f \
  claude/agentation-erp-integration-cjmv3n \
  claude/agents-erp-integration-audit-0b1ru0 \
  claude/plugin-marketplace-buildwithclaude-9c9gq8 \
  claude/правки-13-09-d1cgf6 \
  claude/pravki-21-9-opt8ul \
  claude/erp-code-review-pz0jpw \
  claude/review-changes-mmbrxcm58mpbz6zb-DVbsI \
  claude/add-agent-install-script-ObJfi \
  redesign/v2 \
  claude/archive-tz-project-n8xotb \
  claude/gstack-permission-setup-rh230j \
  claude/pinhead-qa-security-audit-uqbu4c \
  claude/warehouse-auto-fill-plan-hlvzf1 \
  claude/add-skills-to-projects-koogjf \
  claude/erp-production-navigation-queue-ttnhzv \
  claude/comprehensive-project-testing-r8h941 \
  claude/new-session-gandrj \
  claude/registration-error-si9hjd \
  claude/project-slop-cleanup-qvsdcp \
  claude/erp-consilium-passport-nrzfz0 \
  claude/project-improvements-jyygwo \
  claude/full-project-review-ih7w4y \
  claude/erp-audit-apparel-production-k1omg0 \
  claude/agent-erp-review-snjnyi \
  claude/erp-orders-cleanup-b2l464 \
  claude/remove-oil-from-project-6oah01 \
  claude/new-edits-plan-ot5t9c \
  claude/fix-mobile-readability-JjJwr \
  claude/login-error-ltwkzq \
  claude/erp-visual-lag-test-j6srb3 \
  claude/bencho-dev-integration-i6vyr3
```

После — включить **Settings → General → Automatically delete head branches**,
чтобы ветки не копились снова.
