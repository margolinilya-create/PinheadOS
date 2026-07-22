# DESIGN.md — дизайн-система PinheadOS

> Обновляется в конце сессии при изменениях визуала (правило в CLAUDE.md).

## Язык: Order Studio (единый для обоих режимов)

Светлая «бумага» #FAFAFA, белые карточки, тонкие границы, синий акцент.
Тёмная тема — автоматически через токены `html[data-theme="dark"]`.

### Токены (src/index.css :root)
- Цвета: `--accent #2B2BF0` (электрик-синий) · `--signal #FF3B30` ·
  `--ink/--black #0A0A0A` · `--bg #FAFAFA` · `--card #fff` · `--surface #F5F5F5`
- Статусные пары: `--bg-success/--color-success`, `--bg-warning/…`, `--bg-error/…`
- Шрифты: **Barlow Condensed** (заголовки, 900 uppercase) ·
  **Inter** (текст; UI-подписи 10-11px, 600, letter-spacing 1.2-1.5px, uppercase) ·
  **Roboto Mono** (все числа: qty, KPI, счётчики, время)
- Логотип: Space Grotesk 700, letter-spacing 2px

### Шапка и навигация (оба режима)
- Белая шапка 52px, sticky, логотип слева
- Навигация — **вкладки на всю высоту** с бордером справа;
  hover/active = заливка `--accent` + белый текст
- ERP: второй ряд вкладок 44px; переключатели режимов: «✏️ ТЗ» / «🏭 Производство»

## Редизайн ERP (PR1, сессия 20) — по макетам заказчика + UI Kit

Палитра ERP переопределена **на корне `.shell`** (ERP-scoped, Order Studio не трогаем; селекторы
`:global(html) .shell` / `:global(html[data-theme='dark']) .shell` выигрывают у :root/тёмной темы):
primary `#2563EB`, success `#10A34A`, warning `#F59E0B`, error `#EF4444`, +violet `#8B5CF6`/cyan `#06B6D4`,
светло-серый фон + белые карточки. Оболочка: вертикальный сгруппированный **Sidebar**
(`layout/Sidebar.jsx`, счётчики задач, сворачивание) + Header + прокручиваемый Main. Компонент
**Badge** (`components/Badge.jsx`). Чипы: в работе=синий (`chipProgress`), ожидает=амбер (`chipWaiting`).

## ERP-компоненты (erp.module.css)

| Паттерн | Классы | Правила |
|---|---|---|
| Статус-чипы | `chip` + `chipReady/Progress/Blocked/Done/Waiting/Neutral` | пилюли 999px, 11.5px/600 |
| Вкладки цехов | `deptTabs/deptTab/deptTabActive` + `deptTabCount` (красный бейдж `deptTabHot`) | скролл-бар без скроллбара |
| KPI-плитки | `kpiTile/kpiValue/kpiLabel` (+`kpiWarn/kpiDanger`) | значение — Mono 34px |
| Канбан | `kanbanBoard/kanbanCol` (290px, flex-shrink:0 у лейнов!) `kanbanLane` (ready/in_progress/done) `kanbanCard` | drag только внутри колонки; дедлайн-точка `kanbanDot`; время-в-этапе |
| Очередь цеха | `queueCard` + полоса слева (Ready зел./Progress жёлт./Blocked красн.), просрочка — красная рамка | кнопки min-height 46px (планшет); разворачиваемый блок «📋 ТЗ позиции» (сетка/нанесения/упаковка/материалы); превью 48px + лайтбокс; прогресс-бар qty_done N/M; фото брака/блока |
| Карточка заказа | `matSection` секции; `stepper*` (точки этапов); `printBlock` (нанесение, синяя полоса слева) | InlineEdit: клик→input→Enter |
| Формы | `tile/tileActive` (плитки-radio) · `accSection/accHeader` (аккордеон) · `inputError/fieldError` (инлайн-ошибки) · `draftBanner` (черновик) · `dropZone` (превью, Ctrl+V) · `sizeGrid` + чипсы-пресеты | noValidate + инлайн-валидация с автоскроллом; автосейв черновика; focus-trap + Escape |
| Таблицы | `tableWrap/table` | th: Inter 10px uppercase, фон surface |
| Приёмка склада (4.1.3) | блок «Поле / План / Факт» на материал (в `matSection`) | план read-only из закупки; факт — inputs (`fact_*`/кол-во) + статус приёмки + комментарий |
| Подряд (4.2.4) | `flowStepper/flowStep/flowArrow` + `table` | текущий статус и следующее действие — в РАЗНЫХ колонках; сверху Stepper-легенда маршрута готового изделия |

## UX-правила
- Действие цеха = 1 тап; тач-таргеты ≥44px (глобально через `@media (pointer: coarse)`)
- Просрочка — красный `--color-error`, ≤3 дней — жёлтый `--color-warning`
- Ошибка формы: инлайн у поля (красная рамка + текст, aria-invalid) + автоскролл
  к первому ошибочному; у кнопки — «Осталось заполнить: …»
- Инлайн-правки вместо модалок там, где правится 1 поле (карандаш при hover)
- Optimistic UI с rollback + защита от race с realtime (pendingMutations)
- toast на каждую ошибку Supabase
- Короткие имена цехов (deptShortName) во всех чипах: Закрой, Швейка, ДТФ…
- Mobile: брейкпоинты 760/480; <760 модалки полноэкранные (sticky-кнопки),
  список заказов — карточки; канбан — touch-DnD (mobile-drag-drop) + scroll-snap
- Загрузка: скелетоны (`ErpSkeletons.jsx`), не текст «Загрузка…»
- Названия: line-clamp 2 + title с полным текстом
- Мелкий текст ≥12px; оверлей/тени модалок — токены `--overlay`/`--shadow-modal`
- PWA: manifest + иконки 192/512, установка на планшеты цехов

## Импортированные паттерны kontora24
Время-в-статусе (мин/ч/дн) · дедлайн-точки · блокировка DnD-зон затемнением ·
уникальные имена realtime-каналов (`crypto.randomUUID()`) + debounce 500ms ·
error-summary + плитки · Ctrl+V paste превью · InlineEdit · единая история
(статусы+audit) · чат заказа.
