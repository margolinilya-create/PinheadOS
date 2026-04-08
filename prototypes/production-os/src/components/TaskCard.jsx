import { memo } from 'react';
import useWorkshopStore from '../store/useWorkshopStore';
import OrderTimeline from './OrderTimeline';
import { TYPE_NAMES, FABRIC_NAMES, ZONE_LABELS, TECH_NAMES } from '../data/labels';
import { MS_PER_DAY } from '../utils/format';
import styles from './TaskCard.module.css';

function getDeadlineInfo(deadline) {
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(deadline);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / MS_PER_DAY);

  if (diffDays < 0) return { label: 'ПРОСРОЧЕН', color: 'var(--color-error)' };
  if (diffDays === 0) return { label: 'Сегодня', color: 'var(--color-warning)' };
  if (diffDays === 1) return { label: 'Завтра', color: 'var(--color-warning)' };
  if (diffDays <= 3) return { label: `${diffDays} дн`, color: 'var(--text-mid)' };
  return { label: `${diffDays} дн`, color: 'var(--text-dim)' };
}

const STATUS_LABELS = {
  pending: 'Ожидает',
  ready: 'Готово к работе',
  in_progress: 'В работе',
  done: 'Завершено',
  blocked: 'Заблокировано',
};

const STATUS_COLORS = {
  pending: 'var(--status-pending)',
  ready: 'var(--status-ready)',
  in_progress: 'var(--status-in-progress)',
  done: 'var(--status-done)',
  blocked: 'var(--status-blocked)',
};

function getLeftBarColor(task) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = task.due_date ? new Date(task.due_date) : null;
  if (due) due.setHours(0, 0, 0, 0);

  if (task.status === 'blocked') return 'var(--status-blocked)';
  if (task.status === 'in_progress') return 'var(--status-in-progress)';
  if (due && due < today) return 'var(--color-error)';
  if (due && due.getTime() === today.getTime()) return 'var(--color-warning)';
  return 'var(--status-pending)';
}

function buildDescription(task, order) {
  const item = order?.data?.items?.[0];
  if (!item) return '';
  const ws = task.workshop_code;

  if (ws === 'screen' || ws === 'dtf') {
    const zoneNames = (item.zones || []).map(z => ZONE_LABELS[z] || z).join(', ');
    const tech = TECH_NAMES[ws] || ws;
    const colorCount = item.colors ? `${item.colors} цв` : '';
    return [zoneNames, tech, colorCount].filter(Boolean).join(' · ');
  }
  if (ws === 'embroidery') {
    const zoneNames = (item.zones || []).map(z => ZONE_LABELS[z] || z).join(', ');
    return `Вышивка: ${zoneNames || '—'}`;
  }
  if (ws === 'sewing') {
    const fabric = FABRIC_NAMES[item.fabric] || item.fabric || '—';
    const fit = item.fit === 'oversize' ? 'Оверсайз' : item.fit === 'regular' ? 'Регуляр' : item.fit || '';
    return [fabric, fit].filter(Boolean).join(', ');
  }
  if (ws === 'cutting') {
    const fabric = FABRIC_NAMES[item.fabric] || item.fabric || '—';
    const sizesCount = Object.keys(item.sizes || {}).length;
    return `${fabric} · ${sizesCount} размера`;
  }
  if (ws === 'packaging_qc') {
    return 'Финальная проверка';
  }
  return '';
}

function isJustStarted(task) {
  if (task.status !== 'in_progress' || !task.started_at) return false;
  return (Date.now() - new Date(task.started_at).getTime()) < 3000;
}

// Generate a deterministic "barcode-like" pattern from a string
function buildBarPattern(str) {
  const bars = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    bars.push((c % 3) + 1); // 1, 2, or 3 units wide
  }
  // Normalize to fit in ~28px total
  const total = bars.reduce((s, w) => s + w, 0);
  const scale = 26 / total;
  return bars.map(w => Math.max(1, Math.round(w * scale)));
}

