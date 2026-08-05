import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { EmptyState, LoadFailed } from '../../components/ErpStates';
import { KanbanSkeleton } from '../../components/ErpSkeletons';
import { formatDateShort } from '../../utils/time';
import { localToday } from '../../utils/orderForm';
import { buildQueueEntries } from '../../utils/queueEntries';
import { mondayOf, summarize, weekDates } from '../../utils/planDay';
import { PlanTaskCard } from '../plan/PlanTaskCard';
import { PlanSlotDrawer } from '../plan/PlanSlotDrawer';
import styles from '../../erp.module.css';
import { percentLabel } from '../../utils/format';

/**
 * Кабинет ответственного за цех: что цех должен сделать сегодня, завтра и на этой
 * неделе, в утверждённой очерёдности, с внесением факта.
 *
 * Отдельный экран не заводим — это тот же «Мой цех», второй вид рядом с очередью:
 * человек и так живёт на этой странице, а два адреса про одну работу разошлись бы
 * фильтрами и привычками.
 *
 * План здесь только читается: количество, дату, приоритет и очерёдность меняет
 * руководитель производства (право `plan.manage`). Цеху доступны факт, брак,
 * комментарий и фиксация проблемы — они внутри карточки задачи.
 */
export function DeptPlanPanel({ dept }) {
  const {
    orders, departments, planSlots, planLoaded, planLoading, planLoadError, loadPlan, planComments,
  } = useErpStore(useShallow((s) => ({
    orders: s.orders,
    departments: s.departments,
    planSlots: s.planSlots,
    planLoaded: s.planLoaded,
    planLoading: s.planLoading,
    planLoadError: s.planLoadError,
    loadPlan: s.loadPlan,
    planComments: s.planComments,
  })));

  const today = localToday();
  const dates = useMemo(() => weekDates(mondayOf(today), 7), [today]);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    loadPlan(dates[0], dates[dates.length - 1]);
  }, [loadPlan, dates]);

  const ctxByStage = useMemo(() => {
    const map = new Map();
    for (const e of buildQueueEntries(orders, departments, { includeInactive: true })) {
      map.set(e.stage.id, {
        order: e.order,
        item: e.item,
        stage: e.stage,
        dept: departments.find((d) => d.id === e.stage.department_id) ?? null,
        awaitingMaterials: e.group === 'awaiting_materials',
      });
    }
    return map;
  }, [orders, departments]);

  const mine = useMemo(() => planSlots
    .filter((s) => s.department_id === dept?.id && s.status !== 'cancelled')
    .map((s) => ({
      ...s,
      awaitingMaterials: Boolean(ctxByStage.get(s.stage_id)?.awaitingMaterials),
    }))
    .sort((a, b) => a.work_date.localeCompare(b.work_date)
      || (a.sort_order ?? 0) - (b.sort_order ?? 0)),
  [planSlots, dept?.id, ctxByStage]);

  const tomorrow = dates.find((d) => d > today) ?? '';
  const groups = useMemo(() => ({
    today: mine.filter((s) => s.work_date === today),
    overdue: mine.filter((s) => s.work_date < today && (s.qty_done ?? 0) < s.qty_planned),
    tomorrow: mine.filter((s) => s.work_date === tomorrow),
    later: mine.filter((s) => s.work_date > tomorrow),
  }), [mine, today, tomorrow]);

  const daySummary = summarize(groups.today, today);
  const commentCount = (id) => planComments.filter((c) => c.slot_id === id).length;

  if (planLoadError) {
    return <LoadFailed onRetry={() => loadPlan(dates[0], dates[dates.length - 1])} what="план цеха" />;
  }
  if (!planLoaded && planLoading) return <KanbanSkeleton />;

  if (mine.length === 0) {
    return (
      <EmptyState
        title="Плана на эту неделю нет"
        text="Руководитель производства ещё не поставил цеху задачи. Текущая работа — на вкладке «Очередь»."
      />
    );
  }

  const block = (title, list, hint) => (list.length > 0 ? (
    <section key={title}>
      <h3 className={styles.queueGroupTitle}>{title} <span className={styles.subText}>({list.length})</span></h3>
      {hint && <div className={styles.subText}>{hint}</div>}
      <div className={styles.planDeviationList}>
        {list.map((slot) => (
          <PlanTaskCard
            key={slot.id}
            slot={slot}
            ctx={ctxByStage.get(slot.stage_id)}
            today={today}
            commentsCount={commentCount(slot.id)}
            onOpen={setOpen}
          />
        ))}
      </div>
    </section>
  ) : null);

  return (
    <>
      <div className={styles.planDayStats}>
        <span>сегодня план <b>{daySummary.planned}</b></span>
        <span>факт <b>{daySummary.fact}</b></span>
        <span>{percentLabel(daySummary.percent)}</span>
        <span>остаток <b>{daySummary.remaining}</b></span>
        {daySummary.problems > 0 && <span className={styles.overdue}>проблем {daySummary.problems}</span>}
        {daySummary.awaitingMaterials > 0 && (
          <span className={styles.dueSoon}>ждут материалы {daySummary.awaitingMaterials}</span>
        )}
      </div>

      {block(
        'Просрочено',
        groups.overdue,
        'Дни прошли, план не закрыт. Внесите факт или сообщите о проблеме — новую дату ставит руководитель.',
      )}
      {block(`Сегодня, ${formatDateShort(today)}`, groups.today)}
      {block(tomorrow ? `Завтра, ${formatDateShort(tomorrow)}` : 'Завтра', groups.tomorrow)}
      {block('Дальше на этой неделе', groups.later)}

      {open && (
        <PlanSlotDrawer
          slot={planSlots.find((s) => s.id === open.id) ?? open}
          ctx={ctxByStage.get(open.stage_id)}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
