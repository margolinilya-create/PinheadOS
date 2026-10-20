/**
 * ВЫШИВКА ОДНОЙ ЗАДАЧЕЙ — переходы фазы (правки 19.10, п. 1; Р1–Р3).
 *
 * Строка вышивки в фазе «Разработка программы вышивки» становится «Вышивкой»
 * ТОЛЬКО через две RPC: `erp_embroidery_program_finish` («Программа готова»,
 * файл программы обязан лежать в бакете) и `erp_embroidery_program_skip`
 * («Без программы», `order.manage`, с причиной). Прямую запись `result_kind`
 * отклоняет страж этапов: страж и клиентский гейт — одной правкой.
 *
 * Не оптимистично: переход меняет тип результата, статус и факт строки разом,
 * и показать его до ответа значило бы открыть цеху «Вышивку», которую сервер
 * мог не отдать. После ответа заказ перечитывается (`loadOne`): строка
 * переезжает в другую группу очереди, а её соседям меняется готовность.
 *
 * Вынесено из `stagesSlice` (ратчет размера) и подмешивается в него:
 * контракт `StagesSlice` один.
 */
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import type { ErpItemStage } from '../../types';
import { erpError, erpQuery, withPending } from '../shared';
import { findStage, patchStageIn } from '../orderHelpers';
import type { ErpStore, StagesSlice } from '../types';

type Set = (partial: Partial<ErpStore> | ((s: ErpStore) => Partial<ErpStore>)) => void;
type Get = () => ErpStore;

export function embroideryActions(set: Set, get: Get): Pick<StagesSlice,
  'finishEmbroideryProgram' | 'skipEmbroideryProgram'> {
  /** Общий хвост обоих переходов: строка в стор, затем заказ целиком */
  const transition = async (
    stageId: string,
    what: string,
    rpc: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ): Promise<ErpItemStage | null> => {
    const orderId = findStage(get().orders, stageId)?.order.id ?? null;
    const { data, error } = await erpQuery(() => withPending(`stage:${stageId}`, rpc));
    if (error) {
      erpError(what, error);
      return null;
    }
    const row = (data ?? null) as ErpItemStage | null;
    if (!row) {
      toast.error(`${what}: сервер не вернул задачу — обновите страницу`);
      return null;
    }
    set((s) => ({ orders: patchStageIn(s.orders, stageId, row) }));
    if (orderId) await get().loadOne(orderId);
    return row;
  };

  return {
    finishEmbroideryProgram: (stageId) => transition(
      stageId,
      'Программа не сдана',
      () => supabase.rpc('erp_embroidery_program_finish', { p_stage_id: stageId }),
    ),

    skipEmbroideryProgram: async (stageId, reason) => {
      const text = (reason ?? '').trim();
      if (!text) {
        toast.error('Укажите, почему вышивка идёт без программы');
        return null;
      }
      return transition(
        stageId,
        'Вышивка без программы не записана',
        () => supabase.rpc('erp_embroidery_program_skip', { p_stage_id: stageId, p_reason: text }),
      );
    },
  };
}
