import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { PageHead } from '../components/PageHead';
import { Icon } from '../components/Icon';
import { KanbanSkeleton } from '../components/ErpSkeletons';
import { LoadFailed, EmptyState } from '../components/ErpStates';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { isProductionDept, deptShortName } from '../data/departments';
import { onTabListKeyDown } from '../utils/tabs';
import { formatDateShort } from '../utils/time';
import { localToday } from '../utils/orderForm';
import { buildQueueEntries } from '../utils/queueEntries';
import {
  deviations, groupByDay, mondayOf, shiftWeek, summarize, weekDates,
} from '../utils/planDay';
import { PlanTaskCard } from './plan/PlanTaskCard';
import { PlanSlotDrawer } from './plan/PlanSlotDrawer';
import { PlanAddModal } from './plan/PlanAddModal';
import styles from '../erp.module.css';

/**
 * Недельное и ежедневное планирование производства (правка менеджера 2026-08-03).
 *
 * Руководитель производства вручную раскладывает этапы из общего канбана по цехам
 * и дням; ответственный за цех ежедневно вносит факт. Система план НЕ составляет
 * и остаток сама не переносит — она показывает отклонение, а решение принимает
 * человек (прямое требование 5.14).
 *
 * Неделя и цех живут в адресе: ссылкой на «швейка, неделя с 10-го» можно
 * поделиться, а возврат из карточки заказа восстанавливает подбор.
 */

const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

