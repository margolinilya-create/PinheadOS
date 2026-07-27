import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { TableSkeleton } from '../components/ErpSkeletons';
import { QueueFilters } from '../components/QueueFilters';
import ErpKanban from '../components/ErpKanban';
import { useErpStore } from '../store/useErpStore';
import { useScrollRestore } from '../../hooks/useScrollRestore';
import { isStageReady, waitingReason } from '../utils/routes';
import { stageMissingTz } from '../utils/tz';
import { filtersFromParams, filtersToParams } from '../utils/filterStages';
import { matchesOrderQuery } from '../utils/orderSearch';
import { isProductionDept, deptShortName } from '../data/departments';
import { daysLeft, formatDateShort } from '../utils/time';
import { STAGE_CHIP_CLASS, isOrderReadyToShip } from '../utils/stageUi';
import { itemProgress } from '../utils/progress';
import { STAGE_STATUS_LABELS } from '../types';
import styles from '../erp.module.css';

/**
 * Производственный план — мастер-таблица (аналог 1_Производственный_план).
 * Строка = позиция заказа, колонки = этапы-светофор по цехам.
 * Клик по этапу циклит статус: ready → in_progress → done.
 */

/** Следующий статус по клику (простая механика MVP) */
const NEXT_STATUS = {
  ready: 'in_progress',
  in_progress: 'done',
};

