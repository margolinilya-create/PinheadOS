/**
 * Слайс БИЗНЕС-ЗАДАЧ к заказам (правки 19.10, п. 7).
 *
 * Клиент таблицы `erp_biz_task*` только ЧИТАЕТ (RLS SELECT для `erp_is_member()`),
 * пишут `security definer` RPC — событие истории и уведомления одной транзакцией
 * с изменением (миграция `20261020100000_erp_biz_tasks_rpc`). Отсюда правила слайса:
 *
 *   · БЕЗ ОПТИМИСТИКИ. Кнопку решает писатель (роль, статус, версия), и показать
 *     «В работе» до его ответа значит однажды показать то, чего в базе нет;
 *   · ОТВЕТ КЛАДЁТСЯ ЦЕЛИКОМ. В нём новый `updated_at`, а переход и правка шлют
 *     известную версию (`p_expected_updated_at`): частичный патч оставил бы
 *     старую — и следующее действие получило бы ложный «Задача изменена»;
 *   · ОШИБКА — `toast.error` (через `erpError`) и `null`, состояние не трогается.
 *
 * Строка задачи — одна на id (`bizTasks`), её читают вкладка заказа, общий
 * раздел и карточка: «одна и та же задача, без копий».
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import type { Json } from '../../../types/database.generated';
import type { ErpBizTask } from '../../types';
import { BIZ_TASK_ACTIVE } from '../../utils/bizTasks';
import { currentUserId, erpError, erpQuery, erpRead } from '../shared';
import type { BizTaskDetail, BizTaskRow, BizTasksSlice, ErpStore } from '../types';

/** Потолок списка: экран показывает поручения людей завода, а не архив за годы */
export const BIZ_TASK_LIST_LIMIT = 500;

/**
 * Наблюдаемые задачи читаются пачками id: `in.(…)` уходит в адрес запроса,
 * и сотни uuid разом упёрлись бы в предел длины URL. 100 uuid — около 4 КБ.
 */
export const BIZ_TASK_ID_CHUNK = 100;

/** Колонки строки + наблюдатели и заказ вложенными выборками (литерал — для типизированного клиента) */
export const BIZ_TASK_SELECT = `id, order_id, title, kind, description, assignee_id, creator_id, due_at,
  status, review_required, pause_reason, cancel_reason, return_reason, result_text, result_message_id,
  submitted_at, reviewed_at, completed_at, cancelled_at, client_key, created_at, updated_at,
  watchers:erp_biz_task_watchers(user_id), order:erp_orders(id, bitrix_id, title, tz_number)`;

export const BIZ_TASK_CHECKLIST_COLUMNS = 'id, task_id, text, done, sort, done_by, done_at';
export const BIZ_TASK_EVENT_COLUMNS = 'id, task_id, kind, actor, payload, due_at, at';
export const BIZ_TASK_FILE_COLUMNS = 'id, order_id, file_path, file_name, kind, biz_task_id, message_id, uploaded_by, created_at';

type RawRow = ErpBizTask & {
  watchers?: { user_id: string }[] | null;
  order?: BizTaskRow['order'];
};

function normalize(raw: RawRow): BizTaskRow {
  const { watchers, order, ...task } = raw;
  return { ...task, watchers: (watchers ?? []).map((w) => w.user_id), order: order ?? null };
}

/**
 * Повторы «Создать задачу» в полёте — по ключу попытки. Второй клик получает
 * ТОТ ЖЕ промис: без этого два вызова уходили бы на сервер, и спасал бы только
 * `client_key` (вторая строка не появится, но и лишний запрос с тостом —
 * тоже). Живёт в модуле, а не в состоянии: это не данные, а незавершённый вызов.
 */
const creating = new Map<string, Promise<BizTaskRow | null>>();

