# Правила сессии 59 (правки 13.09): где что лежит


- **Результат этапа файлом** — `erp/utils/stageResult.ts` (`isFileResultStage`,
  `stageResultFiles`, `stageResultFileBlock`, перечисление `FILE_RESULT_KINDS`).
  Модуль-лист; читают его `utils/stageDone` (снимает количественное
  предупреждение), `store/slices/stagesSlice.completionBlockFor` (гейт файла
  у ПИСАТЕЛЯ, ДО проверки «добирает тираж»), `screens/queue/useStageActions.onDone`
  (не пишет `qty_done` вовсе), `StageActionsPanel` (форма и снятая кнопка
  брака), `QueueRow` (вместо процента — состояние файла) и `ProductionTask`.
  Сторож — `utils/stageResult.test.ts`, с мутацией на снятый признак
- **Комментарий по проработке** — `utils/devBoardMove.devNotePrompt` (вопрос,
  `required: false`) + `utils/devNote.ts` (`isBrandingDept`, `stageBrandingNote`
  — кому его показывать) + `hooks/useDevStageMove` (пишет ДО колонки, рядом
  с названием лекал). Колонка `erp_experimental.branding_note` едет эмбедом
  `developments` в ОБЕИХ выборках заказа; показывают `StageActionsPanel`
  (задание цеха нанесения) и `experimental/DevAside` (справка разработки).
  Сторож — `utils/devNote.test.ts`
- **Экран задания** — `screens/ProductionTask`: лента `taskKeyFacts`/
  `taskKeyFact` и компактная строка файлов `taskFileRow` объявлены
  в `screens.module.css`. Пустые поля не рисуются вовсе; исключение —
  «не закреплено» у исполнителя. Сторож — `screens/ProductionTask.test.jsx`,
  блок «раскладка 13.09»
- **Три уровня управления ЭКС** — `screens/Experimental`: `STATE_FILTERS`
  (постоянная строка состояний), `RARE_STATES` (в панели «Фильтры»),
  `BASE_VIEWS` (`board`/`queue` — переключатель вида), `STAGE_VIEWS`
  (фильтры по этапам). Вида `list` и компонента `DevRowCard` больше нет.
  `FILTERED_VIEWS` схлопнулся до одной доски. Сторож —
  `screens/Experimental.test.jsx`
- **Открытие из списков задач** — ссылка на `/task/:stageId` НА НАЗВАНИИ
  СДЕЛКИ в `queue/QueueRow`, `queue/QueueCard`, `experimental/DevDeptQueue`
  и `experimental/DevViews`; кнопок «Открыть» там нет. Карточку доски ЭКС
  открывает ссылка на `/experimental/:devId` в `experimental/DevBoard`.
  Сторожа — `screens/DepartmentQueue.test.jsx` (обе раскладки)
  и `e2e/erp-queue.spec.ts`
- **Шапка без глобального поиска** — `layout/ErpLayout`; сторож
  `layout/ErpLayout.test.ts` держит ОБЕ половины требования: поля в шапке
  нет, поиск на «Заказах» остался. `useErpSearch` теперь стор одного экрана

