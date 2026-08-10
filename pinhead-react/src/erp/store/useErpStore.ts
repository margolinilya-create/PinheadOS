/**
 * ERP store: цеха, производственные заказы, позиции, этапы, материалы.
 *
 * Composition-root: собирает 7 доменных слайсов (store/slices/*) в единый Zustand-стор.
 * Контракт (ErpStore) и DTO — в ./types; инфраструктура (аудит/pending/тайминги) — в
 * ./shared; общие чистые хелперы — в ./orderHelpers. Действия разнесены по слайсам
 * (рефакторинг по плану аудита, docs/erp-audit.md); публичный API и пути импорта не менялись.
 *
 * Правила Pinhead: toast.error на каждую ошибку Supabase, null при ошибке,
 * без optimistic delete, optimistic update только с rollback.
 */

import { create } from 'zustand';
import {
  bootstrapSlice,
  ordersSlice,
  stagesSlice,
  materialsSlice,
  warehouseSlice,
  procurementSlice,
  subcontractingSlice,
  employeesSlice,
  permissionsSlice,
  dictionariesSlice,
  experimentalSlice,
  tzSlice,
  planSlice,
  bypassSlice,
  realtimeSlice,
} from './slices';
import type { ErpStore } from './types';
import { clearQueryCache } from './queryCache';

export const useErpStore = create<ErpStore>((...a) => ({
  ...bootstrapSlice(...a),
  ...ordersSlice(...a),
  ...stagesSlice(...a),
  ...materialsSlice(...a),
  ...warehouseSlice(...a),
  ...procurementSlice(...a),
  ...subcontractingSlice(...a),
  ...employeesSlice(...a),
  ...permissionsSlice(...a),
  ...dictionariesSlice(...a),
  ...experimentalSlice(...a),
  ...tzSlice(...a),
  ...planSlice(...a),
  ...bypassSlice(...a),
  ...realtimeSlice(...a),
}));

/**
 * Данные стора на момент создания — снимок без действий.
 *
 * Нужен для `resetErpStore()` при смене пользователя. Массивы копируем при снятии
 * снимка И при каждом сбросе: иначе все последующие сбросы вернули бы один и тот же
 * инстанс массива, и случайная мутация протекла бы между сессиями.
 */
const INITIAL_DATA = Object.entries(useErpStore.getState())
  .filter(([, v]) => typeof v !== 'function');

/**
 * Сброс ERP-стора к исходному состоянию — вызывается при выходе из системы.
 *
 * На общем цеховом планшете `logout()` чистил localStorage, но стор оставался в
 * памяти вкладки: флаги `loaded`/`myDeptLoaded` были `true`, поэтому `ErpLayout`
 * не делал НИ ОДНОГО запроса, и следующий работник видел заказы предыдущего
 * (выборка RLS уже от чужого имени), его цех, его бейджи и колокол. Само это
 * состояние не восстанавливалось — только F5.
 *
 * `setState(..., false)` — слияние, а не замена: действия слайсов должны остаться.
 */
export function resetErpStore(): void {
  const fresh = Object.fromEntries(
    INITIAL_DATA.map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]),
  );
  useErpStore.setState(fresh as Partial<ErpStore>, false);
  /**
   * Кэш запросов — ТО ЖЕ САМОЕ место, что и стор, только вторая память.
   * Сбросить стор и оставить кэш значило бы вернуть ровно тот баг, ради
   * которого написан resetErpStore: следующий работник на общем планшете
   * получил бы пакет заказа, собранный от имени предыдущего.
   */
  clearQueryCache();
}

// Инфраструктура (currentActor/logStageEvent/withPending/тайминги) — в ./shared.
// Реэкспорт _pendingMutations — для тестов, импортирующих его отсюда.
export { _pendingMutations } from './shared';

// Общие чистые хелперы — в ./orderHelpers. Реэкспорт публичных: readyCountFor нужен
// экрану «Мой цех» и тестам, orderPreviewUrl/lastDefectPhotoUrl — карточкам/канбану/закупке.
export {
  readyCountFor, readyOnlyCountFor, overdueUnackCountFor, orderPreviewUrl, lastDefectPhotoUrl,
  activeOrdersCount, openWarehouseTaskCount, openProcurementCount,
  openSubcontractCount, activeExperimentalCount,
} from './orderHelpers';

// DTO-типы стора вынесены в ./types — реэкспорт для экранов/тестов, импортирующих их отсюда.
export type {
  ErpStore,
  StaffProfile,
  ErpOrderAuditRow,
  ErpOrderComment,
  ErpOrderAttachment,
  ErpOrderFull,
  ReportDefectOptions,
  NewPrintInput,
  NewOrderItemInput,
  NewOrderInput,
  ErpRealtimeEvent,
} from './types';

/** Слоты календаря загружаются отдельно по цеху (Фаза 3) */
export type { ErpCalendarSlot } from '../types';
