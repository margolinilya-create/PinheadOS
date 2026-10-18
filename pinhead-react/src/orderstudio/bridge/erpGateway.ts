/**
 * Шлюз запуска в ERP — единственный модуль Order, который берёт стор ERP.
 *
 * Сам шлюз грузится ТОЛЬКО динамически и только из `bridge/launch.ts`
 * (по «Запустить в производство»): статических импортёров у него нет, это
 * держит сторож `erpImports.test.ts`. Поэтому стор ERP не попадает ни в
 * оболочку Order, ни в экран «К запуску».
 *
 * ПОЧЕМУ ШЛЮЗ, А НЕ ТРИ `import()` ПРЯМО В `launch.ts` (задача 7 вехи 6+7).
 * Rollup режет чанки по набору точек входа, из которых модуль достижим.
 * Три прямых `import()` модулей ERP были тремя НОВЫМИ точками входа, и каждая
 * достигала только части общего чанка ядра стора ERP:
 * - `useErpStore` достигал ядра, но не `erp/utils/statusUi` — ядро
 *   распалось на два чанка;
 * - `orderPayload` (и экран «К запуску» через `tzToErpDraft`) достигал
 *   `erp/utils/garmentSource` без ядра — третий чанк;
 * - каждый `import()` модуля внутри общего чанка добавлял туда объект
 *   пространства имён.
 * Оболочка ERP выросла на 1 001 Б (+707 Б gzip, потолок 195 000 пробит),
 * хотя ERP не менялся ни строкой. Шлюз — ОДНА точка входа, чей граф
 * совпадает с ядром стора: стор, `statusUi`, `garmentSource`, `orderPayload`,
 * `lazyScreen`. Тогда набор точек входа у всех модулей ядра один и тот же,
 * ядро остаётся одним чанком, а пространство имён живёт в чанке шлюза.
 *
 * `statusUi` запуску не нужен — это ЯКОРЬ ГРАФА (поле `graphAnchor`): без
 * него ядро снова режется. Мутация «убрать якорь» краснит
 * `npm run bundle:budget` (оболочка ERP против базы). Код в шлюзе (а не голые
 * реэкспорты) нужен тоже: чанк из одних реэкспортов Rollup вклеивает в соседний,
 * и порядок экспортов общих чанков ERP плывёт. Замеры — `tz/README.md`.
 *
 * ERP заморожен: набор модулей ровно этот, сторож сверяет его списком.
 */
import { ensureDomainSlices } from '../../erp/lazyScreen';
import { useErpStore } from '../../erp/store/useErpStore';
import { createOrderPayload, payloadItems } from '../../erp/screens/orders/create/orderPayload';
import { itemNeedsPurchase } from '../../erp/utils/garmentSource';
import { statusUi } from '../../erp/utils/statusUi';

export interface ErpLaunchModules {
  store: typeof useErpStore;
  payload: { payloadItems: typeof payloadItems; createOrderPayload: typeof createOrderPayload };
  /** Нужна ли позиции закупка — правило ERP для `purchase_required` заказа */
  itemNeedsPurchase: typeof itemNeedsPurchase;
  /** Якорь графа чанков (см. шапку), запуском не используется */
  graphAnchor: typeof statusUi;
}

/** Стор ERP с доменными слайсами и справочниками — то же, что получает экран ERP */
export async function loadErpForLaunch(): Promise<ErpLaunchModules> {
  await ensureDomainSlices();
  await useErpStore.getState().loadBootstrap();
  return {
    store: useErpStore,
    payload: { payloadItems, createOrderPayload },
    itemNeedsPurchase,
    graphAnchor: statusUi,
  };
}
