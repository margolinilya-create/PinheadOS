import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { TableSkeleton } from '../components/ErpSkeletons';
import { SearchInput } from '../components/SearchInput';
import ErpKanban from '../components/ErpKanban';
import { useErpStore } from '../store/useErpStore';
import { isStageReady, waitingReason } from '../utils/routes';
import { matchesOrderQuery } from '../utils/orderSearch';
import { deptShortName } from '../data/departments';
import { daysLeft, formatDateShort } from '../utils/time';
import { STAGE_CHIP_CLASS, isOrderReadyToShip, stageProgress } from '../utils/stageUi';
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
  const effectiveReady =
    stage.status === 'waiting' &&
    isStageReady(stage, allStages, order.materials, dept?.code);
  const displayStatus = effectiveReady ? 'ready' : stage.status;

  const reason =
    displayStatus === 'waiting' || displayStatus === 'blocked'
      ? waitingReason(
          stage, allStages, order.materials,
          new Map([...deptById].map(([id, d]) => [id, d.name])),
          dept?.code,
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
  const [query, setQuery] = useState('');
  const [view, setView] = useState(() => localStorage.getItem('erp_board_view') || 'table');
  const switchView = (v) => { setView(v); localStorage.setItem('erp_board_view', v); };

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
          <>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Поиск: заказ, № сделки, изделие, материал"
              ariaLabel="Поиск по производственному плану"
            />
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={onlyActive}
                onChange={(e) => setOnlyActive(e.target.checked)}
              />
              Только активные
            </label>
          </>
        )}
        <div className={styles.spacer} />
        <span className={styles.subText}>{rows.length} позиций</span>
      </div>

      {view === 'kanban' && loaded && <ErpKanban />}

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
                const progress = stageProgress(item.stages);
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
                      {progress.done}/{progress.total}
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
