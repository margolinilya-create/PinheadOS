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
import { buildRoute, isStageReady } from '../utils/routes';
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
  ErpStageEvent,
  ProductionType,
  StageStatus,
} from '../types';

/** Имя действующего пользователя для аудита */
function currentActor(): string {
  const u = useAuthStore.getState().user;
  return u?.name || u?.email || 'неизвестно';
}

/** Пауза перед повторной попыткой записи аудита */
const STAGE_EVENT_RETRY_MS = 1500;

/**
 * Запись события аудита — fire-and-forget, ошибки не блокируют работу.
 * При ошибке — 1 повторная попытка через ~1.5с; если обе неудачны —
 * toast.error + console.warn.
 */
function logStageEvent(ev: Omit<ErpStageEvent, 'id' | 'created_at' | 'actor'>) {
  const row = { ...ev, actor: currentActor() };
  const attempt = () => supabase.from('erp_stage_events').insert(row);
  void attempt().then(({ error }) => {
    if (!error) return;
    setTimeout(() => {
      void attempt().then(({ error: retryError }) => {
        if (retryError) {
          console.warn('stage event not logged:', retryError.message);
          toast.error('Событие истории не записалось');
        }
      });
    }, STAGE_EVENT_RETRY_MS);
  });
}

/**
 * Защита от race (п.29): ключи сущностей с незавершённой мутацией.
 * Realtime-события по таким ключам не применяются сразу — состояние станет
 * консистентным после ответа сервера (или rollback). Экспорт — для тестов.
 */
export const _pendingMutations = new Set<string>();

/** Выполнить мутацию под pending-ключом (ключ снимается в finally) */
async function withPending<T>(key: string, fn: () => PromiseLike<T>): Promise<T> {
  _pendingMutations.add(key);
  try {
    return await fn();
  } finally {
    _pendingMutations.delete(key);
  }
}

/** Отсрочка применения realtime-события по сущности с pending-мутацией */
const REALTIME_DEFER_MS = 1000;
/** Debounce последнего fallback — полной перезагрузки loadAll */
const FULL_RELOAD_DEBOUNCE_MS = 500;
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
}

/** Публичный URL превью заказа (первое вложение kind=preview) */
export function orderPreviewUrl(order: ErpOrderFull): string | null {
  const att = order.attachments?.find((a) => a.kind === 'preview');
  if (!att) return null;
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
  loading: boolean;
  loaded: boolean;
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
  /** Брак: qty на переделку + причина; этап возвращается в работу */
  reportDefect: (stageId: string, qty: number, reason: string) => Promise<boolean>;
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
  attachments:erp_order_attachments (*)
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
        else if (st.status === 'waiting' && isStageReady(st, it.stages, o.materials, deptCode)) n += 1;
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
  loading: false,
  loaded: false,
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
    set({ loading: true });
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
      set({ loading: false });
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

  reportDefect: async (stageId, qty, reason) => {
    const prev = get().orders;
    const found = findStage(prev, stageId);
    if (!found) return false;
    const { stage, order } = found;

    const patch: Partial<ErpItemStage> = {
      qty_rework: (stage.qty_rework ?? 0) + qty,
      // брак возвращает этап в работу (переделка)
      status: 'in_progress',
      finished_at: null,
    };
    set((s) => ({ orders: patchStageIn(s.orders, stageId, patch) }));
    const { error } = await withPending(`stage:${stageId}`, () =>
      supabase.from('erp_item_stages').update(patch).eq('id', stageId));
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось записать брак');
      return false;
    }
    logStageEvent({
      stage_id: stageId,
      order_id: order.id,
      from_status: stage.status,
      to_status: 'in_progress',
      qty_done: null,
      qty_rework: qty,
      comment: `Брак: ${reason}`,
    });
    return true;
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

    // Логика закупки: все материалы заказа пришли → этап «Закупка» закрывается сам
    const order = get().orders.find((o) => o.materials.some((m) => m.id === id));
    const supplyDept = get().departments.find((d) => d.code === 'supply');
    if (order && supplyDept) {
      const allIn = order.materials.every(
        (m) => m.status === 'received' || m.status === 'not_needed');
      if (allIn) {
        const openSupply = order.items.flatMap((it) =>
          it.stages.filter(
            (st) => st.department_id === supplyDept.id &&
              st.status !== 'done' && st.status !== 'skipped'));
        for (const st of openSupply) {
          await get().setStageStatus(st.id, 'done', { comment: 'Материалы пришли — закупка закрыта автоматически' });
        }
        if (openSupply.length > 0) toast.success('Материалы пришли — закупка по заказу закрыта');
      }
    }
    return true;
  },
}));

/** Слоты календаря загружаются отдельно по цеху (Фаза 3) */
export type { ErpCalendarSlot };
