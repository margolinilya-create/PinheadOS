import { useState, memo } from 'react';
import { STATUS_LIST, STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { TYPE_NAMES, FABRIC_NAMES, TECH_NAMES } from '../../data';
import { getDeadlineInfo } from '../../utils/deadline';
import { confirm } from '../../store/useConfirmStore';
import styles from './KanbanBoard.module.css';

function getInitials(name) {
  if (!name?.trim()) return null;
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const FINAL_STATUSES = ['done'];

const KanbanCard = memo(function KanbanCard({ order, statusColor, onStatusChange, onDelete, onDuplicate, onOpenTZ, onCardClick }) {
  const [showMenu, setShowMenu] = useState(false);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const currentIdx = STATUS_LIST.indexOf(order.status);
      const newIdx = e.key === 'ArrowRight'
        ? Math.min(currentIdx + 1, STATUS_LIST.length - 1)
        : Math.max(currentIdx - 1, 0);
      if (newIdx !== currentIdx) {
        onStatusChange(order.id, STATUS_LIST[newIdx]);
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      onCardClick(order);
    }
  };

  const d = order.data || {};
  const dt = order.created_at ? new Date(order.created_at) : null;
  const dateStr = dt ? dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '';
  const bx = order.bitrix_deal || '';
  const mainNum = bx || order.order_number || '—';
  const itemKey = (order.item_type || '').toLowerCase();
  const skuName = d.sku ? d.sku.name : (TYPE_NAMES[itemKey] || TYPE_NAMES[order.item_type] || order.item_type || '—');
  const fabricName = d.fabric ? (FABRIC_NAMES[d.fabric] || d.fabric) : '';
  const techName = d.tech ? (TECH_NAMES[d.tech] || d.tech) : '';
  const isUrgent = d.priority === 'urgent';
  const dlInfo = getDeadlineInfo(d.deadline);
  const managerInitials = getInitials(d.managerName);

  const stopAndRun = (fn) => (e) => { e.stopPropagation(); fn(); };

  return (
    <div
      className="kb-card"
      tabIndex={0}
      role="article"
      aria-label={`Заказ ${order.order_number || order.id}, статус: ${STATUS_LABELS[order.status]}`}
      onKeyDown={handleKeyDown}
      style={isUrgent ? { borderTop: '2px solid #e53e3e' } : undefined}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', String(order.id));
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.classList.add('dragging');
      }}
      onDragEnd={e => {
        e.currentTarget.classList.remove('dragging');
      }}
      onClick={() => onCardClick(order)}
    >
      <div className="kb-card-bar" style={{ background: statusColor.bar }} />
      <div className="kb-card-content">
        <div className="kb-card-top">
          <div className="kb-card-id">
            {mainNum}
            {bx && <span className="bx-tag">BX</span>}
          </div>
          <div className={styles.rowFlexGap6}>
            {dlInfo && (
              <span className="kb-deadline-badge" style={{
                background: dlInfo.color, color: dlInfo.color === '#888' ? '#444' : '#fff',
              }}>
                {dlInfo.label}
              </span>
            )}
            <div className="kb-card-date">{dateStr}</div>
          </div>
        </div>
        <div className="kb-card-client">{d.name || '—'}</div>
        <div className="kb-card-meta">
          <div className="kb-card-sku">{skuName}{fabricName ? ' · ' + fabricName : ''}</div>
          {techName && (
            <div className="kb-card-row">
              <span>{techName}</span>
              <strong>{order.total_qty || 0} шт</strong>
            </div>
          )}
          {!techName && (order.total_qty > 0) && (
            <div className="kb-card-row">
              <span>&nbsp;</span>
              <strong>{order.total_qty} шт</strong>
            </div>
          )}
        </div>
        <div className="kb-card-bottom">
          <div className="kb-card-sum">{(order.total_sum || 0).toLocaleString('ru-RU')} ₽</div>
          <div className={styles.rowFlexGap4}>
            <div className="kb-card-actions">
              <button className="kb-open" onClick={stopAndRun(() => onOpenTZ(order))}>Открыть</button>
              <button onClick={stopAndRun(() => onDuplicate(order))} title="Дублировать" aria-label="Дублировать заказ">⎘</button>
              <button onClick={stopAndRun(async () => { const ok = await confirm({ title: `Удалить заказ #${order.order_number || order.id}?`, message: 'Это действие нельзя отменить.', variant: 'danger', confirmLabel: 'Удалить' }); if (ok) onDelete(order.id); })} title="Удалить" aria-label="Удалить заказ">✕</button>
            </div>
            {managerInitials && <div className="kb-avatar" title={d.managerName || ''}>{managerInitials}</div>}
          </div>
        </div>
        {/* Mobile status select */}
        <select
          className="mobile-status-select"
          value={order.status}
          aria-label="Изменить статус заказа"
          onClick={e => e.stopPropagation()}
          onChange={e => {
            e.stopPropagation();
            const newStatus = e.target.value;
            if (newStatus === order.status) return;
            if (FINAL_STATUSES.includes(newStatus)) {
              const confirmed = window.confirm(`Перевести заказ в статус «${STATUS_LABELS[newStatus]}»?`);
              if (!confirmed) { e.target.value = order.status; return; }
            }
            onStatusChange(order.id, newStatus);
          }}
        >
          {STATUS_LIST.map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      <button className="kb-card-menu-btn" onClick={stopAndRun(() => setShowMenu(!showMenu))} aria-label="Меню действий">•••</button>
      {showMenu && (
        <>
          <div className="kb-card-menu-backdrop" onClick={stopAndRun(() => setShowMenu(false))} />
          <div className="kb-card-menu">
            {STATUS_LIST.filter(s => s !== order.status).map(s => (
              <button key={s} onClick={stopAndRun(() => { onStatusChange(order.id, s); setShowMenu(false); })}>
                <span className="kb-status-dot" style={{ background: STATUS_COLORS[s].bar }} />
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
});

export default KanbanCard;
