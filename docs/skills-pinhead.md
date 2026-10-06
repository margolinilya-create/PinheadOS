# Pinhead-специфика бывших скиллов

06.10.2026 (сессия 79) четыре наших скилла заменены оригиналами из плагина
everything-claude-code (ECC v2.2.3, `ecc@ecc` в `.claude/settings.json`;
обзор — `docs/2026-10-05-ecc-review.md`):

| Был | Стал (ECC) |
|---|---|
| `software-architecture` | агенты `architect`, `code-architect`, `planner`; скилл `architecture-decision-records` |
| `test-driven-development` | скилл `tdd-workflow`, агент `tdd-guide` |
| `finishing-a-development-branch` | скилл `verification-loop` |
| `using-git-worktrees` | скилл `git-workflow` |

Скиллы ECC общие и не знают проекта. Всё, что в наших было про Pinhead
(карта ERP, шаблон спеки фичи, где лежат тесты, порядок веток, обновление
памяти проекта в конце), перенесено сюда ДОСЛОВНО. Работая с перечисленными
скиллами ECC — сверяйтесь с этим файлом; при расхождении прав проект
(`CLAUDE.md`), а не ECC: например, порога покрытия 80% у нас нет.


---

## Бывший скилл `software-architecture`


## Software Architecture — Pinhead Order Studio

Принципы и паттерны для принятия архитектурных решений.

В приложении **два раздела**, и по умолчанию открывается ERP, а не визард.
Начинай с того, в чей раздел попадает задача.

### 🏭 Производство (ERP) — раздел по умолчанию, `src/erp/`

```
ErpApp (lazy-экраны)
  └── useErpStore — composition-root, слайсы в store/slices/
       ├── ordersSlice        — загрузка (активные / ленивый архив), создание через RPC
       ├── stagesSlice        — статусы этапов, приоритет очереди, перенос между цехами
       ├── materialsSlice     — материалы и варианты поставщиков
       ├── procurement/warehouse/subcontracting/experimental — сопровождающие циклы
       ├── permissionsSlice   — матрица «роль × право»
       ├── dictionariesSlice  — справочники админки
       ├── tzSlice            — ТЗ в PDF: версии и назначения цехам
       └── realtimeSlice      — точечное применение postgres_changes

  Чистая логика (тестируется отдельно, без React) — src/erp/utils/:
       routes (маршрут и гейты) · queueEntries (группа и причина ожидания) ·
       tz (версии и гейт ТЗ) · progress (штуки) · filterStages · queueOrder ·
       stageMove · permissions

Supabase (erp_*)
  erp_orders → erp_order_items → erp_item_stages (позиция × цех, граф depends_on)
  erp_departments (is_production — есть ли у участка очередь)
  erp_materials (+ erp_material_suppliers) · erp_tz_documents/_assignments
  erp_role_permissions · erp_dictionaries · erp_stage_events (история)
```

**Опорные правила ERP** (подробности — в `pinhead-react/CLAUDE.md`):
- Права — только через `useErpAccess`, руками роли в компонентах не проверять.
- Группа задания и причина ожидания считаются **одним** `buildQueueEntries`,
  а не по месту в каждом экране.
- Признаки участка (`is_production`) и справочники живут **в данных**, не в
  константах: иначе то, что заводит директор в админке, не появится в коде.
- Прогресс — в штуках (`utils/progress`), не в числе завершённых этапов.

### ✏️ ТЗ (Order Studio) — за флагом `orderStudio`, `src/` (визард и каталоги)

```
React 19 (UI)
  └── Zustand 5 (State) — разделён на slices
       ├── wizardSlice    — навигация по шагам
       ├── productSlice   — SKU, ткань, цвет, размеры
       ├── designSlice    — зоны, техники, artworkPath
       ├── itemsSlice     — мульти-позиции
       ├── detailsSlice   — данные клиента
       ├── catalogSlice   — загрузка каталогов
       └── orderSlice     — loadOrder, resetOrder

Supabase (Backend)
  ├── orders            — заказы
  ├── profiles          — пользователи + роли
  ├── catalog_config    — SKU, ткани, цены (JSONB)
  ├── order_comments    — комментарии
  ├── order_templates   — шаблоны
  └── order_audit       — лог изменений
```

---

### Правила для новых фич

#### 1. Новый функционал — новый slice или store
Не добавляй в существующий useStore если это отдельная доменная область.

```
Новая область — новый файл:
- Order Studio: отдельный store рядом с useCommentsStore.ts
- ERP: новый слайс в `erp/store/slices/` + регистрация в `domainSlices.ts`
  (сторож `domainSlices.test.ts`), а не новый глобальный store
```