export default function PlanScreen() {
  const {
    orders, departments, loaded, loadError, loadAll,
    planSlots, planLoaded, planLoading, planLoadError, loadPlan, movePlanSlot, planComments,
  } = useErpStore(useShallow((s) => ({
    orders: s.orders,
    departments: s.departments,
    loaded: s.loaded,
    loadError: s.loadError,
    loadAll: s.loadAll,
    planSlots: s.planSlots,
    planLoaded: s.planLoaded,
    planLoading: s.planLoading,
    planLoadError: s.planLoadError,
    loadPlan: s.loadPlan,
    movePlanSlot: s.movePlanSlot,
    planComments: s.planComments,
  })));
  const access = useErpAccess();
  const today = localToday();

  const [params, setParams] = useSearchParams();
  const monday = params.get('week') || mondayOf(today);
  const deptCode = params.get('dept') || 'all';
  const withWeekend = params.get('we') === '1';

  const setParam = useCallback((patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  }, [params, setParams]);

  const dates = useMemo(() => weekDates(monday, withWeekend ? 7 : 5), [monday, withWeekend]);
  const [openSlot, setOpenSlot] = useState(null);
  const [addTo, setAddTo] = useState(null); // { date, deptId }
  const [drag, setDrag] = useState(null);

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  useEffect(() => {
    loadPlan(dates[0], dates[dates.length - 1]);
  }, [loadPlan, dates]);

  const productionDepts = useMemo(
    () => departments.filter((d) => d.active && isProductionDept(d)),
    [departments],
  );

  /**
   * Контекст задачи: заказ, позиция, этап, цех и признак ожидания материалов.
   * Считается из тех же `buildQueueEntries`, что очередь и канбан, — иначе план
   * показывал бы «готово», когда цех видит «ждём ткань».
   */
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

  /** Задачи с подмешанным признаком материалов — для сводок */
  const enriched = useMemo(
    () => planSlots.map((s) => ({
      ...s,
      awaitingMaterials: Boolean(s.stage_id && ctxByStage.get(s.stage_id)?.awaitingMaterials),
    })),
    [planSlots, ctxByStage],
  );

  const visible = useMemo(
    () => (deptCode === 'all'
      ? enriched
      : enriched.filter((s) => ctxByStage.get(s.stage_id)?.dept?.code === deptCode
        || productionDepts.find((d) => d.code === deptCode)?.id === s.department_id)),
    [enriched, deptCode, ctxByStage, productionDepts],
  );

  const byDay = useMemo(() => groupByDay(visible, dates), [visible, dates]);
  const weekSummary = useMemo(() => summarize(visible, today), [visible, today]);
  const weekDeviations = useMemo(() => deviations(visible, today), [visible, today]);

  const commentCount = useCallback(
    (slotId) => planComments.filter((c) => c.slot_id === slotId).length,
    [planComments],
  );

  const canManage = access.can('plan.manage');

  const onDrop = async (date) => {
    if (!drag) return;
    setDrag(null);
    if (drag.work_date === date) return;
    await movePlanSlot(drag.id, date);
  };

  if (loadError && !loaded) return <LoadFailed onRetry={loadAll} what="производственный план" />;
  if (planLoadError) {
    return <LoadFailed onRetry={() => loadPlan(dates[0], dates[dates.length - 1])} what="план недели" />;
  }

  return (
    <>
      <PageHead
        title="План производства"
        sub="Недельная раскладка по цехам и дням: план, факт, остатки и отклонения. Остаток система не переносит — новую дату ставит руководитель."
      />

      <div className={styles.toolbar}>
        <button type="button" className="btn btn-secondary" onClick={() => setParam({ week: shiftWeek(monday, -1) })}>
          <Icon name="chevronLeft" size={15} /> Неделя
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setParam({ week: null })}>
          Текущая неделя
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setParam({ week: shiftWeek(monday, 1) })}>
          Неделя <Icon name="chevronRight" size={15} />
        </button>
        <span className={styles.subText}>
          {formatDateShort(dates[0])} — {formatDateShort(dates[dates.length - 1])}
        </span>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={withWeekend} onChange={(e) => setParam({ we: e.target.checked ? '1' : null })} />
          с выходными
        </label>
        <div className={styles.spacer} />
        <span className={styles.subText}>
          план {weekSummary.planned} · факт {weekSummary.fact} · {weekSummary.percent}%
        </span>
      </div>

      <div className={styles.deptTabsWrap}>
        <div className={styles.deptTabs} role="tablist" aria-label="Выбор цеха" onKeyDown={onTabListKeyDown}>
          {[{ code: 'all', name: 'Все цеха' }, ...productionDepts].map((d) => (
            <button
              key={d.code}
              type="button"
              role="tab"
              aria-controls="plan-tabpanel"
              aria-selected={deptCode === d.code}
              tabIndex={deptCode === d.code ? 0 : -1}
              className={`${styles.deptTab} ${deptCode === d.code ? styles.deptTabActive : ''}`}
              onClick={() => setParam({ dept: d.code === 'all' ? null : d.code })}
            >
              {d.code === 'all' ? d.name : deptShortName(d.code, d.name)}
            </button>
          ))}
        </div>
      </div>

      <div id="plan-tabpanel" role="tabpanel">
      {!planLoaded && planLoading && <KanbanSkeleton />}

      {planLoaded && deptCode === 'all' && (
        <AllDeptsSummary
          depts={productionDepts}
          slots={enriched}
          ctxByStage={ctxByStage}
          today={today}
          onPick={(code) => setParam({ dept: code })}
        />
      )}

      {planLoaded && deptCode !== 'all' && (
        <ScrollHintBox className={styles.planBoardWrap} label="Недельный план цеха">
          <div className={styles.planBoard}>
            {dates.map((date, i) => {
              const list = byDay[date] ?? [];
              const day = summarize(list, today);
              return (
                <section
                  key={date}
                  className={`${styles.planDay} ${date === today ? styles.planDayToday : ''}`}
                  onDragOver={(e) => { if (drag) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); onDrop(date); }}
                >
                  <header className={styles.planDayHead}>
                    <b>{DAY_NAMES[i]}</b>
                    <span className={styles.subText}>{formatDateShort(date)}</span>
                  </header>
                  {/* Сводка дня до открытия карточек — требование 5.5 */}
                  <div className={styles.planDayStats}>
                    <span>план <b>{day.planned}</b></span>
                    <span>факт <b>{day.fact}</b></span>
                    <span>{day.percent}%</span>
                    {day.active > 0 && <span>в работе {day.active}</span>}
                    {day.done > 0 && <span>готово {day.done}</span>}
                    {day.problems > 0 && <span className={styles.overdue}>проблем {day.problems}</span>}
                    {day.overdue > 0 && <span className={styles.overdue}>просрочек {day.overdue}</span>}
                    {day.awaitingMaterials > 0 && (
                      <span className={styles.dueSoon}>ждут материалы {day.awaitingMaterials}</span>
                    )}
                  </div>

                  {list.map((slot) => (
                    <div key={slot.id} className={styles.planCardWrap}>
                      <PlanTaskCard
                        slot={slot}
                        ctx={ctxByStage.get(slot.stage_id)}
                        today={today}
                        commentsCount={commentCount(slot.id)}
                        draggable={canManage}
                        onDragStart={(e, s) => { setDrag(s); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragEnd={() => setDrag(null)}
                        onOpen={setOpenSlot}
                      />
                      {/* Перетаскиванию обязана быть клавиатурная альтернатива —
                          правило проекта и единственный путь на планшете цеха */}
                      {canManage && (
                        <div className={styles.planMoveBtns}>
                          <button
                            type="button" className="btn btn-ghost"
                            disabled={i === 0}
                            aria-label={`Перенести на ${DAY_NAMES[i - 1] || ''}`}
                            title="На день раньше"
                            onClick={() => movePlanSlot(slot.id, dates[i - 1])}
                          >
                            <Icon name="chevronLeft" size={14} />
                          </button>
                          <button
                            type="button" className="btn btn-ghost"
                            disabled={i === dates.length - 1}
                            aria-label={`Перенести на ${DAY_NAMES[i + 1] || ''}`}
                            title="На день позже"
                            onClick={() => movePlanSlot(slot.id, dates[i + 1])}
                          >
                            <Icon name="chevronRight" size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {list.length === 0 && <div className={styles.kanbanEmpty}>—</div>}

                  {canManage && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setAddTo({
                        date,
                        deptId: productionDepts.find((d) => d.code === deptCode)?.id ?? null,
                      })}
                    >
                      + В план на этот день
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        </ScrollHintBox>
      )}

      {planLoaded && deptCode !== 'all' && visible.length === 0 && (
        <EmptyState
          title="На эту неделю задач нет"
          text={canManage
            ? 'Добавьте этапы из общего производственного плана кнопкой «+ В план на этот день».'
            : 'Руководитель производства ещё не разложил задачи на эту неделю.'}
        />
      )}

      {/* Отклонения: то, что руководителю разбирать вручную */}
      {planLoaded && weekDeviations.length > 0 && (
        <section className={styles.planDeviations}>
          <h3 className={styles.queueGroupTitle}>
            Требуют решения ({weekDeviations.length})
          </h3>
          <div className={styles.planDeviationList}>
            {weekDeviations.map((slot) => (
              <PlanTaskCard
                key={`dev-${slot.id}`}
                slot={slot}
                ctx={ctxByStage.get(slot.stage_id)}
                today={today}
                commentsCount={commentCount(slot.id)}
                onOpen={setOpenSlot}
              />
            ))}
          </div>
        </section>
      )}

      </div>

      {openSlot && (
        <PlanSlotDrawer
          slot={planSlots.find((s) => s.id === openSlot.id) ?? openSlot}
          ctx={ctxByStage.get(openSlot.stage_id)}
          onClose={() => setOpenSlot(null)}
        />
      )}
      {addTo && (
        <PlanAddModal
          date={addTo.date}
          departmentId={addTo.deptId}
          onClose={() => setAddTo(null)}
        />
      )}
    </>
  );
}

/**
 * Вкладка «Все цеха» — краткий управленческий экран (требование 5.12).
 * Детальная работа с задачами живёт внутри вкладки конкретного цеха, поэтому
 * здесь только цифры и переход.
 */
function AllDeptsSummary({ depts, slots, ctxByStage, today, onPick }) {
  const rows = depts.map((d) => {
    const mine = slots.filter((s) => s.department_id === d.id
      || ctxByStage.get(s.stage_id)?.dept?.id === d.id);
    return { dept: d, week: summarize(mine, today), day: summarize(mine.filter((s) => s.work_date === today), today) };
  });

  return (
    <ScrollHintBox className={styles.tableWrap} label="Сводка по цехам">
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Цех</th>
            <th>План на день</th><th>Факт</th><th>%</th>
            <th>План на неделю</th><th>Факт за неделю</th><th>%</th>
            <th>Незавершённых</th><th>Просрочено</th><th>Проблем</th>
            <th>Ждут материалы</th><th>Брак</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ dept, week, day }) => (
            <tr key={dept.id} className={styles.rowClickable} onClick={() => onPick(dept.code)}>
              <td><b>{deptShortName(dept.code, dept.name)}</b></td>
              <td>{day.planned}</td><td>{day.fact}</td><td>{day.percent}%</td>
              <td>{week.planned}</td><td>{week.fact}</td><td>{week.percent}%</td>
              <td>{week.active}</td>
              <td className={week.overdue > 0 ? styles.overdue : undefined}>{week.overdue}</td>
              <td className={week.problems > 0 ? styles.overdue : undefined}>{week.problems}</td>
              <td className={week.awaitingMaterials > 0 ? styles.dueSoon : undefined}>
                {week.awaitingMaterials}
              </td>
              <td>{week.defect}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollHintBox>
  );
}
