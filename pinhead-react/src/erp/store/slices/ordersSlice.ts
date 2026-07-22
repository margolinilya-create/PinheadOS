/**
 * Слайс заказов: загрузка (активные/архив/один), CRUD, отгрузка, вложения,
 * история этапов/правок, комментарии. Вынесен из useErpStore.ts (рефакторинг по плану аудита).
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { validateImageUpload } from '../../../lib/uploadGuard';
import { toast } from '../../../store/useToastStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { buildRoute } from '../../utils/routes';
import { isOrderReadyToShip } from '../../utils/stageUi';
import { daysLeft } from '../../utils/time';
import type {
  ErpDepartment,
  ErpItemStage,
  ErpOrder,
  ErpOrderStatus,
  ErpStageEvent,
} from '../../types';
import { currentActor, withPending } from '../shared';
import { ORDER_SELECT, sortOrderFull } from '../orderHelpers';
import type {
  ErpStore,
  OrdersSlice,
  ErpOrderAttachment,
  ErpOrderAuditRow,
  ErpOrderComment,
  ErpOrderFull,
} from '../types';

export const ordersSlice: StateCreator<ErpStore, [], [], OrdersSlice> = (set, get) => ({
  departments: [],
  orders: [],
  loading: false,
  loaded: false,
  loadError: false,
  archiveLoaded: false,
  archiveLoading: false,

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
        let route = buildRoute({
          productionType: it.production_type,
          brandingMethods: it.branding_methods,
          brandingOn: it.branding_on ?? 'cut',
        });
        // Правка 4.2.2: материал предоставляет подрядчик → закупку не заводим.
        // Убираем этап supply и вычищаем его из depends_on остальных, чтобы не осиротить зависимость.
        if (it.production_type === 'outsource' && it.material_source === 'contractor') {
          route = route
            .filter((r) => r.departmentCode !== 'supply')
            .map((r) => ({ ...r, dependsOnCodes: r.dependsOnCodes.filter((c) => c !== 'supply') }));
        }
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
          // Подряд (волна 4.2): тип/источник материалов для production_type='outsource'
          subcontract_kind: it.production_type === 'outsource' ? (it.subcontract_kind ?? null) : null,
          material_source: it.production_type === 'outsource' ? (it.material_source ?? null) : null,
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
    const created = await get().loadOne(data as string);
    // Подряд (волна 4.2): авто-создаём операцию подряда по каждой позиции с типом подряда.
    // Готовое изделие стартует в цикле «Ожидает оплаты», отдельная операция — «Запланировано».
    if (created) {
      // created.items идут в том же порядке, что и input items (sort_order = (k+1)*10),
      // поэтому return_dept (не хранится на позиции) берём из входных items по индексу.
      for (let k = 0; k < created.items.length; k++) {
        const it = created.items[k];
        if (!it.subcontract_kind) continue;
        // Правка 4.2.3: для «отдельной операции» имя операции берём из формы (не хранится
        // на позиции), для готового изделия — вид изделия.
        const operation = it.subcontract_kind === 'operation'
          ? (items[k]?.subcontract_operation?.trim() || it.product_type)
          : it.product_type;
        await get().createSubcontractOp({
          order_id: created.id,
          item_id: it.id,
          operation,
          op_type: it.subcontract_kind,
          material_source: it.material_source ?? 'pinhead',
          qty: it.qty,
          status: it.subcontract_kind === 'finished_product' ? 'awaiting_payment' : 'planned',
          return_dept: it.subcontract_kind === 'operation' ? (items[k]?.return_dept ?? null) : null,
        });
      }
      // Эксперимент (волна 4.3): заказ-образец сразу заводит разработку в эксперим. цехе
      // (фаза «Построение лекал»), чтобы проработка не создавалась вручную.
      if (created.items.some((it) => it.production_type === 'samples')) {
        await get().createExperimental(created.id);
      }
    }
    return created;
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
    // security ME-1: только растровые картинки, content-type из allowlist (не svg/html)
    const check = validateImageUpload(file);
    if (!check.ok) {
      toast.error(check.error);
      return false;
    }
    const path = `${orderId}/${Date.now()}.${check.ext}`;
    const { error: upErr } = await supabase.storage
      .from('erp-attachments')
      .upload(path, file, { contentType: check.contentType });
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
    // security ME-1: только растровые картинки, content-type из allowlist (не svg/html)
    const check = validateImageUpload(file);
    if (!check.ok) {
      toast.error(check.error);
      return false;
    }
    const path = `${orderId}/${Date.now()}.${check.ext}`;
    const { error: upErr } = await supabase.storage
      .from('erp-attachments')
      .upload(path, file, { contentType: check.contentType });
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
});
