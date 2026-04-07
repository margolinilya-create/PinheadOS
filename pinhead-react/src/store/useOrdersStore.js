import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useAuthStore } from './useAuthStore';
import { toast } from './useToastStore';

const STATUS_LIST = ['draft', 'review', 'approved', 'production', 'done'];
const STATUS_LABELS = { draft: 'Черновик', review: 'На проверке', approved: 'Подтверждён', production: 'В производстве', done: 'Готов' };
const STATUS_COLORS = {
  draft:      { bg: '#F0F0F0', text: '#555555', bar: '#CCCCCC' },
  review:     { bg: '#FFF8E1', text: '#C87137', bar: '#C87137' },
  approved:   { bg: '#EEF2FF', text: '#2B2BF0', bar: '#2B2BF0' },
  production: { bg: '#FFF3E8', text: '#C87137', bar: '#E07B30' },
  done:       { bg: '#F0FFF4', text: '#06A77D', bar: '#06A77D' },
};

export { STATUS_LIST, STATUS_LABELS, STATUS_COLORS };

// ─── Generate sequential PH-XXXX order number via Supabase sequence ───
async function generateOrderNumber() {
  try {
    const { data, error } = await supabase.rpc('generate_order_number');
    if (!error && data) return data;
  } catch { /* fallback below */ }
  // Fallback: timestamp-based to avoid collisions
  return `PH-${Date.now()}`;
}

const PAGE_SIZE = 50;

