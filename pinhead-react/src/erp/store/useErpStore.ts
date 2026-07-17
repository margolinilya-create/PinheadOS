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

/** Запись события аудита — fire-and-forget, ошибки не блокируют работу */
function logStageEvent(ev: Omit<ErpStageEvent, 'id' | 'created_at' | 'actor'>) {
  supabase
    .from('erp_stage_events')
    .insert({ ...ev, actor: currentActor() })
    .then(({ error }) => {
      if (error) console.warn('stage event not logged:', error.message);
    });
}

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
  items: (ErpOrderItem & { stages: ErpItemStage[] })[];
  materials: ErpMaterial[];
  attachments?: ErpOrderAttachment[];
}

/** Публичный URL превью заказа (первое вложение kind=preview) */
export function orderPreviewUrl(order: ErpOrderFull): string | null {
  const att = order.attachments?.find((a) => a.kind === 'preview');
  if (!att) return null;
  return supabase.storage.from('erp-attachments').getPublicUrl(att.file_path).data.publicUrl;
}

export interface NewOrderItemInput {
  product_type: string;
  variant?: string;
  qty: number;
  production_type: ProductionType;
  branding_methods: BrandingMethod[];
  branding_on: BrandingOn;
  notes?: string;
}

export interface NewOrderInput {
  bitrix_id?: string;
  title: string;
  manager?: string;
  launch_date?: string;
  due_date?: string;
  buffer_days?: number;
  notes?: string;
  items: NewOrderItemInput[];
}

interface ErpStore {
  departments: ErpDepartment[];
  orders: ErpOrderFull[];
  employees: ErpEmployee[];
  profilesList: StaffProfile[];
  employeesLoaded: boolean;
  loading: boolean;
  loaded: boolean;