export const bizTasksSlice: StateCreator<ErpStore, [], [], BizTasksSlice> = (set, get) => {
  /** Строки списка — целиком, вместе с наблюдателями и заказом */
  const putRows = (rows: BizTaskRow[]) => {
    if (rows.length === 0) return;
    set((s) => ({ bizTasks: { ...s.bizTasks, ...Object.fromEntries(rows.map((r) => [r.id, r])) } }));
  };

  /**
   * Ответ писателя: строка `erp_biz_tasks` без вложений. Поля задачи —
   * целиком из ответа; наблюдатели и заказ — прежние (писатель их не отдаёт).
   */
  const putWritten = (task: ErpBizTask): BizTaskRow => {
    const prev = get().bizTasks[task.id];
    const row: BizTaskRow = {
      ...task,
      watchers: prev?.watchers ?? [],
      order: prev?.order ?? null,
    };
    set((s) => ({ bizTasks: { ...s.bizTasks, [row.id]: row } }));
    return row;
  };

  /** Непрочитанное по задачам. Счётчик вторичен: сбой не стоит второго тоста поверх списка */
  const loadUnread = async (ids: string[]) => {
    if (ids.length === 0 || !currentUserId()) return;
    const { data, error } = await erpRead(() => supabase.rpc('erp_chat_unread_tasks', { p_task_ids: ids }));
    if (error || !data) return;
    const next = { ...get().bizTaskUnread };
    for (const id of ids) next[id] = 0;
    for (const r of data as { task_id: string; unread: number }[]) next[r.task_id] = r.unread;
    set({ bizTaskUnread: next });
  };

  /** Версия, от которой идёт правка; нет строки — нечего сверять */
  const versionOf = (id: string): string | null => {
    const v = get().bizTasks[id]?.updated_at ?? null;
    if (!v) erpError('Задача не загружена — обновите страницу');
    return v;
  };

  /** Перечитать часть карточки после писателя, который вернул только строку задачи */
  const refreshDetail = async (id: string) => {
    if (get().bizTaskDetails[id] || get().bizTasks[id]) await get().loadBizTask(id);
  };

  /**
   * `ascending` — ближайшие сроки первыми (активные). Иначе — поздние сроки
   * первыми: в потолок строк попадают свежие задачи, а не архив за годы.
   */
  const fetchRows = async (
    build: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>,
    ascending = true,
  ): Promise<BizTaskRow[] | null> => {
    const { data, error } = await erpRead(() => build(baseQuery())
      .order('due_at', { ascending })
      .limit(BIZ_TASK_LIST_LIMIT));
    if (error) {
      erpError('Не удалось загрузить задачи', error);
      return null;
    }
    const rows = ((data ?? []) as unknown as RawRow[]).map(normalize);
    putRows(rows);
    // Ждём счётчик: строка без числа непрочитанного, а через миг с ним, — мигание
    await loadUnread(rows.map((r) => r.id));
    return rows;
  };

  return {
    bizTasks: {},
    bizTaskDetails: {},
    bizTaskUnread: {},
    bizTaskPing: 0,

    loadBizTasks: async (filter) => {
      const me = currentUserId();
      if (filter.scope !== 'all' && !me) return [];
      const statuses = filter.statuses ?? [];
      // Только активные — ближайшие сроки первыми; с закрытыми — свежие первыми
      const ascending = statuses.length > 0 && statuses.every((st) => BIZ_TASK_ACTIVE.includes(st));
      const query = (ids: string[] | null) => fetchRows((q) => {
        let out = q;
        if (statuses.length) out = out.in('status', [...statuses]);
        if (filter.scope === 'assignee') out = out.eq('assignee_id', me as string);
        if (filter.scope === 'creator') out = out.eq('creator_id', me as string);
        if (ids) out = out.in('id', ids);
        return out;
      }, ascending);
      if (filter.scope !== 'watcher') return query(null);

      const { data, error } = await erpRead(() => supabase
        .from('erp_biz_task_watchers').select('task_id').eq('user_id', me as string));
      if (error) {
        erpError('Не удалось загрузить задачи', error);
        return null;
      }
      const ids = ((data ?? []) as { task_id: string }[]).map((r) => r.task_id);
      if (ids.length === 0) return [];
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += BIZ_TASK_ID_CHUNK) chunks.push(ids.slice(i, i + BIZ_TASK_ID_CHUNK));
      const parts = await Promise.all(chunks.map((c) => query(c)));
      if (parts.some((p) => p === null)) return null;
      return parts.flatMap((p) => p ?? []);
    },

    loadOrderBizTasks: (orderId) => fetchRows((q) => q.eq('order_id', orderId)),

    loadBizTask: async (id) => {
      const [task, checklist, events, files] = await Promise.all([
        erpRead(() => supabase.from('erp_biz_tasks').select(BIZ_TASK_SELECT).eq('id', id)),
        erpRead(() => supabase.from('erp_biz_task_checklist').select(BIZ_TASK_CHECKLIST_COLUMNS)
          .eq('task_id', id).order('sort')),
        erpRead(() => supabase.from('erp_biz_task_events').select(BIZ_TASK_EVENT_COLUMNS)
          .eq('task_id', id).order('at')),
        erpRead(() => supabase.from('erp_order_attachments').select(BIZ_TASK_FILE_COLUMNS)
          .eq('biz_task_id', id).order('created_at')),
      ]);
      const failed = [task, checklist, events, files].find((r) => r.error);
      if (failed) {
        erpError('Не удалось загрузить задачу', failed.error);
        return null;
      }
      const raw = ((task.data ?? []) as unknown as RawRow[])[0];
      if (!raw) {
        erpError('Задача не найдена или недоступна');
        return null;
      }
      const row = normalize(raw);
      const detail: BizTaskDetail = {
        watchers: row.watchers,
        checklist: (checklist.data ?? []) as unknown as BizTaskDetail['checklist'],
        events: (events.data ?? []) as unknown as BizTaskDetail['events'],
        files: (files.data ?? []) as unknown as BizTaskDetail['files'],
      };
      putRows([row]);
      set((s) => ({ bizTaskDetails: { ...s.bizTaskDetails, [id]: detail } }));
      return detail;
    },

    createBizTask: (input, clientKey) => {
      const running = creating.get(clientKey);
      if (running) return running;
      const call = (async () => {
        const { data, error } = await erpQuery(() => supabase.rpc('erp_biz_task_create', {
          p_task: input as unknown as Json,
          p_client_key: clientKey,
        }));
        if (error || !data) {
          erpError('Не удалось создать задачу', error);
          return null;
        }
        const row = putWritten(data as unknown as ErpBizTask);
        // Состав участников — с сервера, а не из формы: писатель убирает из
        // наблюдателей постановщика и ответственного и добавляет менеджера
        // заказа (Р3). Сбой перечитывания тостит сам; строка задачи уже в сторе
        await get().loadBizTask(row.id);
        return get().bizTasks[row.id] ?? row;
      })().finally(() => { creating.delete(clientKey); });
      creating.set(clientKey, call);
      return call;
    },

    bizTaskTransition: async (id, action, text) => {
      const version = versionOf(id);
      if (!version) return null;
      const { data, error } = await erpQuery(() => supabase.rpc('erp_biz_task_transition', {
        p_id: id, p_action: action, p_text: text, p_expected_updated_at: version,
      }));
      if (error || !data) {
        erpError('Не удалось изменить статус задачи', error);
        return null;
      }
      return putWritten(data as unknown as ErpBizTask);
    },

    updateBizTask: async (id, patch) => {
      const version = versionOf(id);
      if (!version) return null;
      const { data, error } = await erpQuery(() => supabase.rpc('erp_biz_task_update', {
        p_id: id, p_patch: patch as unknown as Json, p_expected_updated_at: version,
      }));
      if (error || !data) {
        erpError('Не удалось сохранить задачу', error);
        return null;
      }
      const row = putWritten(data as unknown as ErpBizTask);
      // Наблюдателей писатель не возвращает: состав — с сервера, а не из формы
      if (patch.watchers) await refreshDetail(id);
      return get().bizTasks[id] ?? row;
    },

    setBizTaskResult: async (id, text, messageId) => {
      const { data, error } = await erpQuery(() => supabase.rpc('erp_biz_task_set_result', {
        p_id: id, p_text: text, p_message_id: messageId,
      }));
      if (error || !data) {
        erpError('Не удалось сохранить результат', error);
        return null;
      }
      return putWritten(data as unknown as ErpBizTask);
    },

    bizTaskChecklistOp: async (id, op, item) => {
      const { data, error } = await erpQuery(() => supabase.rpc('erp_biz_task_checklist_op', {
        p_id: id, p_op: op, p_item: item as unknown as Json,
      }));
      if (error || !data) {
        erpError('Не удалось изменить чек-лист', error);
        return null;
      }
      const row = putWritten(data as unknown as ErpBizTask);
      await refreshDetail(id);
      return get().bizTasks[id] ?? row;
    },

    attachBizTaskFiles: async (id, files) => {
      const { data, error } = await erpQuery(() => supabase.rpc('erp_biz_task_attach', {
        p_id: id, p_files: files as unknown as Json,
      }));
      if (error || !data) {
        erpError('Не удалось приложить файлы к задаче', error);
        return null;
      }
      const row = putWritten(data as unknown as ErpBizTask);
      await refreshDetail(id);
      return get().bizTasks[id] ?? row;
    },

    markBizTaskSeen: async (id) => {
      const { data, error } = await erpQuery(() => supabase.rpc('erp_biz_task_mark_seen', { p_id: id }));
      if (error || !data) {
        erpError('Не удалось отметить задачу просмотренной', error);
        return null;
      }
      return putWritten(data as unknown as ErpBizTask);
    },
  };
};

/** Запрос списка задач — один на все виды; фильтры — до сортировки и потолка */
function baseQuery() {
  return supabase.from('erp_biz_tasks').select(BIZ_TASK_SELECT);
}
