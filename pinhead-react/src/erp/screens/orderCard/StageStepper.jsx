import { useMemo } from 'react';
import { isStageReady, isStageAwaitingProcurement, materialsForItem } from '../../utils/routes';
import { stageMissingTz } from '../../utils/tz';
import { deptShortName } from '../../data/departments';
import { STAGE_STATUS_LABELS } from '../../types';
import { StageIndicator } from '../../components/StageIndicator';
import { fmtTs } from './format';

/**
 * Тонкая лента этапов позиции (паттерн kontora24 OrderStepper).
 *
 * Здесь только предметная логика — «в каком состоянии этап на самом деле»:
 * ожидающий этап показывается готовым, если по факту готов (материалы пришли,
 * закупка закрыта, ТЗ назначено). Рисование отдано `StageIndicator`, общему
 * на все три вида индикаторов ERP.
 */
export function StageStepper({ item, order, deptById, events }) {
  const lastEventByStage = useMemo(() => {
    const m = new Map();
    for (const ev of events ?? []) {
      if (!m.has(ev.stage_id)) m.set(ev.stage_id, ev); // events отсортированы desc
    }
    return m;
  }, [events]);

  const nodes = item.stages.map((st) => {
    const dept = deptById.get(st.department_id);
    const awaitProc = isStageAwaitingProcurement(order.procurement_tasks, st.id);
    const effReady = st.status === 'waiting'
      && isStageReady(st, item.stages, materialsForItem(order.materials, item.id), dept, awaitProc,
        stageMissingTz(order, item.id, dept));
    const display = effReady ? 'ready' : st.status;
    const ev = lastEventByStage.get(st.id);
    let state;
    if (display === 'done') state = 'done';
    else if (display === 'in_progress' || display === 'ready') state = 'active';
    else if (display === 'blocked') state = 'blocked';
    return {
      key: st.id,
      label: dept ? deptShortName(dept.code, dept.name) : '?',
      state,
      // Соединитель красится по фактическому статусу этапа, а не по вычисленному:
      // «готов» — это ещё не пройденный участок пути
      lineDone: st.status === 'done',
      title: [
        dept?.name,
        STAGE_STATUS_LABELS[display],
        st.finished_at && `завершён ${fmtTs(st.finished_at)}`,
        ev?.actor && `последний: ${ev.actor}`,
      ].filter(Boolean).join(' · '),
    };
  });

  return <StageIndicator variant="dots" nodes={nodes} label="Лента этапов" />;
}