function StageChip({ stage, item, order, deptById, onAdvance }) {
  const dept = deptById.get(stage.department_id);
  const allStages = item.stages;

  // waiting в БД, но зависимости выполнены → показываем как «готов к работе»
  const noTz = stageMissingTz(order, item.id, stage.department_id, dept);
  const effectiveReady =
    stage.status === 'waiting' &&
    isStageReady(stage, allStages, order.materials, dept?.code, false, noTz);
  const displayStatus = effectiveReady ? 'ready' : stage.status;

  const reason =
    displayStatus === 'waiting' || displayStatus === 'blocked'
      ? waitingReason(
          stage, allStages, order.materials,
          new Map([...deptById].map(([id, d]) => [id, d.name])),
          dept?.code, false, noTz,
        )
      : null;

  const clickable = displayStatus === 'ready' || displayStatus === 'in_progress';
  const title = [
    dept?.name,
    STAGE_STATUS_LABELS[displayStatus],
    reason,
    clickable ? `Клик: ${STAGE_STATUS_LABELS[NEXT_STATUS[displayStatus]]}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className={`${styles.chip} ${styles[STAGE_CHIP_CLASS[displayStatus]]}`}
      style={{ cursor: clickable ? 'pointer' : 'default', font: 'inherit' }}
      title={title}
      aria-label={title}
      disabled={!clickable}
      onClick={() => clickable && onAdvance(stage, NEXT_STATUS[displayStatus], item)}
    >
      {dept ? deptShortName(dept.code, dept.name) : '?'}
      {displayStatus === 'done' && ' ✓'}
    </button>
  );
}

export default function ProductionBoard() {
  const {
    orders, departments, loading, loaded, loadAll, setStageStatus,
    archiveLoaded, loadArchive,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loading: s.loading,
      loaded: s.loaded,
      loadAll: s.loadAll,
      setStageStatus: s.setStageStatus,
      archiveLoaded: s.archiveLoaded,
      loadArchive: s.loadArchive,
    })),
  );
  const [onlyActive, setOnlyActive] = useState(true);
  const [view, setView] = useState(() => localStorage.getItem('erp_board_view') || 'table');
  const switchView = (v) => { setView(v); localStorage.setItem('erp_board_view', v); };

  // Поиск, фильтры и сортировка — общие с очередью цеха, состояние в URL (правки 4 и 9)
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const setFilters = useCallback(
    (next) => setSearchParams(filtersToParams(next), { replace: true }),
    [setSearchParams],
  );
  const query = filters.q;
  useScrollRestore(loaded);

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  // Снят фильтр «Только активные» → нужны и архивные (лениво)
  useEffect(() => {
    if (!onlyActive && !archiveLoaded) loadArchive();
  }, [onlyActive, archiveLoaded, loadArchive]);

  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );
  /** Цеха с очередью — колонки канбана и значения фильтра «Цех» */
  const queueDepartments = useMemo(
    () => departments.filter((d) => d.active && isProductionDept(d)),
    [departments],
  );
  const assignees = useMemo(
    () => [...new Set(
      orders.flatMap((o) => o.items).flatMap((it) => it.stages).map((s) => s.assignee).filter(Boolean),
    )].sort(),
    [orders],
  );

  /** Плоский список позиций всех заказов, ближайший срок первым */
  const rows = useMemo(() => {
    const list = [];
    for (const order of orders) {
      if (onlyActive && order.status !== 'active') continue;
      if (!matchesOrderQuery(order, query)) continue;
      for (const item of order.items) {
        list.push({ order, item });
      }
    }
    return list.sort((a, b) => {
      const da = a.order.due_date || '9999';
      const db = b.order.due_date || '9999';
      return da.localeCompare(db);
    });
  }, [orders, onlyActive, query]);

  const onAdvance = async (stage, nextStatus, item) => {
    const extra = nextStatus === 'done' ? { qty_done: item.qty } : {};
    await setStageStatus(stage.id, nextStatus, extra);
  };

  return (
    <>
      <PageHead
        title="Производственный план"
        sub="Все позиции в работе: этапы-светофор по цехам, сроки, узкие места."
      />

      <div className={styles.toolbar}>
        <div role="tablist" aria-label="Вид" style={{ display: 'flex', gap: 6 }}>
          <button
            type="button" role="tab" aria-selected={view === 'table'}
            className={`${styles.chip} ${view === 'table' ? styles.chipProgress : styles.chipNeutral}`}
            style={{ cursor: 'pointer', font: 'inherit' }}
            onClick={() => switchView('table')}
          >
            ☰ Таблица
          </button>
          <button
            type="button" role="tab" aria-selected={view === 'kanban'}
            className={`${styles.chip} ${view === 'kanban' ? styles.chipProgress : styles.chipNeutral}`}
            style={{ cursor: 'pointer', font: 'inherit' }}
            onClick={() => switchView('kanban')}
          >
            ▦ Канбан
          </button>
        </div>
        {view === 'table' && (
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
            />
            Только активные
          </label>
        )}
        <div className={styles.spacer} />
        <span className={styles.subText}>{rows.length} позиций</span>
      </div>

      <QueueFilters
        filters={filters}
        onChange={setFilters}
        departments={queueDepartments}
        assignees={assignees}
      />

      {view === 'kanban' && loaded && <ErpKanban filters={filters} />}

      {loading && !loaded && <TableSkeleton rows={6} label="Загрузка производственного плана" />}

      {view === 'table' && loaded && rows.length === 0 && (
        <div className={styles.emptyState}>
          Нет позиций в работе. Создайте заказ на экране «Заказы».
        </div>
      )}

      {view === 'table' && rows.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>№</th>
                <th>Заказ / позиция</th>
                <th>Кол-во</th>
                <th>Срок</th>
                <th>Прогресс</th>
                <th>Этапы</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ order, item }) => {
                const d = daysLeft(order.due_date);
                const dueCls = d !== null && d < 0
                  ? styles.overdue
                  : d !== null && d <= 3 ? styles.dueSoon : undefined;
                const progress = itemProgress(item);
                return (
                  <tr key={item.id}>
                    <td>{order.bitrix_id || '—'}</td>
                    <td>
                      <span className={styles.cellTitle} title={order.title}>{order.title}</span>
                      {isOrderReadyToShip(order) && (
                        <span
                          className={`${styles.chip} ${styles.chipReady}`}
                          style={{ marginLeft: 6 }}
                          title="Все этапы завершены — заказ готов к отгрузке"
                        >
                          ✅ к отгрузке
                        </span>
                      )}
                      <div className={styles.subText}>
                        {item.product_type}
                        {item.variant ? ` · ${item.variant}` : ''}
                        {order.manager ? ` · ${order.manager}` : ''}
                      </div>
                    </td>
                    <td>{item.qty}</td>
                    <td className={dueCls}>
                      {order.due_date
                        ? formatDateShort(order.due_date)
                        : '—'}
                      {d !== null && (
                        <div className={styles.subText}>
                          {d >= 0 ? `${d} дн.` : `просрочен ${-d}`}
                        </div>
                      )}
                    </td>
                    <td className={styles.progressCell}>
                      <div className={styles.progressLine} title={`Сделано ${progress.done} из ${progress.total} шт по этапам маршрута`}>
                        <div className={styles.progressTrack} aria-hidden="true">
                          <div className={styles.progressFill} style={{ width: `${progress.pct}%` }} />
                        </div>
                        <span>{progress.pct}%</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.stageChips}>
                        {item.stages.map((st) => (
                          <StageChip
                            key={st.id}
                            stage={st}
                            item={item}
                            order={order}
                            deptById={deptById}
                            onAdvance={onAdvance}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
