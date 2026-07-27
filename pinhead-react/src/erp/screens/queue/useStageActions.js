import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { currentActor } from '../../store/shared';
import { deptShortName } from '../../data/departments';
import { confirmStageDone } from '../../utils/stageDone';
import { toast } from '../../../store/useToastStore';

/**
 * Действия цеха над заданием: взять в работу, записать результат, проблема,
 * завершить этап, брак. Вынесены из DepartmentQueue, чтобы очередь, строка очереди
 * и страница производственного задания вызывали одно и то же (правки 5 и 8).
 *
 * «Взять в работу» закрепляет задание за исполнителем (erp_item_stages.assignee) —
 * колонка была в схеме с первой фазы, но никогда не заполнялась.
 */
export function useStageActions() {
  const {
    departments, setStageStatus, setStagePlan, reportProgress, reportDefect,
    uploadOrderAttachment, ackStageOverdue,
  } = useErpStore(
    useShallow((s) => ({
      departments: s.departments,
      setStageStatus: s.setStageStatus,
      setStagePlan: s.setStagePlan,
      reportProgress: s.reportProgress,
      reportDefect: s.reportDefect,
      uploadOrderAttachment: s.uploadOrderAttachment,
      ackStageOverdue: s.ackStageOverdue,
    })),
  );
  const deptNameById = useMemo(
    () => new Map(departments.map((d) => [d.id, deptShortName(d.code, d.name)])),
    [departments],
  );

  /** Взять в работу: план завершения + закрепление за исполнителем */
  const onStart = useCallback(async (entry, plannedEnd) => {
    if (plannedEnd) await setStagePlan(entry.stage.id, { planned_end: plannedEnd });
    return setStageStatus(entry.stage.id, 'in_progress', { assignee: currentActor() });
  }, [setStagePlan, setStageStatus]);

  /**
   * «Готово» без числа — закрыть этап целиком.
   * Пишет весь тираж, поэтому при незакрытом остатке сперва спрашиваем: иначе
   * «сдал 40 из 100 → нажал Завершить» тихо превращалось в 100 сданных штук
   * и открывало следующий цех на количество, которого физически нет.
   */
  const onDone = useCallback(async (entry) => {
    const ok = await confirmStageDone({
      stage: entry.stage,
      qty: entry.item.qty,
      allStages: entry.item.stages,
      deptNameById,
    });
    if (!ok) return false;
    return setStageStatus(entry.stage.id, 'done', { qty_done: entry.item.qty });
  }, [setStageStatus, deptNameById]);

  /** «Частично» — накопительный прогресс qty_done += N */
  const onProgress = useCallback(
    (entry, qty) => reportProgress(entry.stage.id, qty),
    [reportProgress],
  );

  const onBlock = useCallback(async (entry, reason, photo) => {
    let photoOk = false;
    if (photo) photoOk = await uploadOrderAttachment(entry.order.id, photo, `Блокировка: ${reason}`);
    const ok = await setStageStatus(entry.stage.id, 'blocked', {
      block_reason: photoOk ? `${reason} (фото во вложениях)` : reason,
    });
    if (photo && !photoOk) toast.warning('Блокировка записана, но фото не загрузилось');
    return ok;
  }, [setStageStatus, uploadOrderAttachment]);

  const onUnblock = useCallback(
    (entry) => setStageStatus(entry.stage.id, 'waiting', { block_reason: null }),
    [setStageStatus],
  );

  const onDefect = useCallback(async (entry, opts, photo) => {
    let photoOk = false;
    if (photo) photoOk = await uploadOrderAttachment(entry.order.id, photo, `Брак: ${opts.reason}`);
    const ok = await reportDefect(entry.stage.id, {
      ...opts,
      reason: photoOk ? `${opts.reason} (фото во вложениях)` : opts.reason,
    });
    if (photo && !photoOk) toast.warning('Брак записан, но фото не загрузилось');
    return ok;
  }, [reportDefect, uploadOrderAttachment]);

  return { onStart, onDone, onProgress, onBlock, onUnblock, onDefect, onAckOverdue: ackStageOverdue };
}
