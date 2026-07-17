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

## ERP-компоненты (erp.module.css)

| Паттерн | Классы | Правила |
|---|---|---|
| Статус-чипы | `chip` + `chipReady/Progress/Blocked/Done/Waiting/Neutral` | пилюли 999px, 11.5px/600 |
| Вкладки цехов | `deptTabs/deptTab/deptTabActive` + `deptTabCount` (красный бейдж `deptTabHot`) | скролл-бар без скроллбара |
| KPI-плитки | `kpiTile/kpiValue/kpiLabel` (+`kpiWarn/kpiDanger`) | значение — Mono 34px |
| Канбан | `kanbanBoard/kanbanCol` (290px, flex-shrink:0 у лейнов!) `kanbanLane` (ready/in_progress/done) `kanbanCard` | drag только внутри колонки; дедлайн-точка `kanbanDot`; время-в-этапе |
| Очередь цеха | `queueCard` + полоса слева (Ready зел./Progress жёлт./Blocked красн.), просрочка — красная рамка | кнопки min-height 46px (планшет) |
| Карточка заказа | `matSection` секции; `stepper*` (точки этапов); `printBlock` (нанесение, синяя полоса слева) | InlineEdit: клик→input→Enter |
| Формы | `tile/tileActive` (плитки-radio) · `errorSummary` (красный баннер) · `dropZone` (превью, Ctrl+V) · `sizeGrid` | noValidate + своя валидация |
| Таблицы | `tableWrap/table` | th: Inter 10px uppercase, фон surface |

## UX-правила
- Действие цеха = 1 тап; тач-таргеты ≥44px
- Просрочка — красный `--color-error`, ≤3 дней — жёлтый `--color-warning`
- Ошибка формы: error-summary сверху + scroll к нему; ошибки списком
- Инлайн-правки вместо модалок там, где правится 1 поле (карандаш при hover)
- Optimistic UI с rollback; toast на каждую ошибку Supabase
- Короткие имена цехов (deptShortName) во всех чипах: Закрой, Швейка, ДТФ…
- Mobile: скролл-вкладки, полноширинные карточки, `queueDue` переносится

## Импортированные паттерны kontora24
Время-в-статусе (мин/ч/дн) · дедлайн-точки · блокировка DnD-зон затемнением ·
уникальные имена realtime-каналов (`crypto.randomUUID()`) + debounce 500ms ·
error-summary + плитки · Ctrl+V paste превью · InlineEdit · единая история
(статусы+audit) · чат заказа.
