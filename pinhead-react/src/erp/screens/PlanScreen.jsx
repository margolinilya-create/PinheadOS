import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { PageHead } from '../components/PageHead';
import { Icon } from '../components/Icon';
import { PlanBoardSkeleton } from './plan/PlanBoardSkeleton';
import { deptsSettled } from '../store/shared';
import { LoadFailed, EmptyState } from '../components/ErpStates';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { isProductionDept, deptShortName } from '../data/departments';
import { onTabListKeyDown } from '../utils/tabs';
import { formatDateShort } from '../utils/time';
import { factoryToday } from '../../utils/date';
import { buildQueueEntries } from '../utils/queueEntries';
import { remainingQty, unplannedEntries } from '../utils/planQueue';
import {
  deviations, groupByDay, mondayOf, shiftWeek, summarize, weekDates,
} from '../utils/planDay';
import { CapacityBar } from '../components/CapacityBar';
import { capacityReport } from '../utils/capacity';
import { PlanTaskCard } from './plan/PlanTaskCard';
import { PlanSlotDrawer } from './plan/PlanSlotDrawer';
import { PlanAddModal } from './plan/PlanAddModal';
import styles from '../styles';
import { percentLabel, weekdayName } from '../utils/format';
import { Button } from '../components/Button';
import { ProductionTabs } from '../components/ProductionTabs';

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

