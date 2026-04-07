---
name: using-git-worktrees
description: Use when starting a large feature that should be isolated from main branch. Triggers on "новая ветка", "изолировать", "не сломать main", "feature branch", "worktree", "параллельная разработка".
---

# Using Git Worktrees — Pinhead Order Studio

Для крупных фич — работай в изолированной ветке через worktree.

## Когда использовать

- Задача L-размера (покупательский портал, Bitrix интеграция)
- Нужно работать параллельно не трогая main
- Хочешь безопасно экспериментировать

## Создать worktree для новой фичи

```bash
# Создать ветку и worktree одной командой
git worktree add ../pinhead-portal feature/portal

# Теперь есть две рабочие директории:
# ~/PinheadOS/          — main (текущий)
# ~/pinhead-portal/     — feature/portal (новый)

# Перейти в новый worktree
cd ../pinhead-portal
```

## Работа в worktree

```bash
# Установить зависимости (если нужно)
cd pinhead-react && npm install

# Работай как обычно
# Коммиты идут в ветку feature/portal

# Проверить статус
git status
git log --oneline -5
```

## Слить обратно в main

```bash
# Убедиться что тесты зелёные
cd pinhead-react && npm test -- --run

# Перейти в main
cd ../PinheadOS

# Смержить
git merge feature/portal

# Или squash merge для чистой истории
git merge --squash feature/portal
git commit -m "feat(portal): customer-facing order portal MVP"

# Удалить worktree
git worktree remove ../pinhead-portal
git branch -d feature/portal
```

## Полезные команды

```bash
# Список всех worktrees
git worktree list

# Убрать worktree (если больше не нужен)
git worktree remove ../pinhead-portal

# Синхронизировать с main (если main обновился)
cd ../pinhead-portal
git rebase main
```

## Для Pinhead — порядок веток

```
main                    — всегда рабочий, деплоится на Vercel
  ├── feature/portal    — покупательский портал
  └── feature/bitrix    — Bitrix интеграция (когда придёт время)
```

**Важно:** Vercel деплоит только main. Feature ветки не деплоятся автоматически.
