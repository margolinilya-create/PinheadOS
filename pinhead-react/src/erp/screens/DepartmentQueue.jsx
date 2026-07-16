import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { useErpStore } from '../store/useErpStore';
import { isStageReady, waitingReason } from '../utils/routes';
import { deptShortName, isQueueDept } from '../data/departments';
import styles from '../erp.module.css';

/**
 * Экран цеха: очередь работ конкретного цеха.
 * Группы: Готов к работе → В работе → Ожидает (с причиной) → Готово.
 * Крупные кнопки — цех работает с планшета/телефона.
 */

function daysLeft(dueDate) {
  if (!dueDate) return null;
  const due = new Date(dueDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}

function QueueCard({ entry, onStart, onDone, onBlock, onUnblock, onDefect }) {
  const { order, item, stage, reason, group } = entry;
  const [blockMode, setBlockMode] = useState(false);
  const [blockText, setBlockText] = useState('');
  const [defectMode, setDefectMode] = useState(false);
  const [defectQty, setDefectQty] = useState('');
  const [defectText, setDefectText] = useState('');
  const [doneQty, setDoneQty] = useState(String(item.qty));
  const d = daysLeft(order.due_date);
  const cardCls = [
    styles.queueCard,
    group === 'ready' && styles.queueCardReady,
    group === 'in_progress' && styles.queueCardProgress,
    group === 'blocked' && styles.queueCardBlocked,
    d !== null && d < 0 && styles.queueCardUrgent,
  ].filter(Boolean).join(' ');

  return (
    <div className={cardCls}>
      <div className={styles.queueCardHead}>
        <div>
          <div className={styles.queueCardTitle}>{order.title}</div>
          <div className={styles.subText}>
            №{order.bitrix_id || '—'} · {item.product_type}
            {item.variant ? ` · ${item.variant}` : ''}
          </div>
        </div>
        <div className={styles.queueDue}>
          <div className={styles.queueQty}>{item.qty} шт</div>
          {order.due_date && (
            <div className={d < 0 ? styles.overdue : d <= 3 ? styles.dueSoon : styles.subText}>
              до {new Date(order.due_date + 'T00:00:00').toLocaleDateString('ru-RU')}
              {d !== null && ` · ${d >= 0 ? `${d} дн.` : `−${-d} дн.`}`}
            </div>
          )}
        </div>
      </div>

      {reason && <div className={styles.queueReason}>⏳ {reason}</div>}
      {stage.status === 'blocked' && stage.block_reason && (
        <div className={styles.queueReason}>🚫 {stage.block_reason}</div>
      )}

      <div className={styles.queueActions}>
        {group === 'ready' && (
          <>
            <button type="button" className="btn btn-primary" onClick={() => onStart(stage)}>
              ▶ Взять в работу
            </button>
            {!blockMode && (
              <button type="button" className="btn btn-ghost" onClick={() => setBlockMode(true)}>
                🚫 Проблема
              </button>
            )}
          </>
        )}
        {group === 'in_progress' && (
          <>
            <input
              type="number"
              min="1"
              className={styles.input}
              style={{ maxWidth: 84, flex: '0 0 auto' }}
              value={doneQty}
              onChange={(e) => setDoneQty(e.target.value)}
              aria-label="Сколько сделано, шт"
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onDone(stage, item, Math.max(1, Number(doneQty) || item.qty))}
            >
              ✓ Готово
            </button>
            {!blockMode && !defectMode && (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => setDefectMode(true)}>
                  ↩ Брак
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setBlockMode(true)}>
                  🚫 Проблема
                </button>
              </>
            )}
          </>
        )}
        {group === 'done' && !defectMode && (
          <button type="button" className="btn btn-ghost" onClick={() => setDefectMode(true)}>
            ↩ Брак / переделка
          </button>
        )}
        {group === 'blocked' && (
          <button type="button" className="btn btn-secondary" onClick={() => onUnblock(stage)}>
            Снять блокировку
          </button>
        )}
      </div>

      {blockMode && (
        <div className={styles.queueBlockForm}>
          <input
            className={styles.input}
            placeholder="Что мешает? (брак кроя, нет ниток…)"
            value={blockText}
            onChange={(e) => setBlockText(e.target.value)}
            autoFocus
          />
          <button
            type="button"
            className="btn btn-danger"
            disabled={!blockText.trim()}
            onClick={() => { onBlock(stage, blockText.trim()); setBlockMode(false); setBlockText(''); }}
          >
            Заблокировать
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setBlockMode(false)}>
            Отмена
          </button>
        </div>
      )}

      {defectMode && (
        <div className={styles.queueBlockForm}>
          <input
            type="number"
            min="1"
            className={styles.input}
            style={{ maxWidth: 84, flex: '0 0 auto' }}
            placeholder="шт"
            value={defectQty}
            onChange={(e) => setDefectQty(e.target.value)}
            aria-label="Сколько штук в брак"
            autoFocus
          />
          <input
            className={styles.input}
            placeholder="Причина брака (кривая строчка, пятно…)"
            value={defectText}
            onChange={(e) => setDefectText(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-danger"
            disabled={!defectText.trim() || !(Number(defectQty) > 0)}
            onClick={() => {
              onDefect(stage, Number(defectQty), defectText.trim());
              setDefectMode(false); setDefectQty(''); setDefectText('');
            }}
          >
            В переделку
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setDefectMode(false)}>
            Отмена
          </button>
        </div>
      )}
    </div>
  );
}

