---
name: root-cause-tracing
description: Use when an error occurs deep in the call stack and you need to trace back to the original trigger. Triggers on "откуда это", "почему ломается", "trace", "stack trace", "unexpected behavior", "не понимаю откуда ошибка".
---

# Root Cause Tracing — Pinhead Order Studio

Когда ошибка глубоко в стеке — иди от симптома к причине, не наоборот.

## Алгоритм трассировки

### Шаг 1 — Зафиксируй точку отказа
```
Ошибка: [текст ошибки]
Файл: [файл:строка из stack trace]
Когда: [какое действие пользователя вызвало]
```

### Шаг 2 — Иди вверх по стеку вызовов

```
Ошибка в → кто вызвал → кто вызвал того → ...
```

Типичные цепочки в Pinhead:

```
UI клик → обработчик → store action → supabase → ошибка
                → часто причина здесь
```

```
Рендер компонента → selector → store state → неправильное значение
           → или здесь → неправильный начальный state
```

```
loadOrder() → restoreItem() → отсутствующее поле → undefined
      → данные из старого заказа без нового поля
```

### Шаг 3 — Проверь данные на каждом уровне

```js
// Добавь временные console.log для трассировки
console.log('[TRACE] store action input:', payload);
console.log('[TRACE] supabase response:', { data, error });
console.log('[TRACE] state after:', get().someField);
```

### Шаг 4 — Найди первое место где данные стали неправильными

Это и есть корневая причина. Чини там, не в месте где ошибка проявилась.

---

## Частые корневые причины в Pinhead

| Симптом | Корневая причина |
|---------|-----------------|
| Данные пропали после перезагрузки | Поле не в DRAFT_FIELDS в useDraft.js |
| Зоны нанесения неправильные | SKU изменился, зоны не перефильтровались |
| Цена неправильная | Каталог загрузился из fallback (sessionStorage устарел) |
| Компонент не обновляется | useStore без useShallow — нет re-render |
| TypeError: cannot read undefined | loadOrder() — старый заказ без нового поля |
| Статус не меняется | updateStatus optimistic без rollback |

---

## Инструменты трассировки

```bash
# Найти все вызовы функции
grep -rn "functionName" pinhead-react/src/ --include="*.js" --include="*.jsx"

# Найти где устанавливается значение
grep -rn "setState\|set({" pinhead-react/src/store/ | grep "fieldName"

# Проверить тесты на конкретный сценарий
cd pinhead-react && npm test -- --run --reporter=verbose 2>&1 | grep "fieldName"
```

---

## Правило

**Не чини там где ошибка проявилась — чини там где данные стали неправильными.**

Пример:
- ❌ Добавить `|| {}` проверку в компоненте где TypeError
- ✅ Найти почему loadOrder не восстанавливает поле и починить там
