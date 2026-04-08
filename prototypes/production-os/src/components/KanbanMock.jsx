import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useWorkshopStore from '../store/useWorkshopStore';
import { WORKSHOP_MAP } from '../data/workshops';
import { getDeadlineInfo } from './TaskCard';
import OrderTimeline from './OrderTimeline';
import styles from './KanbanMock.module.css';

// ─── Mock orders for non-production columns ───────────────────────────────────

const MOCK_DRAFT = [
  { id: 'md1', order_number: 'PH-1120', status: 'draft', total_qty: 50, data: { name: 'Агентство «Медиа+»', deadline: '2026-04-25' } },
  { id: 'md2', order_number: 'PH-1121', status: 'draft', total_qty: 120, data: { name: 'Колледж Политех', deadline: '2026-04-30' } },
  { id: 'md3', order_number: 'PH-1122', status: 'draft', total_qty: 30, data: { name: 'ИП Сидоров А.В.', deadline: '2026-05-05' } },
];

const MOCK_REVIEW = [
  { id: 'mr1', order_number: 'PH-1117', status: 'review', total_qty: 200, data: { name: 'Банк «Восток»', deadline: '2026-04-20' } },
  { id: 'mr2', order_number: 'PH-1118', status: 'review', total_qty: 80, data: { name: 'Клиника «Здоровье»', deadline: '2026-04-22' } },
];

const MOCK_APPROVED = [
  { id: 'ma1', order_number: 'PH-1119', status: 'approved', total_qty: 150, data: { name: 'ООО «Стройком»', deadline: '2026-04-17' } },
  { id: 'ma2', order_number: 'PH-1116', status: 'approved', total_qty: 60, data: { name: 'Кафе «Восход»', deadline: '2026-04-19' } },
];

const COLUMN_COLORS = {
  draft:      '#F0F0F0',
  review:     '#FFF8E1',
  approved:   '#EEF2FF',
  production: '#FFF3E8',
  done:       '#F0FFF4',
};

const COLUMN_LABELS = {
  draft:      'Черновик',
  review:     'На проверке',
  approved:   'Подтверждён',
  production: 'Производство',
  done:       'Готово',
};

const COLUMN_HEADER_COLORS = {
  draft:      '#9E9E9E',
  review:     '#F59E0B',
  approved:   '#6366F1',
  production: '#F97316',
  done:       '#22C55E',
};

// ─── Find the active workshop for a production order ─────────────────────────

function getActiveWorkshop(tasks, orderId) {
  const orderTasks = tasks.filter(t => t.order_id === orderId);
  const active = orderTasks.find(t => t.status === 'in_progress' || t.status === 'ready');
  if (active) return WORKSHOP_MAP[active.workshop_code] || null;
  if (orderTasks.every(t => t.status === 'done')) return WORKSHOP_MAP['packaging_qc'] || null;
  return null;
}

// ─── KanbanCard ───────────────────────────────────────────────────────────────

