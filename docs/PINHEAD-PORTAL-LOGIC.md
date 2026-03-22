# PINHEAD Order Studio — Логика этапов визарда

## Этап 3 — Дизайн (зоны нанесения)

**Файл:** `src/components/steps/StepDesign.jsx`

### Доступные зоны
`['front', 'back', 'sleeve-l', 'sleeve-r', 'hood']` — фильтруются по `sku.zones`

### Данные в store
| Поле | Тип | Описание |
|------|-----|----------|
| `zones` | string[] | Выбранные зоны |
| `zoneTechs` | `{ zone: tech }` | Техника по зоне |
| `zonePrints` | `{ zone: { size, colors, textile, fx } }` | Шелкография |
| `flexZones` | `{ zone: { size, colors } }` | Флекс |
| `dtgZones` | `{ zone: { size, textile } }` | DTG |
| `embZones` | `{ zone: { area, colors } }` | Вышивка |
| `dtfZones` | `{ zone: { size } }` | DTF |

### Пять техник нанесения

1. **Шелкография (screen)**
   - Параметры: формат (A4/A3/A3+/Max), цвета (1–8), текстиль (white/color ×1.3), спецэффект (none/stone/puff/metallic/fluor ×2)
   - Матрица цен по тиражу: [50, 100, 300, 500, 700, 1000]
   - Минимум 50 шт — предупреждение + подтверждение

2. **Флекс (flex)**
   - Параметры: формат (A6/A5/A4/A3), цвета (1–3 max)
   - Тиражная матрица: [<20 single, 20+, 35+, 50+]

3. **DTG (Direct-to-Garment)**
   - Параметры: размер (A6–A3+), текстиль (white/color)
   - Базовая цена + формат + белая подложка для цветного

4. **Вышивка (embroidery)**
   - Параметры: площадь (S ≤7 см / M ≤12 см / L ≤20 см), цвета нитей (1–20)
   - Базовая ~350₽ + площадь + доп. цвет ×20₽

5. **DTF (трансфер)**
   - Параметры: размер (A6–A3+)
   - Базовая ~180₽ + формат

### UI-компоненты
- **Zone Cards Grid** — toggle зон; активные показывают мини-сводку
- **ZoneMockup** — SVG-превью изделия с активными зонами
- **ZoneTechBlock** — параметры техники для каждой зоны
- **LabelConfigurator** — настройка бирок (составник/основная/хэнгтег)

### Валидация
- Минимум 1 зона ИЛИ включён `noPrint`
- Шелкография + тираж < 50 → баннер-предупреждение

---

## Этап 4 — Позиции (multi-SKU)

**Файл:** `src/components/steps/StepItems.jsx`

### Структура данных
```javascript
items: [
  {
    type, fabric, color, sku,
    sizes: { XS: 5, S: 10, M: 15 },
    customSizes: [{ label: 'Custom L', qty: 2 }],
    fit, extras[], zones[], zoneTechs{}, ...
  }
]
activeItemIdx: number  // -1 = новая позиция
```

### Операции (itemsSlice)
| Действие | Логика |
|----------|--------|
| `addNewItem()` | Очистить поля, `activeItemIdx: -1`, перейти на шаг 0 |
| `editItem(idx)` | Загрузить `items[idx]` в форму, перейти на шаг 2 |
| `removeItem(idx)` | Удалить из массива, скорректировать `activeItemIdx` |
| `saveCurrentItem()` | Snapshot текущей формы → `items[activeItemIdx]` или push |

### Snapshot / Restore
- `snapshotItem(state)` — глубокая копия 23 ITEM_FIELDS
- `restoreItem(item)` — загрузка снапшота обратно в поля формы
- Автоматический snapshot при переходе шаг 2 → 3

### Таблица позиций
| Колонка | Содержимое |
|---------|-----------|
| Позиция | `#N` + название SKU |
| Кол-во | `getItemTotalQty(item)` |
| Цена/шт | `getItemUnitPrice(item, catalogs)` |
| Сумма | `calcItemTotal(item, catalogs)` |
| **Итого** | Сумма всех позиций |

### Валидация
- Минимум 1 позиция для перехода далее

---

## Этап 5 — Детали

