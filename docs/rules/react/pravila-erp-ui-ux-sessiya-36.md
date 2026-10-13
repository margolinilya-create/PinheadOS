# Правила ERP (UI/UX, сессия 36)


- Компактная раскладка экранов с таблицами — `useCompactLayout()` + карточки:
  `screens/warehouse/WarehouseTaskCard`, `screens/purchasing/PurchaseRowCard`
  рядом с прежними `QueueCard` и `OrderCardMobile`. Вид — семейство
  `.dataCard*` в `erp.module.css`, `.orderCardM*` его `composes`
- Содержимое колонок закупки — `screens/purchasing/PurchaseFields` (одно
  на таблицу и карточку), подписи и группы — `purchasing/purchaseLabels`
  (константы отдельно от компонентов: `react-refresh/only-export-components`)
- Главное действие карточки — `Button block`, своего класса не заводить:
  примитив уже даёт ширину и ≥44px на тач-экранах
- Состояния экрана: `LoadFailed` → `TableSkeleton` → `EmptyState`/`EmptyResult`.
  Скелетон вешать на `!loaded && !loadError`. `employeesError` в сторе заведена
  ровно для этого: у `loadEmployees` сбой не поднимал `employeesLoaded`,
  и экран оставался пустым навсегда
- Сторож токенов — `src/styles/tokens.test.ts`: ни одного `var(--x, фолбэк)`,
  каждый `var()` на объявленный токен. Комментарии он снимает (объяснение
  «почему фолбэка больше нет» содержит те же слова, что и фолбэк)
- `contrast.test.ts` читает и `index.css`, и блоки `.shell` в `erp.module.css`
- Тема — `hooks/useTheme`: `prefers-color-scheme` при отсутствии выбора,
  запись в localStorage только из тумблера
- CSS Order Studio импортируют `orderstudio/OrderStudioApp` и
  `components/auth/AdminPanel`, а не глобальный `styles/index.css`