  loadAll: () => Promise<void>;
  createOrder: (input: NewOrderInput) => Promise<ErpOrderFull | null>;
  updateOrder: (id: string, patch: Partial<ErpOrder>) => Promise<boolean>;
  deleteOrder: (id: string) => Promise<boolean>;
  setStageStatus: (
    stageId: string,
    status: StageStatus,
    extra?: { qty_done?: number; block_reason?: string | null; comment?: string },
  ) => Promise<boolean>;
  /** Брак: qty на переделку + причина; этап возвращается в работу */
  reportDefect: (stageId: string, qty: number, reason: string) => Promise<boolean>;
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
    stages:erp_item_stages (*)
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

/** Сколько работ «готово/в работе» в цехе — для уведомления о новой работе */
function readyCountFor(orders: ErpOrderFull[], departments: ErpDepartment[], deptCode: string): number {
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

  loadAll: async () => {
    set({ loading: true });
    const [deps, orders] = await Promise.all([
      supabase.from('erp_departments').select('*').order('sort_order'),
      supabase
        .from('erp_orders')
        .select(ORDER_SELECT)
        .order('due_date', { ascending: true, nullsFirst: false }),
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

  createOrder: async (input) => {
    const { departments } = get();
    const deptByCode = new Map(departments.map((d) => [d.code, d]));

    // 1. Заказ
    const { items, ...orderFields } = input;
    const { data: orderRows, error: orderErr } = await supabase
      .from('erp_orders')
      .insert({ ...orderFields, status: 'active' })
      .select();
    const order = orderRows?.[0] as ErpOrder | undefined;
    if (orderErr || !order) {
      toast.error('Не удалось создать заказ');
      return null;
    }

    // 2. Позиции
    const itemsPayload = items.map((it, i) => ({
      order_id: order.id,
      product_type: it.product_type,
      variant: it.variant || null,
      qty: it.qty,
      production_type: it.production_type,
      branding_methods: it.branding_methods,
      branding_on: it.branding_on,
      notes: it.notes || null,
      sort_order: (i + 1) * 10,
    }));
    const { data: itemRows, error: itemsErr } = await supabase
      .from('erp_order_items')
      .insert(itemsPayload)
      .select();
    if (itemsErr || !itemRows) {
      toast.error('Заказ создан, но позиции не сохранились');
      return null;
    }

    // 3. Этапы по маршруту (двухфазно: insert → проставить depends_on по id)
    const allStages: ErpItemStage[] = [];
    for (const row of itemRows as ErpOrderItem[]) {
      const route = buildRoute({
        productionType: row.production_type,
        brandingMethods: row.branding_methods,
        brandingOn: row.branding_on ?? 'cut',
      });
      const valid = route.filter((r) => deptByCode.has(r.departmentCode));
      if (valid.length === 0) continue;

      const { data: stageRows, error: stErr } = await supabase
        .from('erp_item_stages')
        .insert(valid.map((r) => ({
          item_id: row.id,
          department_id: deptByCode.get(r.departmentCode)!.id,
          sort_order: r.sortOrder,
        })))
        .select();
      if (stErr || !stageRows) {
        toast.error('Не удалось создать этапы маршрута');
        return null;
      }

      const deptIdToStageId = new Map(
        (stageRows as ErpItemStage[]).map((s) => [s.department_id, s.id]),
      );
      for (const r of valid) {
        const stageId = deptIdToStageId.get(deptByCode.get(r.departmentCode)!.id);
        const depIds = r.dependsOnCodes
          .map((c) => deptIdToStageId.get(deptByCode.get(c)?.id ?? ''))
          .filter((x): x is string => Boolean(x));
        if (stageId && depIds.length > 0) {
          const { error: depErr } = await supabase
            .from('erp_item_stages')
            .update({ depends_on: depIds })
            .eq('id', stageId);
          if (depErr) {
            toast.error('Не удалось связать этапы маршрута');
            return null;
          }
        }
      }
      const { data: finalStages } = await supabase
        .from('erp_item_stages').select('*').eq('item_id', row.id);
      allStages.push(...((finalStages ?? []) as ErpItemStage[]));
    }

    const full = sortOrderFull({
      ...order,
      items: (itemRows as ErpOrderItem[]).map((it) => ({
        ...it,
        stages: allStages.filter((s) => s.item_id === it.id),
      })),
      materials: [],
    });
    set((s) => ({ orders: [full, ...s.orders] }));
    return full;
  },

  updateOrder: async (id, patch) => {
    const prev = get().orders;
    // optimistic с rollback
    set((s) => ({
      orders: s.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
    const { error } = await supabase.from('erp_orders').update(patch).eq('id', id);
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
    let fromStatus: string | null = null;
    let orderId: string | null = null;
    for (const o of prev) {
      for (const it of o.items) {
        const st = it.stages.find((s) => s.id === stageId);
        if (st) { fromStatus = st.status; orderId = o.id; }
      }
    }

    // optimistic с rollback
    set((s) => ({
      orders: s.orders.map((o) => ({
        ...o,
        items: o.items.map((it) => ({
          ...it,
          stages: it.stages.map((st) => (st.id === stageId ? { ...st, ...patch } : st)),
        })),
      })),
    }));
    const { error } = await supabase.from('erp_item_stages').update(patch).eq('id', stageId);
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось обновить этап');
      return false;
    }
    if (orderId) {
      logStageEvent({
        stage_id: stageId,
        order_id: orderId,
        from_status: fromStatus,
        to_status: status,
        qty_done: extra.qty_done ?? null,
        qty_rework: null,
        comment: comment ?? extra.block_reason ?? null,
      });
    }
    return true;
  },

  reportDefect: async (stageId, qty, reason) => {
    const prev = get().orders;
    let stage: ErpItemStage | null = null;
    let orderId: string | null = null;
    for (const o of prev) {
      for (const it of o.items) {
        const st = it.stages.find((s) => s.id === stageId);
        if (st) { stage = st; orderId = o.id; }
      }
    }
    if (!stage || !orderId) return false;

    const patch: Partial<ErpItemStage> = {
      qty_rework: stage.qty_rework + qty,
      // брак возвращает этап в работу (переделка)
      status: 'in_progress',
      finished_at: null,
    };
    set((s) => ({
      orders: s.orders.map((o) => ({
        ...o,
        items: o.items.map((it) => ({
          ...it,
          stages: it.stages.map((st) => (st.id === stageId ? { ...st, ...patch } : st)),
        })),
      })),
    }));
    const { error } = await supabase.from('erp_item_stages').update(patch).eq('id', stageId);
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось записать брак');
      return false;
    }
    logStageEvent({
      stage_id: stageId,
      order_id: orderId,
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
    set((s) => ({
      orders: s.orders.map((o) => ({
        ...o,
        items: o.items.map((it) => ({
          ...it,
          stages: it.stages.map((st) => (st.id === stageId ? { ...st, ...plan } : st)),
        })),
      })),
    }));
    const { error } = await supabase.from('erp_item_stages').update(plan).eq('id', stageId);
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

  subscribeRealtime: () => {
    // Уникальное имя канала (паттерн kontora24) + debounce 500ms
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const myDept = localStorage.getItem('erp_my_dept');
        const before = myDept
          ? readyCountFor(get().orders, get().departments, myDept)
          : 0;
        await get().loadAll();
        if (myDept) {
          const after = readyCountFor(get().orders, get().departments, myDept);
          if (after > before) {
            toast.success('В вашем цехе появилась новая работа');
          }
        }
      }, 500);
    };
    const channel = supabase
      .channel(`erp-live-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_item_stages' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_orders' }, refresh)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
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
