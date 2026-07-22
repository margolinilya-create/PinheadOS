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
  ordersSlice,
  stagesSlice,
  materialsSlice,
  warehouseSlice,
  procurementSlice,
  subcontractingSlice,
  employeesSlice,
  experimentalSlice,
  realtimeSlice,
} from './slices';
import type { ErpStore } from './types';

export const useErpStore = create<ErpStore>((...a) => ({
  ...ordersSlice(...a),
  ...stagesSlice(...a),
  ...materialsSlice(...a),
  ...warehouseSlice(...a),
  ...procurementSlice(...a),
  ...subcontractingSlice(...a),
  ...employeesSlice(...a),
  ...experimentalSlice(...a),
  ...realtimeSlice(...a),
}));

// Инфраструктура (currentActor/logStageEvent/withPending/тайминги) — в ./shared.
// Реэкспорт _pendingMutations — для тестов, импортирующих его отсюда.
export { _pendingMutations } from './shared';

// Общие чистые хелперы — в ./orderHelpers. Реэкспорт публичных: readyCountFor нужен
// экрану «Мой цех» и тестам, orderPreviewUrl/lastDefectPhotoUrl — карточкам/канбану/закупке.
export {
  readyCountFor, overdueUnackCountFor, orderPreviewUrl, lastDefectPhotoUrl,
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