#### 2. Supabase — всегда null при ошибке
Все async функции работающие с Supabase:
- При ошибке: `toast.error(...)` + `return null`
- При успехе: `return data[0]`
- Оптимистичное обновление только с rollback

#### 3. Новые компоненты — рядом с тестом
```
erp/screens/
  FabricLeftovers.jsx
  FabricLeftovers.test.jsx   — сразу
```

#### 4. Lazy loading для тяжёлых панелей
```js
// ERP: экраны только через `lazyScreen` (сторож запрещает голый lazy()),
// он же догружает доменные слайсы стора параллельно с чанком экрана
const FabricLeftovers = lazyScreen(() => import('./screens/FabricLeftovers'));
```

---

### Покупательский портал — ОТМЕНЁН

Портал `/order` отклонён: приоритет сменился на CRM/ERP (Roadmap
в `PROJECT.md`, «Отклонено / отложено»). Прежний план здесь снят, чтобы
не учить строить то, чего не будет.

---

### Спека фичи — ДО кода

Крупная задача (5+ файлов, новая таблица, новый экран или изменение
маршрута) начинается с файла `docs/erp/<YYYY-MM-DD>-<slug>-spec.md`.
Спека отвечает на «что» и «зачем»; «как» (файлы, слайсы, миграции)
идёт отдельным разделом «План» ниже, чтобы одно не подменяло другое.
Идея взята из Spec Kit (`github/spec-kit`); сам инструмент в проект
не ставится — его «конституция» и команды дублировали бы `CLAUDE.md`,
`docs/rules/` и этот скилл.

Шаблон (три раздела обязательны, «План» — по готовности):

```markdown
## <Название фичи> — спека

Статус: черновик | согласована | в работе | сделана
Раздел: 🏭 Производство | ✏️ ТЗ
Дата: YYYY-MM-DD

### 1. Цель и пользователь
Кто (роль из матрицы прав) и какую задачу решает. Одно-два предложения.
Что сегодня делают вместо этого и почему это плохо.

### 2. Сценарии и граничные случаи
- Основной сценарий: шаги как их видит пользователь, без имён файлов.
- Что видит другая роль (цех / менеджер / директор).
- Граничные случаи: пустые данные, повтор действия, отказ сервера,
  необратимое действие (что именно необратимо и как это сказано человеку).
- Права: какое право из матрицы, есть ли серверный страж.

### 3. Не входит
Что осознанно НЕ делаем в этой итерации и куда это записано (roadmap,
бэклог обзора). Без этого раздела спека не считается готовой.

### 4. Открытые вопросы
Пронумерованный список; ответ вписывается рядом с датой и кем решено.

### План (заполняется после согласования)
Таблицы и миграции → слайс/стор → чистая логика в utils (с тестами) →
экран → сторожа. Ссылки на существующие части, которые переиспользуем.
```

Правила к спеке:
- Открытый вопрос — это не запрещение работать: делай всё, что от него
  не зависит, а ответ вписывай в раздел 4 датой.
- Спека переживает фичу: после сдачи меняется только статус, а решения
  о том, чего НЕ делали, переезжают в `docs/rules/` или roadmap.
- Прежний свободный формат `docs/erp/*-plan.md` для новых задач не
  использовать; старые файлы не переписывать.

---

### Чеклист перед реализацией крупной фичи

- [ ] Написал спеку по шаблону выше (разделы 1–3 заполнены)
- [ ] Нарисовал структуру файлов (2 минуты)
- [ ] Определил какие существующие части переиспользую
- [ ] Определил что нужно новое (store, таблица, компонент)
- [ ] Нет ли циклических зависимостей
- [ ] Нужна ли миграция Supabase — если да, сначала SQL
- [ ] Написал тест перед кодом (см. test-driven-development skill)

---

## Бывший скилл `test-driven-development`


## Test-Driven Development — Pinhead Order Studio

**Правило:** Тест пишется ДО кода. Никогда не наоборот.

### Цикл Red → Green → Refactor

#### Red — написать падающий тест
Перед любым изменением кода:
1. Определи что именно должен делать новый код
2. Напиши тест который это проверяет
3. Убедись что тест ПАДАЕТ (red) — это доказывает что тест работает

```bash
cd pinhead-react && npm test -- --run 2>&1 | tail -10
```

#### Green — написать минимальный код
- Пиши ровно столько кода сколько нужно чтобы тест прошёл
- Не добавляй лишнего
- Проверь: тестов не стало меньше, чем было до правки, и все зелёные

