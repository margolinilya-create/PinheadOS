# SKU как центр управления ТЗ — Дизайн-документ

## Контекст

SKU-редактор управляет 5 каталогами (изделия, ткани, отделка, обработки, фурнитура), но не является полноценным центром управления формирования ТЗ. Ценообразование живёт отдельно (PriceEditor), визард не знает об ограничениях SKU, менеджеры тратят время на ручной выбор и допускают ошибки.

**Проблемы:**
1. Много ручного выбора в визарде (ткань/цвет/обработки каждый раз с нуля)
2. Ошибки в ТЗ (несовместимые комбинации ткань + техника)
3. Непрозрачные цены (менеджер не понимает откуда цена)

**Решение:** Подход B — "Правила категорий" с per-SKU overrides, 4 фазы.

## Архитектура

### Новая сущность: CategoryRules

```typescript
interface CategoryRules {
  categoryId: string;              // 'hoodies', 'tshirts', ...
  allowedTechs: string[];          // ['screen', 'flex', 'dtg'] — null = все
  allowedZoneTechs?: Record<string, string[]>; // { hood: ['flex', 'dtg'] }
  allowedColors?: string[] | null; // коды цветов или null = все
  defaultExtras?: string[];        // авто-выбранные обработки
  moq?: number;                    // мин. тираж
  availableSizes?: string[];       // доступные размеры
  labelPresets?: Partial<LabelConfig>; // дефолтные лейблы
}
```

### Расширение SkuItem

```typescript
interface SkuItem {
  // ... существующие поля ...
  overrides?: Partial<Omit<CategoryRules, 'categoryId'>>;
  priceMultiplier?: number;        // 1.1 = +10% к себестоимости
}
```

### Логика резолюции

```typescript
// utils/skuRules.ts
function getEffectiveRules(sku: SkuItem, rules: CategoryRules[]): ResolvedRules {
  const catRule = rules.find(r => r.categoryId === sku.category);
  return deepMerge(catRule ?? defaults, sku.overrides ?? {});
}
```

Принцип: `undefined` = "нет ограничений" (текущее поведение). Обратная совместимость 100%.

## Фаза 1: Pricing → SKU + Экономика

**Цель:** Единый хаб. Прозрачные цены.

### 1.1 Вкладка "Ценообразование"

- Рефакторить `PriceEditor.jsx` → `PricingTabContent.jsx` (reusable компонент)
- Добавить 6-ю вкладку в `SkuEditor.jsx`
- `saveAll()` сохраняет и `prices` в `app_config`
- Удалить роут `/prices`, редирект на `/sku?tab=pricing`
- Убрать `PriceEditor` из lazy imports в `App.jsx`

### 1.2 Экономика в карточке SKU

В `SkuDetailModal` добавить секцию "Экономика" (read-only):

```
Себестоимость:
  Пошив:     480 ₽
  Ткань:     2.0м × $13.10 × 92 = 2 410 ₽
  Отделка:   0.15м × $13.20 × 92 = 182 ₽
  ─────────────────────
  Итого:     3 072 ₽

Цена продажи (тираж 100):
  Наценка:   40% → 4 301 ₽
  Маржа:     1 229 ₽ (28.6%)

Цена продажи (тираж 300):
  Наценка:   30% → 3 994 ₽
  Маржа:     922 ₽ (23.1%)
```

Расчёт из существующего `estimatePrice()` + `getMarkup()` из `pricing.ts`.

### Файлы

| Файл | Действие |
|------|----------|
| `PriceEditor.jsx` | Рефакторить в `PricingTabContent.jsx` |
| `SkuEditor.jsx` | Добавить вкладку, расширить `saveAll()` |
| `SkuDetailModal.jsx` | Добавить секцию "Экономика" |
| `App.jsx` | Убрать `/prices` роут |
| `catalogSlice.ts` | `saveAll` сохраняет `prices` |

### Ноль изменений в визарде.

---

## Фаза 2: Category Rules — инфраструктура

**Цель:** Данные и UI правил без изменений визарда.

### 2.1 Типы и стор

- `types/catalog.ts`: добавить `CategoryRules`, расширить `SkuItem.overrides`
- `catalogSlice.ts`: добавить `categoryRules: CategoryRules[]`, загружать из `app_config.categoryRules`
- `utils/skuRules.ts`: `getEffectiveRules()` + unit-тесты
- Персистенция: `app_config` ключ `categoryRules`

### 2.2 Вкладка "Правила категорий"

Новый `sku/CategoryRulesTab.jsx` — 7-я вкладка в SKU-редакторе.

Таблица: строка = категория (11 шт), колонки:
- **Категория** (название)
- **Техники** (multi-select чипсы: screen, flex, dtg, dtf, embroidery)
- **Дефолтные обработки** (multi-select из extrasCatalog)
- **Мин. тираж** (число)
- **Доступные размеры** (чекбоксы: XS...10XL)

