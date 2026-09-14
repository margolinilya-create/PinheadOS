/**
 * Слайс заказов: загрузка (активные/архив/один), CRUD, отгрузка, вложения,
 * история этапов/правок, комментарии. Вынесен из useErpStore.ts (рефакторинг по плану аудита).
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import type {
  ErpDepartment,
  ErpItemStage,
  ErpOrder,
  ErpOrderStatus,
  ErpStageEvent,
} from '../../types';
import { erpError, erpQuery, erpRead } from '../shared';
import { ORDER_LIST_SELECT, sortOrderFull } from '../orderHelpers';

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

import type { ErpStore, OrdersSlice, ErpOrderFull } from '../types';

/** Кэш-ключ пакета спутников заказа (история, аудит, комментарии) */
export const orderBundleKey = (orderId: string) => `erp:order-detail:${orderId}`;

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

});
