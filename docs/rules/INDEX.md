# Указатель правил проекта

Правила, накопленные за 60+ сессий, лежат здесь по ОДНОМУ ФАЙЛУ НА СЕССИЮ —
текст перенесён из `CLAUDE.md` дословно, без единой правки.

**Почему не нарезано по темам.** Каждая секция внутри держит правила разных
тем: в «сессии 49» рядом лежат гейт материалов, доступность на планшете
и токены CSS. Нарезка по темам — это редактура каждого буллета, то есть ровно
та операция, при которой правило теряется молча. Поэтому перенос механический,
а тематический вход даёт этот указатель: он ССЫЛАЕТСЯ, а не пересказывает,
и разойтись с правилом не может, потому что правил не содержит.

**Как пользоваться.** Ищете правило по теме — берите раздел ниже и читайте
названные файлы. Ищете по слову — `grep -rn "слово" docs/rules/`.

⚠️ **Правило, записанное позже, отменяет более раннее.** Проект ловился
на этом дважды («устаревшее правило хуже отсутствующего»). Файлы названы
по дате сессии — при расхождении верьте позднему и сверяйте с живой базой.

---

## RLS, стражи и права

Кто и что может писать, как разбирается одна UPDATE-операция по колонкам,
почему гейт живёт у писателя, как проверять права на живой базе.

- `pravila-erp-security-razbor-10-08.md`
- `pravila-proverki-prav-na-zhivoy-baze-21-08-posle-razbora.md`
- `pravila-erp-resheniya-zakazchika-po-matrice-sessiya-29.md`
- `pravila-erp-sploshnoy-audit-03-09-sessiya-47.md`
- `pravila-erp-progon-04-09-sessiya-48.md`
- `pravila-erp-pred-prodakshen-audit-22-08-sessiya-35.md`
- `pravila-kataloga-sku-v-erp-pravka-14-09-p-6-pr-3-sessiya-61.md`
- `pravila-erp-pravki-zakazchika-16-09-sessiya-63.md` — узкий пропуск стража
  (метка + ровно три изменившиеся колонки), право `analytics.view` внутри
  каждой функции сводки, `revoke … from public, anon` закрывает НЕ ВСЁ

## Сторожа и тесты

Когда сторож зелен на сломанном коде, почему мутация обязательна, чем
отличается упоминание от вызова, как читать красный визуальный эталон.

- `pravila-audita-i-storozhey-defekt-10-09-sessiya-54.md`
- `pravila-erp-krasnyy-ci-sessiya-36-razbor.md`
- `pravila-vykladki-v-prod-07-09-chemu-nauchil-krasnyy-ci-na-main.md`
- `pravila-erp-kod-revyu-05-08.md`
- `pravila-ustoychivosti-raskladki-sessiya-44.md`
- `pravila-erp-pravki-zakazchika-16-09-sessiya-63.md` — тело функции обязано
  быть в `$$` (иначе `functionBody` вырезает пустоту и семь проверок молча
  перестают проверять), а сторож «нельзя обращаться к таблице» и сторож
  «нельзя ПИСАТЬ в таблицу» — разные сторожа

## Миграции и журнал

Подлинный текст функции, снимок `APPLIED.json`, почему применённую миграцию
правят новой, чем сверка с продом отличается от сверки с папкой.

- `pravila-erp-zhurnal-migraciy-31-08.md`
- `pravila-erp-audit-03-08-2026-fazy-0-5.md`
- `pravila-erp-daty-sessiya-29.md`

## Вёрстка, токены, контраст

Токены и фолбэки, контраст, кегли, тени и движение, витрина, шрифты.

- `pravila-verstki-i-vida-obhod-12-09-sessiya-56.md`
- `pravila-vitriny-06-09-sessiya-51-bumaga-i-kraska.md`
- `pravila-vitriny-07-09-vtoraya-volna-rasprostranenie-na-ves-produkt.md`
- `pravila-erp-obhod-glazami-dizaynera-04-09-sessiya-49.md`
- `pravila-erp-vtoraya-polovina-obhoda-04-09-sessiya-49.md`

## Планшет цеха, раскладка, офлайн

Компактные раскладки, тач-цели, устойчивость раскладки, service worker,
раздача и старт.

