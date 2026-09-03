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
  dictionariesError: null,

  loadDictionaries: async () => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_dictionaries')
      .select('*')
      .order('kind')
      .order('sort_order'));
    if (error) {
      // Справочники — подсказки, а не гейт: без них экраны работают на свободном
      // вводе. Отказ запоминаем для ВКЛАДКИ справочников в админке (правка 03.09):
      // там пустой список читается как «значений нет», хотя их просто не привезли
      set({ dictionariesLoaded: true, dictionariesError: error.message });
      return;
    }
    set({
      dictionaries: (data ?? []) as ErpDictionaryItem[],
      dictionariesLoaded: true,
      dictionariesError: null,
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
    const { error } = await erpQuery(() => supabase.from('erp_dictionaries').update(patch).eq('id', id));
    if (error) {
      set({ dictionaries: prev });
      toast.error('Не удалось сохранить значение справочника');
      return false;
    }
    return true;
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
     * ПО ОЧЕРЕДИ И ЧЕРЕЗ `erpWrite` (правка 03.09). Было три дефекта в четырёх
     * строках:
     *
     *  1. голые вызовы мимо `erpQuery` — в офлайне supabase-js БРОСАЕТ,
     *     и `Promise.all` реджектился необработанным: busy-состояние
     *     вызывающего не снималось вовсе;
     *  2. проверялся только `error`, а RLS `catalog.edit` запрещает через
     *     `USING`, то есть отдаёт «0 строк» БЕЗ ошибки — «порядок изменён»
     *     было неправдой;
     *  3. при успехе первой записи и сбое второй интерфейс откатывался
     *     ПОВЕРХ уже закоммиченной первой, и в базе у двух значений
     *     оставался одинаковый `sort_order`.
     *
     * Поэтому: сначала одна запись, и только после её подтверждения вторая;
     * если упала вторая — возвращаем первую на место компенсирующей записью,
     * а не откатом экрана (правило проекта о действии из двух записей).
     */
    const firstOk = await erpWrite('Порядок не изменён', () => supabase
      .from('erp_dictionaries').update({ sort_order: b.sort_order }).eq('id', a.id).select());
    if (!firstOk) {
      set({ dictionaries: prev });
      return false;
    }
    const secondOk = await erpWrite('Порядок не изменён', () => supabase
      .from('erp_dictionaries').update({ sort_order: a.sort_order }).eq('id', b.id).select());
    if (!secondOk) {
      // Компенсирующая запись: без неё у двух значений останется один и тот же
      // порядок, и список начнёт «прыгать» при каждой перезагрузке
      await erpQuery(() => supabase
        .from('erp_dictionaries').update({ sort_order: a.sort_order }).eq('id', a.id));
      set({ dictionaries: prev });
      return false;
    }
    return true;
  },
});
