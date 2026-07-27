import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { currentActor } from '../../store/shared';
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
    setStageStatus, setStagePlan, reportProgress, reportDefect,
    uploadOrderAttachment, ackStageOverdue,
  } = useErpStore(
    useShallow((s) => ({
      setStageStatus: s.setStageStatus,
      setStagePlan: s.setStagePlan,
      reportProgress: s.reportProgress,
      reportDefect: s.reportDefect,
      uploadOrderAttachment: s.uploadOrderAttachment,
      ackStageOverdue: s.ackStageOverdue,
    })),
  );

  /** Взять в работу: план завершения + закрепление за исполнителем */
  const onStart = useCallback(async (entry, plannedEnd) => {
    if (plannedEnd) await setStagePlan(entry.stage.id, { planned_end: plannedEnd });
    return setStageStatus(entry.stage.id, 'in_progress', { assignee: currentActor() });
  }, [setStagePlan, setStageStatus]);

  /** «Готово» без числа — закрыть этап целиком */
  const onDone = useCallback(
    (entry) => setStageStatus(entry.stage.id, 'done', { qty_done: entry.item.qty }),
    [setStageStatus],
  );

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
