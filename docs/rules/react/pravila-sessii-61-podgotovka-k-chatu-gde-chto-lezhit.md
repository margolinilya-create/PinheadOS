# Правила сессии 61 (подготовка к чату): где что лежит


- **Персональные уведомления** — `erp_notifications` (миграция
  `20260914214651`), слайс `store/slices/notificationsSlice.ts` В ЯДРЕ
  (счётчик показывает колокол шапки, то есть до открытия любого экрана),
  тип `ErpNotification` в `erp/types.ts`, разбор для центра —
  `utils/notifications.personalNotices` рядом с `orderNotices`. Группа
  «Вам написали» стоит ПЕРВОЙ и развёрнута, значит попадает в `urgentCount`
  и считается колоколом. Писателя пока нет: им станет `erp_chat_send`
- **Строка виджета уведомлений** — `NoticeRow` в `screens/ErpDashboard.jsx`:
  персональное ведёт по своему адресу (`notice.to`) и гаснет по ПЕРЕХОДУ,
  а не по показу. Локальный список строк виджета называется `notices` —
  `notifications` занято списком строк таблицы из стора
- **Сторожа** — `utils/notificationsGuard.test.ts` (RLS: читает только
  адресат, INSERT-политики нет вовсе, страж правит только `read_at`; виды
  в CHECK и в типе совпадают; обнуляемость колонок повторена) и блок
  `personalNotices` в `utils/notifications.test.ts`
- **`realtimeCoverage.test.ts` видит и RPC**: таблицы собираются ещё
  и из тел функций, вызываемых стором (`rpcTables`), имена сверяются
  с `tableNames()` из `types/schema.testutil.ts`. Журналы приёмок, отгрузок,
  результатов этапа и аудита названы в `NO_REALTIME` с причиной «итог лежит
  в подписанной таблице»
- **Загрузки заказов по требованию** — `store/slices/ordersOnDemandSlice.ts`
  (архив, `loadOrderBundle`, `findOrdersByBitrixId`, `loadOne`): доменный
  чанк, приезжает с первым экраном. В ядре остался `loadAll` — им живут
  бейджи, счётчики цехов и колокол. Что оболочка не зовёт вынесенное,
  сторожит `store/domainSlices.test.ts`, блок «оболочка не зовёт загрузки
  по требованию»

