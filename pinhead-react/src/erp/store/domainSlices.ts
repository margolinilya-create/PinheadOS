import { useErpStore } from './useErpStore';
import { stagesSlice } from './slices/stagesSlice';
import { materialsSlice } from './slices/materialsSlice';
import { warehouseSlice } from './slices/warehouseSlice';
import { procurementSlice } from './slices/procurementSlice';
import { subcontractingSlice } from './slices/subcontractingSlice';
import { employeesSlice } from './slices/employeesSlice';
import { invitesSlice } from './slices/invitesSlice';
import { dictionariesSlice } from './slices/dictionariesSlice';
import { experimentalSlice } from './slices/experimentalSlice';
import { tzSlice } from './slices/tzSlice';
import { planSlice } from './slices/planSlice';
import { settingsSlice } from './slices/settingsSlice';
import type { ErpStore } from './types';

/**
 * Доменные действия стора — отдельным чанком, вместе с первым экраном.
 *
 * ЗАЧЕМ. Оболочку ERP грузят ВСЕ и ВСЕГДА: это раздел по умолчанию, другого
 * пути в приложение нет. `useErpStore` собирался из всех шестнадцати слайсов
 * сразу, поэтому склад, подряд, образцы, справочники и план ехали рабочему,
 * который открывает только очередь своего цеха, — с планшета по цеховому
 * Wi-Fi. Замер: доменные слайсы весят 13,6 кБ gzip из 208,8 кБ оболочки.
 *
 * В ЯДРЕ ОСТАЛОСЬ ровно то, чем пользуется сама оболочка: `bootstrap`
 * (цеха, привязка, права), `orders` (список и бейджи), `permissions`
 * (`useErpAccess`), `bypass` (пометки снятых блокировок в счётчиках) и
 * `realtime` (подписка живёт в `ErpLayout`).
 *
 * ПОЧЕМУ ОДИН ЧАНК, А НЕ ПО СЛАЙСУ НА ЭКРАН. Разделение по экранам требует
 * знать, какому экрану какой слайс нужен, — а это знание живёт в голове и
 * разъезжается: `DeptPlanPanel` внутри очереди цеха работает со слайсом плана,
 * `createOrder` из списка заказов зовёт `createSubcontractOp` и
 * `createExperimental`. Один промах даёт «действие не функция» на боевом
 * планшете. Выигрыш от дробления — доли килобайта: слайсы мелкие, и почти всё
 * их содержимое общее (`shared`, `orderHelpers`, клиент Supabase) и всё равно
 * лежит в оболочке.
 *
 * ПЕРЕНОСЯТСЯ ТОЛЬКО ФУНКЦИИ. Данные доменных слайсов стоят в ядре
 * (`domainState.ts`) — почему, написано там же: `loadBootstrap` наполняет часть
 * из них ещё до открытия экрана, и подключение слайса с собственными
 * значениями затирало бы загруженное.
 */

const DOMAIN_SLICES = [
  stagesSlice,
  materialsSlice,
  warehouseSlice,
  procurementSlice,
  subcontractingSlice,
  employeesSlice,
  invitesSlice,
  dictionariesSlice,
  experimentalSlice,
  tzSlice,
  planSlice,
  settingsSlice,
] as const;

let attached = false;

/**
 * Прицепить доменные действия к уже созданному стору.
 *
 * Идемпотентно: модуль вычисляется один раз, но вызов защищён и от повторного —
 * второй проход пересоздал бы замыкания действий без всякой пользы.
 */
export function attachDomainSlices(): void {
  if (attached) return;
  attached = true;

  const set = useErpStore.setState;
  const get = useErpStore.getState;
  const actions: Record<string, unknown> = {};

  for (const factory of DOMAIN_SLICES) {
    const slice = (factory as unknown as (
      s: typeof set, g: typeof get, api: typeof useErpStore,
    ) => Record<string, unknown>)(set, get, useErpStore);
    for (const [key, value] of Object.entries(slice)) {
      // Данные слайса игнорируем: они уже в сторе из domainState
      if (typeof value === 'function') actions[key] = value;
    }
  }

  // `false` — слияние: состояние и действия ядра остаются на месте
  useErpStore.setState(actions as Partial<ErpStore>, false);
}

/** Прицеплены ли доменные действия — для тестов и сторожей */
export function domainSlicesAttached(): boolean {
  return attached;
}
