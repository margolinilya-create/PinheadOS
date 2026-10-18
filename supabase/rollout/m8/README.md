# Выкатка миграций вехи 8 — L, K, M

Файлы `*.sql` этой папки собирает `build.mjs` из миграций, проб и снимка
(`node supabase/rollout/m8/build.mjs`); руками не правятся — сторож
`pinhead-react/src/orderstudio/orderV4M8.test.ts` сверяет папку со сборкой.
План — `docs/superpowers/plans/2026-10-18-order-flow-m8-polish-enable.md`, задачи 2 и 12.

| Миграция | Файл | Кто применяет | Когда |
|---|---|---|---|
| L | `20261018150000_order_v3_readonly_staff_audit` | контроллер (MCP) | ДО выкладки фронта вехи 8 |
| K | `20261018160000_order_v4_zone_notes` | контроллер (MCP) | после фронта ревизии 4, не позже 30 минут |
| M | `20261018170000_catalog_legacy_keys` | владелец (SQL Editor) | в любой момент после снимка |

## Файлы

Каждый файл открывает транзакцию (`begin` + таймауты), первым блоком — предусловие (журнал
миграций и md5 `prosrc` функций на бою), иначе `raise exception` и ничего не меняется.

| Файл | Кто | Ожидание |
|---|---|---|
| `1-dryrun-L.sql` | контроллер | `PROBE_RESULT fails=0 total=35` (пробы `order_v3_readonly.sql`) |
| `1b-dryrun-L-regress.sql` | владелец | `fails=0 total=161` (пробы прав, в них удаление строк) |
| `4-dryrun-rollback-L.sql` | контроллер | L + K + откат L, `fails=0 total=13` |
| `2-apply-L.sql` | контроллер | `t | 20261018150000` |
| `4b-dryrun-rollback-L-after-apply.sql` | контроллер | откат поверх применённой L, `fails=0 total=13` |
| `3-rollback-L.sql` | контроллер | стражи — тело B + `notes`; журнал признаков выключен; `t | f` |
| `1-dryrun-K.sql` | контроллер | `fails=0 total=26` (пробы `order_v4_zone_notes.sql`) |
| `1b-dryrun-K-regress.sql` | владелец | `fails=0 total=161` |
| `4-dryrun-rollback-K.sql` | контроллер | K + откат функций, `fails=0 total=6` |
| `2-apply-K.sql` | контроллер | `t | 20261018160000` |
| `3-rollback-K-functions.sql` | контроллер | обёртка — тело D (порог 3); СНАЧАЛА он, потом откат фронта |
| `3b-drop-zone-id.sql` | владелец, по желанию | только после `3-rollback-K-functions.sql` |
| `1-dryrun-M.sql` | владелец | `fails=0 total=13` (пробы `catalog_legacy.sql`) |
| `4-dryrun-rollback-M.sql` | владелец | `ROLLBACK_M_OK` (значения после отката = снимок по md5) |
| `2-apply-M.sql` | владелец | `0 | 20261018170000` |
| `3-rollback-M.sql` | владелец | значения снимка обратно, прежняя политика чтения |

В файлах контроллера нет слов `drop`/`delete` вне комментариев и строк: MCP `execute_sql`
на них ждёт ручного подтверждения. Поэтому K не пересоздаёт `order_v4_save` (в её теле есть
удаление строк) — новые поля и порог ревизии 4 несёт `order_v4_save_full`; подробно — шапка K
и `supabase/probes/README.md`, раздел «Веха 8 — миграции L, K, M».

Откаты L и K не удаляют запись журнала (нет оператора удаления): после отката контроллер
ставит пометку в `supabase/migrations/APPLIED.json`; повторное применение — новой миграцией.
Мутации SQL (14, каждая — `fails>0`) — `node supabase/rollout/m8/build.mjs --mutations <каталог вне
репозитория>`, гоняет владелец или локальный шим.

`probes-after-rollback-L.sql` и `probes-after-rollback-K.sql` — пробы состояния после отката,
входят в `4-dryrun-rollback-*`; отдельно их можно прогнать после настоящего отката.