### 2.3 Overrides в карточке SKU

В `SkuDetailModal` добавить секцию "Переопределения":
- Показывает унаследованные правила категории (серым)
- Переключатель "Переопределить" per-поле
- Если переопределён — показывает локальное значение

### Файлы

| Файл | Действие |
|------|----------|
| `types/catalog.ts` | `CategoryRules`, `SkuItem.overrides` |
| `catalogSlice.ts` | `categoryRules` + load/save |
| новый `sku/CategoryRulesTab.jsx` | UI правил |
| `SkuDetailModal.jsx` | Секция "Переопределения" |
| `SkuEditor.jsx` | 7-я вкладка |
| новый `utils/skuRules.ts` | `getEffectiveRules()` |
| новый `utils/skuRules.test.ts` | Тесты резолюции |

### Ноль изменений в визарде.

---

## Фаза 3: Умный визард

**Цель:** Визард использует правила. Меньше ошибок, быстрее оформление.

### 3.1 Хук useEffectiveRules

```typescript
// hooks/useEffectiveRules.ts
function useEffectiveRules(sku: SkuItem | null): ResolvedRules | null {
  const categoryRules = useStore(s => s.categoryRules);
  return sku ? getEffectiveRules(sku, categoryRules) : null;
}
```

### 3.2 Фильтрация в визарде

| Компонент | Что меняется |
|-----------|-------------|
| `ZoneTechBlock` | Фильтр `TECH_TABS` через `rules.allowedTechs`. Заблокированные — disabled + tooltip |
| `ColorPicker` | Фильтр палитры через `rules.allowedColors` (если задан) |
| `SizeTable` | Disable недоступных размеров из `rules.availableSizes` |
| `ExtrasAccordion` | Авто-чек `rules.defaultExtras` при выборе SKU |
| `productSlice.selectSku()` | Применить `labelPresets`, проверить MOQ |
| `StepSummary` | Предупреждение если qty < MOQ |

### 3.3 Warning-система (из подхода C)

Не жёсткий блок, а 3 уровня:
- **Доступно** — обычный вид
- **Не рекомендуется** — жёлтая рамка + tooltip с причиной
- **Недоступно** — серый, disabled

### Файлы

| Файл | Действие |
|------|----------|
| новый `hooks/useEffectiveRules.ts` | Хук резолюции |
| `ZoneTechBlock.jsx` | Фильтр техник |
| `ColorPicker.jsx` | Фильтр цветов |
| `SizeTable.jsx` | Disable размеров |
| `ExtrasAccordion.jsx` | Авто-дефолты |
| `productSlice.ts` | `selectSku()` + правила |
| `StepSummary.jsx` | MOQ warning |

---

## Фаза 4: Продвинутые правила

**Цель:** Полный контроль для сложных случаев.

### 4.1 Per-SKU палитра цветов

В `SkuDetailModal` — визуальный пикер цветов (сетка свотчей). Клик = toggle в `overrides.allowedColors`.

### 4.2 Зона ↔ Техника матрица

В `CategoryRulesTab` — матрица: строки = зоны, столбцы = техники, чекбоксы. Например: `hood` + `screen` = off.

### 4.3 priceMultiplier per SKU

Поле в `SkuDetailModal`: множитель к себестоимости (1.0 = без изменений, 1.15 = +15% премиум). Влияет на расчёт в `pricing.ts`.

### Файлы

| Файл | Действие |
|------|----------|
| `SkuDetailModal.jsx` | Пикер цветов, priceMultiplier |
| `CategoryRulesTab.jsx` | Зона-техника матрица |
| `pricing.ts` | Учёт priceMultiplier |
| `utils/skuRules.ts` | zone-level resolution |

---

## Итоговая структура вкладок SKU-редактора

1. **Изделия** (существует)
2. **Основная ткань** (существует)
3. **Отделочная ткань** (существует)
4. **Обработки** (существует)
5. **Фурнитура** (существует)
6. **Ценообразование** (Фаза 1 — из PriceEditor)
7. **Правила категорий** (Фаза 2 — новая)

## Обратная совместимость

- Все новые поля optional (`undefined` = текущее поведение)
- Существующие данные в Supabase работают без миграции
- Каждая фаза деплоится независимо
- Визард продолжает работать если правил нет

## Верификация

- Фаза 1: `npm run build` проходит, `/prices` редиректит на `/sku`, экономика считается корректно
- Фаза 2: unit-тесты `skuRules.test.ts`, правила сохраняются/загружаются из Supabase
- Фаза 3: E2E тест — создать заказ с SKU у которого есть правила, убедиться что визард фильтрует
- Фаза 4: визуальная проверка палитры цветов и матрицы зон
- На каждой фазе: `npm run test` (735+ unit tests) + `npm run build` без ошибок
