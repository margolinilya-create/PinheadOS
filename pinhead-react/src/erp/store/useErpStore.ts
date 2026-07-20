/**
 * ERP store: цеха, производственные заказы, позиции, этапы, материалы.
 *
 * Правила Pinhead: toast.error на каждую ошибку Supabase, null при ошибке,
 * без optimistic delete, optimistic update только с rollback.
 */

import { create } from 'zustand';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { useAuthStore } from '../../store/useAuthStore';
import { buildRoute, isStageReady, isStageAwaitingProcurement } from '../utils/routes';
import { isOrderReadyToShip } from '../utils/stageUi';
import { daysLeft } from '../utils/time';
import {
  currentActor,
  logStageEvent,
  withPending,
  _pendingMutations,
  REALTIME_DEFER_MS,
  FULL_RELOAD_DEBOUNCE_MS,
} from './shared';
import type {
  BrandingMethod,
  BrandingOn,
  ErpItemPrint,
  SizeGridRow,
  ErpCalendarSlot,
  ErpDepartment,
  ErpEmployee,
  ErpItemStage,
  ErpMaterial,
  ErpOrder,
  ErpOrderItem,
  ErpOrderStatus,
  ErpProcurementTask,
  ErpStageEvent,
  ErpSubcontractOp,
  ProductionType,
  StageStatus,
} from '../types';

// Инфраструктура (currentActor/logStageEvent/withPending/_pendingMutations/тайминги)
// вынесена в ./shared. Реэкспорт _pendingMutations — для тестов, импортирующих его отсюда.
export { _pendingMutations };

/** Таймер debounce полной перезагрузки (реассайнится здесь — держим локально) */
let fullReloadTimer: ReturnType<typeof setTimeout> | null = null;

/** Профиль из общей таблицы profiles (единый источник сотрудников с Order Studio) */
export interface StaffProfile {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  approved: boolean;
  active: boolean | null;
}

export interface ErpOrderAuditRow {
  id: string;
  order_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
}

export interface ErpOrderComment {
  id: string;
  order_id: string;
  author: string;
  text: string;
  created_at: string;
}

/** Заказ со вложенными позициями/этапами/материалами (join при загрузке) */
export interface ErpOrderAttachment {
  id: string;
  order_id: string;
  file_path: string;
  file_name: string | null;
  kind: 'preview' | 'attachment';
  uploaded_by: string | null;
  created_at: string;
}

export interface ErpOrderFull extends ErpOrder {
  items: (ErpOrderItem & { stages: ErpItemStage[]; prints?: ErpItemPrint[] })[];
  materials: ErpMaterial[];
  attachments?: ErpOrderAttachment[];
  procurement_tasks?: ErpProcurementTask[];
}

/**
 * Параметры возврата брака (правка 3): пользователь выбирает этап устранения.
 * target: 'current' — переделка на месте; <stageId> — перенос на конкретный этап
 * (в т.ч. закрой); 'procurement' — материал испорчен, нужна закупка.
 * needsMaterial — создать задачу закупки при любом target.
 */
export interface ReportDefectOptions {
  qty: number;
  reason: string;
  target?: 'current' | 'procurement' | (string & {});
  needsMaterial?: boolean;
  cause?: import('../types').ProcurementCauseType;
  supplier?: string | null;
  plannedDate?: string | null;
  materialName?: string | null;
  requiredQty?: string | null;
}

/** Публичный URL превью заказа (первое вложение kind=preview) */
export function orderPreviewUrl(order: ErpOrderFull): string | null {
  const att = order.attachments?.find((a) => a.kind === 'preview');
  if (!att) return null;
  return supabase.storage.from('erp-attachments').getPublicUrl(att.file_path).data.publicUrl;
}

/** URL последнего фото брака заказа (вложение с префиксом «Брак:») */
export function lastDefectPhotoUrl(order: ErpOrderFull): string | null {
  const atts = (order.attachments ?? []).filter(
    (a) => a.kind === 'attachment' && (a.file_name ?? '').startsWith('Брак:'));
  if (atts.length === 0) return null;
  const att = atts[atts.length - 1];
  return supabase.storage.from('erp-attachments').getPublicUrl(att.file_path).data.publicUrl;
}

export interface NewPrintInput {
  method: BrandingMethod;
  fabric?: string;
  zone?: string;
  width_mm?: number | null;
  height_mm?: number | null;
  offset_note?: string;
  pantone?: string;
  comment?: string;
}

export interface NewOrderItemInput {
  product_type: string;
  variant?: string;
  qty: number;
  production_type: ProductionType;
  branding_methods: BrandingMethod[];
  branding_on: BrandingOn;
  notes?: string;
  size_grid?: SizeGridRow[] | null;
  prints?: NewPrintInput[];
}

export interface NewOrderInput {
  bitrix_id?: string;
  title: string;
  manager?: string;
  launch_date?: string;
  due_date?: string;
  buffer_days?: number;
  notes?: string;
  packaging?: string;
  packaging_note?: string;
  stickers?: string;
  stickers_note?: string;
  no_chestny_znak?: boolean;
  items: NewOrderItemInput[];
}

/** Нормализованное realtime-событие postgres_changes (для точечного применения) */
export interface ErpRealtimeEvent {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

interface ErpStore {
  departments: ErpDepartment[];
  orders: ErpOrderFull[];
  employees: ErpEmployee[];
  profilesList: StaffProfile[];
  employeesLoaded: boolean;
  /** Подряд: операции у внешних подрядчиков (грузятся лениво по вкладке) */
  subcontracting: ErpSubcontractOp[];
  subcontractingLoaded: boolean;
  loading: boolean;
  loaded: boolean;
  /** Ошибка загрузки loadAll — для inline-блока «Не удалось загрузить · Повторить» */
  loadError: boolean;
  /** Архив (status != active) грузится лениво — при первом заходе на вкладку */
  archiveLoaded: boolean;
  archiveLoading: boolean;
  /** Цех текущего пользователя (erp_employees.department_id по profile_id) */
  myDeptId: string | null;
  myDeptLoaded: boolean;

