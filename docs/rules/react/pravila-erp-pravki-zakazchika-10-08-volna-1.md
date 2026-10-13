# Правила ERP (правки заказчика 10.08, волна 1)


- Роли: коды в БД неизменны, меняются подписи (`EMPLOYEE_ROLE_LABELS` в `erp/types.ts`).
  Новые роли — `technologist` + участки `dtf`/`silkscreen`/`embroidery`; у участков
  права как у `worker`, различает их привязка `erp_employees.department_id`
- ОТК: `buildRoute` больше не добавляет `qc`, поля `needs_qc` нет, цех деактивирован
- Аварийное снятие блокировок — `erp_bypasses` + `utils/bypass.ts`. Применяется
  в местах сборки гейта (`queueEntries`, `ordersSlice.shipOrder`), а не внутри
  `isStageReady`/`waitingReason`: они принимают материалы и «нет ТЗ» параметрами
- Пометка «Проверка снята вручную» ставится только там, где снятие повлияло —
  `buildQueueEntries` пересчитывает готовность по настоящим данным и сравнивает
- Пропуск этапа (`skipped`) — под `order.manage`, с обязательной причиной;
  в `erp_stage_guard` у него своя ветка (раньше переход не проверялся вовсе)

