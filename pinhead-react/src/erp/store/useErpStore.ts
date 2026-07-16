/**
 * ERP store: цеха, производственные заказы, позиции, этапы, материалы.
 *
 * Правила Pinhead: toast.error на каждую ошибку Supabase, null при ошибке,
 * без optimistic delete, optimistic update только с rollback.
 */

import { create } from 'zustand';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { buildRoute } from '../utils/routes';
import type {
  BrandingMethod,
  BrandingOn,
  ErpCalendarSlot,
  ErpDepartment,
  ErpItemStage,
  ErpMaterial,
  ErpOrder,
  ErpOrderItem,
  ProductionType,
  StageStatus,
} from '../types';

/** Заказ со вложенными позициями/этапами/материалами (join при загрузке) */
export interface ErpOrderFull extends ErpOrder {
  items: (ErpOrderItem & { stages: ErpItemStage[] })[];
  materials: ErpMaterial[];
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
  loading: boolean;
  loaded: boolean;

  loadAll: () => Promise<void>;
  createOrder: (input: NewOrderInput) => Promise<ErpOrderFull | null>;
  updateOrder: (id: string, patch: Partial<ErpOrder>) => Promise<boolean>;
  deleteOrder: (id: string) => Promise<boolean>;
  setStageStatus: (
    stageId: string,
    status: StageStatus,
    extra?: { qty_done?: number; block_reason?: string },
  ) => Promise<boolean>;
  addMaterial: (
    orderId: string,
    material: Partial<ErpMaterial> & Pick<ErpMaterial, 'kind' | 'name'>,
  ) => Promise<ErpMaterial | null>;
  updateMaterial: (id: string, patch: Partial<ErpMaterial>) => Promise<boolean>;
}

const ORDER_SELECT = `
  *,
  items:erp_order_items (
    *,
    stages:erp_item_stages (*)
  ),
  materials:erp_materials (*)
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

export const useErpStore = create<ErpStore>((set, get) => ({
  departments: [],
  orders: [],
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
    const patch: Partial<ErpItemStage> = { status, ...extra };
    if (status === 'in_progress') patch.started_at = new Date().toISOString();
    if (status === 'done') patch.finished_at = new Date().toISOString();

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
    return true;
  },
}));

/** Слоты календаря загружаются отдельно по цеху (Фаза 3) */
export type { ErpCalendarSlot };
