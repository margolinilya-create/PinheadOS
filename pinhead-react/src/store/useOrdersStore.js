import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useAuthStore } from './useAuthStore';

const STATUS_LIST = ['draft', 'review', 'approved', 'production', 'done'];
const STATUS_LABELS = { draft: 'Черновик', review: 'На проверке', approved: 'Подтверждён', production: 'В производстве', done: 'Готов' };
const STATUS_COLORS = { draft: '#888', review: '#b89000', approved: '#1D19EA', production: '#c04500', done: '#007840' };

export { STATUS_LIST, STATUS_LABELS, STATUS_COLORS };

// ─── Generate sequential PH-XXXX order number ───
function generateOrderNumber(existingOrders) {
  let maxNum = 0;
  for (const o of existingOrders) {
    const m = (o.order_number || '').match(/^PH-(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
  }
  const next = maxNum + 1;
  return 'PH-' + String(next).padStart(4, '0');
}

export const useOrdersStore = create((set, get) => ({
  orders: [],
  loading: false,
  filter: 'all',
  search: '',

  setFilter: (f) => set({ filter: f }),
  setSearch: (s) => set({ search: s }),

  // Загрузить заказы из Supabase (фильтрация по роли)
  fetchOrders: async () => {
    set({ loading: true });
    try {
      const auth = useAuthStore.getState();
      const role = auth.user?.role;
      const userId = auth.user?.id;

      let query = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(200);

      // Менеджер видит только свои заказы
      if (role === 'manager' && userId && userId !== 'dev') {
        query = query.eq('created_by', userId);
      }
      // Производство видит только approved/production
      if (role === 'production') {
        query = query.in('status', ['approved', 'production']);
      }

      const { data, error } = await query;
      if (!error && data) {
        set({ orders: data, loading: false });
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  // Сохранить новый заказ (INSERT с sequence PH-XXXX)
  saveOrder: async (orderData) => {
    const orderNumber = generateOrderNumber(get().orders);
    const auth = useAuthStore.getState();
    const row = {
      order_number: orderNumber,
      status: 'draft',
      data: orderData,
      total_sum: orderData.total || 0,
      total_qty: orderData.totalQty || 0,
      item_type: orderData.type || '',
      bitrix_deal: orderData.bitrixDeal || null,
      notes: orderData.notes || null,
      created_by: auth.user?.id || null,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from('orders').insert(row).select();
    if (!error && data?.[0]) {
      set(s => ({ orders: [data[0], ...s.orders] }));
      return data[0];
    }
    // Fallback: сохраняем локально
    const local = { ...row, id: Date.now() };
    set(s => ({ orders: [local, ...s.orders] }));
    return local;
  },

  // Обновить заказ (UPDATE по id — без дублирования)
  updateOrder: async (id, orderData) => {
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
    // Return the locally updated version
    return get().orders.find(o => o.id === id) || null;
  },

  // Патч только data JSONB (для checklist, comments, photos — без пересчёта сумм)
  patchOrderData: async (id, patch) => {
    const order = get().orders.find(o => o.id === id);
    if (!order) return null;
    const newData = { ...order.data, ...patch };
    set(s => ({
      orders: s.orders.map(o => o.id === id ? { ...o, data: newData } : o),
    }));
    const { data, error } = await supabase.from('orders').update({ data: newData }).eq('id', id).select();
    if (!error && data?.[0]) {
      set(s => ({ orders: s.orders.map(o => o.id === id ? data[0] : o) }));
      return data[0];
    }
    return get().orders.find(o => o.id === id) || null;
  },

  // Обновить статус
  updateStatus: async (id, status) => {
    set(s => ({
      orders: s.orders.map(o => o.id === id ? { ...o, status } : o),
    }));
    await supabase.from('orders').update({ status }).eq('id', id);
  },

  // Удалить заказ
  deleteOrder: async (id) => {
    set(s => ({ orders: s.orders.filter(o => o.id !== id) }));
    await supabase.from('orders').delete().eq('id', id);
  },

  // Дублировать заказ
  duplicateOrder: async (order) => {
    const orderNumber = generateOrderNumber(get().orders);
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
    // Fallback
    const local = { ...dup, id: Date.now() };
    set(s => ({ orders: [local, ...s.orders] }));
    return local;
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
