# Карта подсистем React-приложения

Файлы здесь отвечают на вопрос **«где что лежит»** — какой модуль отвечает
за механизм и почему он устроен именно так. Перенесены из
`pinhead-react/CLAUDE.md` дословно, по одному файлу на секцию (15.09).

Правила ПРОЕКТА (что можно и чего нельзя) — этажом выше: `../INDEX.md`.

Поиск по слову: `grep -rn "слово" docs/rules/react/`.

---

## Маршрут, этапы, очередь цеха

Как считается маршрут, откуда берутся группы очереди, кто пишет счётчики
этапа, как работают гейты запуска и завершения.

- `pravila-erp-volna-1-yadro-dispetchera.md`
- `pravila-erp-kod-revyu-05-08.md`
- `pravila-erp-zakrytie-tehdolga-audita-29-07.md`
- `pravila-erp-uchastok-podryad-dokument-21-08.md`
- `pravila-sessii-43-dokument-01-09-gde-chto-lezhit.md`
- `pravila-sessii-45-dokument-02-09-gde-chto-lezhit.md`

## Закупка, склад, подряд, разработка

- `pravila-erp-pravki-zakazchika-12-08.md`
- `pravila-erp-pravki-menedzhera-volny-2-3.md`
- `pravila-sessii-40-dokument-23-08-gde-chto-lezhit.md`
- `pravila-sessii-41-dokument-24-08-gde-chto-lezhit.md`
- `pravila-sessii-42-dokument-30-08-gde-chto-lezhit.md`
- `pravila-erp-pravki-zakazchika-20-08-sessiya-33.md`
- `pravila-erp-pravki-zakazchika-22-08-sessiya-37.md`

## Форма заказа, ТЗ, вложения

- `pravila-erp-volny-3-4-postavschiki-i-tz-v-pdf.md`
- `pravila-erp-pravki-zakazchika-16-08-sessiya-32.md`
- `pravila-erp-dokument-20-08-sessiya-33.md`
- `pravila-sessii-61-hvosty-14-09-gde-chto-lezhit.md`
- `pravila-sessii-61-pravki-14-09-pr-1-gde-chto-lezhit.md`

## Стор, вес оболочки, ленивые экраны

Ядро против доменной части, `lazyScreen`, бюджет критического пути, кэш,
realtime.

- `pravila-erp-ves-obolochki-sessiya-29.md`
- `pravila-erp-audit-03-08-2026-fazy-0-5.md`
- `pravila-sessii-39-vtoraya-polovina-daty-razdelenie-koda.md`
- `pravila-sessii-61-podgotovka-k-chatu-gde-chto-lezhit.md`

## Интерфейс: состояния, примитивы, доступность

Три состояния экрана, вкладки, чипы, модалки, подписи полей.

- `pravila-erp-ux-audit-volna-ux-1.md`
- `pravila-erp-ux-audit-volna-ux-2.md`
- `pravila-erp-ux-audit-volna-ux-3.md`
- `pravila-erp-ux-audit-volny-ux-4-ux-6.md`
- `pravila-erp-ux-audit-hvost-dolgov.md`
- `pravila-sessii-49-vtoraya-polovina-obhod-04-09-gde-chto-lezhit.md`
- `pravila-sessii-47-audit-erp-03-09-gde-chto-lezhit.md`

## Планшет, раскладка, офлайн

- `pravila-erp-ui-ux-sessiya-36.md`
- `pravila-oflayna-i-plansheta-sessiya-39.md`
- `pravila-sessii-44-ustoychivost-raskladki-gde-chto-lezhit.md`
- `pravila-sessii-52-pravki-07-09-gde-chto-lezhit.md`

## Даты и время

- `pravila-erp-kalendarnye-daty-sessiya-29.md`

## Права, роли, учётные записи

- `pravila-erp-resheniya-zakazchika-po-matrice-sessiya-29.md`
- `pravila-administrirovaniya-uchetnyh-zapisey-sessiya-31.md`
- `pravila-erp-pravki-zakazchika-10-08-volna-0.md`
- `pravila-erp-pravki-zakazchika-10-08-volna-1.md`
- `pravila-erp-hvosty-dokumenta-10-08-sessiya-29.md`
- `pravila-erp-pred-prodakshen-audit-22-08-sessiya-35.md`

## Чат и каталог SKU

