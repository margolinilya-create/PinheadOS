/**
 * Слайс аналитики производства (правка заказчика 16.09, п. 7).
 *
 * СЧИТАЕТ СЕРВЕР, И ЭТО НЕ ВКУС. Стор держит только незакрытые заказы
 * (`loadAll`), а сводка — про историю: данных, из которых её можно посчитать
 * на клиенте, в памяти просто нет. Агрегация идёт по журналу отчётов, строкам
 * размеров, расходу рулонов, позициям и заказам — тянуть это на клиент значит
 * выкачать историю фабрики ради пяти плиток. Прецедент в разделе уже есть
 * и работает: `erp_bootstrap()` и `erp_sku_card_stats()`.
 *
 * ОДИН ВЫЗОВ НА СМЕНУ ФИЛЬТРА. Четыре RPC уходят параллельно и складываются
 * в один снимок: карточки, ряды, таблица моделей и брак по цехам. Каждая
 * из них сама проверяет право `analytics.view` — то же, чем гейтится вкладка.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { erpQuery, erpError } from '../shared';
import type { AnalyticsFilter, AnalyticsSnapshot, ErpStore, AnalyticsSlice } from '../types';

/** Ключ снимка: те же фильтры — тот же ответ */
function filterKey(f: AnalyticsFilter): string {
  return [f.from, f.to, f.bucket ?? 'day', f.product ?? '', f.dept ?? ''].join('|');
}

export const analyticsSlice: StateCreator<ErpStore, [], [], AnalyticsSlice> = (set, get) => ({
  /**
   * Данные объявлены здесь, хотя приезжают из `DOMAIN_INITIAL_STATE`:
   * сторож `domainSlices.test.ts` сверяет ядро со слайсами и требует, чтобы
   * у каждого доменного поля был хозяин. Поле без хозяина — это поле,
   * которое никто не чистит при выходе из системы.
   */
  analytics: null,
  analyticsKey: null,
  analyticsLoading: false,

  loadAnalytics: async (filter) => {
    const key = filterKey(filter);
    // Тот же фильтр — тот же ответ: переключение вкладок внутри раздела
    // не должно гонять четыре агрегации заново
    const cached = get().analytics;
    if (get().analyticsKey === key && cached) return cached;

    set({ analyticsLoading: true });
    const args = {
      p_from: filter.from,
      p_to: filter.to,
      p_product: filter.product || null,
      p_dept: filter.dept || null,
    };

    const [overview, series, bySku, byDept] = await Promise.all([
      erpQuery(() => supabase.rpc('erp_analytics_overview', args)),
      erpQuery(() => supabase.rpc('erp_analytics_series', {
        p_from: filter.from,
        p_to: filter.to,
        p_bucket: filter.bucket ?? 'day',
        p_product: filter.product || null,
        p_dept: filter.dept || null,
      })),
      erpQuery(() => supabase.rpc('erp_analytics_by_sku', {
        p_from: filter.from, p_to: filter.to, p_dept: filter.dept || null,
      })),
      erpQuery(() => supabase.rpc('erp_analytics_by_dept', {
        p_from: filter.from, p_to: filter.to, p_product: filter.product || null,
      })),
    ]);

    const failed = [overview, series, bySku, byDept].find((r) => r.error);
    if (failed?.error) {
      erpError('Аналитика не загрузилась', failed.error);
      set({ analyticsLoading: false });
      // `null`, а не половина снимка: показать три плитки из пяти и молчать
      // про остальные — худший исход, чем честное «не загрузилось»
      return null;
    }

    const snapshot: AnalyticsSnapshot = {
      overview: (overview.data ?? null) as AnalyticsSnapshot['overview'],
      series: (series.data ?? []) as AnalyticsSnapshot['series'],
      bySku: (bySku.data ?? []) as AnalyticsSnapshot['bySku'],
      byDept: (byDept.data ?? []) as AnalyticsSnapshot['byDept'],
    };
    set({ analytics: snapshot, analyticsKey: key, analyticsLoading: false });
    return snapshot;
  },
});
