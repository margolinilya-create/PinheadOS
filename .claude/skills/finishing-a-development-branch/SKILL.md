---
name: finishing-a-development-branch
description: Use when a task is done and ready to commit and push. Triggers on "готово", "done", "закончил", "commit", "push", "ready", "завершил задачу". Runs final checks before committing.
---

# Finishing a Development Branch — Pinhead Order Studio

Перед каждым коммитом пройди все шаги. Не пропускай.

## Шаг 1 — Тесты

```bash
cd pinhead-react && npm test -- --run
```

**Критерий:** все тесты зелёные, количество >= 722.
Если тест упал — стоп, чини сначала тест.

## Шаг 2 — Линтер

```bash
cd pinhead-react && npm run lint
```

**Критерий:** 0 ошибок. Предупреждения допустимы.

## Шаг 3 — Проверь изменённые файлы

```bash
git diff --name-only
```

Для каждого файла спроси:
- Этот файл нужен для задачи? Если нет — не добавляй в коммит
- Нет ли случайных `console.log`, `debugger`, закомментированного кода?
- Нет ли хардкода (`'dev'`, тестовых данных, временных значений)?

```bash
grep -rn "console.log\|debugger\|TODO\|FIXME" pinhead-react/src --include="*.jsx" --include="*.js" | grep -v ".test."
```

## Шаг 4 — Формат коммита

Используй conventional commits:

```
feat(scope): короткое описание что добавлено
fix(scope): короткое описание что починено
docs(scope): изменения документации
refactor(scope): рефакторинг без новой функциональности
```

Примеры scope для Pinhead:
- `wizard` — шаги конфигуратора
- `orders` — заказы, Kanban, useOrdersStore
- `analytics` — Dashboard
- `auth` — авторизация
- `catalog` — каталоги SKU/цен
- `print` — PrintPreview
- `mobile` — адаптивность

**Запрещено:** `fix bug`, `update`, `changes`, `wip`

## Шаг 5 — Коммит и пуш

```bash
git add [файлы задачи]
git commit -m "feat(scope): описание"
git push
```

## Шаг 6 — Обнови ACTION-PLAN.md

Найди задачу в `ACTION-PLAN.md` и поставь ✅.
Если появились новые баги или идеи — добавь их в соответствующий раздел.