function KanbanCard({ order, isProduction, tasks, isSelected, onSelect }) {
  const deadline = getDeadlineInfo(order.data?.deadline);
  const activeWs = isProduction ? getActiveWorkshop(tasks, order.id) : null;
  const leftBorderColor = activeWs ? activeWs.color : 'transparent';

  return (
    <div
      className={`${styles.card}${isSelected ? ' ' + styles.cardSelected : ''}${isProduction ? ' ' + styles.cardProduction : ''}`}
      style={isProduction ? { '--ws-border': leftBorderColor } : {}}
      onClick={() => isProduction && onSelect(order.id)}
    >
      {isProduction && <div className={styles.cardWsBar} style={{ background: leftBorderColor }} />}

      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <span className={styles.cardNum}>{order.order_number}</span>
          {deadline && (
            <span className={styles.cardDeadline} style={{ color: deadline.color }}>
              {deadline.label}
            </span>
          )}
        </div>
        <div className={styles.cardClient}>{order.data?.name || '—'}</div>
        <div className={styles.cardQty}>{order.total_qty} шт</div>

        {isProduction && (
          <div className={styles.cardTimeline}>
            <OrderTimeline orderId={order.id} compact />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ProductionDetail ─────────────────────────────────────────────────────────

function ProductionDetail({ order, tasks, onClose }) {
  const orderTasks = tasks.filter(t => t.order_id === order.id).sort((a, b) => a.seq - b.seq);
  const deadline = getDeadlineInfo(order.data?.deadline);

  const STATUS_LABELS = {
    pending: 'Ожидает',
    ready: 'Готово к работе',
    in_progress: 'В работе',
    done: 'Завершено',
    blocked: 'Заблокировано',
  };
  const STATUS_COLORS_MAP = {
    pending: 'var(--text-dim)',
    ready: 'var(--color-warning)',
    in_progress: 'var(--accent)',
    done: 'var(--color-success)',
    blocked: 'var(--color-error)',
  };

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <div>
          <span className={styles.detailNum}>{order.order_number}</span>
          {deadline && (
            <span className={styles.detailDeadline} style={{ color: deadline.color }}>
              {deadline.label}
            </span>
          )}
        </div>
        <button className={styles.detailClose} onClick={onClose}>✕</button>
      </div>
      <div className={styles.detailClient}>{order.data?.name || '—'}</div>
      <div className={styles.detailQty}>{order.total_qty} шт · дедлайн {order.data?.deadline ? new Date(order.data.deadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—'}</div>

      <div className={styles.detailTimelineFull}>
        <OrderTimeline orderId={order.id} />
      </div>

      <div className={styles.detailTasks}>
        {orderTasks.map(t => {
          const ws = WORKSHOP_MAP[t.workshop_code];
          const statusColor = STATUS_COLORS_MAP[t.status] || 'var(--text-dim)';
          return (
            <div key={t.id} className={styles.detailTaskRow}>
              <span
                className={styles.detailWsDot}
                style={{ background: ws?.color || '#ccc' }}
              />
              <span className={styles.detailWsName}>{ws?.name || t.workshop_code}</span>
              <span className={styles.detailTaskStatus} style={{ color: statusColor }}>
                {STATUS_LABELS[t.status] || t.status}
              </span>
              {t.handoff_note && (
                <span className={styles.detailTaskNote}>💬 {t.handoff_note}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────

function Column({ status, orders, tasks, selectedId, onSelect }) {
  const isProduction = status === 'production';
  const headerColor = COLUMN_HEADER_COLORS[status];
  const bgColor = COLUMN_COLORS[status];

  return (
    <div className={styles.column} style={{ background: bgColor }}>
      <div className={styles.colHeader} style={{ background: headerColor }}>
        <span className={styles.colTitle}>{COLUMN_LABELS[status]}</span>
        <span className={styles.colCount}>{orders.length}</span>
      </div>
      <div className={styles.colCards}>
        {orders.length === 0 && (
          <div className={styles.colEmpty}>Нет заказов</div>
        )}
        {orders.map(order => (
          <KanbanCard
            key={order.id}
            order={order}
            isProduction={isProduction}
            tasks={tasks}
            isSelected={selectedId === order.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

// ─── KanbanMock (root) ────────────────────────────────────────────────────────

export default function KanbanMock() {
  const navigate = useNavigate();
  const tasks = useWorkshopStore(s => s.tasks);
  const orders = useWorkshopStore(s => s.orders);
  const [selectedId, setSelectedId] = useState(null);

  const { productionOrders, doneOrders } = useMemo(() => {
    const allOrders = Object.values(orders);
    const productionOrders = allOrders.filter(o => {
      const orderTasks = tasks.filter(t => t.order_id === o.id);
      return !orderTasks.every(t => t.status === 'done');
    });
    const doneOrders = allOrders.filter(o => {
      const orderTasks = tasks.filter(t => t.order_id === o.id);
      return orderTasks.length > 0 && orderTasks.every(t => t.status === 'done');
    });
    return { productionOrders, doneOrders };
  }, [tasks, orders]);

  const selectedOrder = selectedId ? orders[selectedId] : null;

  function handleSelect(id) {
    setSelectedId(v => v === id ? null : id);
  }

  return (
    <div className={styles.root}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.headerTitle}>KANBAN</h1>
          <span className={styles.headerSub}>Production Integration Mock</span>
        </div>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← К цехам
        </button>
      </header>

      {/* Board */}
      <div className={styles.boardWrap}>
        <div className={styles.board}>
          <Column status="draft"      orders={MOCK_DRAFT}      tasks={tasks} selectedId={selectedId} onSelect={handleSelect} />
          <Column status="review"     orders={MOCK_REVIEW}     tasks={tasks} selectedId={selectedId} onSelect={handleSelect} />
          <Column status="approved"   orders={MOCK_APPROVED}   tasks={tasks} selectedId={selectedId} onSelect={handleSelect} />
          <Column status="production" orders={productionOrders} tasks={tasks} selectedId={selectedId} onSelect={handleSelect} />
          <Column status="done"       orders={doneOrders}      tasks={tasks} selectedId={selectedId} onSelect={handleSelect} />
        </div>

        {/* Detail panel */}
        {selectedOrder && (
          <ProductionDetail
            order={selectedOrder}
            tasks={tasks}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}
