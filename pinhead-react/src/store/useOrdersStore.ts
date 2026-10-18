import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useAuthStore } from './useAuthStore';
import { registerAppReset } from './appReset';
import { toast } from './useToastStore';
import type { Order, OrderStatus, StatusColors } from '../types/order';

/**
 * Старые заказы визарда (v3, `orders.schema_version = 3`) — ТОЛЬКО ЧТЕНИЕ
 * (веха 8, К6). Запись, удаление и дублирование v3 убраны: страж миграции L
 * (`order_v4_guard`, `order_v4_delete_guard`) отказывает клиенту `42501`
 * «Старые заказы (v3) только для чтения». Читает вкладка «Заказы ТЗ» админки
 * (`components/auth/AdminPanel.jsx`); новые заказы — Order v4 (`useSalesStore`).
 */

export const STATUS_LIST: OrderStatus[] = ['draft', 'review', 'approved', 'production', 'done'];
export const STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Черновик',
  review: 'На проверке',
  approved: 'Подтверждён',
  production: 'В производстве',
  done: 'Готов',
};
export const STATUS_COLORS: Record<OrderStatus, StatusColors> = {
  draft:      { bg: '#F0F0F0', text: '#555555', bar: '#CCCCCC' },
  review:     { bg: '#FFF8E1', text: '#C87137', bar: '#C87137' },
  approved:   { bg: '#EEF2FF', text: '#2B2BF0', bar: '#2B2BF0' },
  production: { bg: '#FFF3E8', text: '#C87137', bar: '#E07B30' },
  done:       { bg: '#F0FFF4', text: '#06A77D', bar: '#06A77D' },
};

const PAGE_SIZE = 50;

/** Незавершённая загрузка списка заказов — см. комментарий в fetchOrders */
let ordersInFlight: Promise<void> | null = null;

/** Тело загрузки заказов (вынесено, чтобы fetchOrders остался тонкой обёрткой) */
async function doFetchOrders(set: (patch: Record<string, unknown>) => void): Promise<void> {
  set({ loading: true, loadError: false, orders: [], lastCreatedAt: null, hasMore: true });
  try {
    const auth = useAuthStore.getState();
    const role = auth.user?.role;
    const userId = auth.user?.id;

    let query = supabase.from('orders').select('*')
      // Только заказы визарда: у строк Order v4 (schema_version = 4) свои статусы,
      // и старый канбан/дашборд/админка показали бы их «Черновиком»
      .eq('schema_version', 3)
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
      const rows = data as Order[];
      set({
        orders: rows,
        loading: false,
        hasMore: rows.length === PAGE_SIZE,
        lastCreatedAt: rows.length > 0 ? rows[rows.length - 1].created_at : null,
      });
    } else {
      console.error('[fetchOrders]', error);
      toast.error('Не удалось загрузить заказы');
      set({ loading: false, loadError: true });
    }
  } catch (err) {
    console.error('[fetchOrders]', err);
    toast.error('Не удалось загрузить заказы');
    set({ loading: false, loadError: true });
  }
}

export type OrdersFilter = 'all' | OrderStatus;

interface OrdersStore {
  orders: Order[];
  loading: boolean;
  /** Последняя загрузка списка не удалась (тост уже показан) */
  loadError: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  lastCreatedAt: string | null;
  filter: OrdersFilter;
  search: string;

  setFilter: (f: OrdersFilter) => void;
  setSearch: (s: string) => void;
  fetchOrders: () => Promise<void>;
  fetchMoreOrders: () => Promise<void>;
  getFiltered: () => Order[];
}

export const useOrdersStore = create<OrdersStore>((set, get) => ({
  orders: [],
  loading: false,
  loadError: false,
  hasMore: true,
  loadingMore: false,
  lastCreatedAt: null,
  filter: 'all',
  search: '',

  setFilter: (f) => set({ filter: f }),
  setSearch: (s) => set({ search: s }),

  // Загрузить заказы из Supabase (фильтрация по роли)
  fetchOrders: async () => {
    // Дедупликация одновременных вызовов: fetchOrders дёргают эффекты сразу
    // нескольких экранов, а StrictMode дублирует их.
    // Кэшировать результат нельзя — выборка зависит от роли (RLS менеджера,
    // превью роли), поэтому переиспользуем только НЕЗАВЕРШЁННЫЙ запрос.
    if (ordersInFlight) return ordersInFlight;
    ordersInFlight = doFetchOrders(set).finally(() => { ordersInFlight = null; });
    return ordersInFlight;
  },

  // Подгрузить следующую страницу
  fetchMoreOrders: async () => {
    const { hasMore, loadingMore, lastCreatedAt } = get();
    if (!hasMore || loadingMore || !lastCreatedAt) return;

    set({ loadingMore: true });
    try {
      const auth = useAuthStore.getState();
      const role = auth.user?.role;
      const userId = auth.user?.id;

      let query = supabase.from('orders').select('*')
        // Только заказы визарда — см. fetchOrders
        .eq('schema_version', 3)
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
        const rows = data as Order[];
        set((s) => ({
          orders: [...s.orders, ...rows],
          loadingMore: false,
          hasMore: rows.length === PAGE_SIZE,
          lastCreatedAt: rows.length > 0 ? rows[rows.length - 1].created_at : null,
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

  // Отфильтрованные заказы
  getFiltered: () => {
    const { orders, filter, search } = get();
    let filtered = orders;
    if (filter !== 'all') filtered = filtered.filter((o) => o.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((o) =>
        (o.order_number || '').toLowerCase().includes(q) ||
        (o.data?.name || '').toLowerCase().includes(q) ||
        (o.item_type || '').toLowerCase().includes(q) ||
        (o.bitrix_deal || '').toLowerCase().includes(q)
      );
    }
    return filtered;
  },
}));

/**
 * Сброс при выходе и потере сессии — ЧЕРЕЗ РЕЕСТР, а не из `useAuthStore`.
 *
 * Тот импортировал этот стор напрямую ради двух `setState` — и тянул весь
 * стор Order Studio (заказы, каталоги, номера) во ВХОДНОЙ чанк, который
 * грузится каждому, включая цех, где раздел выключен флагом. Ровно тот же
 * дефект, что был у `resetErpStore` до заведения `store/appReset`, и тот же,
 * что нашли 23.08 в `main.jsx` со стартом визарда.
 *
 * Регистрация на уровне модуля означает: не открывали Order Studio в этой
 * сессии — стор не загружен, и сбрасывать нечего. Это не обходной путь,
 * а точное описание положения дел.
 */
registerAppReset(() => {
  useOrdersStore.setState({
    orders: [], loading: false, loadError: false, hasMore: true, loadingMore: false,
    lastCreatedAt: null, filter: 'all', search: '',
  });
});
