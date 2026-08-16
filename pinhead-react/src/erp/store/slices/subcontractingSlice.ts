/**
 * Слайс подряда: операции у внешних подрядчиков (ленивая загрузка по вкладке).
 *
 * Переходы ведёт ФАЗА (`phase`), а не устаревший `status` — см.
 * `utils/subcontractPhase`. До этой правки клиент двигал `status`, а складской
 * гейт с волны 3.5 читал `phase`: колонка стояла с бэкфилла, и гейт проверял
 * величину, которую никто не продвигает.
 *
 * Эффекты перехода:
 *  - готовое изделие → «Вернулось»  ⇒ задача склада «Приёмка от подрядчика»;
 *  - готовое изделие → «Принято»    ⇒ упаковка/отгрузка, но ТОЛЬКО у заказа
 *    без производственных этапов (подряд «под ключ»): у остальных задачу
 *    заводит триггер, и у него три предусловия, включая приёмку готовой
 *    продукции складом. Создавать её отсюда во всех случаях значило бы
 *    обходить собственный гейт;
 *  - отдельная операция → «Вернулось» ⇒ следующий участок либо упаковка.
 * Кросс-сущностные эффекты держим в сторе (не в триггерах) — они покрыты юнит-тестами.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { currentActor, erpError, erpQuery } from '../shared';
import { toast } from '../../../store/useToastStore';
import type { ErpSubcontractOp } from '../../types';
import { subcontractPhase, subcontractPhasePatch } from '../../utils/subcontractPhase';
import type { ErpStore, SubcontractingSlice } from '../types';
import { factoryToday } from '../../../utils/date';

/** Создать/обеспечить задачу склада (идемпотентно по (order_id, task_type)) */
async function upsertWarehouseTask(
  orderId: string, taskType: string, status: string, itemId: string | null = null,
): Promise<boolean> {
  const { error } = await erpQuery(() => supabase
    .from('erp_warehouse_tasks')
    .upsert(
      { order_id: orderId, item_id: itemId, task_type: taskType, status },
      { onConflict: 'order_id,task_type', ignoreDuplicates: true },
    ));
  if (error) {
    toast.error('Не удалось создать задачу склада');
    return false;
  }
  return true;
}

/** Эффекты перехода ФАЗЫ подрядной операции (правки 4.2.1/4.2.3, волна 3.5) */
async function applySubcontractTransition(get: () => ErpStore, op: ErpSubcontractOp): Promise<void> {
  const phase = subcontractPhase(op);
  // Готовое изделие вернулось от подрядчика → обязательная приёмка складом (правка 4.2.1)
  if (op.op_type === 'finished_product' && phase === 'returned') {
    if (await upsertWarehouseTask(op.order_id, 'subcontract_receipt', 'awaiting_receipt')) {
      await get().loadOne(op.order_id);
    }
    return;
  }
  /**
   * Готовое изделие принято → упаковку заводит СЕРВЕР (`erp_can_pack_ship`
   * внутри триггеров склада), а не эта ветка.
   *
   * Здесь успело побывать два неверных варианта. Сначала клиент создавал
   * упаковку безусловно — и обходил собственный гейт приёмки ГП. Потом я
   * добавил ранний выход «у заказа есть этапы — ничего не делаем», и стало
   * хуже: у заказа С этапами И подрядом упаковка не создавалась ВООБЩЕ.
   * Цепочка обрывалась трижды — derive пропускал (подряд не принят),
   * fg_accepted пропускал (подряд всё ещё не принят), а на подряде триггера
   * не было. Заказ оставался без задачи упаковки навсегда.
   *
   * Условие теперь одно и живёт на сервере, где видны все три предусловия.
   */
  if (op.op_type === 'finished_product' && phase === 'accepted') {
    await get().loadOne(op.order_id);
    return;
  }
  /**
   * Возврат отдельной операции у строки БЕЗ маршрута (правка 4.2.3).
   *
   * У подряда, заведённого конструктором маршрута, ветки нет и быть не должно:
   * следующий этап УЖЕ в маршруте и зависит от подрядного через `depends_on`,
   * а закрывает подрядный этап приёмка в журнале перемещений. Это и есть
   * ответ на «вернулось от подрядчика ≠ заказ готов» — без единой строчки
   * специальной логики.
   *
   * Ветка осталась ровно для строк, заведённых до перехода (`stage_id is null`):
   * маршрута у них нет, и убрать её сейчас значило бы оставить такой заказ
   * стоять после возврата. Уйдёт вместе с блоком совместимости на экране.
   */
  if (op.op_type === 'operation' && phase === 'returned' && !op.stage_id) {
    if (op.return_dept) {
      // доработка внутри Pinhead → готовый к работе этап на выбранном участке
      const dept = get().departments.find((d) => d.code === op.return_dept);
      const order = get().orders.find((o) => o.id === op.order_id);
      const itemId = op.item_id ?? order?.items?.[0]?.id ?? null;
      if (!dept || !itemId) {
        toast.error('Не удалось направить заказ на следующий участок');
        return;
      }
      /**
       * ЯВНАЯ ПРОВЕРКА ВМЕСТО `upsert(onConflict)` — и это не стилистика.
       * Уникальность этапа стала ЧАСТИЧНОЙ (`where executor = 'internal'`):
       * документ требует нескольких подрядных этапов на одну позицию, а полный
       * индекс `(item_id, department_id, cycle)` разрешал ровно один. PostgREST
       * же шлёт голый `ON CONFLICT (col, col)`, и частичный индекс по нему
       * Postgres не выводит — прежний вызов отвечал бы 42P10 на КАЖДОМ возврате
       * подряда. Спецификация проверяется при планировании запроса, до поиска
       * конфликта, поэтому «дубля же не будет» здесь не спасает.
       *
       * Гонки бояться нечего: путь legacy-только, его проходит один человек
       * одним нажатием, а смысл прежнего `ignoreDuplicates` («вставить, если
       * нет») проверка воспроизводит буквально.
       */
      const { data: existing, error: findErr } = await erpQuery(() => supabase
        .from('erp_item_stages')
        .select('id')
        .eq('item_id', itemId)
        .eq('department_id', dept.id)
        .eq('cycle', 0)
        .limit(1));
      if (findErr) {
        toast.error(`Не удалось создать этап: ${dept.name}`);
        return;
      }
      if ((existing ?? []).length === 0) {
        const { error } = await erpQuery(() => supabase
          .from('erp_item_stages')
          .insert({
            item_id: itemId, department_id: dept.id, cycle: 0,
            status: 'ready', sort_order: 900, depends_on: [],
          }));
        if (error) {
          toast.error(`Не удалось создать этап: ${dept.name}`);
          return;
        }
      }
    } else {
      // доработка не нужна → упаковка/отгрузка (приёмка склада = шаг awaiting_receipt→accepted)
      if (!(await upsertWarehouseTask(op.order_id, 'pack_ship', 'awaiting_receipt'))) return;
    }
    await get().loadOne(op.order_id);
  }
}