  /** Основная загрузка: только активные заказы (архив — loadArchive) */
  loadAll: () => Promise<void>;
  /** Ленивая загрузка архива (status != active) при первом заходе на вкладку */
  loadArchive: () => Promise<void>;
  /** Перезагрузка одного заказа тем же вложенным select (upsert в стор) */
  loadOne: (orderId: string) => Promise<ErpOrderFull | null>;
  /** Точечное применение realtime-события (экспорт действия — для тестов) */
  applyRealtimeEvent: (ev: ErpRealtimeEvent) => void;
  /** Автопривязка цеха: ищет erp_employees по profile_id текущего пользователя */
  loadMyDept: (profileId: string | undefined) => Promise<void>;
  createOrder: (input: NewOrderInput) => Promise<ErpOrderFull | null>;
  updateOrder: (id: string, patch: Partial<ErpOrder>) => Promise<boolean>;
  /**
   * Отгрузка готового заказа: status → done_* (по сроку клиента),
   * shipped_status → shipped, shipped_at/shipped_by. Заказ уходит в архив.
   */
  shipOrder: (orderId: string) => Promise<boolean>;
  deleteOrder: (id: string) => Promise<boolean>;
  setStageStatus: (
    stageId: string,
    status: StageStatus,
    extra?: { qty_done?: number; block_reason?: string | null; comment?: string },
  ) => Promise<boolean>;
  /**
   * Частичная готовность: qty_done += qty; при qty_done >= qty позиции
   * этап закрывается (done), иначе остаётся in_progress с прогрессом «300/500».
   */
  reportProgress: (stageId: string, qty: number) => Promise<boolean>;
  /** Брак: пользователь выбирает этап устранения; при необходимости — задача закупки */
  reportDefect: (stageId: string, opts: ReportDefectOptions) => Promise<boolean>;
  /** Последние события возврата брака по этапам (для баннера получателю) */
  loadStageReworkEvents: (stageIds: string[]) => Promise<Record<string, ErpStageEvent>>;
  /** Фото брака/блокировки: файл в bucket erp-attachments + запись kind=attachment */
  uploadOrderAttachment: (orderId: string, file: File, note?: string) => Promise<boolean>;
  /** Ручные плановые даты этапа */
  setStagePlan: (
    stageId: string,
    plan: { planned_start?: string | null; planned_end?: string | null },
  ) => Promise<boolean>;
  loadOrderEvents: (orderId: string) => Promise<ErpStageEvent[] | null>;
  loadOrderAudit: (orderId: string) => Promise<ErpOrderAuditRow[] | null>;
  uploadOrderPreview: (orderId: string, file: File) => Promise<boolean>;
  loadComments: (orderId: string) => Promise<ErpOrderComment[] | null>;
  addComment: (orderId: string, text: string) => Promise<ErpOrderComment | null>;
  addMaterial: (
    orderId: string,
    material: Partial<ErpMaterial> & Pick<ErpMaterial, 'kind' | 'name'>,
  ) => Promise<ErpMaterial | null>;
  updateMaterial: (id: string, patch: Partial<ErpMaterial>) => Promise<boolean>;
  /** Подтвердить наличие материала со склада → «Доступен со склада» (открывает закрой) */
  confirmStockMaterial: (id: string) => Promise<boolean>;
  /** Все материалы заказа готовы → закрыть этап «Закупка» (received/reserved/not_needed) */
  maybeCloseSupply: (orderId: string) => Promise<void>;
  /** Задача закупки (возврат из закроя → дозакупка/замена, не трогая исходную закупку) */
  createProcurementTask: (
    orderId: string,
    task: Partial<ErpProcurementTask> & Pick<ErpProcurementTask, 'material_name' | 'cause_type'>,
  ) => Promise<ErpProcurementTask | null>;
  updateProcurementTask: (id: string, patch: Partial<ErpProcurementTask>) => Promise<boolean>;
  /** Подряд: список операций у подрядчиков (join заголовок заказа) */
  loadSubcontracting: () => Promise<void>;
  createSubcontractOp: (
    op: Partial<ErpSubcontractOp> & Pick<ErpSubcontractOp, 'order_id' | 'operation'>,
  ) => Promise<ErpSubcontractOp | null>;
  updateSubcontractOp: (id: string, patch: Partial<ErpSubcontractOp>) => Promise<boolean>;

