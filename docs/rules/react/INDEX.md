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

## Прочее

- `pravila-erp-audit-po-skilam.md`
- `pravila-erp-otlozhennoe-otk-sortirovka-daty-diplink-indikatory.md`
- `pravila-sessii-44-dokument-01-09-vtoraya-iteraciya-gde-chto-lezhit.md`
- `pravila-sessii-46-agentation-gde-chto-lezhit.md`
- `pravila-sessii-49-obhod-04-09-gde-chto-lezhit.md`
- `pravila-sessii-59-pravki-13-09-gde-chto-lezhit.md`
