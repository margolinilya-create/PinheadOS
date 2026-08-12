/**
 * Слайс экспериментального цеха: разработка + НАБОР ЗАДАЧ (ТЗ заказчика 12.08).
 *
 * Прежняя модель была стейт-машиной из пяти фаз, и заказчик назвал её главной
 * логической ошибкой: разработка не линейна. Здесь разработка — карточка,
 * а работа — задачи: параллельные, необязательные, с зависимостями и циклами.
 *
 * Что изменилось по сравнению с прежним слайсом:
 *  · передача в цех идёт ОДНИМ RPC вместо «RPC + отдельный INSERT» —
 *    при сбое второго этап оставался в очереди цеха, а разработка о нём не знала;
 *  · возврат из цеха ведёт ТРИГГЕР, клиент задачу со `stage_id` только читает:
 *    два писателя одной колонки затирают друг друга молча;
 *  · фазы не хранятся — состояние считает `utils/experimentalTasks`.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { erpError, erpQuery } from '../shared';
import { toast } from '../../../store/useToastStore';
import type { ErpExperimental, ErpExperimentalTask } from '../../types';
import type { DevTaskInput, ErpStore, ExperimentalSlice } from '../types';

/**
 * Задачи приезжают вложенным эмбедом вместе с разработкой: экран без них
 * не отвечает ни на один свой вопрос («готовность», «блокер», «что дальше»),
 * а вторым запросом они дали бы карточку, которая секунду показывает
 * разработку без задач — то есть «ничего не происходит».
 */
const EXP_SELECT = `
  *,
  tasks:erp_experimental_tasks (*),
  order:erp_orders (title, bitrix_id, due_date)
`;

/** Точечная замена задачи в списке разработок (не трогая соседние) */
function patchTaskIn(
  list: ErpExperimental[],
  taskId: string,
  apply: (t: ErpExperimentalTask) => ErpExperimentalTask,
): ErpExperimental[] {
  return list.map((e) => {
    if (!(e.tasks ?? []).some((t) => t.id === taskId)) return e;
    return { ...e, tasks: (e.tasks ?? []).map((t) => (t.id === taskId ? apply(t) : t)) };
  });
}

export const experimentalSlice: StateCreator<ErpStore, [], [], ExperimentalSlice> = (set, get) => ({
  experimental: [],
  experimentalLoaded: false,

  loadExperimental: async () => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_experimental')
      .select(EXP_SELECT)
      .order('created_at', { ascending: false }));
    if (error) {
      erpError('Не удалось загрузить экспериментальный цех', error);
      return;
    }
    // Задачи внутри разработки — в порядке доски, а не в порядке вставки
    const rows = (data ?? []) as ErpExperimental[];
    for (const row of rows) {
      row.tasks = [...(row.tasks ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    }
    set({ experimental: rows, experimentalLoaded: true });
  },

  createExperimental: async (orderId, input = {}) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_experimental')
      .insert({
        order_id: orderId,
        item_id: input.item_id ?? null,
        tech_name: input.tech_name ?? null,
      })
      .select(EXP_SELECT));
    const row = data?.[0] as ErpExperimental | undefined;
    if (error || !row) {
      erpError('Не удалось создать разработку', error);
      return null;
    }
    set((s) => ({ experimental: [{ ...row, tasks: row.tasks ?? [] }, ...s.experimental] }));
    return row;
  },

  updateExperimental: async (id, patch) => {
    const prev = get().experimental;
    // `constructorName` → колонка `constructor`: имя поля отличается намеренно,
    // см. комментарий к `DevPatch` в store/types.ts
    const { constructorName, ...rest } = patch;
    const row: Record<string, unknown> = {
      ...rest,
      // Ключ задаётся литералом: присваивание `row.constructor = …` TypeScript
      // разрешает в `Object.prototype.constructor` и требует `Function`
      ...(constructorName !== undefined ? { constructor: constructorName } : {}),
    };

    set((s) => ({
      experimental: s.experimental.map(
        (e) => (e.id === id ? (Object.assign({}, e, row) as ErpExperimental) : e)),
    }));
    const { error } = await erpQuery(() => supabase
      .from('erp_experimental').update(row).eq('id', id));
    if (error) {
      set({ experimental: prev });
      erpError('Разработка не обновлена', error);
      return false;
    }
    return true;
  },

  /**
   * Пачка задач одной транзакцией. Не оптимистично: id и номера кругов
   * считает сервер, и нарисовать их заранее значит показать числа, которых
   * может не получиться.
   */
  addDevTasks: async (experimentalId, tasks) => {
    if (!tasks || tasks.length === 0) return [];
    const { data, error } = await erpQuery(() => supabase
      .rpc('erp_experimental_add_tasks', {
        p_experimental_id: experimentalId,
        p_tasks: tasks as unknown as DevTaskInput[],
      }));
    const rows = (data ?? []) as ErpExperimentalTask[];
    if (error) {
      erpError('Задачи не добавлены', error);
      return null;
    }
    set((s) => ({
      experimental: s.experimental.map((e) =>
        e.id === experimentalId
          ? { ...e, tasks: [...(e.tasks ?? []), ...rows].sort((a, b) => a.sort_order - b.sort_order) }
          : e),
    }));
    return rows;
  },

  updateDevTask: async (id, patch) => {
    const prev = get().experimental;
    const task = prev.flatMap((e) => e.tasks ?? []).find((t) => t.id === id);
    if (!task) return false;

    /**
     * Задача в цехе: статус ведёт триггер `erp_experimental_task_sync`.
     * Клиент его не пишет — иначе у колонки два писателя, и «готово»,
     * поставленное технологом, разошлось бы с открытым этапом в цехе.
     */
    const safe = { ...patch };
    if (task.stage_id) {
      delete safe.status;
      delete safe.blocked_reason;
      delete safe.done_on;
    }
    if (Object.keys(safe).length === 0) {
      toast.warning('Статус задачи, переданной в цех, меняет сам цех');
      return false;
    }

    set((s) => ({ experimental: patchTaskIn(s.experimental, id, (t) => ({ ...t, ...safe })) }));
    const { error } = await erpQuery(() => supabase
      .from('erp_experimental_tasks').update(safe).eq('id', id));
    if (error) {
      set({ experimental: prev });
      erpError('Задача не обновлена', error);
      return false;
    }
    return true;
  },

  sendDevTaskToDept: async (taskId, input) => {
    const { data, error } = await erpQuery(() => supabase
      .rpc('erp_experimental_task_send', {
        p_task_id: taskId,
        p_department_id: input.department_id,
        p_planned_end: input.planned_end ?? null,
        p_qty: input.qty ?? null,
      }));
    const row = (data ?? null) as ErpExperimentalTask | null;
    if (error || !row) {
      erpError('Задача не поставлена в очередь цеха', error);
      return false;
    }
    set((s) => ({ experimental: patchTaskIn(s.experimental, taskId, () => row) }));
    // Этап появился у заказа — список заданий его ещё не видит
    void get().loadAll();
    return true;
  },

  /**
   * Исход разработки. «Готово к серии» НИЧЕГО не создаёт автоматически
   * (решение заказчика): производственный заказ заводит менеджер.
   */
  closeExperimental: async (id, input) => {
    return get().updateExperimental(id, {
      outcome: input.outcome,
      outcome_comment: input.comment?.trim() || null,
      closed_at: new Date().toISOString(),
    });
  },
});
