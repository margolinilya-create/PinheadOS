# Правила сессии 61 (PR 3, каталог SKU в ERP): где что лежит


- **Серверная половина** — пять миграций: `20260915030910` (схема, права,
  страж, версии, статистика), `20260915031050` (единственный писатель прайса
  `erp_sku_catalog_upsert` + перевод `erp_sku_from_dev` на `sku.publish` +
  засев 52 карточек из прайса), `20260915031210` (починка `array_append`
  в триггере версий — найдена проверкой на живой базе), `20260915034120`
  (автопубликация + бэкфилл) и `20260915034723` (связь с позицией заказа).
  Сторожа: `utils/skuCardAutopublish.test.ts`, `utils/skuCardOrderLink.test.ts`
- **Стор** — `store/slices/skuSlice.ts` (ДОМЕННЫЙ: каталог открывают
  с экрана), данные в ядре (`store/domainState.ts`). `loadSkuCardDetail`
  перечитывает САМУ карточку, а не только историю и файлы: подписки realtime
  у каталога нет, и «перечитывается при открытии» обязано быть правдой
- **Экраны** — `screens/admin/SkuCatalogTab.jsx` (сетка, поиск и фильтры
  в адресе, «Завести модель» под `sku.edit`) и `screens/skuCard/SkuCardPage`
  (вкладки Описание · Технический пакет · Заказы · История; три действия —
  три права). Карточка ВНЕ админки: её открывает и вкладка SKU разработки,
  и позиция заказа — `screens/skuCard/SkuCardLink`
- **Подписи** — `utils/skuCardLabels.ts` (статусы и роли файлов) и
  `utils/skuCardFields.ts` (имена полей для истории версий, fail-open).
  В `types.ts` их держать нельзя: он едет в чанке оболочки
- **Выбор модели в заказе** — `screens/orders/create/SkuCardPicker.jsx`:
  подставляет только ПУСТЫЕ поля, архивные в выбор не попадают (кроме уже
  выбранной), без права `sku.view` блока нет вовсе
- **Права** — `permissionKeys.ts` (`sku.view`/`edit`/`publish`/`archive`),
  `utils/permissions.ts` (`DEFAULT_PERMISSIONS`), `utils/screenAccess.ts`
  (`/sku-card`), `screens/AdminScreen.jsx` (`needs` у КАЖДОЙ вкладки),
  `ErpApp.jsx` (`/admin` = `isAdmin || can('sku.view')`), `layout/Sidebar.jsx`
  (`alsoWhen`). Сторож — `utils/screenAccess.test.ts`