- `pravila-sessii-61-pr-2-chat-vnutri-sdelki-gde-chto-lezhit.md`
- `pravila-sessii-61-pr-3-katalog-sku-v-erp-gde-chto-lezhit.md`

## Order v4: вкладка «Дизайн» (веха 5а)

Карта модуля `orderstudio/design/` (ядро, ассеты, стор, холст, панель, PDF макета, сид флэтов)
и замеры бюджета — `pinhead-react/src/orderstudio/design/README.md`. Правила (что можно
и чего нельзя) — этажом выше, `../pravila-dizain-meikera-veha-5a-18-10.md`.

## Order v4: админка «Флэты и зоны» (веха 5б)

Ядро правки флэта — `orderstudio/design/edit/` (виды, зоны, якоря, размеры, id, новый флэт,
зеркальный рукав, калибровка, `validateFlat`), версии — `design/catalog/flatVersion.ts`, строки ТЗ —
`orderstudio/catalog/tzRows.ts`; экран — `orderstudio/admin/flats/` (`FlatEditor` с холстом `canvas/`,
`FlatPreview`, `saveFlat` + `useFlatEditor`, `ZonesCatalogEditor` + `zonesEdit`); замеры — раздел
«Итог 5б» в `design/README.md`. Правила — `../pravila-flety-i-zony-veha-5b-18-10.md`.

## Order v4: ТЗ в PDF, отправка и запуск (веха 6+7)

Модель ТЗ — `orderstudio/tz/model/` (группы `tzGroups`, документ `tzDocument`, раскладка `layoutTz`/
`layoutTzPrints`/`layoutPager`/`layoutGrid`, `fitText`, глифы `pdfGlyphs`/`sendGlyphs`, хэш `tzHash`, имя
`tzFileName`, чек-лист `sendChecklist`, `groupDiff`, `safeUrl`), движок — `tz/pdf/` (`tzPdf`, `drawBoxes`,
`tzImages`) на общем `design/export/pdfCore.ts`, отправка — `tz/sendToWork.ts`, экран «ТЗ и цена» —
`tz/ui/` (`TzSummary`, `SendPanel`, `ChecklistView`, `TzGroupsPanel`, `TzPreviewButton`, `ReturnBanner`),
оплата — `orderstudio/payment/`; запуск — `bridge/` (`launch`, `launchFiles`, `erpKeys`, `tzCheck`,
`erpGateway`), экран «К запуску» — `orderstudio/launch/`; фикстуры образцов — `orderstudio/fixtures/`.
Сверка имён и замеры — `orderstudio/tz/README.md`. Правила — `../pravila-tz-i-zapuska-veha-6-7-18-10.md`.

## Order v4: включение раздела, рестайл и хвосты (веха 8)

Выбор оболочки — `config/shellChoice.ts` + `ShellGate` в `App.jsx`, доступ — `orderstudio/layout/salesAccess.ts`,
флаги — `config/features.ts`, маркер сборки — `scripts/build-id.mjs`. Рестайл: `components/editors/SkuEditor.jsx`
(+ `sku/`, `sku/skuDetail/`), `components/editors/ExpressCalc.jsx` (+ `express/`), панели `components/steps/garment/*`
на модулях, `components/auth/AdminPanel.jsx`. Рабочее место: `workplace/TabMarker.jsx`, `tabState.ts`,
`OrderNotesField.jsx`, `api/serverZoneNotes.ts`, `model/garmentTextile.ts`, `catalog/allowedColors.ts`,
`ui/a11y.module.css`; журнал признаков — `admin/SalesStaffJournal.jsx`; подмена профиля — `store/devAutologin.ts`
и `store/devProfiles.ts`; смены обхода — `e2e/walk/`. Уборка — `supabase/functions/order-files-gc/`,
`scripts/lib/orderFileHolders.mjs`. Правила — `../pravila-vklyucheniya-i-restayla-veha-8-18-10.md`.

## Прочее

- `pravila-erp-audit-po-skilam.md`
- `pravila-erp-otlozhennoe-otk-sortirovka-daty-diplink-indikatory.md`
- `pravila-sessii-44-dokument-01-09-vtoraya-iteraciya-gde-chto-lezhit.md`
- `pravila-sessii-46-agentation-gde-chto-lezhit.md`
- `pravila-sessii-49-obhod-04-09-gde-chto-lezhit.md`
- `pravila-sessii-59-pravki-13-09-gde-chto-lezhit.md`