  /** Realtime: доска/очереди обновляются сами; возвращает отписку */
  subscribeRealtime: () => () => void;
  loadEmployees: () => Promise<void>;
  createEmployee: (emp: Partial<ErpEmployee> & { full_name: string }) => Promise<ErpEmployee | null>;
  updateEmployee: (id: string, patch: Partial<ErpEmployee>) => Promise<boolean>;
  /** Профили общие с Order Studio: те же действия, что в Админке */
  updateProfile: (id: string, patch: Partial<StaffProfile>) => Promise<boolean>;
  /** Цеховая надстройка профиля: upsert erp_employees по profile_id */
  upsertProfileDept: (
    profile: StaffProfile,
    patch: Partial<Pick<ErpEmployee, 'department_id' | 'role' | 'notes'>>,
  ) => Promise<boolean>;
}

const ORDER_SELECT = `
  *,
  items:erp_order_items (
    *,
    stages:erp_item_stages (*),
    prints:erp_item_prints (*)
  ),
  materials:erp_materials (*),
  attachments:erp_order_attachments (*),
  procurement_tasks:erp_procurement_tasks (*)
`;

function sortOrderFull(o: ErpOrderFull): ErpOrderFull {
  return {
    ...o,
    items: [...(o.items ?? [])]
      .map((it) => ({
        ...it,
        stages: [...(it.stages ?? [])].sort((a, b) => a.sort_order - b.sort_order),
      }))
      .sort((a, b) => a.sort_order - b.sort_order),
    materials: o.materials ?? [],
    procurement_tasks: o.procurement_tasks ?? [],
  };
}

/** Найти этап по id вместе с позицией и заказом */
function findStage(
  orders: ErpOrderFull[],
  stageId: string,
): { order: ErpOrderFull; item: ErpOrderFull['items'][number]; stage: ErpItemStage } | null {
  for (const order of orders) {
    for (const item of order.items) {
      const stage = item.stages.find((s) => s.id === stageId);
      if (stage) return { order, item, stage };
    }
  }
  return null;
}

/**
 * Точечный патч этапа: пересоздаются ТОЛЬКО заказ/позиция с этим этапом,
 * остальные заказы сохраняют объектную идентичность (критично для ререндеров).
 */
function patchStageIn(
  orders: ErpOrderFull[],
  stageId: string,
  patch: Partial<ErpItemStage>,
): ErpOrderFull[] {
  return orders.map((order) => {
    if (!order.items.some((it) => it.stages.some((st) => st.id === stageId))) return order;
    return {
      ...order,
      items: order.items.map((it) =>
        it.stages.some((st) => st.id === stageId)
          ? {
              ...it,
              stages: it.stages.map((st) => (st.id === stageId ? { ...st, ...patch } : st)),
            }
          : it),
    };
  });
}

/**
 * Обёртка применения realtime-изменений: если после них в цехе пользователя
 * прибавилось работ «готово/в работе» — уведомляем (как раньше при loadAll).
 */
function withNewWorkToast(
  get: () => { orders: ErpOrderFull[]; departments: ErpDepartment[] },
  apply: () => void | Promise<unknown>,
): Promise<void> {
  const myDept =
    typeof localStorage !== 'undefined' ? localStorage.getItem('erp_my_dept') : null;
  const before = myDept
    ? readyCountFor(get().orders, get().departments, myDept)
    : 0;
  return Promise.resolve(apply()).then(() => {
    if (!myDept) return;
    const after = readyCountFor(get().orders, get().departments, myDept);
    if (after > before) toast.success('В вашем цехе появилась новая работа');
  });
}

/** Сколько работ «готово/в работе» в цехе — для уведомления и бейджа «Мой цех» */
export function readyCountFor(orders: ErpOrderFull[], departments: ErpDepartment[], deptCode: string): number {
  const dept = departments.find((d) => d.code === deptCode);
  if (!dept) return 0;
  let n = 0;
  for (const o of orders) {
    if (o.status !== 'active') continue;
    for (const it of o.items) {
      for (const st of it.stages) {
        if (st.department_id !== dept.id) continue;
        if (st.status === 'in_progress') n += 1;
        else if (
          st.status === 'waiting' &&
          isStageReady(
            st, it.stages, o.materials, deptCode,
            isStageAwaitingProcurement(o.procurement_tasks, st.id),
          )
        ) n += 1;
      }
    }
  }
  return n;
}

export const useErpStore = create<ErpStore>((set, get) => ({
  departments: [],
  orders: [],
  employees: [],
  profilesList: [],
  employeesLoaded: false,
  subcontracting: [],
  subcontractingLoaded: false,
  loading: false,
  loaded: false,
  loadError: false,
  archiveLoaded: false,
  archiveLoading: false,
  myDeptId: null,
  myDeptLoaded: false,

  loadMyDept: async (profileId) => {
    // dev-режим и отсутствие логина — свободный выбор, запрос не нужен
    if (!profileId || profileId === 'dev') {
      set({ myDeptId: null, myDeptLoaded: true });
      return;
    }
    const { data, error } = await supabase
      .from('erp_employees')
      .select('department_id')
      .eq('profile_id', profileId)
      .eq('active', true)
      .limit(1);
    if (error) {
      toast.error('Не удалось определить ваш цех');
      set({ myDeptLoaded: true });
      return;
    }
    set({ myDeptId: data?.[0]?.department_id ?? null, myDeptLoaded: true });
  },

  loadAll: async () => {
    set({ loading: true, loadError: false });
    // Архив лениво (п.26): пока архив не открывали — грузим только активные.
    // Если архив уже загружен, полная перезагрузка обновляет и его.
    let ordersQuery = supabase
      .from('erp_orders')
      .select(ORDER_SELECT)
      .order('due_date', { ascending: true, nullsFirst: false });
    if (!get().archiveLoaded) ordersQuery = ordersQuery.eq('status', 'active');
    const [deps, orders] = await Promise.all([
      supabase.from('erp_departments').select('*').order('sort_order'),
      ordersQuery,
    ]);
    if (deps.error || orders.error) {
      toast.error('Не удалось загрузить данные ERP');
      set({ loading: false, loadError: true });
      return;
    }
    set({
      departments: (deps.data ?? []) as ErpDepartment[],
      orders: ((orders.data ?? []) as ErpOrderFull[]).map(sortOrderFull),
      loading: false,
      loaded: true,
    });
  },

  loadArchive: async () => {
    if (get().archiveLoading || get().archiveLoaded) return;
    set({ archiveLoading: true });
    const { data, error } = await supabase
      .from('erp_orders')
      .select(ORDER_SELECT)
      .neq('status', 'active')
      .order('due_date', { ascending: true, nullsFirst: false });
    if (error) {
      toast.error('Не удалось загрузить архив');
      set({ archiveLoading: false });
      return;
    }
    set((s) => ({
      orders: [
        ...s.orders.filter((o) => o.status === 'active'),
        ...((data ?? []) as ErpOrderFull[]).map(sortOrderFull),
      ],
      archiveLoading: false,
      archiveLoaded: true,
    }));
  },

  loadOne: async (orderId) => {
    const { data, error } = await supabase
      .from('erp_orders')
      .select(ORDER_SELECT)
      .eq('id', orderId)
      .maybeSingle();
    if (error) {
      toast.error('Не удалось загрузить заказ');
      return null;
    }
    if (!data) return null;
    const full = sortOrderFull(data as ErpOrderFull);
    set((s) => ({
      orders: s.orders.some((o) => o.id === full.id)
        ? s.orders.map((o) => (o.id === full.id ? full : o))
        : [full, ...s.orders],
    }));
    return full;
  },

  createOrder: async (input) => {
    const { departments } = get();
    const deptByCode = new Map(departments.map((d) => [d.code, d]));
    const { items, ...orderFields } = input;

    // Маршрут (этапы + depends_on) считается на клиенте как раньше (buildRoute),
    // а RPC erp_create_order атомарно вставляет всё в одной транзакции (п.28).
    // depends_on в payload — индексы этапов той же позиции (всегда более ранних).
    const payload = {
      order: { ...orderFields, status: 'active' },
      items: items.map((it, i) => {
        const route = buildRoute({
          productionType: it.production_type,
          brandingMethods: it.branding_methods,
          brandingOn: it.branding_on ?? 'cut',
        });
        const valid = route.filter((r) => deptByCode.has(r.departmentCode));
        const codeToIdx = new Map(valid.map((r, idx) => [r.departmentCode, idx]));
        return {
          product_type: it.product_type,
          variant: it.variant || null,
          qty: it.qty,
          production_type: it.production_type,
          branding_methods: it.branding_methods,
          branding_on: it.branding_on,
          notes: it.notes || null,
          size_grid: it.size_grid ?? null,
          sort_order: (i + 1) * 10,
          prints: (it.prints ?? []).map((p, j) => ({
            seq: j + 1,
            method: p.method,
            fabric: p.fabric || null,
            zone: p.zone || null,
            width_mm: p.width_mm ?? null,
            height_mm: p.height_mm ?? null,
            offset_note: p.offset_note || null,
            pantone: p.pantone || null,
            comment: p.comment || null,
          })),
          stages: valid.map((r) => ({
            department_id: deptByCode.get(r.departmentCode)!.id,
            sort_order: r.sortOrder,
            depends_on: r.dependsOnCodes
              .map((c) => codeToIdx.get(c))
              .filter((x): x is number => x !== undefined),
          })),
        };
      }),
      materials: [],
    };

    const { data, error } = await supabase.rpc('erp_create_order', { payload });
    if (error || !data) {
      toast.error('Не удалось создать заказ');
      return null;
    }
    // Созданный заказ забираем тем же вложенным select
    return get().loadOne(data as string);
  },

  updateOrder: async (id, patch) => {
    const prev = get().orders;
    // optimistic с rollback + pending-ключ (защита от «старого» realtime)
    set((s) => ({
      orders: s.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
    const { error } = await withPending(`order:${id}`, () =>
      supabase.from('erp_orders').update(patch).eq('id', id));
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось обновить заказ');
      return false;
    }
    return true;
  },

  shipOrder: async (orderId) => {
    const prev = get().orders;
    const order = prev.find((o) => o.id === orderId);
    if (!order) return false;
    // отгружать можно только готовый заказ (все этапы done/skipped)
    if (!isOrderReadyToShip(order)) {
      toast.error('Заказ ещё не готов к отгрузке');
      return false;
    }
    // архивный статус — по сроку клиента (как в ORDER_STATUS_LABELS)
    const d = daysLeft(order.due_date);
    const status: ErpOrderStatus =
      d === null || d === 0 ? 'done_on_time' : d < 0 ? 'done_late' : 'done_early';
    // dev-режим: user.id 'dev' — не валидный uuid (паттерн useOrdersStore)
    const userId = useAuthStore.getState().user?.id;
    const patch: Partial<ErpOrder> = {
      status,
      shipped_status: 'shipped',
      shipped_at: new Date().toISOString(),
      shipped_by: userId && userId !== 'dev' ? userId : null,
    };

    // optimistic с rollback + pending-ключ (защита от «старого» realtime)
    set((s) => ({
      orders: s.orders.map((o) => (o.id === orderId ? { ...o, ...patch } : o)),
    }));
    const { error } = await withPending(`order:${orderId}`, () =>
      supabase.from('erp_orders').update(patch).eq('id', orderId));
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось отгрузить заказ');
      return false;
    }
    toast.success('Заказ отгружен и перемещён в архив');
    return true;
  },

  deleteOrder: async (id) => {
    // НЕ optimistic — ждём Supabase
    const { error } = await supabase.from('erp_orders').delete().eq('id', id);
    if (error) {
      toast.error('Не удалось удалить заказ');
      return false;
    }
    set((s) => ({ orders: s.orders.filter((o) => o.id !== id) }));
    return true;
  },

  setStageStatus: async (stageId, status, extra = {}) => {
    const prev = get().orders;
    const { comment, ...fields } = extra;
    const patch: Partial<ErpItemStage> = { status, ...fields };
    if (status === 'in_progress') patch.started_at = new Date().toISOString();
    if (status === 'done') patch.finished_at = new Date().toISOString();

    // найдём заказ и прежний статус для аудита
    const found = findStage(prev, stageId);

    // optimistic с rollback (нетронутые заказы сохраняют идентичность)
    set((s) => ({ orders: patchStageIn(s.orders, stageId, patch) }));
    const { error } = await withPending(`stage:${stageId}`, () =>
      supabase.from('erp_item_stages').update(patch).eq('id', stageId));
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось обновить этап');
      return false;
    }
    if (found) {
      logStageEvent({
        stage_id: stageId,
        order_id: found.order.id,
        from_status: found.stage.status,
        to_status: status,
        qty_done: extra.qty_done ?? null,
        qty_rework: null,
        comment: comment ?? extra.block_reason ?? null,
      });
    }
    return true;
  },

  reportProgress: async (stageId, qty) => {
    const prev = get().orders;
    const found = findStage(prev, stageId);
    if (!found || !(qty > 0)) return false;
    const { stage, item, order } = found;

    const total = item.qty;
    const newDone = Math.min((stage.qty_done ?? 0) + qty, total);
    const isDone = newDone >= total;
    if ((stage.qty_done ?? 0) + qty > total) {
      toast.warning(`Введено больше остатка — засчитано ${total - (stage.qty_done ?? 0)} шт (до полного тиража)`);
    }
    const patch: Partial<ErpItemStage> = { qty_done: newDone };
    if (isDone) {
      patch.status = 'done';
      patch.finished_at = new Date().toISOString();
    }

    // optimistic с rollback
    set((s) => ({ orders: patchStageIn(s.orders, stageId, patch) }));
    const { error } = await withPending(`stage:${stageId}`, () =>
      supabase.from('erp_item_stages').update(patch).eq('id', stageId));
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось записать прогресс');
      return false;
    }
    logStageEvent({
      stage_id: stageId,
      order_id: order.id,
      from_status: stage.status,
      to_status: isDone ? 'done' : stage.status,
      qty_done: qty,
      qty_rework: null,
      comment: `Частичная готовность: ${newDone}/${total}`,
    });
    return true;
  },

  reportDefect: async (stageId, opts) => {
    const {
      qty, reason, target = 'current', needsMaterial = false,
      cause = 'other', supplier = null, plannedDate = null,
      materialName = null, requiredQty = null,
    } = opts;
    const prev = get().orders;
    const found = findStage(prev, stageId);
    if (!found || !(qty > 0)) return false;
    const { stage, order, item } = found;

    // брак не может превышать тираж позиции
    if (item.qty > 0 && qty > item.qty) {
      toast.error(`Брак не может превышать тираж (${item.qty} шт)`);
      return false;
    }
    // ...и не больше, чем этап реально сделал (аудит correctness #3)
    const processed = stage.qty_done ?? 0;
    if (processed > 0 && qty > processed) {
      toast.error(`Брак не может превышать сделанное на этапе (${processed} шт)`);
      return false;
    }

    const dept = get().departments.find((d) => d.id === stage.department_id);
    const deptName = dept?.name || 'цех';

    // Целевой этап устранения: конкретный этап позиции (в т.ч. закрой), либо null
    const byId = new Map(item.stages.map((s) => [s.id, s]));
    const targetStage =
      target !== 'current' && target !== 'procurement' ? byId.get(target) ?? null : null;

    // Патчи этапов
    const patches: { id: string; patch: Partial<ErpItemStage> }[] = [];
    if (targetStage) {
      // Текущий S: снять N с готовых, вернуть в очередь, +брак
      patches.push({
        id: stage.id,
        patch: {
          qty_done: Math.max((stage.qty_done ?? 0) - qty, 0),
          qty_rework: (stage.qty_rework ?? 0) + qty,
          status: stage.status === 'done' ? 'waiting' : stage.status,
          finished_at: stage.status === 'done' ? null : stage.finished_at,
        },
      });
      // Целевой этап T: переоткрыть на N штук
      patches.push({
        id: targetStage.id,
        patch: {
          status: 'in_progress',
          qty_done: Math.max((targetStage.qty_done ?? 0) - qty, 0),
          qty_rework: (targetStage.qty_rework ?? 0) + qty,
          finished_at: null,
        },
      });
      // Промежуточные этапы между T и S тоже переоткрыть на N — перекроенные единицы
      // должны заново пройти их (аудит correctness #4), иначе они «застрянут» в done.
      const lo = Math.min(targetStage.sort_order, stage.sort_order);
      const hi = Math.max(targetStage.sort_order, stage.sort_order);
      for (const mid of item.stages) {
        if (mid.id === stage.id || mid.id === targetStage.id) continue;
        if (mid.sort_order <= lo || mid.sort_order >= hi) continue;
        if (mid.status !== 'done' && mid.status !== 'in_progress') continue;
        patches.push({
          id: mid.id,
          patch: {
            status: 'waiting',
            qty_done: Math.max((mid.qty_done ?? 0) - qty, 0),
            qty_rework: (mid.qty_rework ?? 0) + qty,
            finished_at: null,
          },
        });
      }
    } else if (target === 'procurement') {
      // Материал испорчен: N уходят в ожидание закупки нового материала
      patches.push({
        id: stage.id,
        patch: {
          qty_done: Math.max((stage.qty_done ?? 0) - qty, 0),
          qty_rework: (stage.qty_rework ?? 0) + qty,
          status: 'waiting',
          finished_at: null,
        },
      });
    } else {
      // 'current' — переделка на месте
      patches.push({
        id: stage.id,
        patch: {
          qty_rework: (stage.qty_rework ?? 0) + qty,
          status: 'in_progress',
          finished_at: null,
        },
      });
    }

    // optimistic с rollback
    let next = prev;
    for (const p of patches) next = patchStageIn(next, p.id, p.patch);
    set({ orders: next });
    const results = await Promise.all(
      patches.map((p) =>
        withPending(`stage:${p.id}`, () =>
          supabase.from('erp_item_stages').update(p.patch).eq('id', p.id))),
    );
    if (results.some((r) => r.error)) {
      set({ orders: prev });
      toast.error('Не удалось записать брак');
      return false;
    }

    // Аудит: событие на получателе (целевой этап, если есть)
    const receiver = targetStage ?? stage;
    logStageEvent({
      stage_id: receiver.id,
      order_id: order.id,
      from_status: receiver.status,
      to_status: 'in_progress',
      qty_done: null,
      qty_rework: qty,
      comment: targetStage ? `Возврат брака из «${deptName}»: ${reason}` : `Брак (${deptName}): ${reason}`,
    });

    // Правки 1-2: нужна закупка → отдельная задача закупщику (исходную закупку не трогаем)
    if (needsMaterial || target === 'procurement') {
      const task = await get().createProcurementTask(order.id, {
        item_id: item.id,
        source_stage_id: stage.id,
        initiating_dept: dept?.code ?? null,
        material_name: materialName || 'Материал (уточнить)',
        rework_qty: qty,
        required_qty: requiredQty,
        cause_type: cause,
        reason,
        supplier,
        planned_date: plannedDate,
      });
      // Аудит-агент: этап уже в waiting/переделке — если заявка не создалась, предупреждаем,
      // иначе этап «ждёт закупку», которой нет (createProcurementTask сам покажет error).
      if (!task) toast.warning('Брак записан, но заявка на закупку не создана — создайте вручную');
    }
    return true;
  },

  loadStageReworkEvents: async (stageIds) => {
    if (stageIds.length === 0) return {};
    const { data, error } = await supabase
      .from('erp_stage_events')
      .select('*')
      .in('stage_id', stageIds)
      .not('qty_rework', 'is', null)
      .order('created_at', { ascending: false });
    if (error) return {};
    const map: Record<string, ErpStageEvent> = {};
    for (const ev of (data ?? []) as ErpStageEvent[]) {
      if (!map[ev.stage_id]) map[ev.stage_id] = ev;
    }
    return map;
  },

  setStagePlan: async (stageId, plan) => {
    const prev = get().orders;
    set((s) => ({ orders: patchStageIn(s.orders, stageId, plan) }));
    const { error } = await withPending(`stage:${stageId}`, () =>
      supabase.from('erp_item_stages').update(plan).eq('id', stageId));
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось сохранить план этапа');
      return false;
    }
    return true;
  },

  loadOrderEvents: async (orderId) => {
    const { data, error } = await supabase
      .from('erp_stage_events')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      toast.error('Не удалось загрузить историю');
      return null;
    }
    return (data ?? []) as ErpStageEvent[];
  },

