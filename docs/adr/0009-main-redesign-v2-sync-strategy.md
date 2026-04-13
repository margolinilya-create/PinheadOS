# ADR-0009 — Main + redesign/v2 parallel development sync strategy

**Статус:** accepted
**Дата:** 2026-04-13
**Контекст ветки:** redesign/v2 (+ main)

## Контекст

Пользователь явно сообщил в Day-0 (2026-04-13): «буду везти улучшения в main и одновременно проводить разработку новой версии». Это значит:

- `main` получает hotfixes / небольшие improvements для менеджеров каждые 1-7 дней
- `redesign/v2` получает production-слой architecture каждый день
- Обе ветки живут **3 месяца** параллельно
- Long-lived branches без sync = merge hell на cutover

Без явной sync-стратегии возникнут проблемы:
- `redesign/v2` отстаёт от `main`, в W12 massive merge conflict
- Hotfix в main не виден разработчику v2 → дублирование работы
- Изменения в «серой зоне» файлов (App.jsx, Header.jsx, styles/index.css) конфликтуют непредсказуемо

## Решение

### Cadence

1. **Еженедельный sync:** каждый понедельник `git merge main --no-ff` в ветку `redesign/v2`
2. **Immediate sync после hotfix:** если в main ушёл hotfix помеченный `fix:`, merge в redesign/v2 в тот же день
3. **Never rebase:** только merge, чтобы сохранить историю коммитов и не force-push'ить длинноживущую ветку

### Flow

```bash
# Стандартный еженедельный merge
git checkout main
git pull
git checkout redesign/v2
git pull
git merge main --no-ff -m "merge: sync main → redesign/v2 (weekly W<N>)"
# resolve conflicts if any
npm run test        # 796 main tests должны остаться зелёные
npm run lint
git push origin redesign/v2
```

### Зоны конфликтов

**🔴 Красная зона** (redesign/v2 plan активно меняет):

| File | v2 changes | Conflict likelihood |
|---|---|---|
| `pinhead-react/src/App.jsx` | +routes `/production/*`, `/admin/*` | MED |
| `pinhead-react/src/components/orders/KanbanBoard.jsx` | W10 dnd-kit replace + Table view | HIGH |
| `pinhead-react/src/components/layout/Header.jsx` | W1 bell notifications | MED |
| `pinhead-react/src/styles/index.css` | расширение токенов | LOW |
| `pinhead-react/package.json` | +8 новых deps | HIGH |
| `supabase/migrations/` | +10 новых файлов | LOW |

**🔵 Синяя зона** (v2 plan НЕ трогает, main меняет свободно):

- `pinhead-react/src/components/steps/**` — Wizard (diff-guard защищает)
- `pinhead-react/src/utils/pricing.ts` — 84 теста (diff-guard защищает)
- `pinhead-react/src/store/slices/{wizard,product,design,items,details,catalog,order}Slice.ts` — 796 тестов (diff-guard защищает)
- `pinhead-react/src/components/shared/CommandPalette.jsx` — остаётся as-is в v2
- `pinhead-react/src/components/editors/sku/*` — SKU Hub v2 дропнут из MVP
- `pinhead-react/src/data/` — fallback данные
- `pinhead-react/src/components/analytics/Dashboard.jsx` — TV Dashboard дропнут

### Конфликт-резолвер playbook

| Сценарий | Действие |
|---|---|
| Merge conflict в `App.jsx` routes | Принять оба набора routes (union) |
| Merge conflict в `styles/index.css` | Сохранить оба набора токенов (v2 только расширяет) |
| Merge conflict в `package.json` | Union dependencies, `npm install`, закоммитить `package-lock.json` |
| Diff-guard fail после merge main | Main изменил защищённый файл → (a) проверить тривиальность, (b) если ок — добавить в diff-guard temporary exception с комментарием, (c) если big — отдельный ADR + обсуждение |
| Migration name collision | Переименовать новейший файл на следующий свободный timestamp, обновить `supabase/migrations/` order |
| Kanban conflict (main hotfixes существующий DnD, v2 планирует replace) | Зафиксировать main изменения как есть; в W10 при dnd-kit replace переделать с нуля |
| 796 тестов красные после merge | Bisect, найти source, либо revert main change либо адаптировать v2 |

### Пост-merge проверки (всегда)

```bash
npm run test                    # 796 юнит-тестов зелёные
npm run lint                    # 0 ошибок
npm run build                   # successful build
# CI на push — diff-guard + rls-gate проходят
```

Если что-то красное — **не пушим**, разбираемся.

## Последствия

**Плюсы:**
- main и v2 синхронизированы, cutover в W12 становится маленьким merge
- Hotfixes видны обеим веткам в течение 24 часов
- Конфликты ловятся рано и чаще, но маленькими порциями
- Diff-guard рано сигналит если main влезает в v2 чувствительные файлы

**Минусы:**
- Еженедельный merge commit — шум в истории
- Потенциально медленный weekly ритуал (~30 мин с тестами)
- Возможная усталость от постоянной sync-работы

## Альтернативы

- **Rebase** — отвергнуто: force-push на long-lived ветку ломает CI history, непонятно для ревью
- **Cherry-pick per commit** — отвергнуто: легко пропустить взаимосвязанные коммиты
- **Sync раз в месяц** — отвергнуто: копит конфликты, поздно ловит regressions
- **No sync до cutover** — отвергнуто: в W12 будет merge hell

## TODO

- [x] Документировать в ADR
- [ ] Добавить напоминание на понедельник W2 (первый sync)
- [ ] Скрипт `scripts/weekly-sync.sh` (опционально, W2)
