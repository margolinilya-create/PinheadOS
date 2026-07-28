---
name: test-driven-development
description: Use when implementing any new feature, fixing a bug, or modifying existing logic in Pinhead Order Studio. Triggers on "добавить", "реализовать", "сделать фичу", "implement", "add feature", "fix bug". Tests FIRST, code second.
---

# Test-Driven Development — Pinhead Order Studio

**Правило:** Тест пишется ДО кода. Никогда не наоборот.

## Цикл Red → Green → Refactor

### Red — написать падающий тест
Перед любым изменением кода:
1. Определи что именно должен делать новый код
2. Напиши тест который это проверяет
3. Убедись что тест ПАДАЕТ (red) — это доказывает что тест работает

```bash
cd pinhead-react && npm test -- --run 2>&1 | tail -10
```

### Green — написать минимальный код
- Пиши ровно столько кода сколько нужно чтобы тест прошёл
- Не добавляй лишнего
- Проверь: тестов не стало меньше, чем было до правки, и все зелёные

### Refactor — улучшить если нужно
- Только если есть явное дублирование или проблема
- Тесты должны оставаться зелёными после рефакторинга

---

## Где писать тесты в Pinhead

| Что меняешь | Куда писать тест |
|-------------|-----------------|
| `erp/utils/*.ts` (routes, tz, progress, queueEntries…) | Рядом `*.test.ts` — это чистая логика, тест обязателен |
| `erp/store/slices/*.ts` | `erp/store/useErpStore.test.ts` |
| `erp/screens/*`, `erp/components/*` | Сценарий в `e2e/erp-queue.spec.ts` |
| `utils/pricing.ts` | `utils/pricing.test.js` |
| `store/useOrdersStore.ts` | `store/useOrdersStore.test.js` |
| `store/slices/*.ts` | `store/useStore.test.js` |
| `components/steps/Step*.jsx` | `components/steps/Step*.test.jsx` |
| `components/orders/KanbanBoard.jsx` | Рядом `KanbanBoard.test.jsx` если нет |
| Новый утилит | Рядом `*.test.ts` |

---

## Шаблон теста для Pinhead (Vitest + RTL)

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ИмяФункции', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('делает X когда Y', () => {
    // Arrange
    const input = ...;
    // Act
    const result = functionUnderTest(input);
    // Assert
    expect(result).toBe(expectedValue);
  });

  it('возвращает null при ошибке Supabase', async () => {
    // Важный паттерн Pinhead — функции возвращают null при ошибке
    vi.mocked(supabase.from).mockReturnValue({
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: null, error: new Error('fail') }) })
    });
    const result = await saveOrder({});
    expect(result).toBeNull();
  });
});
```

---

## Важные паттерны Pinhead в тестах

- `saveOrder` / `updateOrder` / `deleteOrder` — должны возвращать `null` при ошибке
- Zustand сторы — используй `useStore.getState()` для проверки состояния
- Toast — мокай `useToastStore` и проверяй что `toast.error` вызван
- Baseline: **число тестов до твоей правки** — если стало меньше, ты удалил тест,
  это запрещено (на 27.07.2026 их 1194)