export const useOrdersStore = create((set, get) => ({
  orders: [],
  loading: false,
  hasMore: true,
  loadingMore: false,
  lastCreatedAt: null,
  filter: 'all',
  search: '',

  setFilter: (f) => set({ filter: f }),
  setSearch: (s) => set({ search: s }),

  // Загрузить заказы из Supabase (фильтрация по роли)
  fetchOrders: async () => {
    set({ loading: true, orders: [], lastCreatedAt: null, hasMore: true });
    try {
      const auth = useAuthStore.getState();
      const role = auth.user?.role;
      const userId = auth.user?.id;

      let query = supabase.from('orders').select('*')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (role === 'manager' && userId && userId !== 'dev') {
        query = query.eq('created_by', userId);
      }
      if (role === 'production') {
        query = query.in('status', ['approved', 'production']);
      }

      const { data, error } = await query;
      if (!error && data) {
        set({
          orders: data,
          loading: false,
          hasMore: data.length === PAGE_SIZE,
          lastCreatedAt: data.length > 0 ? data[data.length - 1].created_at : null,
        });
      } else {
        set({ loading: false });
      }
    } catch (err) {
      console.error('[fetchOrders]', err);
      toast.error('Не удалось загрузить заказы');
      set({ loading: false });
    }
  },

  // Подгрузить следующую страницу
  fetchMoreOrders: async () => {
    const { hasMore, loadingMore, lastCreatedAt } = get();
    if (!hasMore || loadingMore) return;

    set({ loadingMore: true });
    try {
      const auth = useAuthStore.getState();
      const role = auth.user?.role;
      const userId = auth.user?.id;

      let query = supabase.from('orders').select('*')
        .order('created_at', { ascending: false })
        .lt('created_at', lastCreatedAt)
        .limit(PAGE_SIZE);

      if (role === 'manager' && userId && userId !== 'dev') {
        query = query.eq('created_by', userId);
      }
      if (role === 'production') {
        query = query.in('status', ['approved', 'production']);
      }

      const { data, error } = await query;
      if (!error && data) {
        set(s => ({
          orders: [...s.orders, ...data],
          loadingMore: false,
          hasMore: data.length === PAGE_SIZE,
          lastCreatedAt: data.length > 0 ? data[data.length - 1].created_at : null,
        }));
      } else {
        toast.error('Не удалось загрузить заказы');
        set({ loadingMore: false });
      }
    } catch (err) {
      console.error('[fetchMoreOrders]', err);
      toast.error('Не удалось загрузить заказы');
      set({ loadingMore: false });
    }
  },

  // Сохранить новый заказ (INSERT с sequence PH-XXXX)
  saveOrder: async (orderData) => {
    const orderNumber = await generateOrderNumber();
    const auth = useAuthStore.getState();
    // DEV_MODE user id 'dev' is not a valid UUID — use null for created_by
    const userId = auth.user?.id;
    const createdBy = (userId && userId !== 'dev') ? userId : null;
    const managerName = auth.user?.name || auth.user?.email || '';
    const dataWithManager = { ...orderData, managerName };
    const row = {
      order_number: orderNumber,
      status: 'draft',
      data: dataWithManager,
      total_sum: orderData.total || 0,
      total_qty: orderData.totalQty || 0,
      item_type: orderData.type || '',
      bitrix_deal: orderData.bitrixDeal || null,
      notes: orderData.notes || null,
      created_by: createdBy,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from('orders').insert(row).select();
    if (!error && data?.[0]) {
      set(s => ({ orders: [data[0], ...s.orders] }));
      return data[0];
    }
    // Supabase failed — return null so callers know the save did not persist
    console.error('[saveOrder] Supabase error:', error);
    toast.error('Не удалось сохранить заказ в базу');
    return null;
  },

  // Обновить заказ (UPDATE по id — без дублирования)
  updateOrder: async (id, orderData) => {
    const prev = get().orders.find(o => o.id === id);
    const payload = {
      data: orderData,
      total_sum: orderData.total || 0,
      total_qty: orderData.totalQty || 0,
      item_type: orderData.type || '',
      bitrix_deal: orderData.bitrixDeal || null,
      notes: orderData.notes || null,
    };

    // Optimistic update
    set(s => ({
      orders: s.orders.map(o => o.id === id ? { ...o, ...payload } : o),
    }));

    const { data, error } = await supabase.from('orders').update(payload).eq('id', id).select();
    if (!error && data?.[0]) {
      set(s => ({
        orders: s.orders.map(o => o.id === id ? data[0] : o),
      }));
      return data[0];
    }
    // Rollback optimistic update
    if (prev) {
      set(s => ({
        orders: s.orders.map(o => o.id === id ? prev : o),
      }));
    }
    console.error('[updateOrder] Supabase error:', error);
    toast.error('Не удалось обновить заказ в базе');
    return null;
  },

  // Патч только data JSONB (для checklist, comments, photos — без пересчёта сумм)
  patchOrderData: async (id, patch) => {
    const prev = get().orders.find(o => o.id === id);
    if (!prev) return null;
    const newData = { ...prev.data, ...patch };
    set(s => ({
      orders: s.orders.map(o => o.id === id ? { ...o, data: newData } : o),
    }));
    const { data, error } = await supabase.from('orders').update({ data: newData }).eq('id', id).select();
    if (!error && data?.[0]) {
      set(s => ({ orders: s.orders.map(o => o.id === id ? data[0] : o) }));
      return data[0];
    }
    // Rollback
    set(s => ({
      orders: s.orders.map(o => o.id === id ? prev : o),
    }));
    console.error('[patchOrderData] Supabase error:', error);
    toast.error('Не удалось обновить данные заказа');
    return null;
  },

  // Обновить статус (optimistic + rollback on error)
  updateStatus: async (id, status) => {
    const prev = get().orders.find(o => o.id === id);
    const prevStatus = prev ? prev.status : null;

    // Optimistic update
    set(s => ({
      orders: s.orders.map(o => o.id === id ? { ...o, status } : o),
    }));

    const { error } = await supabase.from('orders').update({ status }).eq('id', id);
    if (error) {
      // Rollback
      if (prevStatus !== null) {
        set(s => ({
          orders: s.orders.map(o => o.id === id ? { ...o, status: prevStatus } : o),
        }));
      }
      toast.error('Не удалось обновить статус');
      return { error };
    }
    return { error: null };
  },

  // Удалить заказ (не optimistic — ждём ответа Supabase)
  deleteOrder: async (id) => {
    const { error } = await supabase.from('orders').delete().eq('id', id);
    if (error) {
      console.error('[deleteOrder] Supabase error:', error);
      toast.error('Не удалось удалить заказ');
      return false;
    }
    set(s => ({ orders: s.orders.filter(o => o.id !== id) }));
    return true;
  },

  // Дублировать заказ
  duplicateOrder: async (order) => {
    const orderNumber = await generateOrderNumber();
    const auth = useAuthStore.getState();
    const dup = {
      order_number: orderNumber,
      status: 'draft',
      data: order.data ? JSON.parse(JSON.stringify(order.data)) : {},
      total_sum: order.total_sum || 0,
      total_qty: order.total_qty || 0,
      item_type: order.item_type || '',
      bitrix_deal: order.bitrix_deal || null,
      notes: order.notes || null,
      created_by: auth.user?.id || null,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from('orders').insert(dup).select();
    if (!error && data?.[0]) {
      set(s => ({ orders: [data[0], ...s.orders] }));
      return data[0];
    }
    console.error('[duplicateOrder] Supabase error:', error);
    toast.error('Не удалось дублировать заказ');
    return null;
  },

  // Отфильтрованные заказы
  getFiltered: () => {
    const { orders, filter, search } = get();
    let filtered = orders;
    if (filter !== 'all') filtered = filtered.filter(o => o.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(o =>
        (o.order_number || '').toLowerCase().includes(q) ||
        (o.data?.name || '').toLowerCase().includes(q) ||
        (o.item_type || '').toLowerCase().includes(q) ||
        (o.bitrix_deal || '').toLowerCase().includes(q)
      );
    }
    return filtered;
  },
}));
