/**
 * Слайс заказов: загрузка (активные/архив/один), CRUD, отгрузка, вложения,
 * история этапов/правок, комментарии. Вынесен из useErpStore.ts (рефакторинг по плану аудита).
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import type {
  ErpDepartment,
  ErpItemStage,
  ErpOrder,
  ErpOrderStatus,
  ErpStageEvent,
} from '../../types';
import { erpError, erpQuery, erpRead } from '../shared';
import { cachedQuery, invalidate } from '../queryCache';
import { ORDER_SELECT, ORDER_LIST_SELECT, sortOrderFull } from '../orderHelpers';

/** Размер страницы архива: заказы грузятся не все разом, а по кнопке «Показать ещё» */
export const ARCHIVE_PAGE_SIZE = 50;

/**
 * Пути файлов заказа в бакете `erp-attachments`: ТЗ в PDF и вложения
 * (превью макета, фото). Обе таблицы уедут каскадом вместе с заказом,
 * поэтому спрашивать их надо ДО удаления.
 *
 * Отдельным запросом, а не из `order.tz_documents`/`order.attachments`
 * в сторе: в списке заказ приезжает по `ORDER_LIST_SELECT`, где этих связей
 * нет, и уборка работала бы только у заказа, чью карточку успели открыть.
 *
 * Сбой чтения НЕ отменяет удаление: невозможность перечислить файлы — плохая
 * причина запретить удалить заказ. Хуже сироты только заблокированное действие.
 */
export async function orderFilePaths(orderId: string): Promise<string[]> {
  const [tz, att] = await Promise.all([
    erpQuery(() => supabase
      .from('erp_tz_documents').select('file_path').eq('order_id', orderId)),
    erpQuery(() => supabase
      .from('erp_order_attachments').select('file_path').eq('order_id', orderId)),
  ]);
  const rows = [
    ...(tz.data ?? []),
    ...(att.data ?? []),
  ] as { file_path: string | null }[];
  return rows.map((r) => r.file_path).filter((p): p is string => Boolean(p));
}

import type {
  ErpStore,
  OrdersSlice,
  ErpOrderBrief,
  ErpOrderBundle,
  ErpOrderAttachment,
  ErpOrderAuditRow,
  ErpOrderComment,
  ErpOrderFull,
} from '../types';

/** Кэш-ключ пакета спутников заказа (история, аудит, комментарии) */
export const orderBundleKey = (orderId: string) => `erp:order-detail:${orderId}`;

/** Ключ localStorage для переключателя показа тестовых заказов */
export const SHOW_DEMO_KEY = 'erp_show_demo';

/** Читаем настройку показа демо; отсутствие ключа = не показывать */
function readShowDemo(): boolean {
  try {
    return localStorage.getItem(SHOW_DEMO_KEY) === '1';
  } catch {
    return false; // приватный режим — ведём себя как по умолчанию
  }
}

