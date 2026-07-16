import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { useErpStore } from '../store/useErpStore';
import { isStageReady, waitingReason } from '../utils/routes';
import { deptShortName } from '../data/departments';
import { STAGE_STATUS_LABELS } from '../types';
import styles from '../erp.module.css';

/**
 * Производственный план — мастер-таблица (аналог 1_Производственный_план).
 * Строка = позиция заказа, колонки = этапы-светофор по цехам.
 * Клик по этапу циклит статус: ready → in_progress → done.
 */

const STAGE_CHIP_CLASS = {
  waiting: 'chipWaiting',
  ready: 'chipReady',
  in_progress: 'chipProgress',
  done: 'chipDone',
  skipped: 'chipSkipped',
  blocked: 'chipBlocked',
};

/** Следующий статус по клику (простая механика MVP) */
const NEXT_STATUS = {
  ready: 'in_progress',
  in_progress: 'done',
};

function daysLeft(dueDate) {
  if (!dueDate) return null;
  const due = new Date(dueDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}

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
  const { orders, departments, loading, loaded, loadAll, setStageStatus } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loading: s.loading,
      loaded: s.loaded,
      loadAll: s.loadAll,
      setStageStatus: s.setStageStatus,
    })),
  );
  const [onlyActive, setOnlyActive] = useState(true);

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );

  /** Плоский список позиций всех заказов, ближайший срок первым */
  const rows = useMemo(() => {
    const list = [];
    for (const order of orders) {
      if (onlyActive && order.status !== 'active') continue;
      for (const item of order.items) {
        list.push({ order, item });
      }
    }
    return list.sort((a, b) => {
      const da = a.order.due_date || '9999';
      const db = b.order.due_date || '9999';
      return da.localeCompare(db);
    });
  }, [orders, onlyActive]);

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
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(e) => setOnlyActive(e.target.checked)}
          />
          Только активные
        </label>
        <div className={styles.spacer} />
        <span className={styles.subText}>{rows.length} позиций</span>
      </div>

      {loading && !loaded && <div className={styles.emptyState}>Загрузка…</div>}

      {loaded && rows.length === 0 && (
        <div className={styles.emptyState}>
          Нет позиций в работе. Создайте заказ на экране «Заказы».
        </div>
      )}

      {rows.length > 0 && (
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
                const relevant = item.stages.filter((s) => s.status !== 'skipped');
                const doneCount = relevant.filter((s) => s.status === 'done').length;
                return (
                  <tr key={item.id}>
                    <td>{order.bitrix_id || '—'}</td>
                    <td>
                      <strong>{order.title}</strong>
                      <div className={styles.subText}>
                        {item.product_type}
                        {item.variant ? ` · ${item.variant}` : ''}
                        {order.manager ? ` · ${order.manager}` : ''}
                      </div>
                    </td>
                    <td>{item.qty}</td>
                    <td className={dueCls}>
                      {order.due_date
                        ? new Date(order.due_date + 'T00:00:00').toLocaleDateString('ru-RU')
                        : '—'}
                      {d !== null && (
                        <div className={styles.subText}>
                          {d >= 0 ? `${d} дн.` : `просрочен ${-d}`}
                        </div>
                      )}
                    </td>
                    <td className={styles.progressCell}>
                      {doneCount}/{relevant.length}
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
