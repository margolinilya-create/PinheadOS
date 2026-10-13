# Правила ERP (документ 20.08, сессия 33)


- Подряд: `utils/subcontractFlow.ts` — вычисляемые фазы («Запланировано»,
  «Готово к передаче — N шт» считаются из `stageInputQty`, хранимая фаза
  двигается с ПЕРЕДАЧИ) + `SUBCONTRACT_ACTIONS`. Селекта фазы нет: им можно
  было объявить операцию завершённой, не записав ни одного перемещения
- Действия подряда идут ОДНИМ RPC `erp_subcontract_apply`: журнал, фаза
  и легаси-зеркало `status` одной транзакцией. Приёмку делает СКЛАД
  (`screens/warehouse/SubcontractReceiptCard`) — она пишет журнал `accept`
  и только потом закрывает задачу; неудачная запись задачу не закрывает
- Файлы подрядного этапа: `uploadStageFile`/`deleteStageFile`
  (`subcontractingSlice`) для существующего этапа, `stage_key` → `stage_index`
  для формы создания. Разметка одна — `RouteFields` со слотом `renderStageFiles`
- ЭКС: `utils/experimentalBoard.ts` (шаги доски, гейт кроя, состояния дорожек),
  `utils/finalPackage.ts` (перечень недостающего для «Готово к серии»),
  `reworkPlan` в `utils/experimentalTasks` (доработка ПО ОБЛАСТЯМ, и та же
  функция формулирует текст последствий). Доска — `screens/experimental/DevBoard`,
  внутренние виды — `DevViews` (отбор `buildQueueEntries` по `origin`)
- Лист закупки: файл менеджера (`purchase_list`) либо отметка
  `purchase_required = false`; проверка — в `validateOrderForm`. Отметка
  вырезает `supply` из маршрута (`buildItemRoute({ needsPurchase })`), и заказ
  не попадает к закупщику ПО ПОСТРОЕНИЮ
- Участок DTG заведён полноценным цехом брендирования (`data/departments`,
  `BrandingMethod`, `BRANDING_DEPT`, матрица прав, справочники) — документ
  называет его и в маршруте, и среди видов ЭКС

