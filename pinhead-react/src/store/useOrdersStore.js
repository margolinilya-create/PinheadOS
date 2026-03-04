import { create } from 'zustand';
import { supabase } from '../lib/supabase';

const STATUS_LIST = ['draft', 'review', 'approved', 'production', 'done'];
const STATUS_LABELS = { draft: 'Черновик', review: 'На проверке', approved: 'Подтверждён', production: 'В производстве', done: 'Готов' };
const STATUS_COLORS = { draft: '#888', review: '#b89000', approved: '#1D19EA', production: '#c04500', done: '#007840' };

export { STATUS_LIST, STATUS_LABELS, STATUS_COLORS };

export const useOrdersStore = create((set, get) => ({
  orders: [],
  loading: false,
  filter: 'all',
  search: '',

  setFilter: (f) => set({ filter: f }),
  setSearch: (s) => set({ search: s }),

  // Загрузить заказы из Supabase
  fetchOrders: async () => {
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (!error && data) {
        set({ orders: data, loading: false });
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  // Сохранить новый заказ
  saveOrder: async (orderData) => {
    const id = 'PH-' + Date.now().toString(36).toUpperCase();
    const row = {
      order_number: id,
      status: 'draft',
      data: orderData,
      total_sum: orderData.total || 0,
      total_qty: orderData.totalQty || 0,
      item_type: orderData.type || '',
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
  duplicateOrder: (order) => {
    const id = 'PH-' + Date.now().toString(36).toUpperCase();
    const dup = {
      ...order,
      id: Date.now(),
      order_number: id,
      status: 'draft',
      created_at: new Date().toISOString(),
    };
    set(s => ({ orders: [dup, ...s.orders] }));
    // Сохраняем в облако
    supabase.from('orders').insert(dup).select();
    return dup;
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
