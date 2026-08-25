/**
 * Слайс справочников админки (правка 12): причины блокировок, типы проблем,
 * типы изделий, поставщики. Одна таблица erp_dictionaries на все виды.
 *
 * Грузятся один раз оболочкой (ErpLayout) — значения нужны цеху при работе,
 * а не только в админке. Правки — optimistic с rollback, как везде в сторе.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { erpQuery, erpWrite } from '../shared';
import { toast } from '../../../store/useToastStore';
import type { ErpDictionaryItem } from '../../types';
import type { DictionariesSlice, ErpStore } from '../types';

/** Код значения из названия: латиница/цифры, остальное — подчёркивание */
function slugify(name: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya',
  };
  const slug = name.trim().toLowerCase().split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  // Название из одних символов вне латиницы/кириллицы — код по времени создания
  return slug || `item_${Date.now().toString(36)}`;
}

const byOrder = (a: ErpDictionaryItem, b: ErpDictionaryItem) =>
  a.sort_order - b.sort_order || a.name.localeCompare(b.name);

export const dictionariesSlice: StateCreator<ErpStore, [], [], DictionariesSlice> = (set, get) => ({
  dictionaries: [],
  dictionariesLoaded: false,

  loadDictionaries: async () => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_dictionaries')
      .select('*')
      .order('kind')
      .order('sort_order'));
    if (error) {
      // Справочники — подсказки, а не гейт: без них экраны работают на свободном вводе
      set({ dictionariesLoaded: true });
      return;
    }
    set({
      dictionaries: (data ?? []) as ErpDictionaryItem[],
      dictionariesLoaded: true,
    });
  },

  createDictionaryItem: async (kind, name) => {
    const clean = name.trim();
    if (!clean) return null;
    const existing = get().dictionaries.filter((d) => d.kind === kind);
    if (existing.some((d) => d.name.toLowerCase() === clean.toLowerCase())) {
      toast.warning('Такое значение уже есть в справочнике');
      return null;
    }
    // Код уникален в паре с видом: при коллизии добавляем суффикс
    let code = slugify(clean);
    if (existing.some((d) => d.code === code)) code = `${code}_${existing.length + 1}`;
    const row = {
      kind,
      code,
      name: clean,
      sort_order: existing.reduce((max, d) => Math.max(max, d.sort_order), 0) + 10,
    };
    const { data, error } = await erpQuery(() => supabase.from('erp_dictionaries').insert(row).select());
    const created = data?.[0] as ErpDictionaryItem | undefined;
    if (error || !created) {
      toast.error('Не удалось добавить значение справочника');
      return null;
    }
    set((s) => ({ dictionaries: [...s.dictionaries, created].sort(byOrder) }));
    return created;
  },

  updateDictionaryItem: async (id, patch) => {
    const prev = get().dictionaries;
    set((s) => ({
      dictionaries: s.dictionaries.map((d) => (d.id === id ? { ...d, ...patch } : d)).sort(byOrder),
    }));
    // `erp_dictionaries_update` гейтится правом `catalog.edit`: отказ RLS — «0 строк»
    const ok = await erpWrite('Значение справочника не сохранено', () => supabase
      .from('erp_dictionaries').update(patch).eq('id', id).select());
    if (!ok) set({ dictionaries: prev });
    return ok;
  },

  /**
   * Перестановка значения на одну позицию: меняем sort_order с соседом.
   * Значения уже использованы в заказах, поэтому удаляем не физически, а
   * деактивацией (updateDictionaryItem active:false) — история остаётся читаемой.
   */
  /**
   * `neighbourId` — сосед из ВИДИМОГО списка. Без него обмен шёл с соседом
   * по полному набору, и при выключенном «Показывать отключённые» стрелка меняла
   * порядок с невидимым значением: на экране ничего не двигалось, кнопка
   * выглядела сломанной.
   */
  moveDictionaryItem: async (id, direction, neighbourId = null) => {
    const all = get().dictionaries;
    const item = all.find((d) => d.id === id);
    if (!item) return false;
    const list = all.filter((d) => d.kind === item.kind).sort(byOrder);
    const i = list.findIndex((d) => d.id === id);
    const a = list[i];
    let b;
    if (neighbourId) {
      b = list.find((d) => d.id === neighbourId);
    } else {
      const j = direction === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return false;
      b = list[j];
    }
    if (!a || !b || a.id === b.id) return false;
    const prev = get().dictionaries;
    set((s) => ({
      dictionaries: s.dictionaries
        .map((d) => {
          if (d.id === a.id) return { ...d, sort_order: b.sort_order };
          if (d.id === b.id) return { ...d, sort_order: a.sort_order };
          return d;
        })
        .sort(byOrder),
    }));
    /**
     * Обе строки — через `erpWrite`: отказ права `catalog.edit` приходит нулём
     * строк, а не ошибкой, и прежняя проверка `results.some(r => r.error)`
     * читала его как успешную перестановку.
     *
     * Последовательно, а не `Promise.all`: перестановка — это ДВЕ записи,
     * и при сбое второй первая уже закоммичена. Откатить экран поверх неё
     * значило бы соврать — у обоих значений остался бы один `sort_order`,
     * то есть порядок, которого никто не выбирал, а на экране прежний.
     * Поэтому сначала компенсирующая запись, и только если и она не прошла —
     * говорим, что в базе осталось.
     */
    const okA = await erpWrite('Порядок не изменён', () => supabase
      .from('erp_dictionaries').update({ sort_order: b.sort_order }).eq('id', a.id).select());
    if (!okA) {
      set({ dictionaries: prev });
      return false;
    }
    const okB = await erpWrite('Порядок не изменён', () => supabase
      .from('erp_dictionaries').update({ sort_order: a.sort_order }).eq('id', b.id).select());
    if (!okB) {
      // Возвращаем первую строку на место: без этого у двух значений один
      // и тот же `sort_order`, и справочник показывает их в случайном порядке
      const restored = await erpWrite('Порядок не восстановлен', () => supabase
        .from('erp_dictionaries').update({ sort_order: a.sort_order }).eq('id', a.id).select());
      set({ dictionaries: prev });
      if (!restored) {
        toast.error('Порядок в справочнике мог сбиться — проверьте список');
      }
      return false;
    }
    return true;
  },
});
