import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { useErpStore } from '../store/useErpStore';
import { isStageReady, waitingReason } from '../utils/routes';
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

function QueueCard({ entry, onStart, onDone, onBlock, onUnblock }) {
  const { order, item, stage, reason, group } = entry;
  const [blockMode, setBlockMode] = useState(false);
  const [blockText, setBlockText] = useState('');
  const d = daysLeft(order.due_date);

  return (
    <div className={styles.queueCard}>
      <div className={styles.queueCardHead}>
        <div>
          <strong>{order.title}</strong>
          <div className={styles.subText}>
            №{order.bitrix_id || '—'} · {item.product_type}
            {item.variant ? ` · ${item.variant}` : ''} · {item.qty} шт
          </div>
        </div>
        {order.due_date && (
          <div className={d < 0 ? styles.overdue : d <= 3 ? styles.dueSoon : styles.subText}>
            до {new Date(order.due_date + 'T00:00:00').toLocaleDateString('ru-RU')}
            {d !== null && <div className={styles.subText}>{d >= 0 ? `${d} дн.` : `просрочен ${-d}`}</div>}
          </div>
        )}
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
            <button type="button" className="btn btn-primary" onClick={() => onDone(stage, item)}>
              ✓ Готово ({item.qty} шт)
            </button>
            {!blockMode && (
              <button type="button" className="btn btn-ghost" onClick={() => setBlockMode(true)}>
                🚫 Проблема
              </button>
            )}
          </>
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
  const onDone = (stage, item) => setStageStatus(stage.id, 'done', { qty_done: item.qty });
  const onBlock = (stage, reason) => setStageStatus(stage.id, 'blocked', { block_reason: reason });
  const onUnblock = (stage) => setStageStatus(stage.id, 'waiting', { block_reason: null });

  return (
    <>
      <PageHead
        title={dept ? `Цех: ${dept.name}` : 'Мой цех'}
        sub="Очередь работ цеха: бери в работу, отмечай готово, сообщай о проблемах."
      />

      <div className={styles.toolbar} role="tablist" aria-label="Выбор цеха">
        {departments.filter((d) => d.active).map((d) => (
          <button
            key={d.code}
            type="button"
            role="tab"
            aria-selected={deptCode === d.code}
            className={`${styles.chip} ${deptCode === d.code ? styles.chipProgress : styles.chipNeutral}`}
            style={{ cursor: 'pointer', font: 'inherit' }}
            onClick={() => setDeptCode(d.code)}
          >
            {d.name}
          </button>
        ))}
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
