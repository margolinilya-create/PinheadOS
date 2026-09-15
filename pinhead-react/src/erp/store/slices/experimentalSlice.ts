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
import { arrivedLate, currentActor, erpError, erpQuery, removeOrphanUpload } from '../shared';
import { toast } from '../../../store/useToastStore';
import { attachmentFilePath } from '../../utils/storageKey';
import { TZ_BUCKET } from '../../types';
import type { ErpExperimental, ErpExperimentalTask, ErpOrderAttachment } from '../../types';
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
  attachments:erp_order_attachments (*),
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
  experimentalError: null,

  loadExperimental: async () => {
    // Снимок ДО ожидания — им отличается запоздавший ответ от повторной
    // загрузки. Объяснение целиком — у `arrivedLate` в `store/shared`
    const before = get().experimentalLoaded;
    const { data, error } = await erpQuery(() => supabase
      .from('erp_experimental')
      .select(EXP_SELECT)
      .order('created_at', { ascending: false }));
    if (error) {
      /**
       * Флаг отказа (правка 03.09). Без него `experimentalLoaded` оставался
       * false, скелетон висел ВЕЧНО, а эффект `if (!loaded) load()` второй раз
       * не срабатывает — выход был только F5. Экран теперь показывает
       * «Не удалось загрузить» с кнопкой «Повторить».
       */
      set({ experimentalError: error.message });
      erpError('Не удалось загрузить экспериментальный цех', error);
      return;
    }
    /**
     * Пакет оболочки успел наполнить раздел, пока этот запрос летел, — и мог
     * успеть человек. Ставить снимок поверх правки значит вернуть карточку
     * назад молча.
     */
    if (arrivedLate(before, get().experimentalLoaded)) return;
    // Задачи внутри разработки — в порядке доски, а не в порядке вставки
    const rows = (data ?? []) as ErpExperimental[];
    for (const row of rows) {
      row.tasks = [...(row.tasks ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    }
    set({ experimental: rows, experimentalLoaded: true, experimentalError: null });
  },

  /**
   * Создание разработки ВМЕСТЕ со стартовой задачей — одной транзакцией
   * (правки 20.08, RPC `erp_experimental_create`).
   *
   * Раньше это был обычный INSERT, и разработка заводилась БЕЗ ЕДИНОЙ ЗАДАЧИ:
   * доска по этапам у неё пуста, а документ требует задачу на лекала сразу
   * после запуска. Двумя запросами это делать нельзя — правило проекта
   * про действие из нескольких записей: при сбое второго осталась бы
   * разработка без обязательной задачи, и заметить это было бы нечем.
   *
   * Строка перечитывается вторым запросом: RPC возвращает голую строку,
   * а экрану нужны `tasks` и заголовок заказа. Два запроса на ЧТЕНИЕ
   * допустимы — транзакционность записи от этого не страдает.
   */
  createExperimental: async (orderId, input = {}) => {
    const { data, error } = await erpQuery(() => supabase.rpc('erp_experimental_create', {
      p_order_id: orderId,
      p_item_id: input.item_id ?? null,
      p_tech_name: input.tech_name ?? null,
    }));
    const created = data as ErpExperimental | null;
    if (error || !created) {
      erpError('Не удалось создать разработку', error);
      return null;
    }
    const { data: full } = await erpQuery(() => supabase
      .from('erp_experimental')
      .select(EXP_SELECT)
      .eq('id', created.id)
      .maybeSingle());
    const row = (full as ErpExperimental | null) ?? created;
    set((s) => ({ experimental: [{ ...row, tasks: row.tasks ?? [] }, ...s.experimental] }));
    return row;
  },

  /**
   * ПРИВЯЗКА РАЗРАБОТКИ «С ПОЛКИ» К СДЕЛКЕ (правка 14.09).
   *
   * Отдельным RPC, а не патчем `updateExperimental`: это решение с
   * последствиями — разработка попадает в гейт отгрузки заказа, её переписка
   * становится видна из чата сделки, а завершение заводит складскую задачу
   * приёмки ГП. Повторную привязку сервер отклоняет (23505): перенос между
   * сделками оставил бы этапы и задачу склада у прежнего заказа.
   *
   * Строка перечитывается целиком, а не патчится ответом: у разработки
   * эмбеды (`tasks`, `attachments`, `order`), и собранный из голой строки
   * объект потерял бы заголовок сделки — то самое, ради чего привязку и делали.
   */
  attachOrderToDev: async (devId, orderId, itemId = null) => {
    const { error } = await erpQuery(() => supabase.rpc('erp_experimental_attach_order', {
      p_dev: devId,
      p_order: orderId,
      p_item: itemId,
    }));
    if (error) {
      erpError('Не удалось привязать разработку к сделке', error);
      return false;
    }
    const { data: full } = await erpQuery(() => supabase
      .from('erp_experimental')
      .select(EXP_SELECT)
      .eq('id', devId)
      .maybeSingle());
    const row = full as ErpExperimental | null;
    if (row) {
      set((s) => ({
        experimental: s.experimental.map((d) => (
          d.id === devId ? { ...row, tasks: row.tasks ?? [] } : d
        )),
      }));
    }
    return true;
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

    /**
     * Правка кладётся В ДВА МЕСТА, и это осознанно: `s.experimental` —
     * список разработок для доски ЭКС, `order.developments` — эмбед, по
     * которому судит гейт отгрузки (`utils/stageUi.openDevelopments`).
     * Realtime обновит второй тоже, но своя вкладка не должна ждать событие
     * с сервера, чтобы увидеть результат собственного нажатия: после
     * «Завершить разработку» кнопка отгрузки обязана появиться сразу.
     */
    const prevOrders = get().orders;
    const patchOrders = (list: typeof prevOrders) => list.map((o) => (
      (o.developments ?? []).some((d) => d.id === id)
        ? {
          ...o,
          developments: (o.developments ?? []).map(
            (d) => (d.id === id ? { ...d, ...row } : d)),
        }
        : o));

    set((s) => ({
      experimental: s.experimental.map(
        (e) => (e.id === id ? (Object.assign({}, e, row) as ErpExperimental) : e)),
      orders: patchOrders(s.orders),
    }));
    const { error } = await erpQuery(() => supabase
      .from('erp_experimental').update(row).eq('id', id));
    if (error) {
      set({ experimental: prev, orders: prevOrders });
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
   *
   * Полноту финального пакета проверяют ДВОЕ: интерфейс (кнопка заблокирована
   * и перечисляет недостающее) и страж `erp_dev_package_guard`. Здесь ничего
   * не проверяется намеренно — третья реализация того же правила разошлась бы
   * с обеими.
   */
  closeExperimental: async (id, input) => {
    return get().updateExperimental(id, {
      outcome: input.outcome,
      outcome_comment: input.comment?.trim() || null,
      closed_at: new Date().toISOString(),
    });
  },

  /**
   * Файл пакета уходит в бакет и привязывается строкой — в таком порядке,
   * и с уборкой за собой: файл, загруженный и не привязанный, остаётся
   * навсегда — платный, никем не учтённый и доступный по ссылке.
   */
  /**
   * `taskId` — файл ЗАДАЧИ (правка 24.08, п. 4.4). Отдельной функции для него
   * не заводим: путь в бакет, уборка сироты и привязка к разработке те же,
   * различается одна колонка. Вторая копия разошлась бы с первой молча —
   * обе «работают», просто пишут по-разному.
   */
  uploadDevFile: async ({ devId, orderId, kind, file, taskId = null }) => {
    /**
     * ПАПКА В БАКЕТЕ — ЗАКАЗ, А У РАЗРАБОТКИ «НА ПОЛКЕ» ЕГО НЕТ (правка 14.09).
     * Без запасного значения ключ вышел бы `att/null/…`: путь валидный,
     * и файлы всех беззаказных разработок легли бы в ОДНУ папку с чужими —
     * заметно это стало бы только при разборе бакета руками. Разработка
     * и есть владелец этих файлов, поэтому её id и становится папкой.
     */
    const path = attachmentFilePath(orderId || devId, kind, crypto.randomUUID(), file.name);
    const { error: upErr } = await erpQuery(() => supabase.storage
      .from(TZ_BUCKET)
      .upload(path, file, { contentType: file.type || 'application/octet-stream' }));
    if (upErr) {
      erpError('Не удалось загрузить файл', upErr);
      return false;
    }
    const { data, error } = await erpQuery(() => supabase
      .from('erp_order_attachments')
      .insert({
        // `null` у разработки «на полку» — колонка обнуляема с 15.09, а CHECK
        // `erp_order_attachments_anchor_check` держит инвариант «файл принадлежит
        // хоть чему-то»: здесь якорь — сама разработка
        order_id: orderId || null,
        experimental_id: devId,
        task_id: taskId,
        file_path: path,
        file_name: file.name,
        kind,
        uploaded_by: currentActor(),
      })
      .select());
    const row = (data?.[0] ?? null) as ErpOrderAttachment | null;
    if (error || !row) {
      await removeOrphanUpload(TZ_BUCKET, path);
      erpError('Файл загружен, но не привязан к разработке', error);
      return false;
    }
    set((s) => ({
      experimental: s.experimental.map((e) => (e.id === devId
        ? { ...e, attachments: [...(e.attachments ?? []), row] }
        : e)),
    }));
    return true;
  },

  /**
   * Удаление НЕ оптимистичное (правило проекта) и идёт с `.select()`: RLS
   * запрещает DELETE через `USING`, то есть отдаёт «0 строк», а не ошибку —
   * без этой проверки отказ прав выглядел бы зелёным «файл снят».
   *
   * Объект бакета убирается ПОСЛЕ строки: обратный порядок оставил бы
   * разработку со ссылкой на несуществующий файл, если DELETE не прошёл.
   */
  deleteDevFile: async (devId, attachmentId) => {
    const dev = get().experimental.find((e) => e.id === devId);
    const att = (dev?.attachments ?? []).find((a) => a.id === attachmentId) ?? null;
    const { data, error } = await erpQuery(() => supabase
      .from('erp_order_attachments').delete().eq('id', attachmentId).select());
    if (error || (data ?? []).length === 0) {
      erpError('Файл не снят', error ?? { message: 'Нет прав на удаление файла' });
      return false;
    }
    if (att?.file_path) await removeOrphanUpload(TZ_BUCKET, att.file_path);
    set((s) => ({
      experimental: s.experimental.map((e) => (e.id === devId
        ? { ...e, attachments: (e.attachments ?? []).filter((a) => a.id !== attachmentId) }
        : e)),
    }));
    return true;
  },

  /**
   * ПЕРЕНОС ФИНАЛЬНОГО ПАКЕТА В КАТАЛОГ SKU (решение заказчика 21.08).
   *
   * Смысл требования документа — «при следующем заказе этой модели
   * экспериментальный цех повторно не требуется»: пока пакет лежит только
   * в карточке разработки, менеджер повторного заказа о нём не знает.
   *
   * Запись идёт ОДНИМ RPC: каталог хранится одной строкой `app_config`,
   * и клиентское «прочитать массив → дописать → записать обратно» оставляло бы
   * окно, в котором редактор SKU затирает новый артикул молча.
   *
   * ФОТО — ПРОИЗВОДНАЯ. Оно копируется в бакет каталога ДО переноса, и его
   * неудача перенос не отменяет: артикул важнее картинки, а фото докладывается
   * в редакторе SKU. Обратный порядок (сначала артикул, потом дописать фото)
   * потребовал бы второй записи в каталог — того самого второго писателя.
   */
  transferDevToSku: async (devId, sku) => {
    const { data, error } = await erpQuery(() => supabase.rpc('erp_sku_from_dev', {
      p_dev: devId,
      p_sku: sku as unknown as Record<string, unknown>,
    }));
    const code = (data ?? null) as string | null;
    if (error || !code) {
      erpError('Модель не перенесена в каталог', error);
      return null;
    }
    set((s) => ({
      experimental: s.experimental.map(
        (e) => (e.id === devId ? { ...e, sku_code: code } : e)),
    }));
    toast.success(`Модель в каталоге: ${code}`);
    return code;
  },
});
