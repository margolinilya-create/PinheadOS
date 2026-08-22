import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { erpError, erpQuery, erpWrite } from '../shared';
import type { ErpStore, OrderDraftsSlice } from '../types';
import type { ErpOrderDraft } from '../../types';

/**
 * Черновики заказа В БАЗЕ (правка заказчика 22.08, п. 5.5).
 *
 * ЧТО БЫЛО НЕ ТАК. Черновик формы жил в ОДНОМ ключе localStorage, поэтому
 * «Новый заказ» при наличии незапущенного заказа восстанавливал предыдущий:
 * «пользователь не может параллельно подготовить два разных заказа».
 * И он был привязан к браузеру — начал на планшете, продолжить с ноутбука
 * нельзя.
 *
 * ЧЕРНОВИК — НЕ ЗАКАЗ. Он лежит в своей таблице снимком формы, а не строкой
 * `erp_orders` со статусом `draft`: новый статус означал бы фильтр в полутора
 * десятках производственных поверхностей, и один забытый фильтр отправил бы
 * незаконченный заказ в цех. Подробности — в самой миграции.
 *
 * АВТОСОХРАНЕНИЕ ИДЁТ ПО МОЛЧАНИЮ (debounce в форме), поэтому ошибку записи
 * НЕ показываем тостом на каждый промах: человек в этот момент печатает,
 * и красная полоса поверх формы — худшее, что можно сделать. Форма
 * показывает состояние строкой рядом с собой; тост остаётся у ЯВНЫХ
 * действий — открытия списка и удаления.
 */
export const orderDraftsSlice: StateCreator<ErpStore, [], [], OrderDraftsSlice> = (set, get) => ({
  orderDrafts: [],
  orderDraftsLoaded: false,
  orderDraftsError: null,

  loadOrderDrafts: async () => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_order_drafts')
      .select('*')
      .order('updated_at', { ascending: false }));
    if (error) {
      /**
       * Флаг загрузки НЕ поднимаем, но ошибку запоминаем: эффект
       * `if (!loaded) load()` второй раз не срабатывает, и без этого
       * состояния экран остался бы пустым навсегда — ровно тот отказ,
       * ради которого в сторе завели `employeesError`.
       */
      set({ orderDraftsError: 'Не удалось загрузить черновики' });
      erpError('Не удалось загрузить черновики', error);
      return;
    }
    set({
      orderDrafts: (data ?? []) as ErpOrderDraft[],
      orderDraftsLoaded: true,
      orderDraftsError: null,
    });
  },

  /**
   * Сохранить черновик. `id` пустой — создаём и возвращаем новый: форма
   * запоминает его и дальше правит СВОЮ строку, а не заводит по одной
   * на каждое нажатие клавиши.
   */
  saveOrderDraft: async (id, title, payload) => {
    if (id) {
      const { data, error } = await erpQuery(() => supabase
        .from('erp_order_drafts')
        .update({ title, payload })
        .eq('id', id)
        .select());
      /**
       * Пустой ответ — ОТКАЗ, а не успех: RLS на UPDATE запрещает через
       * `USING`, то есть отдаёт «0 строк» без ошибки. Молча считать это
       * сохранением значит потерять работу человека.
       */
      if (error || (data ?? []).length === 0) return null;
      const row = data![0] as ErpOrderDraft;
      set((s) => ({
        orderDrafts: s.orderDrafts.map((d) => (d.id === row.id ? row : d)),
      }));
      return row;
    }
    const { data, error } = await erpQuery(() => supabase
      .from('erp_order_drafts')
      .insert({ title, payload })
      .select());
    if (error || (data ?? []).length === 0) return null;
    const row = data![0] as ErpOrderDraft;
    set((s) => ({ orderDrafts: [row, ...s.orderDrafts] }));
    return row;
  },

  /** Удаление НЕ оптимистичное (правило проекта): ждём ответ сервера */
  deleteOrderDraft: async (id) => {
    const ok = await erpWrite(
      'Черновик не удалён',
      () => supabase.from('erp_order_drafts').delete().eq('id', id).select(),
    );
    if (!ok) return false;
    set((s) => ({ orderDrafts: s.orderDrafts.filter((d) => d.id !== id) }));
    return true;
  },

  /** Черновик по id — форма открывает его по ссылке из списка */
  orderDraftById: (id) => get().orderDrafts.find((d) => d.id === id) ?? null,
});
