/**
 * ЗАГРУЗКИ ЗАКАЗОВ ПО ТРЕБОВАНИЮ — доменный чанк, приезжает с первым экраном.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ `ordersSlice`. Оболочку грузят все и всегда, и активный
 * список ей нужен для бейджей, счётчиков цехов и колокола. Всё остальное
 * чтение зовут ТОЛЬКО экраны, и проверяется это списком вызывающих:
 *
 *   · `loadArchive` / `loadMoreArchive` — вкладка «Архив» (`OrdersScreen`);
 *   · `loadOrderBundle` — карточка заказа (`orderCard/useOrderDetail`);
 *   · `findOrdersByBitrixId` — форма заказа, проверка дубля № сделки;
 *   · `loadOne` — карточка заказа и страница разработки (`DevPage`).
 *
 * Ни `ErpApp`, ни `layout/*` их не вызывают — оболочка знает `loadAll`,
 * `loadBootstrap`, `loadBypasses` и `loadNotifications`, и только их.
 *
 * ПОЧЕМУ ЭТО СДЕЛАНО 14.09. Центр уведомлений по построению живёт в ядре
 * (колокол считает непрочитанные до открытия любого экрана), и его слайс
 * добавил оболочке 439 Б gzip — бюджет упёрся в потолок, оставив 518 байт
 * на всё остальное. Владелец решил: потолок не поднимать, сократить ядро.
 * Бюджет, в который упёрлись вплотную, ломает сборку на каждой правке
 * вместо того, чтобы ловить регрессию, — а чат впереди принесёт ещё счётчик.
 *
 * Данные (`orders`, `archiveLoaded`, `detailIds`, …) остаются в ядре
 * (`domainState.ts`): их наполняет `loadAll` ещё до открытия любого экрана,
 * и слайс с собственными значениями затирал бы загруженное.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import { erpError, erpQuery } from '../shared';
import { cachedQuery, invalidate } from '../queryCache';
import { ORDER_SELECT, ORDER_LIST_SELECT, sortOrderFull } from '../orderHelpers';
import { ARCHIVE_PAGE_SIZE, orderBundleKey } from './ordersSlice';
import type {
  ErpStore,
  OrdersOnDemandSlice,
  ErpOrderBrief,
  ErpOrderBundle,
  ErpOrderFull,
} from '../types';

export const ordersOnDemandSlice: StateCreator<ErpStore, [], [], OrdersOnDemandSlice> = (
  set,
  get,
) => ({
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
    const q = supabase
      .from('erp_orders')
      .select(ORDER_LIST_SELECT)
      .neq('status', 'active');
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
    const q = supabase
      .from('erp_orders')
      .select(ORDER_LIST_SELECT)
      .neq('status', 'active');
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

  findOrdersByBitrixId: async (bitrixId, excludeOrderId) => {
    const value = bitrixId.trim();
    if (!value) return [];
    // Запрос, а не поиск по стору: дубль может лежать в архиве (он грузится
    // лениво) или быть помечен тестовым (его в сторе нет вовсе). Проверка
    // по памяти нашла бы не всё и была бы хуже отсутствия проверки —
    // «мы посмотрели, дублей нет».
    //
    // САМ СЕБЕ НЕ ДУБЛЬ (правка заказчика 12.09, баг 03). Форма правки — это
    // та же форма, и до правки она спрашивала «есть ли заказ с таким номером»
    // вообще, находила РЕДАКТИРУЕМЫЙ заказ и сообщала о дубле при каждом
    // открытии. Отсев идёт запросом, а не фильтром по ответу: `limit(5)`
    // иначе тратился бы на сам заказ и мог скрыть настоящий дубль.
    const { data, error } = await erpQuery(() => {
      const q = supabase
        .from('erp_orders')
        .select('id, title, status, created_at')
        .eq('bitrix_id', value);
      return (excludeOrderId ? q.neq('id', excludeOrderId) : q).limit(5);
    });
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