const GROUP_TITLES = {
  ready: '🟢 Готово к работе',
  in_progress: '🟡 В работе',
  waiting: '⏳ Ожидает',
  blocked: '🚫 Заблокировано',
  done: '✓ Завершено недавно',
};

export default function DepartmentQueue() {
  const { orders, departments, loading, loaded, loadAll, setStageStatus, reportDefect } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loading: s.loading,
      loaded: s.loaded,
      loadAll: s.loadAll,
      setStageStatus: s.setStageStatus,
      reportDefect: s.reportDefect,
    })),
  );
  const [deptCode, setDeptCode] = useState(() => localStorage.getItem('erp_my_dept') || '');

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  useEffect(() => {
    if (deptCode) localStorage.setItem('erp_my_dept', deptCode);
  }, [deptCode]);

  const dept = departments.find((d) => d.code === deptCode) || null;
  const deptNameById = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
  );

  /** Счётчик «готово к работе» по каждому цеху — для бейджей на вкладках */
  const readyByDept = useMemo(() => {
    const counts = new Map();
    const deptById = new Map(departments.map((d) => [d.id, d]));
    for (const order of orders) {
      if (order.status !== 'active') continue;
      for (const item of order.items) {
        for (const stage of item.stages) {
          const dd = deptById.get(stage.department_id);
          if (!dd) continue;
          const isReady =
            stage.status === 'in_progress' ||
            (stage.status === 'waiting' &&
              isStageReady(stage, item.stages, order.materials, dd.code));
          if (isReady) counts.set(dd.code, (counts.get(dd.code) || 0) + 1);
        }
      }
    }
    return counts;
  }, [orders, departments]);

  const groups = useMemo(() => {
    const g = { ready: [], in_progress: [], waiting: [], blocked: [], done: [] };
    if (!dept) return g;
    for (const order of orders) {
      if (order.status !== 'active') continue;
      for (const item of order.items) {
        for (const stage of item.stages) {
          if (stage.department_id !== dept.id) continue;
          if (stage.status === 'skipped') continue;
          const entry = { order, item, stage, reason: null };
          if (stage.status === 'done') {
            g.done.push({ ...entry, group: 'done' });
          } else if (stage.status === 'blocked') {
            g.blocked.push({ ...entry, group: 'blocked' });
          } else if (stage.status === 'in_progress') {
            g.in_progress.push({ ...entry, group: 'in_progress' });
          } else if (isStageReady(stage, item.stages, order.materials, dept.code)) {
            g.ready.push({ ...entry, group: 'ready' });
          } else {
            g.waiting.push({
              ...entry,
              group: 'waiting',
              reason: waitingReason(stage, item.stages, order.materials, deptNameById, dept.code),
            });
          }
        }
      }
    }
    const byDue = (a, b) =>
      (a.order.due_date || '9999').localeCompare(b.order.due_date || '9999');
    g.ready.sort(byDue); g.in_progress.sort(byDue); g.waiting.sort(byDue); g.blocked.sort(byDue);
    g.done.sort((a, b) => (b.stage.finished_at || '').localeCompare(a.stage.finished_at || ''));
    g.done = g.done.slice(0, 10);
    return g;
  }, [orders, dept, deptNameById]);

  const onStart = (stage) => setStageStatus(stage.id, 'in_progress');
  const onDone = (stage, item, qty) =>
    setStageStatus(stage.id, 'done', { qty_done: qty ?? item.qty });
  const onBlock = (stage, reason) => setStageStatus(stage.id, 'blocked', { block_reason: reason });
  const onUnblock = (stage) => setStageStatus(stage.id, 'waiting', { block_reason: null });
  const onDefect = (stage, qty, reason) => reportDefect(stage.id, qty, reason);

  return (
    <>
      <PageHead
        title={dept ? dept.name : 'Мой цех'}
        sub="Очередь работ цеха: бери в работу, отмечай готово, сообщай о проблемах."
      />

      <div className={styles.deptTabs} role="tablist" aria-label="Выбор цеха">
        {departments.filter((d) => d.active && isQueueDept(d.code)).map((d) => {
          const count = readyByDept.get(d.code) || 0;
          return (
            <button
              key={d.code}
              type="button"
              role="tab"
              aria-selected={deptCode === d.code}
              className={`${styles.deptTab} ${deptCode === d.code ? styles.deptTabActive : ''}`}
              onClick={() => setDeptCode(d.code)}
            >
              {deptShortName(d.code, d.name)}
              {count > 0 && (
                <span className={`${styles.deptTabCount} ${styles.deptTabHot}`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {!dept && <div className={styles.emptyState}>Выберите свой цех выше — выбор запомнится.</div>}
      {dept && loading && !loaded && <div className={styles.emptyState}>Загрузка…</div>}

      {dept && loaded && Object.entries(GROUP_TITLES).map(([key, title]) => {
        const list = groups[key];
        if (!list || list.length === 0) return null;
        return (
          <section key={key} style={{ marginBottom: 'var(--space-lg, 20px)' }}>
            <h2 className={styles.queueGroupTitle}>{title} <span className={styles.subText}>({list.length})</span></h2>
            <div className={styles.queueGrid}>
              {list.map((entry) => (
                <QueueCard
                  key={entry.stage.id}
                  entry={entry}
                  onStart={onStart}
                  onDone={onDone}
                  onBlock={onBlock}
                  onUnblock={onUnblock}
                  onDefect={onDefect}
                />
              ))}
            </div>
          </section>
        );
      })}

      {dept && loaded &&
        Object.values(groups).every((l) => l.length === 0) && (
        <div className={styles.emptyState}>В этом цехе пока нет работ.</div>
      )}
    </>
  );
}
