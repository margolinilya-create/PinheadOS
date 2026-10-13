# Правила сессии 39 (вторая половина): даты, разделение кода


- `utils/stagePlan` — `defaultPlannedEnd` (подстановка плана, одна на три
  формы) и `unplannedStages` (сколько открытых этапов без срока).
  `deptLoad.ordersWithoutPlan` надстроена над второй
- Общий диалог умеет поле-дату: `prompt.type = 'date'` + `prompt.initialValue`
  (`useConfirmStore` + `ConfirmDialog`). Заведено ради «Взять в работу»
  в закупке — своя форма рядом с кнопкой была бы вторым механизмом
- `store/slices/orderWriteSlice` — запись по заказу, доменный чанк.
  В `ordersSlice` осталось чтение; `orderFilePaths` и `orderBundleKey`
  экспортируются для него
- CSS раздела — ДВА модуля: `erp.module.css` (нужен и оболочке) и
  `screens.module.css` (только экранам). Экраны импортируют агрегатор
  `erp/styles.js` (Proxy-слияние, не спред). Границы разделения сторожит
  `erp/stylesResolve.test.ts`