export default function PlanScreen() {
  const {
    orders, departments, loaded, loadError, loadAll,
    planSlots, planLoaded, planLoadError, loadPlan, movePlanSlot, planComments,
    capacity, capacityLoaded, loadSettings,
    plannedStageIds, plannedAheadLoaded, loadPlannedAhead, bypasses,
    bootstrapLoaded,
  } = useErpStore(useShallow((s) => ({
    orders: s.orders,
    departments: s.departments,
    loaded: s.loaded,
    loadError: s.loadError,
    loadAll: s.loadAll,
    planSlots: s.planSlots,
    planLoaded: s.planLoaded,
    planLoadError: s.planLoadError,
    bootstrapLoaded: s.bootstrapLoaded,
    loadPlan: s.loadPlan,
    movePlanSlot: s.movePlanSlot,
    planComments: s.planComments,
    capacity: s.capacity,
    capacityLoaded: s.capacityLoaded,
    loadSettings: s.loadSettings,
    plannedStageIds: s.plannedStageIds,
    plannedAheadLoaded: s.plannedAheadLoaded,
    loadPlannedAhead: s.loadPlannedAhead,
    bypasses: s.bypasses,
  })));
  const access = useErpAccess();
  const today = factoryToday();

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

  /**
   * Колонка «сегодня»: доска шире экрана, и на планшете текущий день
   * оставался за правым краем — экран открывался на понедельнике, когда
   * работа идёт в четверг. Прокрутка только ГОРИЗОНТАЛЬНАЯ и внутри своего
   * контейнера: `block: 'nearest'` не даёт странице прыгнуть по вертикали.
   */
  const todayRef = useRef(null);
  useEffect(() => {
    const el = todayRef.current;
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    } catch { /* старый браузер — остаёмся на понедельнике, это не поломка */ }
  }, [monday, deptCode]);

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  useEffect(() => { if (!capacityLoaded) loadSettings(); }, [capacityLoaded, loadSettings]);
  useEffect(() => { if (!plannedAheadLoaded) loadPlannedAhead(); }, [plannedAheadLoaded, loadPlannedAhead]);
  useEffect(() => {
    loadPlan(dates[0], dates[dates.length - 1]);
  }, [loadPlan, dates]);

  const productionDepts = useMemo(
    () => departments.filter((d) => d.active && isProductionDept(d)),
    [departments],
  );
  const deptNameById = useMemo(
    () => new Map(departments.map((d) => [d.id, deptShortName(d.code, d.name)])),
    [departments],
  );

  /**
   * Контекст задачи: заказ, позиция, этап, цех и признак ожидания материалов.
   * Считается из тех же `buildQueueEntries`, что очередь и канбан, — иначе план
   * показывал бы «готово», когда цех видит «ждём ткань».
   */
  const ctxByStage = useMemo(() => {
    const map = new Map();
    for (const e of buildQueueEntries(orders, departments, { includeInactive: true, bypasses })) {
      map.set(e.stage.id, {
        order: e.order,
        item: e.item,
        stage: e.stage,
        dept: departments.find((d) => d.id === e.stage.department_id) ?? null,
        awaitingMaterials: e.group === 'awaiting_materials',
      });
    }
    return map;
  }, [orders, departments, bypasses]);

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

  /**
   * Мощность считается по ЗАКАЗАМ недели, а не по разложенным задачам: слоты
   * плана — это работа цехов (одно изделие попадает в несколько), а мощность
   * фабрики выражена в изделиях. Складывать их нельзя, поэтому полоса стоит
   * отдельно и подписана отдельно.
   */
  const weekCapacity = useMemo(
    () => capacityReport(orders, dates, capacity),
    [orders, dates, capacity],
  );

  const canManage = access.can('plan.manage');

  /**
   * Очередь «Не запланировано» — то, ради чего экран и открывают: что готово
   * к запуску и до сих пор не разложено по дням. Считается из тех же
   * `buildQueueEntries`, что очередь цеха, — иначе план предлагал бы ставить
   * работу, которую цех запустить не может.
   */
  const unplanned = useMemo(() => unplannedEntries(
    buildQueueEntries(orders, departments, { bypasses }),
    {
      plannedStageIds,
      departmentId: deptCode === 'all'
        ? null
        : productionDepts.find((d) => d.code === deptCode)?.id ?? null,
    },
  ), [orders, departments, bypasses, plannedStageIds, deptCode, productionDepts]);

  /**
   * Одна зона сброса, два источника: карточка дня переезжает на другой день,
   * а задание из очереди «Не запланировано» открывает окно постановки с уже
   * подставленными днём и заданием — количество на день человек подтверждает
   * сам. Молча ставить весь остаток значило бы решать за руководителя главное.
   */
  const onDrop = async (date) => {
    if (!drag) return;
    const dragged = drag;
    setDrag(null);
    if (dragged.kind === 'entry') {
      setAddTo({ date, deptId: dragged.entry.stage.department_id, entry: dragged.entry });
      return;
    }
    if (dragged.slot.work_date === date) return;
    await movePlanSlot(dragged.slot.id, date);
  };

  /**
   * Панель готова показывать содержимое, а не скелетон.
   *
   * Три источника, и ни один не заменяет другой: слоты недели, заказы
   * и состав участков. `deptsSettled` — общий предикат раздела: он же снимает
   * резерв места в меню цехов и в ряду вкладок.
   */
  const ready = planLoaded && loaded && deptsSettled(departments, bootstrapLoaded);

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
      <ProductionTabs />

      <CapacityBar
        loading={!capacityLoaded}
        report={weekCapacity}
        periodLabel={`неделя ${formatDateShort(dates[0])} — ${formatDateShort(dates[dates.length - 1])}`}
        hint="Изделия активных заказов со сроком сдачи на этой неделе против доступной мощности. Раскладка ниже — работа цехов, её штуки с этим числом не складываются."
      />

      <div className={styles.toolbar}>
        <Button variant="secondary" onClick={() => setParam({ week: shiftWeek(monday, -1) })}>
          <Icon name="chevronLeft" size={15} /> Неделя
        </Button>
        <Button variant="secondary" onClick={() => setParam({ week: null })}>
          Текущая неделя
        </Button>
        <Button variant="secondary" onClick={() => setParam({ week: shiftWeek(monday, 1) })}>
          Неделя <Icon name="chevronRight" size={15} />
        </Button>
        <span className={styles.subText}>
          {formatDateShort(dates[0])} — {formatDateShort(dates[dates.length - 1])}
        </span>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={withWeekend} onChange={(e) => setParam({ we: e.target.checked ? '1' : null })} />
          с выходными
        </label>
        <div className={styles.spacer} />
        <span className={styles.subText}>
          план {weekSummary.planned} · факт {weekSummary.fact} · {percentLabel(weekSummary.percent)}
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
      {/*
        Готовность панели — ТРИ условия, и каждое своё: `planLoaded` отвечает
        за слоты, `loaded` — за заказы, `deptsSettled` — за состав участков.
        Пока стоял один `planLoaded`, между ответом слотов и приездом цехов
        экран рисовал полноценный, но НЕПРАВДИВЫЙ кадр: сводка сообщала, что
        ничего не запланировано, а очередь — «Не запланировано (0)», хотя
        цехов ещё не было вовсе. Гейт на `planLoading` вдобавок давал лишнюю
        ступень «пусто → скелетон»: `loadPlan` зовётся из эффекта, и первый
        кадр панели был пустым.
      */}
      {!ready && <PlanBoardSkeleton days={dates.length} deptCode={deptCode} />}

      {ready && deptCode === 'all' && (
        <AllDeptsSummary
          depts={productionDepts}
          slots={enriched}
          ctxByStage={ctxByStage}
          today={today}
          onPick={(code) => setParam({ dept: code })}
          canManage={canManage}
        />
      )}

      {/*
        ТЕКУЩИЙ ДЕНЬ ПОПАДАЕТ В ВИД (обход 04.09). Колонка дня — 300px, доска
        прокручивается по горизонтали, и на планшете «сегодня» оставалось
        за правым краем: экран открывался на понедельнике, а работа шла
        в четверг. Прокрутка ГОРИЗОНТАЛЬНАЯ и внутри своего контейнера —
        `block: 'nearest'` не даёт странице прыгнуть по вертикали.
      */}
      {ready && deptCode !== 'all' && (
        <ScrollHintBox className={styles.planBoardWrap} label="Недельный план цеха">
          <div className={styles.planBoard}>
            {dates.map((date, i) => {
              const list = byDay[date] ?? [];
              const day = summarize(list, today);
              return (
                <section
                  key={date}
                  ref={date === today ? todayRef : undefined}
                  className={`${styles.planDay} ${date === today ? styles.planDayToday : ''}`}
                  onDragOver={(e) => { if (drag) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); onDrop(date); }}
                >
                  <header className={styles.planDayHead}>
                    <b>{weekdayName(date)}</b>
                    <span className={styles.subText}>{formatDateShort(date)}</span>
                  </header>
                  {/* Сводка дня до открытия карточек — требование 5.5 */}
                  <div className={styles.planDayStats}>
                    <span>план <b>{day.planned}</b></span>
                    <span>факт <b>{day.fact}</b></span>
                    <span>{percentLabel(day.percent)}</span>
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
                        onDragStart={(e, s) => {
                          setDrag({ kind: 'slot', slot: s });
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => setDrag(null)}
                        onOpen={setOpenSlot}
                      />
                      {/* Перетаскиванию обязана быть клавиатурная альтернатива —
                          правило проекта и единственный путь на планшете цеха */}
                      {canManage && (
                        <div className={styles.planMoveBtns}>
                          <Button
                            variant="ghost"
                            disabled={i === 0}
                            aria-label={`Перенести на ${weekdayName(dates[i - 1])}`}
                            title="На день раньше"
                            onClick={() => movePlanSlot(slot.id, dates[i - 1])}>
                            <Icon name="chevronLeft" size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={i === dates.length - 1}
                            aria-label={`Перенести на ${weekdayName(dates[i + 1])}`}
                            title="На день позже"
                            onClick={() => movePlanSlot(slot.id, dates[i + 1])}>
                            <Icon name="chevronRight" size={14} />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  {list.length === 0 && <div className={styles.kanbanEmpty}>—</div>}

                  {canManage && (
                    <Button
                      variant="ghost"
                      onClick={() => setAddTo({ date, deptId: productionDepts.find((d) => d.code === deptCode)?.id ?? null, })}>
                      + В план на этот день
                    </Button>
                  )}
                </section>
              );
            })}
          </div>
        </ScrollHintBox>
      )}

      {ready && deptCode !== 'all' && visible.length === 0 && (
        <EmptyState
          title="На эту неделю задач нет"
          text={canManage
            ? 'Добавьте этапы из общего производственного плана кнопкой «+ В план на этот день».'
            : 'Руководитель производства ещё не разложил задачи на эту неделю.'}
        />
      )}

      {/* Очередь «Не запланировано» — прямое требование документа. Стоит НАД
          отклонениями: сначала разложить работу, потом разбирать сорванное. */}
      {ready && (
        <UnplannedQueue
          entries={unplanned}
          deptNameById={deptNameById}
          canManage={canManage}
          dragging={drag?.kind === 'entry' ? drag.entry.stage.id : null}
          onDragStart={(e, entry) => {
            setDrag({ kind: 'entry', entry });
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onDragEnd={() => setDrag(null)}
          onPlan={(entry) => setAddTo({
            date: null, deptId: entry.stage.department_id, entry,
          })}
        />
      )}

      {/* Отклонения: то, что руководителю разбирать вручную */}
      {ready && weekDeviations.length > 0 && (
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
          preselect={addTo.entry ?? null}
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
function AllDeptsSummary({ depts, slots, ctxByStage, today, onPick, canManage }) {
  const rows = depts.map((d) => {
    const mine = slots.filter((s) => s.department_id === d.id
      || ctxByStage.get(s.stage_id)?.dept?.id === d.id);
    return { dept: d, week: summarize(mine, today), day: summarize(mine.filter((s) => s.work_date === today), today) };
  });

  /**
   * Сводка из одних нулей — это не «данные», а «плана нет».
   *
   * На 03.08.2026 в `erp_calendar_slots` две строки на всю базу, и таблица
   * рисовала двенадцать строк нулей с прочерками в процентах. Формально
   * честно, практически — экран, по которому нельзя принять ни одного
   * решения и из которого не видно, что делать дальше.
   */
  const nothingPlanned = rows.every(({ week }) => week.tasks === 0);
  if (nothingPlanned) {
    return (
      <EmptyState
        icon="calendar"
        title="На эту неделю ничего не запланировано"
        text={canManage
          ? 'План производства ведётся вручную: откройте вкладку цеха и добавьте этапы кнопкой «+ В план на этот день». Пока плана нет, сводка показывала бы нули по всем участкам.'
          : 'Руководитель производства ещё не разложил работу на эту неделю.'}
      />
    );
  }

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
              <td>{day.planned}</td><td>{day.fact}</td><td>{percentLabel(day.percent)}</td>
              <td>{week.planned}</td><td>{week.fact}</td><td>{percentLabel(week.percent)}</td>
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

/**
 * Очередь «Не запланировано» (правки заказчика 10.08).
 *
 * Отвечает на один вопрос: что можно запускать сегодня и до сих пор не
 * разложено по дням. Постановка — двумя путями: перетащить в день недели или
 * нажать «В план» и выбрать дату. Клавиатурный путь обязателен и здесь: на
 * планшете цеха перетаскивания нет вовсе, а этот экран открывают и с него.
 */
function UnplannedQueue({
  entries, deptNameById, canManage, dragging, onDragStart, onDragEnd, onPlan,
}) {
  if (entries.length === 0) {
    return (
      <section className={styles.planDeviations} aria-label="Не запланировано">
        <h3 className={styles.queueGroupTitle}>Не запланировано (0)</h3>
        <p className={styles.subText}>
          Вся работа, готовая к запуску, разложена по дням.
        </p>
      </section>
    );
  }

  return (
    // Именованный регион: на экране плана уже есть кнопка «+ В план на этот день»
    // у каждого дня, и без имени секции обе постановки неразличимы — ни для
    // скринридера, ни для теста
    <section className={styles.planDeviations} aria-label="Не запланировано">
      <h3 className={styles.queueGroupTitle}>
        Не запланировано ({entries.length})
      </h3>
      <p className={styles.queueReason}>
        Готово к запуску, но ни на один день не поставлено.
        {canManage
          ? ' Перетащите в день недели или нажмите «В план».'
          : ' Разложить работу может руководитель производства.'}
      </p>
      <div className={styles.planUnplannedList}>
        {entries.map((e) => (
          <div
            key={e.stage.id}
            className={`${styles.planUnplannedRow} ${dragging === e.stage.id ? styles.queueRowDragging : ''}`}
            draggable={canManage}
            onDragStart={(ev) => canManage && onDragStart(ev, e)}
            onDragEnd={onDragEnd}
          >
            <span className={styles.planUnplannedBody}>
              <b>№{e.order.bitrix_id || '—'}</b> {e.order.title}
              <span className={styles.subText}>
                {' '}· {[e.item.product_type, e.item.variant].filter(Boolean).join(' ')}
                {' '}· {deptNameById.get(e.stage.department_id) || '—'}
                {' '}· остаток {remainingQty(e)} шт
                {e.order.due_date ? ` · срок ${formatDateShort(e.order.due_date)}` : ''}
              </span>
            </span>
            {canManage && (
              <Button variant="secondary" onClick={() => onPlan(e)}>
                <Icon name="calendar" size={14} /> В план
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