  uploadOrderPreview: async (orderId, file) => {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${orderId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('erp-attachments')
      .upload(path, file, { contentType: file.type || 'image/png' });
    if (upErr) {
      toast.error('Не удалось загрузить превью');
      return false;
    }
    const { data, error } = await supabase
      .from('erp_order_attachments')
      .insert({
        order_id: orderId,
        file_path: path,
        file_name: file.name,
        kind: 'preview',
        uploaded_by: currentActor(),
      })
      .select();
    const row = data?.[0] as ErpOrderAttachment | undefined;
    if (error || !row) {
      toast.error('Превью загружено, но не привязано к заказу');
      return false;
    }
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === orderId
          ? { ...o, attachments: [...(o.attachments ?? []), row] }
          : o),
    }));
    return true;
  },

  uploadOrderAttachment: async (orderId, file, note) => {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${orderId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('erp-attachments')
      .upload(path, file, { contentType: file.type || 'image/jpeg' });
    if (upErr) {
      toast.error('Не удалось загрузить фото');
      return false;
    }
    const { data, error } = await supabase
      .from('erp_order_attachments')
      .insert({
        order_id: orderId,
        file_path: path,
        file_name: note ? `${note} — ${file.name}` : file.name,
        kind: 'attachment',
        uploaded_by: currentActor(),
      })
      .select();
    const row = data?.[0] as ErpOrderAttachment | undefined;
    if (error || !row) {
      toast.error('Фото загружено, но не привязано к заказу');
      return false;
    }
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === orderId
          ? { ...o, attachments: [...(o.attachments ?? []), row] }
          : o),
    }));
    return true;
  },

  loadOrderAudit: async (orderId) => {
    const { data, error } = await supabase
      .from('erp_order_audit')
      .select('*')
      .eq('order_id', orderId)
      .order('changed_at', { ascending: false })
      .limit(100);
    if (error) {
      toast.error('Не удалось загрузить историю правок');
      return null;
    }
    return (data ?? []) as ErpOrderAuditRow[];
  },

  loadComments: async (orderId) => {
    const { data, error } = await supabase
      .from('erp_order_comments')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) {
      toast.error('Не удалось загрузить комментарии');
      return null;
    }
    return (data ?? []) as ErpOrderComment[];
  },

  addComment: async (orderId, text) => {
    const { data, error } = await supabase
      .from('erp_order_comments')
      .insert({ order_id: orderId, author: currentActor(), text })
      .select();
    const row = data?.[0] as ErpOrderComment | undefined;
    if (error || !row) {
      toast.error('Не удалось отправить комментарий');
      return null;
    }
    return row;
  },

  applyRealtimeEvent: (ev) => {
    const row = (ev.eventType === 'DELETE' ? ev.old : ev.new) ?? {};
    const id = row.id as string | undefined;

    // Последний fallback: точечно применить нельзя — debounced полная перезагрузка
    const scheduleFullReload = () => {
      if (fullReloadTimer) clearTimeout(fullReloadTimer);
      fullReloadTimer = setTimeout(() => {
        fullReloadTimer = null;
        void withNewWorkToast(get, () => get().loadAll());
      }, FULL_RELOAD_DEBOUNCE_MS);
    };
    if (!id) {
      scheduleFullReload();
      return;
    }

    // Аудит-агент (A3): materials/procurement_tasks/subcontracting не подписаны были —
    // теперь точечно обновляем связанный заказ / список подряда у других пользователей.
    if (ev.table === 'erp_materials' || ev.table === 'erp_procurement_tasks') {
      const orderId = (row.order_id ?? null) as string | null;
      if (orderId && get().orders.some((o) => o.id === orderId)) {
        void withNewWorkToast(get, () => get().loadOne(orderId));
      }
      return;
    }
    if (ev.table === 'erp_subcontracting') {
      if (get().subcontractingLoaded) void get().loadSubcontracting();
      return;
    }

    // Защита от race (п.29): по сущности идёт мутация — отложить событие на ~1с
    // и применить, только если ключ снят (иначе состояние выправит ответ сервера).
    const key = ev.table === 'erp_item_stages' ? `stage:${id}` : `order:${id}`;
    if (_pendingMutations.has(key)) {
      setTimeout(() => {
        if (!_pendingMutations.has(key)) get().applyRealtimeEvent(ev);
      }, REALTIME_DEFER_MS);
      return;
    }

    if (ev.table === 'erp_item_stages') {
      if (ev.eventType === 'UPDATE') {
        // Точечная замена этапа; этап незагруженного (архивного) заказа — мимо
        if (!findStage(get().orders, id)) return;
        void withNewWorkToast(get, () => {
          set((s) => ({ orders: patchStageIn(s.orders, id, row as Partial<ErpItemStage>) }));
        });
        return;
      }
      if (ev.eventType === 'DELETE') {
        const found = findStage(get().orders, id);
        if (!found) return;
        set((s) => ({
          orders: s.orders.map((o) =>
            o.id !== found.order.id
              ? o
              : {
                  ...o,
                  items: o.items.map((it) => ({
                    ...it,
                    stages: it.stages.filter((st) => st.id !== id),
                  })),
                }),
        }));
        return;
      }
      // INSERT этапа: точечно не применить — перезагрузим один заказ, если позиция наша
      // (этапы новых заказов придут вместе с INSERT erp_orders → loadOne там)
      const itemId = (ev.new?.item_id ?? null) as string | null;
      const order = itemId
        ? get().orders.find((o) => o.items.some((it) => it.id === itemId))
        : null;
      if (order) void withNewWorkToast(get, () => get().loadOne(order.id));
      return;
    }

    if (ev.table === 'erp_orders') {
      if (ev.eventType === 'DELETE') {
        set((s) => ({ orders: s.orders.filter((o) => o.id !== id) }));
        return;
      }
      const existing = get().orders.find((o) => o.id === id);
      if (ev.eventType === 'UPDATE' && existing) {
        // merge полей заказа — вложенные items/materials/attachments не затираются
        void withNewWorkToast(get, () => {
          set((s) => ({
            orders: s.orders.map((o) =>
              o.id === id ? { ...o, ...(row as Partial<ErpOrder>) } : o),
          }));
        });
        return;
      }
      // INSERT нового заказа (или UPDATE незагруженного) → перезагрузка одного по id.
      // Незагруженный неактивный заказ при незагруженном архиве не тянем — не нужен.
      const status = (ev.new?.status ?? 'active') as string;
      if (status === 'active' || get().archiveLoaded) {
        void withNewWorkToast(get, () => get().loadOne(id));
      }
      return;
    }

    // Неизвестная таблица — старый путь
    scheduleFullReload();
  },

  subscribeRealtime: () => {
    // Уникальное имя канала (паттерн kontora24); события применяются точечно (п.27)
    const forward = (table: string) => (payload: {
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      new: Record<string, unknown>;
      old: Record<string, unknown>;
    }) => {
      get().applyRealtimeEvent({
        table,
        eventType: payload.eventType,
        new: payload.new ?? null,
        old: payload.old ?? null,
      });
    };
    const channel = supabase
      .channel(`erp-live-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_item_stages' },
        forward('erp_item_stages'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_orders' },
        forward('erp_orders'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_materials' },
        forward('erp_materials'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_procurement_tasks' },
        forward('erp_procurement_tasks'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_subcontracting' },
        forward('erp_subcontracting'),
      )
      .subscribe();
    return () => {
      if (fullReloadTimer) {
        clearTimeout(fullReloadTimer);
        fullReloadTimer = null;
      }
      supabase.removeChannel(channel);
    };
  },

  loadEmployees: async () => {
    const [emps, profs] = await Promise.all([
      supabase.from('erp_employees').select('*').order('full_name'),
      supabase
        .from('profiles')
        .select('id, name, email, role, approved, active')
        .order('name'),
    ]);
    if (emps.error || profs.error) {
      toast.error('Не удалось загрузить сотрудников');
      return;
    }
    set({
      employees: (emps.data ?? []) as ErpEmployee[],
      profilesList: (profs.data ?? []) as StaffProfile[],
      employeesLoaded: true,
    });
  },

  updateProfile: async (id, patch) => {
    const prev = get().profilesList;
    set((s) => ({
      profilesList: s.profilesList.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
    const { error } = await supabase.from('profiles').update(patch).eq('id', id);
    if (error) {
      set({ profilesList: prev });
      toast.error('Не удалось обновить пользователя');
      return false;
    }
    return true;
  },

  upsertProfileDept: async (profile, patch) => {
    const existing = get().employees.find((e) => e.profile_id === profile.id);
    if (existing) return get().updateEmployee(existing.id, patch);
    const created = await get().createEmployee({
      full_name: profile.name || profile.email || 'Без имени',
      profile_id: profile.id,
      role: 'worker',
      ...patch,
    });
    return Boolean(created);
  },

  createEmployee: async (emp) => {
    const { data, error } = await supabase.from('erp_employees').insert(emp).select();
    const row = data?.[0] as ErpEmployee | undefined;
    if (error || !row) {
      toast.error('Не удалось добавить сотрудника');
      return null;
    }
    set((s) => ({ employees: [...s.employees, row].sort((a, b) => a.full_name.localeCompare(b.full_name)) }));
    return row;
  },

  updateEmployee: async (id, patch) => {
    const prev = get().employees;
    set((s) => ({
      employees: s.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
    const { error } = await supabase.from('erp_employees').update(patch).eq('id', id);
    if (error) {
      set({ employees: prev });
      toast.error('Не удалось обновить сотрудника');
      return false;
    }
    return true;
  },

  addMaterial: async (orderId, material) => {
    const { data, error } = await supabase
      .from('erp_materials')
      .insert({ ...material, order_id: orderId })
      .select();
    const row = data?.[0] as ErpMaterial | undefined;
    if (error || !row) {
      toast.error('Не удалось добавить материал');
      return null;
    }
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === orderId ? { ...o, materials: [...o.materials, row] } : o),
    }));
    // Правка 4: добавление сразу-готового материала тоже должно закрывать этап «Закупка»
    await get().maybeCloseSupply(orderId);
    return row;
  },

  updateMaterial: async (id, patch) => {
    const prev = get().orders;
    set((s) => ({
      orders: s.orders.map((o) => ({
        ...o,
        materials: o.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),
    }));
    const { error } = await supabase.from('erp_materials').update(patch).eq('id', id);
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось обновить материал');
      return false;
    }
    const order = get().orders.find((o) => o.materials.some((m) => m.id === id));
    if (order) await get().maybeCloseSupply(order.id);
    return true;
  },

  confirmStockMaterial: async (id) => {
    // Материал со склада: подтверждение наличия → «Доступен со склада» (reserved)
    const ok = await get().updateMaterial(id, {
      status: 'reserved',
      received_at: new Date().toISOString().slice(0, 10),
    });
    return ok;
  },

  maybeCloseSupply: async (orderId) => {
    const order = get().orders.find((o) => o.id === orderId);
    const supplyDept = get().departments.find((d) => d.code === 'supply');
    if (!order || !supplyDept) return;
    // «Готов» = пришло / зарезервировано со склада / не требуется.
    // length>0 — не закрывать закупку у заказа вовсе без материалов (аудит, LOW).
    const allIn = order.materials.length > 0 && order.materials.every(
      (m) => m.status === 'received' || m.status === 'reserved' || m.status === 'not_needed');
    if (!allIn) return;
    const openSupply = order.items.flatMap((it) =>
      it.stages.filter(
        (st) => st.department_id === supplyDept.id &&
          st.status !== 'done' && st.status !== 'skipped'));
    for (const st of openSupply) {
      await get().setStageStatus(st.id, 'done', { comment: 'Материалы готовы — закупка закрыта автоматически' });
    }
    if (openSupply.length > 0) toast.success('Материалы готовы — закупка по заказу закрыта');
  },

  createProcurementTask: async (orderId, task) => {
    // Правка 2: брак поставщика → замена (не считается закупкой компании);
    // прочие причины → дозакупка (внутренняя ошибка).
    // Аудит (A5): вычисляемые kind/counts_as_purchase идут ПОСЛЕ ...task —
    // вызывающий не может их переопределить (сервер также форсит их триггером).
    const isSupplier = task.cause_type === 'supplier_defect';
    const row0 = {
      status: 'new',
      ...task,
      kind: isSupplier ? 'replacement' : 'restock',
      counts_as_purchase: !isSupplier,
      order_id: orderId,
    };
    const { data, error } = await supabase
      .from('erp_procurement_tasks')
      .insert(row0)
      .select();
    const row = data?.[0] as ErpProcurementTask | undefined;
    if (error || !row) {
      toast.error('Не удалось создать задачу закупки');
      return null;
    }
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === orderId
          ? { ...o, procurement_tasks: [...(o.procurement_tasks ?? []), row] }
          : o),
    }));
    return row;
  },

  updateProcurementTask: async (id, patch) => {
    const prev = get().orders;
    set((s) => ({
      orders: s.orders.map((o) => ({
        ...o,
        procurement_tasks: (o.procurement_tasks ?? []).map((t) =>
          t.id === id ? { ...t, ...patch } : t),
      })),
    }));
    const { error } = await supabase.from('erp_procurement_tasks').update(patch).eq('id', id);
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось обновить задачу закупки');
      return false;
    }
    return true;
  },

  loadSubcontracting: async () => {
    const { data, error } = await supabase
      .from('erp_subcontracting')
      .select('*, order:erp_orders (title, bitrix_id)')
      .order('created_at', { ascending: false });
    if (error) {
      toast.error('Не удалось загрузить операции подряда');
      return;
    }
    set({ subcontracting: (data ?? []) as ErpSubcontractOp[], subcontractingLoaded: true });
  },

  createSubcontractOp: async (op) => {
    const { data, error } = await supabase
      .from('erp_subcontracting')
      .insert({ status: 'planned', ...op })
      .select('*, order:erp_orders (title, bitrix_id)');
    const row = data?.[0] as ErpSubcontractOp | undefined;
    if (error || !row) {
      toast.error('Не удалось добавить операцию подряда');
      return null;
    }
    set((s) => ({ subcontracting: [row, ...s.subcontracting] }));
    return row;
  },

  updateSubcontractOp: async (id, patch) => {
    const prev = get().subcontracting;
    set((s) => ({
      subcontracting: s.subcontracting.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
    const { error } = await supabase.from('erp_subcontracting').update(patch).eq('id', id);
    if (error) {
      set({ subcontracting: prev });
      toast.error('Не удалось обновить операцию подряда');
      return false;
    }
    return true;
  },
}));

/** Слоты календаря загружаются отдельно по цеху (Фаза 3) */
export type { ErpCalendarSlot };
