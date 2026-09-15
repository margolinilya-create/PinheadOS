/**
 * КАТАЛОГ SKU В ERP (правка 14.09, п. 6) — клиентская половина.
 *
 * ЧТО ЭТО РЯДОМ С ПРАЙС-КАТАЛОГОМ ВИЗАРДА. `app_config.sku_catalog` считает
 * ЦЕНУ заказа; `erp_sku_cards` описывает, КАК ИЗДЕЛИЕ ШЬЁТСЯ. Связь — по коду,
 * и «есть ли артикул в прайсе» спрашивается у самого прайса (его читает любой
 * вошедший), а не хранится вторым флагом: два источника одного факта
 * разошлись бы в первую же публикацию.
 *
 * СЛАЙС ДОМЕННЫЙ: каталог открывают с экрана админки или из карточки
 * разработки, к этому моменту доменный чанк уже приехал.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import type { ErpSkuCard, ErpSkuCardFile, ErpSkuCardVersion } from '../../types';
import { currentUserId, erpError, erpQuery, erpRead } from '../shared';
import type { ErpStore, SkuSlice } from '../types';

export const skuSlice: StateCreator<ErpStore, [], [], SkuSlice> = (set, get) => ({
  // Зеркало `domainState.DOMAIN_INITIAL_STATE` — сверяет `domainSlices.test.ts`
  skuCards: [],
  skuCardsLoaded: false,
  skuCardsError: null,
  skuPriceCodes: [],

  loadSkuCards: async () => {
    const { data, error } = await erpRead(() => supabase
      .from('erp_sku_cards')
      .select('*')
      .order('name'));
    if (error) {
      set({ skuCardsError: error.message, skuCardsLoaded: true });
      return;
    }
    /**
     * Коды прайс-каталога приезжают ВТОРЫМ запросом и намеренно НЕ падают
     * вместе с первым: без них карточки читаются, просто не видно, какие
     * из них уже выпущены. Обратное — уронить весь экран из-за подписи —
     * было бы хуже.
     */
    const price = await erpRead(() => supabase
      .from('app_config')
      .select('value')
      .eq('key', 'sku_catalog')
      .maybeSingle());
    const codes = Array.isArray(price.data?.value)
      ? (price.data.value as { code?: string }[])
        .map((x) => x?.code)
        .filter((c): c is string => Boolean(c))
      : [];
    set({
      skuCards: (data ?? []) as ErpSkuCard[],
      skuCardsLoaded: true,
      skuCardsError: null,
      skuPriceCodes: codes,
    });
  },

  /**
   * Правка карточки. Оптимистично С ОТКАТОМ — правило проекта; номер версии
   * и историю ведёт сервер, поэтому после ответа строка перечитывается
   * целиком, а не собирается из патча: версия, которую нарисовал бы клиент,
   * разошлась бы с записанной.
   */
  saveSkuCard: async (id, patch) => {
    const before = get().skuCards;
    set({ skuCards: before.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
    /**
     * `.select()` МАССИВОМ, а не `maybeSingle`: RLS на UPDATE запрещает через
     * `USING`, то есть отдаёт «0 строк» БЕЗ ошибки, и зелёное «сохранено»
     * было бы неправдой. Правило проекта; `erpWrite` реализует ровно его,
     * но здесь нужна сама строка — сервер вернёт её с новым номером версии.
     */
    const { data, error } = await erpQuery(() => supabase
      .from('erp_sku_cards')
      .update(patch)
      .eq('id', id)
      .select());
    const row = (data ?? [])[0] as ErpSkuCard | undefined;
    if (error || !row) {
      set({ skuCards: before });
      erpError('Не удалось сохранить карточку модели',
        error ?? { message: 'нет прав на это действие или запись изменена другим' });
      return false;
    }
    set({ skuCards: get().skuCards.map((c) => (c.id === id ? row : c)) });
    return true;
  },

  /**
   * Завести карточку руками — для моделей, которые в прайсе есть, а в ERP
   * не заводились. Код уникален в базе: повтор отвечает 23505, и это честнее
   * предварительной проверки на клиенте (между ней и вставкой помещается
   * второй человек).
   */
  createSkuCard: async (input) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_sku_cards')
      .insert({ ...input, created_by: currentUserId() })
      .select());
    const row = (data ?? [])[0] as ErpSkuCard | undefined;
    if (error || !row) {
      erpError('Не удалось завести карточку модели',
        error ?? { message: 'нет прав на это действие' });
      return null;
    }
    set({ skuCards: [...get().skuCards, row] });
    return row;
  },

  /**
   * Открытие карточки ПЕРЕЧИТЫВАЕТ её саму, а не только историю и файлы.
   *
   * Без этого список, загруженный один раз за сессию, оставался бы снимком
   * на весь день: подписки realtime у каталога нет (и не нужно — это
   * справочник, а не доска цеха), и «перечитывается при открытии» обязано
   * быть правдой, а не объяснением в комментарии. Ровно то же правило, по
   * которому части карточки заказа живут без подписки.
   */
  loadSkuCardDetail: async (id) => {
    const fresh = await erpRead(() => supabase
      .from('erp_sku_cards')
      .select('*')
      .eq('id', id)
      .maybeSingle());
    if (fresh.data) {
      const row = fresh.data as ErpSkuCard;
      set({ skuCards: get().skuCards.map((c) => (c.id === id ? row : c)) });
    }
    const [versions, files] = await Promise.all([
      erpRead(() => supabase
        .from('erp_sku_card_versions')
        .select('*')
        .eq('card_id', id)
        .order('version', { ascending: false })),
      erpRead(() => supabase
        .from('erp_sku_card_files')
        .select('*')
        .eq('card_id', id)
        .order('created_at')),
    ]);
    // Частичный отказ — не повод отдать `null`: история и файлы независимы,
    // и пустая вкладка «Файлы» из-за сбоя истории была бы неправдой
    return {
      versions: (versions.data ?? []) as ErpSkuCardVersion[],
      files: (files.data ?? []) as ErpSkuCardFile[],
    };
  },

  /**
   * Статистика заказов по модели. Считает СЕРВЕР (`erp_sku_card_stats`):
   * на клиенте это означало бы загрузить все заказы ради двух чисел,
   * а активный список в памяти держит только незакрытые.
   */
  loadSkuCardStats: async (id) => {
    const { data, error } = await erpRead(() => supabase
      .rpc('erp_sku_card_stats', { p_card: id }));
    if (error) return null;
    const row = (data ?? {}) as { orders?: number; qty?: number; last_order_at?: string | null };
    return {
      orders: Number(row.orders ?? 0),
      qty: Number(row.qty ?? 0),
      lastOrderAt: row.last_order_at ?? null,
    };
  },
});
