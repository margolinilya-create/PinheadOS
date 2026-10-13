# Правила сессии 44 (документ 01.09, вторая итерация): где что лежит


- Гейт «с Нанесений нельзя дальше» — отказ `branding` в `devMoveIntent`;
  признак `brandingOpen` считает `Experimental.brandingOpenByDev` по
  `DEV_BRANDING_TASK_TYPES` (зеркало формулы `erp_dev_branding_advance`)
- Какой этап закрыть переносом — `utils/devOwnStage` (`DEV_OWN_STAGE_DEPT`,
  `devOwnStageToClose`, `devStageRemainder`). Нанесений в таблице НЕТ
  осознанно. Вызов — `Experimental.closeOwnStage`, ДО записи колонки,
  через `reportProgress(stageId, остаток, { comment })`
- `reportProgress` принимает третьим аргументом `{ comment }`: автозакрытие
  переносом пишет тот же журнал, и «Частичная готовность» там было бы неправдой
- Переиспользование этапа — миграция `20260901114501`
  (`erp_experimental_task_send` + триггер `erp_experimental_task_sync` без
  `origin`); сторож — `utils/devStageReuse.test.ts`, читает текст миграции
- Блок финального пакета на шаге — `FinalPackageWork` в `DevStageRoute`;
  перечень и прогресс из `utils/finalPackage`, второй формы не заводится
- `BASE_CHAIN.samples` без `vto`; это проверяют `routes.test.ts`
  и `routeWalk.test.ts` — сторожей ДВА, и оба фиксировали прежнее поведение
- Мок Supabase отвечает на `erp_experimental_add_tasks`
  и `erp_experimental_task_send`, храня задачи в `createdTasks`