- `pravila-oflayna-i-plansheta-sessiya-39.md`
- `pravila-erp-ui-ux-sessiya-36-planshet-pilota-i-dizayn-sistema.md`
- `pravila-ustoychivosti-raskladki-sessiya-44.md`
- `pravila-razdachi-i-starta-sessiya-38-obolochka.md`
- `pravila-razdeleniya-koda-i-planovyh-dat-sessiya-39-vtoraya-polovina.md`

## Storage, уборка данных и мёртвого кода

Чем «ничей» файл отличается от живого, почему уборка требует возрастного
гейта, как считать мёртвый код и почему список устаревает от первого удаления.

- `pravila-uborki-dannyh-i-faylov-sessiya-60-chistka-13-09.md`
- `pravila-uborki-mertvogo-koda-sessiya-58.md`
- `pravila-tehdolga-07-09-vtoraya-polovina-sessii-52.md`
- `pravila-hvostov-14-09-15-09-limit-vlozheniya-i-razrabotka-bez-sdelki.md`

## Маршрут ERP, этапы, цеха

Как считается маршрут, что такое подрядный этап, гейты запуска и завершения,
закупка, склад, подряд, разработка образцов.

- `pravila-erp-podryad-kak-etap-marshruta-sessiya-32.md`
- `pravila-erp-uchastok-podryad-dokument-21-08.md`
- `pravila-erp-pravki-zakazchika-12-08-zakupka-i-model-eks.md`
- `pravila-erp-dokument-30-08-sessiya-42.md`
- `pravila-erp-dokument-01-09-sessiya-43.md`
- `pravila-erp-dokument-01-09-vtoraya-iteraciya-sessiya-44.md`
- `pravila-erp-dokument-02-09-sessiya-45.md`
- `pravila-erp-pravki-zakazchika-07-09-sessiya-52.md`
- `pravila-erp-pravki-zakazchika-12-09-sessiya-55.md`
- `pravila-erp-pravki-zakazchika-12-09-vtoraya-porciya-sessiya-57.md`
- `pravila-erp-pravki-zakazchika-13-09-sessiya-59.md`
- `pravila-erp-pravki-zakazchika-14-09-sessiya-61.md`
- `pravila-erp-pravki-zakazchika-16-09-sessiya-63.md`

## Доступ, роли и заведение сотрудников

Регистрация, приглашения, восстановление доступа, администрирование учётных
записей, две стены доступа.

- `pravila-registracii-i-vhoda-sessiya-31.md`
- `pravila-zavedeniya-sotrudnikov-priglasheniya-sessiya-31.md`
- `pravila-vosstanovleniya-dostupa-sessiya-31-volna-2.md`
- `pravila-administrirovaniya-uchetnyh-zapisey-sessiya-31-volna-3.md`
- `pravila-erp-pravki-zakazchika-10-08-volna-1.md`

## Чат и уведомления

Якорь сообщения, единственный писатель, отметки прочтения, персональные
уведомления, realtime как «звонок, а не письмо».

- `pravila-chata-vnutri-sdelki-pravka-14-09-pr-2-sessiya-61.md`
- `pravila-podgotovki-k-chatu-14-09-sessiya-61-storozh-rpc-i-uvedomleniya.md`

## Остальные разборы по датам

- `pravila-erp-pravki-zakazchika-10-08-volna-0.md`
- `pravila-erp-pravki-zakazchika-10-08-volna-2.md`
- `pravila-erp-pravki-zakazchika-10-08-volny-3-i-4.md`
- `pravila-erp-hvosty-dokumenta-10-08-sessiya-29.md`
- `pravila-erp-snyatye-otstupleniya-21-08.md`
- `pravila-erp-volny-a-f-ostatok-dokumenta-16-08.md`
- `pravila-erp-pravki-zakazchika-16-08-sessiya-32.md`
- `pravila-erp-dokument-20-08-sessiya-33-sverka.md`
- `pravila-erp-pravki-zakazchika-20-08-sessiya-33.md`
- `pravila-erp-dokument-23-08-sessiya-40.md`
- `pravila-erp-pravki-zakazchika-22-08-sessiya-37.md`
- `pravila-erp-dokument-24-08-sessiya-41.md`
- `pravila-vidzheta-obratnoy-svyazi-agentation-sessiya-46.md`
