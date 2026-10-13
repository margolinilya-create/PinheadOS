# Правила ERP (решения заказчика по матрице, сессия 29)


- Прав стало 16: добавлено `warehouse.manage` (движение складских задач).
  Гейт экрана склада — `useErpAccess().can('warehouse.manage')`, без права
  Drawer оборачивается в `ReadOnlyFieldset`. Тот же примитив у карточки
  разработки образцов — копий быть не должно
- `manager` получил `stage.move_department`; `production_head` — `catalog.edit`
  (подтверждённая правка заказчика). Все четыре решения закреплены поимённо
  в `permissionsCoverage.test.ts`, блок «решения заказчика по матрице»

