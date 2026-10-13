# Правила сессии 47 (аудит ERP 03.09): где что лежит


- Гейт завершения этапа — `store/slices/stagesSlice.completionBlockFor`; зовут
  ВСЕ три писателя статуса (`setStageStatus`, `reportProgress`,
  `submitStageReport`). Серверное зеркало — `erp_stage_completion_block`
  (миграция `20260903203310`), поднимает `P0001` тем же текстом. Сторож —
  `store/stageCompletionGate.test.ts` (поведением, не текстом)
- Плановая дата и исполнитель при входе в работу пишутся ТЕМ ЖЕ UPDATE, что
  и статус (`setStageStatus`, ветка `in_progress`): отдельная запись идёт
  под `order.manage`, которого у цеховых ролей нет
- Сырые строки в localStorage — `lib/storage.storageGetRaw`/`storageSetRaw`
  (ключи хранят `'1'`, `'queue'`, код цеха; `storageGet` делает `JSON.parse`
  и вернул бы дефолт всегда). Интерфейсные обращения к `localStorage` идут
  через них — падение хранилища не должно ронять оболочку белым экраном
- `document.title` ведёт `components/PageHead`: он один на все экраны раздела
- `ScrollHintBox` принимает `role` — нужен там, где у содержимого своя
  семантика (`StageIndicator` вида `dots`: дети объявлены `listitem`)
- Компактные списки карточек несут `role="list"` + `role="listitem"` —
  иначе `aria-label` контейнера не читается (`purchasing/SupplyQueue`,
  `experimental/DevDeptQueue`)
- Автопроверка доступности — `e2e/erp-axe.spec.ts` (12 экранов, уровни A и AA,
  проекты `desktop` и `mobile`). Ратчет `KNOWN` пуст; запись в нём обязана
  нести причину
- Локаторы спек, которые ходят и по таблице, и по карточке, берут объединение:
  `supplyRow` в `erp-supply.spec.ts` — образец (`region`∪`list`,
  `row`∪`listitem`, имя кнопки `/^Открыть/`)
- Компактная раскладка очереди закупки покрыта `e2e/erp-tablet.spec.ts`
  («очередь заказов рисуется карточками, действие во всю ширину и ≥44px»)

