# Правила сессии 41 (документ 24.08): где что лежит


- Закупка: подписи величин — `purchasing/purchaseLabels.PURCHASE_FIELD_LABELS`
  (одна на величину, читают шесть файлов); автостатус «Заказано» —
  `utils/materialStatus.autoOrderedStatus`, зовут оба писателя в
  `materialsSlice`; подпись состояния — `SUPPLY_STATE_BADGE` рядом
  с `supplyState` в `utils/supply`
- Финальный пакет: `utils/finalPackage.wantsSkuCard` — идёт ли модель
  в каталог; от него зависит, обязательны ли поля карточки SKU. Серверное
  зеркало — `erp_pkg_flag(final_package, 'add_to_sku')`
- ЭКС как участок маршрута: `EXPERIMENTAL_DEPT_CODE` в `utils/routeDraft`,
  строки очереди — `utils/experimentalQueue` (читают вид «Очередь участка»
  и сам экран, решающий, показывать ли переключатель видов)
- Канбан ЭКС: колонка — `erp_experimental.board_stage`, читает
  `devBoardColumn` («ручное → иначе расчёт»); смысл переноса —
  `utils/devBoardMove` (одна логика на бросок и на кнопки «‹ ›»);
  дорожка карточки — `laneOf` в `DevBoard` с фолбэком `waiting`
- Нанесения: `DEV_BRANDING_CHOICES` (что предлагаем) и
  `DEV_BRANDING_TASK_TYPES` (что считает автопереход) в
  `utils/experimentalBoard`; выбор — `experimental/DevBrandingPicker`;
  переход в «Пошив» — серверный `erp_dev_branding_advance`
- Задачи разработки: файл через `uploadDevFile({ …, taskId })`, вид
  вложения `dev_task`; активные и завершённые разделяет сам
  `DevTasksSection`
- Подряд: задача склада `subcontract_send` (`warehouse/SendToContractorCard`),
  единственный писатель — `erp_ensure_subcontract_send`; признак
  «операция при этапе» — `SubcontractView.hasStage`, им же снята кнопка
  запуска у маршрутного подряда
- Карточка разработки: вкладки — `experimental/DevCardTabs` (свой префикс
  `dev-tab-*`), постоянная справка — `experimental/DevAside` (блокер,
  следующее действие, материалы — видны на любой вкладке), реестр вложений —
  `experimental/DevFilesTab`. Раскладка — `.devLayout` в `screens.module.css`.
  `DevPage` дозагружает ПОЛНЫЙ заказ (`loadOne` по `detailIds`): размерный ряд
  живёт в `size_grid`, которого нет в списочной выборке
- Запоздавший ответ загрузчика раздела не затирает то, что наполнил другой
  путь: снимок флага берётся ДО ожидания, правило — `store/shared.arrivedLate`,
  зовут ОБА загрузчика обоих разделов (`experimental`, `subcontracting`)