export const ordersSlice: StateCreator<ErpStore, [], [], OrdersSlice> = (set, get) => ({
  departments: [],
  orders: [],
  loading: false,
  loaded: false,
  loadError: false,
  archiveLoaded: false,
  archiveLoading: false,
  archiveHasMore: false,
  archiveOffset: 0,
  detailIds: [],
  detailError: null,
  showDemoOrders: readShowDemo(),

  setShowDemoOrders: async (value) => {
    try {
      localStorage.setItem(SHOW_DEMO_KEY, value ? '1' : '0');
    } catch { /* приватный режим: настройка живёт до перезагрузки */ }
    // Демо отсекается запросом, поэтому переключатель обязан перечитать данные:
    // фильтровать уже загруженный массив нельзя — скрытых строк в нём просто нет.
    set({ showDemoOrders: value, archiveLoaded: false, archiveHasMore: false });
    await get().loadAll();
  },

  loadAll: async () => {
    /**
     * Guard'а «уже грузим — выходим» здесь НЕТ, и это проверено, а не забыто.
     *
     * `ErpLayout` зовёт `loadAll()` при монтировании оболочки, каждый экран
     * делает то же самое, и на первом открытии запрос уходит дважды — экономия
     * напрашивается. Но обе её формы ломают очередь цеха (10 e2e-сценариев из 24):
     * и ранний выход, и дедупликация общим промисом. Экраны вызывают `loadAll()`
     * не «на всякий случай», а как загрузку СВОИХ данных и читают стор сразу
     * после — им нужен свой заход, а не чужой результат.
     *
     * Лишний запрос стоит дешевле пустого экрана «Выберите свой цех выше»,
     * который рабочий читает как «заданий нет». Если экономить — то сводить
     * вызывающих к одному месту, а не отбирать у них загрузку на полпути.
     */
    set({ loading: true, loadError: false });
    // Архив лениво (п.26): пока архив не открывали — грузим только активные.
    // Если архив уже загружен, полная перезагрузка обновляет и его.
    let ordersQuery = supabase
      .from('erp_orders')
      .select(ORDER_LIST_SELECT)
      .order('due_date', { ascending: true, nullsFirst: false });
    if (!get().archiveLoaded) ordersQuery = ordersQuery.eq('status', 'active');
    if (!get().showDemoOrders) ordersQuery = ordersQuery.eq('is_demo', false);
    /**
     * Цеха запрашиваются, только если их ещё нет.
     *
     * Обычный путь — `loadBootstrap()` в оболочке, он приносит цеха вместе
     * с правами и справочниками одним RPC. Но `loadAll` зовут и экраны
     * («если не загружено — загрузи»), и в тестах он вызывается сам по себе,
     * поэтому остаётся самодостаточным: без этого запаса экран, открытый
     * до бутстрапа, остался бы с пустым списком цехов и нарисовал бы
     * «?» вместо названий участков.
     */
    const needDepartments = get().departments.length === 0;
    const [deps, orders] = await Promise.all([
      needDepartments
        ? erpRead(() => supabase.from('erp_departments').select('*').order('sort_order'))
        : Promise.resolve({ data: null, error: null }),
      erpRead(() => ordersQuery),
    ]);
    if (deps.error || orders.error) {
      erpError('Не удалось загрузить данные ERP', deps.error ?? orders.error);
      set({ loading: false, loadError: true });
      return;
    }
    set({
      ...(deps.data ? { departments: deps.data as ErpDepartment[] } : {}),
      orders: ((orders.data ?? []) as ErpOrderFull[]).map(sortOrderFull),
      loading: false,
      loaded: true,
    });
  },

  /**
   * Архив постранично. Раньше первый заход на вкладку тянул ВЕСЬ архив одним
   * запросом с полным ORDER_SELECT (9 вложенных отношений). Сегодня это 71 заказ
   * и работает, но растёт линейно и однажды упрётся.
   *
   * Страница явная, не «тихий лимит»: сколько загружено и есть ли ещё — видно
   * в интерфейсе кнопкой «Показать ещё».
   *
   * Сортировка ОБЯЗАНА иметь уникальный доводчик (`id`). `due_date` не уникален
   * и бывает NULL: при равных значениях Postgres волен вернуть строки в любом
   * порядке, и между двумя запросами `range` порядок мог перетасоваться — заказ
   * приезжал дважды или не приезжал вовсе. Пропуск при этом молчаливый: дедуп
   * по id гасит дубль, а недостачу заметить нечем.
   */
  loadArchive: async () => {
    if (get().archiveLoading || get().archiveLoaded) return;
    set({ archiveLoading: true });
    let q = supabase
      .from('erp_orders')
      .select(ORDER_LIST_SELECT)
      .neq('status', 'active');
    if (!get().showDemoOrders) q = q.eq('is_demo', false);
    const { data, error } = await erpQuery(() => q
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(0, ARCHIVE_PAGE_SIZE - 1));
    if (error) {
      erpError('Не удалось загрузить архив', error);
      set({ archiveLoading: false });
      return;
    }
    const rows = (data ?? []) as ErpOrderFull[];
    // Архивные заказы, уже загруженные мимо пагинации (прямая ссылка
    // `/orders/:id` → `loadOne`), СОХРАНЯЕМ. Прежде здесь стоял `filter(status === 'active')`:
    // открытая по ссылке карточка архивного заказа пропадала из стора в момент
    // захода на вкладку архива и возвращалась, только если попала в первые 50.
    set((s) => {
      const fresh = rows.map(sortOrderFull);
      const paged = new Set(fresh.map((o) => o.id));
      return {
        orders: [...s.orders.filter((o) => !paged.has(o.id)), ...fresh],
        archiveLoading: false,
        archiveLoaded: true,
        archiveOffset: rows.length,
        archiveHasMore: rows.length === ARCHIVE_PAGE_SIZE,
      };
    });
  },

  loadMoreArchive: async () => {
    if (get().archiveLoading || !get().archiveHasMore) return;
    const offset = get().archiveOffset;
    set({ archiveLoading: true });
    let q = supabase
      .from('erp_orders')
      .select(ORDER_LIST_SELECT)
      .neq('status', 'active');
    if (!get().showDemoOrders) q = q.eq('is_demo', false);
    const { data, error } = await erpQuery(() => q
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + ARCHIVE_PAGE_SIZE - 1));
    if (error) {
      erpError('Не удалось догрузить архив', error);
      set({ archiveLoading: false });
      return;
    }
    const rows = (data ?? []) as ErpOrderFull[];
    // Дедуп по id: заказ мог приехать сюда раньше по диплинку или из realtime
    set((s) => {
      const known = new Set(s.orders.map((o) => o.id));
      const fresh = rows.filter((o) => !known.has(o.id)).map(sortOrderFull);
      return {
        orders: [...s.orders, ...fresh],
        archiveLoading: false,
        archiveOffset: offset + rows.length,
        archiveHasMore: rows.length === ARCHIVE_PAGE_SIZE,
      };
    });
  },

  loadOrderBundle: async (orderId, { force = false } = {}) => {
    /**
     * История этапов, лог правок и комментарии — одним RPC вместо трёх запросов.
     *
     * Карточка заказа открывалась одиннадцатым–тринадцатым запросом сессии;
     * три из них были эти. Лимиты (100/100/200) перенесены в функцию БД
     * дословно — менять их заодно с числом запросов значило бы тихо
     * поменять поведение экрана.
     *
     * Через кэш: страница и боковой Drawer подключены к одному хуку, а в dev
     * StrictMode вызывает эффекты парой — без дедупликации это два-четыре
     * одинаковых запроса подряд. Возврат на недавно открытый заказ отдаёт
     * данные сразу и обновляет фоном.
     */
    const fetcher = async () => {
      // try/catch наравне с проверкой `error`: supabase-js возвращает `error`
      // на ответ сервера и БРОСАЕТ, когда ответа не было (нет сети, CORS).
      // Без второй ветки карточка остаётся на скелетоне навсегда — экран
      // ждёт данных, которых уже не будет, и ошибку никто не показал.
      try {
        const { data, error } = await supabase.rpc('erp_order_detail', { p_order_id: orderId });
        if (error) {
          toast.error('Не удалось загрузить историю заказа');
          return null;
        }
        return data as ErpOrderBundle;
      } catch (e) {
        console.error('[loadDetail]', e);
        toast.error('Не удалось загрузить историю заказа');
        return null;
      }
    };
    if (force) invalidate(orderBundleKey(orderId));
    return cachedQuery(orderBundleKey(orderId), fetcher);
  },

  findOrdersByBitrixId: async (bitrixId) => {
    const value = bitrixId.trim();
    if (!value) return [];
    // Запрос, а не поиск по стору: дубль может лежать в архиве (он грузится
    // лениво) или быть помечен тестовым (его в сторе нет вовсе). Проверка
    // по памяти нашла бы не всё и была бы хуже отсутствия проверки —
    // «мы посмотрели, дублей нет».
    const { data, error } = await erpQuery(() => supabase
      .from('erp_orders')
      .select('id, title, status, created_at, is_demo')
      .eq('bitrix_id', value)
      .limit(5));
    // Молча: это подсказка, а не действие пользователя. Тост об упавшей
    // фоновой проверке во время заполнения формы только мешает.
    if (error) return [];
    return (data ?? []) as ErpOrderBrief[];
  },

  loadOne: async (orderId) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_orders')
      .select(ORDER_SELECT)
      .eq('id', orderId)
      .maybeSingle());
    if (error) {
      // Сбой ОТЛИЧАЕТСЯ от «такого заказа нет»: экран покажет «Не удалось
      // загрузить · Повторить», а не «Заказ не найден» (правка 03.09)
      set({ detailError: error.message });
      erpError('Не удалось загрузить заказ', error);
      return null;
    }
    if (!data) {
      set({ detailError: null });
      return null;
    }
    const full = sortOrderFull(data as ErpOrderFull);
    set((s) => ({
      orders: s.orders.some((o) => o.id === full.id)
        ? s.orders.map((o) => (o.id === full.id ? full : o))
        : [full, ...s.orders],
      // Отмечаем, что у этого заказа есть колонки, которых нет в списочном запросе
      detailIds: s.detailIds.includes(full.id) ? s.detailIds : [...s.detailIds, full.id],
      detailError: null,
    }));
    return full;
  },
});