function MiniBarcode({ orderNumber }) {
  const code = orderNumber || '??';
  const bars = buildBarPattern(code);
  let x = 1;
  const rects = bars.map((w, i) => {
    const rect = i % 2 === 0
      ? <rect key={i} x={x} y={2} width={w} height={20} fill="#111" rx="0.5" />
      : null;
    x += w;
    return rect;
  });

  return (
    <div className={styles.qr} title={`Заказ: ${code}`}>
      <svg viewBox="0 0 28 26" width="28" height="26" style={{ display: 'block' }}>
        {rects}
        <rect x={1} y={23} width={26} height={1} fill="#111" rx="0.5" />
      </svg>
      <span className={styles.qrLabel}>{code.replace('PH-', '')}</span>
    </div>
  );
}

const TaskCard = memo(function TaskCard({ task }) {
  const order = useWorkshopStore(s => s.orders[task.order_id]);
  const selectTask = useWorkshopStore(s => s.selectTask);
  const startTask = useWorkshopStore(s => s.startTask);
  const selectAndHandoff = useWorkshopStore(s => s.selectAndHandoff);
  const selectedTaskId = useWorkshopStore(s => s.selectedTaskId);
  const orderNumber = order?.order_number || '—';
  const clientName = order?.data?.name || '';
  const item = order?.data?.items?.[0];
  const typeName = TYPE_NAMES[item?.type] || item?.type || '—';
  const qty = task.total_units;
  const desc = buildDescription(task, order);
  const deadline = getDeadlineInfo(task.due_date);
  const leftBar = getLeftBarColor(task);
  const isSelected = task.id === selectedTaskId;
  const justStarted = isJustStarted(task);

  function handleQuickStart(e) {
    e.stopPropagation();
    startTask(task.id);
  }

  function handleQuickDone(e) {
    e.stopPropagation();
    selectAndHandoff(task.id);
  }

  return (
    <div
      className={`${styles.card}${isSelected ? ' ' + styles.cardSelected : ''}${justStarted ? ' ' + styles.cardJustStarted : ''}`}
      onClick={() => selectTask(task.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTask(task.id); } }}
    >
      <div className={styles.leftBar} style={{ background: leftBar }}>
        <span className={styles.srOnly}>{STATUS_LABELS[task.status] || task.status}</span>
      </div>

      <MiniBarcode orderNumber={orderNumber} />

      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.orderNum}>{orderNumber}</span>
          <span
            className={styles.statusBadge}
            style={{
              background: STATUS_COLORS[task.status] || 'var(--border-mid)',
              color: task.status === 'pending' || task.status === 'ready' ? '#333' : '#fff',
            }}
          >
            {STATUS_LABELS[task.status] || task.status}
          </span>
          <span className={styles.garment}>{typeName} · {qty} шт</span>
          {deadline && (
            <span className={styles.deadline} style={{ color: deadline.color }}>
              {deadline.label}
            </span>
          )}
        </div>

        {clientName && <div className={styles.client}>{clientName}</div>}

        {desc && <div className={styles.desc}>{desc}</div>}

        {task.handoff_note && (
          <div className={styles.handoff}>
            <span className={styles.handoffIcon}>💬</span>
            {task.handoff_note}
          </div>
        )}

        <div className={styles.footer}>
          <OrderTimeline orderId={task.order_id} currentTaskId={task.id} compact />
          {task.status === 'ready' && (
            <button className={`${styles.quickBtn} ${styles.quickBtnStart}`} onClick={handleQuickStart}>НАЧАТЬ</button>
          )}
          {task.status === 'in_progress' && (
            <button className={`${styles.quickBtn} ${styles.quickBtnDone}`} onClick={handleQuickDone}>ГОТОВО</button>
          )}
        </div>
      </div>
    </div>
  );
});

export { getDeadlineInfo };
export default TaskCard;
