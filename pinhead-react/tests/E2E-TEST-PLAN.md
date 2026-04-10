# Pinhead Order Studio — E2E Test Plan

**URL:** https://pinhead-os.vercel.app
**Обновлено:** 10.04.2026
**Тестов:** 33 сценария в 6 файлах (desktop + mobile)
**Стек:** Playwright

---

## Файлы тестов

### wizard-flow.spec.ts (3 теста)
- Полный flow: SKU → ткань → цвет → размеры → дизайн → позиции → детали → итог
- Блокировка шага "Детали" без имени клиента
- Блокировка навигации с несохранённым заказом

### wizard-extras.spec.ts (7 тестов)
- Extras accordion — открытие, выбор/снятие обработки
- Кнопка "Далее" disabled без количества
- Поиск SKU фильтрует список
- Фильтр по категории
- Фильтр по fit
- Переключение supplier tabs (Medastex / CottonProm)
- Accessory flow — тираж вместо размеров

### navigation.spec.ts (5 тестов)
- Wizard page загружается с шагом 1
- Kanban роут загружается
- Express калькулятор загружается
- Логотип возвращает на визард
- Keyboard shortcuts dialog (? → открытие, Закрыть → закрытие)

### kanban-actions.spec.ts (7 тестов)
- Поиск фильтрует карточки
- Type filter populated
- Stats bar показывает счётчики
- Клик по карточке открывает drawer
- "/" фокусирует поиск
- "n" переходит к новому заказу
- 5 колонок статусов рендерятся

### routes-smoke.spec.ts (6 тестов)
- /admin — загрузка интерфейса
- /analytics — загрузка dashboard
- /prices — загрузка таблицы цен
- /sku — загрузка каталога с табами
- /sku — переключение между 5 табами
- /print — загрузка preview

### visual.spec.ts (5 тестов)
- Screenshot regression: wizard, kanban, express, prices, sku

---

## Покрытие роутов

| Роут | Smoke | Functional | Visual |
|------|-------|------------|--------|
| `/` (wizard) | Yes | 10 тестов | Yes |
| `/orders` (kanban) | Yes | 7 тестов | Yes |
| `/express` | Yes | — | Yes |
| `/prices` | Yes | — | Yes |
| `/sku` | Yes | 1 тест (tabs) | Yes |
| `/admin` | Yes | — | — |
| `/analytics` | Yes | — | — |
| `/print` | Yes | — | — |

## Запуск

```bash
npm run e2e                           # Все тесты (desktop + mobile)
npx playwright test --project=desktop # Только desktop
npx playwright test e2e/wizard-flow   # Конкретный файл
```
