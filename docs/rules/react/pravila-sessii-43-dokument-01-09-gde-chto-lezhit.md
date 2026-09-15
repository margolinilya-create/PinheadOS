# Правила сессии 43 (документ 01.09): где что лежит


- Шагов доски ЭКС ШЕСТЬ: `patterns · materials · cutting · branding · sewing ·
  final` (`DEV_STAGE_ORDER`). `materials` — «Ожидает материалы», ключ отличается
  от дорожки `awaiting_materials` намеренно. CHECK базы сверяет с клиентом
  `utils/devBoardStage.test.ts`, миграция — `20260901053949`
- Вход в «Крой» держат ДВА условия: `cuttingGate({ …, supplyOpen })` —
  материалы позиции (`isMaterialPending`) И открытый этап закупки заказа
  (`utils/supply.openSupplyStages` + `findSupplyDept`). Контекст считают
  экраны: `Experimental` строит `supplyOpenByOrder` и `brandingByItem` рядом
  с `materialsByOrder`, `DevCard` и `DevPage` — из своего `order`
- Что применимо к конкретной разработке — `utils/devBoardMove.devStagePath`.
  Её зовут и `devMoveIntent` (запрет перескока, отказ `sequence` с `expected`),
  и `neighbourStage` (кнопки «‹ ›»). Текст отказа собирает
  `devMoveRefusalText`, а не таблица: `sequence` обязан НАЗЫВАТЬ пропущенный шаг
- `devStageStates` принимает `supplyOpen` и `hasBranding`; шаг `materials`
  разбирается своей веткой ВЫШЕ общих (задач у него не бывает, и `workLater`
  объявил бы его перепрыгнутым). `hasBranding` делает «Нанесения» применимыми
  ДО заведения первой задачи — иначе запрет п. 2 не на что опереть
- `devMovePrompt` спрашивает техническое название лекал на ЛЮБОМ ходе вперёд
  с `patterns` (в стоянку и в крой), а не только в «Крой»
- E2E-сторож последовательности ходит настоящим HTML5-броском (`dragCard`
  в `erp-experimental.spec.ts`): кнопками этот запрет не нарушить

