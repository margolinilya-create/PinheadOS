# Правила офлайна и планшета (сессия 39)


- Service worker — `public/sw.js` (ручной, без зависимости) + клиентская
  половина `lib/serviceWorker.ts`. Регистрация только при
  `import.meta.env.PROD`; отсюда проект `offline` в `playwright.config.ts`
  со своим сервером (`vite preview` из `dist-e2e`) и спека `e2e/offline.spec.ts`
- Компактная раскладка есть у ВСЕХ экранов с таблицами: к прежним пяти
  добавлены `screens/subcontracting/StageRowCard` (+ `StageFields`,
  `subcontractLabels`), `screens/DeptLoadCard` (карточка на ЦЕХ с лентой
  недели — здесь матрица, а не список), `screens/experimental/DevRowCard`,
  `screens/admin/EmployeeCard` + `LooseEmployeeCard` (+ `EmployeeFields`),
  `screens/admin/DeptCard` (+ `DeptFields`). Сторожа — `e2e/erp-tablet.spec.ts`
- `buildDeptLoad` возвращает `totals` («планируют ли вообще»): считается
  по ВСЕМ открытым этапам, без оглядки на видимую неделю. Пока `planned = 0`,
  `/load` прямо говорит, что загрузка не рассчитывается
- Мок Supabase умеет `profiles` и `erp_employees` — без них экран сотрудников
  показывал бы пустое состояние, и проверять было бы нечего

