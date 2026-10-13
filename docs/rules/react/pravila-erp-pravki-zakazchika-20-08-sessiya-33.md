# Правила ERP (правки заказчика 20.08, сессия 33)


- Подряд: поля этапа заполняются в конструкторе маршрута (`components/RouteFields`),
  превращение шага в поля сервера — единственное выражение `stepPayload`
  (`utils/routeDraft`). Движение операции — действия
  (`screens/subcontracting/StageActions`), не селект фазы; вычисляемые фазы
  и доступные действия — `utils/subcontractFlow`
- Приёмка подряда — задача склада на КАЖДЫЙ подрядный этап
  (`screens/warehouse/SubcontractReceiptCard`): «принято» пишет журнал `accept`,
  который приращает `qty_done` этапа и открывает следующий
- Лист закупки: файл менеджера (`purchase_list`) либо отметка «Закупка
  не требуется» — проверяет `validateOrderForm`. Резолюция файла —
  `utils/attachments.purchaseListFile`; маршрут вырезает `supply` при
  `needsPurchase = false` (`utils/routes.buildItemRoute`)
- ЭКС: доска по этапам — `utils/experimentalBoard` (шаг задачи, гейт кроя,
  состояния шагов, колонка разработки) + `screens/experimental/DevBoard`.
  Внутренние виды — `screens/experimental/DevViews`: свои очереди читают
  ЗАДАЧИ, нанесения — `buildQueueEntries` с отбором по `origin`
- ЭКС: доработка по областям — `utils/experimentalTasks.reworkPlan` (задачи
  и текст последствий считает ОДНА функция), интерфейс —
  `screens/experimental/DevSampleCheck`. История доработок — плоский список
  (`reworkHistory`): круг считает сервер по ТИПУ задачи, и группа по номеру
  собрала бы неполный круг
- ЭКС: финальный пакет — `utils/finalPackage` (перечень недостающего) +
  `screens/experimental/DevFinalPackage`. Файлы принадлежат разработке
  (`experimental_id`), виды `dev_pattern | dev_passport | dev_photo`
- Вид раздела ЭКС — в QUERY (`?view=`), а не подпутём: `canOpenScreen`
  перечисляет ИСКЛЮЧЕНИЯ и открывает незнакомый путь, поэтому
  `/experimental/dtf` был бы доступен всем, включая цех без права
- **E2E больше НЕ ЗАВИСИТ от `.env`** (правка 31.08): фиктивные ключи
  Supabase задаёт сам `playwright.config.ts` обоим серверам
  (`MOCK_SUPABASE_ENV`), и переменные процесса у Vite сильнее файла — прогон
  не может уйти на живой проект даже с боевым `.env` на машине. Прежде
  ключей не было → `lib/supabase.ts` бросал на уровне модуля, до React,
  и падал ВЕСЬ прогон белым экраном с «element(s) not found» у каждого
  локатора: свежая машина, чистый клон или пересозданный контейнер давали
  полностью красный e2e. Сторожит `src/lib/e2eEnv.test.ts` (в `src/`:
  vitest исключает `e2e/**`). Сеть по-прежнему перехватывает
  `e2e/support/mockSupabase`
- Спека, которой нужен этап образца, заводит СВОЙ заказ
  (`installSupabaseMock(page, { orders })`): базовые четыре держат
  visual-эталоны и счётчики очередей

