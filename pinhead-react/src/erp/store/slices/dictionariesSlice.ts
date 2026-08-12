/**
 * Слайс справочников админки (правка 12): причины блокировок, типы проблем,
 * типы изделий, поставщики. Одна таблица erp_dictionaries на все виды.
 *
 * Грузятся один раз оболочкой (ErpLayout) — значения нужны цеху при работе,
 * а не только в админке. Правки — optimistic с rollback, как везде в сторе.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { erpError, erpQuery, erpRefused, rlsRefused } from '../shared';
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
    // `.select()` обязателен: RLS запрещает UPDATE через `USING`, то есть
    // «0 строк», а не ошибка. Без него экран показывал новое значение,
    // а при перезагрузке возвращалось старое — притом что соседняя кнопка
    // «Добавить» падала громко (её ловит `WITH CHECK`).
    const { data, error } = await erpQuery(() => supabase
      .from('erp_dictionaries').update(patch).eq('id', id).select('id'));
    if (error) {
      set({ dictionaries: prev });
      erpError('Не удалось сохранить значение справочника', error);
      return false;
    }
    if (rlsRefused(data)) {
      set({ dictionaries: prev });
      return erpRefused('Значение справочника не сохранено');
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
    /*
     * Две записи идут ПОСЛЕДОВАТЕЛЬНО, и при сбое второй первая КОМПЕНСИРУЕТСЯ.
     *
     * Было `Promise.all` двух голых запросов с общим откатом интерфейса. Это
     * нарушало сразу три правила раздела. Голый `supabase` вместо `erpQuery`:
     * при обрыве связи промис ОТКЛОНЯЛСЯ, ветка отката не выполнялась вовсе,
     * порядок на экране оставался переставленным, тоста не было. Общий откат
     * поверх закоммиченного: если первый UPDATE прошёл, а второй отказал,
     * в базе у двух значений оставался ОДИНАКОВЫЙ `sort_order`, а интерфейс
     * показывал исходный порядок — расхождение, которое видно только после
     * перезагрузки. И отказ RLS через `USING` не отличался от успеха.
     *
     * Транзакция (RPC) была бы честнее, но заводить серверную функцию ради
     * перестановки значения справочника — цена выше пользы; компенсирующая
     * запись даёт тот же итог: в базе либо оба значения переставлены, либо
     * ни одного.
     */
    const first = await erpQuery(() => supabase
      .from('erp_dictionaries').update({ sort_order: b.sort_order }).eq('id', a.id).select('id'));
    if (first.error || rlsRefused(first.data)) {
      set({ dictionaries: prev });
      return first.error
        ? erpError('Не удалось изменить порядок', first.error)
        : erpRefused('Порядок не изменён');
    }

    const second = await erpQuery(() => supabase
      .from('erp_dictionaries').update({ sort_order: a.sort_order }).eq('id', b.id).select('id'));
    if (second.error || rlsRefused(second.data)) {
      // Возвращаем первому значению прежний порядок — иначе в базе останутся
      // два одинаковых `sort_order`, которых никто не выбирал
      const undo = await erpQuery(() => supabase
        .from('erp_dictionaries').update({ sort_order: a.sort_order }).eq('id', a.id).select('id'));
      set({ dictionaries: prev });
      if (undo.error || rlsRefused(undo.data)) {
        toast.error(
          'Порядок изменён наполовину и вернуть его не удалось. Обновите страницу '
          + 'и проверьте порядок значений в справочнике',
        );
        return false;
      }
      return second.error
        ? erpError('Не удалось изменить порядок', second.error)
        : erpRefused('Порядок не изменён');
    }
    return true;
  },
});