**Файл:** `src/components/steps/StepDetails.jsx`

### Поля формы
| Поле | Тип | Валидация | Примечание |
|------|-----|-----------|------------|
| Роль | Enum (manager/client/partner) | — | Информационное |
| Имя / Компания | Text (100) | **Обязательное** | `sanitizeText()` |
| Контакт | Text (100) | — | @telegram или телефон |
| Email | Email | `validateEmail()` | Опционально, если задано — валидно |
| Телефон | Tel (20) | `validatePhone()` | Опционально, если задано — валидно |
| Мессенджер | Text | — | @username |
| Bitrix Deal | Text | — | BX-XXXXX |
| Дедлайн | Date | — | ISO string |
| Адрес | Text (200) | — | Свободный формат |
| Примечания | Textarea (500) | — | Доп. информация |

### Опции с наценкой
| Опция | Наценка | Store |
|-------|---------|-------|
| Инд. упаковка | +15 ₽/шт | `packOption: bool` |
| Срочное производство | +20% | `urgentOption: bool` |

### Валидация
- `name.trim().length > 0` — обязательно
- Email и телефон — только если заполнены
- Ошибки отображаются баннером

---

## Этап 6 — Итог

**Файл:** `src/components/steps/StepSummary.jsx`

### Блоки на каждую позицию
1. **Изделие** — SVG mockup, крой, ткань, цвет, тираж
2. **Размеры** — распределение по размерам + кастомные
3. **Зоны нанесения** — `getZoneTechSummary()` по каждой зоне
4. **Обработки** — extras с ценой/шт
5. **Бирки** — `getLabelsSummary(labelConfig)`
6. **Цена позиции** — цена/шт × кол-во = итого

### Блок клиента
- Все поля из этапа 5 + кнопка «Редактировать»

### PriceBreakdown (раскрывающийся)
Порядок расчёта цены:
1. Базовая цена SKU = пошив + ткань + фурнитура
2. \+ Обработки (за шт)
3. \+ Бирки (за шт)
4. \+ Нанесение (за зону за шт)
5. − Скидка за объём (%)
6. \+ Упаковка (если вкл, за шт)
7. × Срочность (если вкл, +20%)
8. × Кол-во = **Итого**

### Сохранение заказа
1. Сериализация items (strip полных SKU → только `{ code, name, article, category, fit, zones, mockupType }`)
2. Формирование `orderData` с плоскими полями первой позиции (backward compat)
3. **Новый заказ:** `saveOrder(orderData)` → RPC `generate_order_number()` → INSERT в `orders`
4. **Обновление:** `updateOrder(_editingOrderId, orderData)` → UPDATE
5. Очистка `localStorage.pinhead_draft`

### buildTZText
Генерирует форматированный текст ТЗ для копирования:
```
━━━━━━━━━━━━━━━━━━━━
✳ PINHEAD ORDER STUDIO
ТЗ #PH-XXXX
━━━━━━━━━━━━━━━━━━━━
ПОЗИЦИЯ #1
Тип: Tee [code-123]
Размеры: S — 10 шт, M — 15 шт
Нанесение: Передняя: Шелкография
...
КЛИЕНТ
Имя: ...
ИТОГО: 22,500 ₽
```

### Экран успеха
После сохранения: «✳ ЗАКАЗ СОХРАНЁН» с кнопками:
- Скопировать ТЗ
- Печать / PDF
- Все заказы (→ канбан)
- Новый заказ (reset)

---

## Ключевые функции ценообразования

| Функция | Назначение |
|---------|-----------|
| `getZoneSurcharge(zone, state)` | Цена нанесения за зону/шт |
| `getTotalSurcharge(state)` | Сумма всех зон |
| `calcTotal(state)` | Полная стоимость позиции |
| `calcTotalBreakdown(state)` | Разбивка по компонентам |
| `getUnitPrice(state)` | Цена за единицу |
| `calcItemTotal(item, catalogs)` | Для multi-item |
| `getTotalQty(state)` | Суммарное кол-во |
| `getLabelConfigPrice(labelConfig)` | Стоимость бирок/шт |
| `getVolumeDiscount(qty)` | Скидка за объём (%) |
