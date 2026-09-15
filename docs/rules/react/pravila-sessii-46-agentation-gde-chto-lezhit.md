# Правила сессии 46 (Agentation): где что лежит


- Виджет обратной связи (agentation.com, версия 3.0.2) —
  `components/shared/DevAnnotations.jsx`, смонтирован ОДИН раз
  в `GlobalHosts` (`App.jsx`): работает и в ERP, и в Order Studio,
  и на экранах входа. Пакет в `dependencies` — он едет в прод-сборку
- Кому видно: в dev — всем, в проде — `admin`/`director` (`PROD_ROLES`,
  роль настоящая, не `previewRole`). Общий выключатель — `VITE_AGENTATION=0`
- `lazy()` обязателен: чанк 92,6 кБ gzip приезжает после первой отрисовки
  и только тому, кому виджет показан. Статический импорт добавил бы 91 кБ
  gzip в критический путь КАЖДОМУ — сторожит `scripts/bundle-budget.mjs`
- Адрес MCP-сервера (`ENDPOINT`) передаётся только в dev либо явным
  `VITE_AGENTATION_ENDPOINT`. В проде адреса НЕТ намеренно: сервер локальный,
  и переданный адрес дал бы висящий опрос недостижимого хоста и CSP-репорты
- Сторожа ЧЕТЫРЕ: `DevAnnotations.test.jsx` (кому видно и с каким адресом),
  `DevAnnotations.sources.test.ts` (единственность точки монтирования —
  `.ts` из-за `no-undef` на `process` в `.jsx`), `scripts/bundle-budget.mjs`
  (виджет не в критическом пути), `lib/e2eEnv.test.ts` (`VITE_AGENTATION=0`
  у ОБОИХ серверов Playwright — оба поднимаются админом)
- `npm run e2e` тулбар не рисует: иначе он попадает в визуальные эталоны,
  под сканер доступности и в замеры раскладки `erp-cls`