export const subcontractingSlice: StateCreator<ErpStore, [], [], SubcontractingSlice> = (set, get) => ({
  subcontracting: [],
  subcontractingLoaded: false,

  loadSubcontracting: async () => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_subcontracting')
      /**
       * Журнал перемещений едет ВМЕСТЕ с карточкой. Отдельным запросом на строку
       * это было бы N+1 на экране, где строк столько же, сколько подрядных
       * этапов; отдельным запросом на весь экран — вторая точка загрузки,
       * которую придётся не забыть обновить после каждой записи.
       */
      .select('*, order:erp_orders (title, bitrix_id), moves:erp_subcontract_moves (*)')
      .order('created_at', { ascending: false }));
    if (error) {
      toast.error('Не удалось загрузить операции подряда');
      return;
    }
    set({ subcontracting: (data ?? []) as ErpSubcontractOp[], subcontractingLoaded: true });
  },

  createSubcontractOp: async (op) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_subcontracting')
      // Фаза — авторитетная колонка, `status` идёт зеркалом из неё же.
      // Новая строка без явной фазы получила бы дефолт и осталась в нём навсегда.
      .insert({ ...subcontractPhasePatch('planned'), ...op })
      .select('*, order:erp_orders (title, bitrix_id)'));
    const row = data?.[0] as ErpSubcontractOp | undefined;
    if (error || !row) {
      toast.error('Не удалось добавить операцию подряда');
      return null;
    }
    set((s) => ({ subcontracting: [row, ...s.subcontracting] }));
    return row;
  },

  /**
   * Перемещение по подряду (волна 3.5): передали / вернулось / приняли.
   *
   * Пишем строку журнала — количества на карточке ведёт триггер, а приёмка
   * вдобавок приращает `qty_done` привязанного этапа тем же серверным
   * правилом, что и все остальные счётчики. Благодаря этому «следующий этап
   * получает доступное количество» работает без единой дополнительной строки
   * логики: подряд — такой же этап маршрута, а не параллельная сущность.
   */
  addSubcontractMove: async (subcontractId, input) => {
    const qty = Number(input.qty);
    if (!(qty > 0)) {
      toast.error('Количество должно быть больше нуля');
      return false;
    }
    const { error } = await erpQuery(() => supabase
      .from('erp_subcontract_moves')
      .insert({
        subcontract_id: subcontractId,
        kind: input.kind,
        qty,
        moved_on: input.movedOn || factoryToday(),
        comment: input.comment?.trim() || null,
        author: currentActor(),
      }));
    if (error) {
      erpError('Перемещение не записано', error);
      return false;
    }
    await get().loadSubcontracting();
    return true;
  },

  updateSubcontractOp: async (id, patch) => {
    const prev = get().subcontracting;
    const before = prev.find((o) => o.id === id);
    set((s) => ({
      subcontracting: s.subcontracting.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
    const { error } = await erpQuery(() => supabase.from('erp_subcontracting').update(patch).eq('id', id));
    if (error) {
      set({ subcontracting: prev });
      toast.error('Не удалось обновить операцию подряда');
      return false;
    }
    /**
     * Эффекты перехода — только при реальной смене ФАЗЫ. Прежде условие стояло
     * на `patch.status`, и после переезда на `phase` не сработало бы ни разу:
     * экран перестал бы двигать статус, а вместе с ним пропали бы и приёмка
     * складом, и маршрут после возврата операции. Зеркало `status` в патче есть
     * всегда, поэтому сравнивать надо именно фазы.
     */
    if (before && patch.phase && patch.phase !== before.phase) {
      await applySubcontractTransition(get, { ...before, ...patch } as ErpSubcontractOp);
    }
    return true;
  },
});