#### Refactor — улучшить если нужно
- Только если есть явное дублирование или проблема
- Тесты должны оставаться зелёными после рефакторинга

---

### Где писать тесты в Pinhead

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

### Шаблон теста для Pinhead (Vitest + RTL)

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

### Важные паттерны Pinhead в тестах

- `saveOrder` / `updateOrder` / `deleteOrder` — должны возвращать `null` при ошибке
- Zustand сторы — используй `useStore.getState()` для проверки состояния
- Toast — мокай `useToastStore` и проверяй что `toast.error` вызван
- Baseline: **число тестов до твоей правки** — если стало меньше, ты удалил тест,
  это запрещено (на 27.07.2026 их 1194)

---

## Бывший скилл `finishing-a-development-branch`


## Finishing a Development Branch — Pinhead Order Studio

Перед каждым коммитом пройди все шаги. Не пропускай.

### Шаг 1 — Тесты

```bash
cd pinhead-react && npm test -- --run
```

**Критерий:** все тесты зелёные, и их не меньше, чем было до правки
(на 27.07.2026 — 1194). Плюс `npm run build` и, если трогал ERP-экраны,
`npx playwright test e2e/erp-queue.spec.ts --project=desktop`.
Если тест упал — стоп, чини сначала тест.

### Шаг 2 — Линтер

```bash
cd pinhead-react && npm run lint
```

**Критерий:** 0 ошибок. Предупреждения допустимы.

### Шаг 3 — Проверь изменённые файлы

```bash
git diff --name-only
```

Для каждого файла спроси:
- Этот файл нужен для задачи? Если нет — не добавляй в коммит
- Нет ли случайных `console.log`, `debugger`, закомментированного кода?
- Нет ли хардкода (`'dev'`, тестовых данных, временных значений)?

```bash
grep -rn "console.log\|debugger\|TODO\|FIXME" pinhead-react/src \
  --include="*.jsx" --include="*.js" --include="*.ts" | grep -v ".test."
```

### Шаг 4 — Формат коммита

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

### Шаг 5 — Коммит и пуш

```bash
git add [файлы задачи]
git commit -m "feat(scope): описание"
git push
```

### Шаг 6 — Обнови память проекта

По правилу конца сессии из корневого `CLAUDE.md`: `SESSION-STATE.md` (состояние,
решения, next steps), запись в `## Changelog` файла `PROJECT.md`, правила
сессии — отдельным файлом в `docs/rules/` со ссылкой из `docs/rules/INDEX.md`.
Новые баги и идеи — в next steps `SESSION-STATE.md`.

---

## Бывший скилл `using-git-worktrees`


## Using Git Worktrees — Pinhead Order Studio

Для крупных фич — работай в изолированной ветке через worktree.

### Когда использовать

- Задача L-размера (покупательский портал, Bitrix интеграция)
- Нужно работать параллельно не трогая main
- Хочешь безопасно экспериментировать

### Создать worktree для новой фичи

```bash
## Создать ветку и worktree одной командой
git worktree add ../pinhead-portal feature/portal

## Теперь есть две рабочие директории:
## ~/PinheadOS/          — main (текущий)
## ~/pinhead-portal/     — feature/portal (новый)

## Перейти в новый worktree
cd ../pinhead-portal
```

### Работа в worktree

```bash
## Установить зависимости (если нужно)
cd pinhead-react && npm install

## Работай как обычно
## Коммиты идут в ветку feature/portal

## Проверить статус
git status
git log --oneline -5
```

### Слить обратно в main

```bash
## Убедиться что тесты зелёные
cd pinhead-react && npm test -- --run

## Перейти в main
cd ../PinheadOS

## Смержить
git merge feature/portal

## Или squash merge для чистой истории
git merge --squash feature/portal
git commit -m "feat(portal): customer-facing order portal MVP"

## Удалить worktree
git worktree remove ../pinhead-portal
git branch -d feature/portal
```

### Полезные команды

```bash
## Список всех worktrees
git worktree list

## Убрать worktree (если больше не нужен)
git worktree remove ../pinhead-portal

## Синхронизировать с main (если main обновился)
cd ../pinhead-portal
git rebase main
```

### Для Pinhead — порядок веток

```
main                    — всегда рабочий, деплоится на Vercel
  ├── feature/portal    — покупательский портал
  └── feature/bitrix    — Bitrix интеграция (когда придёт время)
```

**Важно:** Vercel деплоит только main. Feature ветки не деплоятся автоматически.
