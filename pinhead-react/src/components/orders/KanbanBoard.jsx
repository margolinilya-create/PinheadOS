import { useEffect, useState } from 'react';
import { useOrdersStore, STATUS_LIST, STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { useStore } from '../../store/useStore';
import { TYPE_NAMES, FABRIC_NAMES, TECH_NAMES } from '../../data';
import { toast } from '../shared/Toast';

function KanbanCard({ order, statusColor, onStatusChange, onDelete, onDuplicate, onOpenTZ }) {
  const [showMenu, setShowMenu] = useState(false);
  const d = order.data || {};
  const dt = order.created_at ? new Date(order.created_at) : null;
  const dateStr = dt ? dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '';
  const bx = order.bitrix_deal || '';
  const mainNum = bx || order.order_number || '—';
  const itemKey = (order.item_type || '').toLowerCase();
  const skuName = d.sku ? d.sku.name : (TYPE_NAMES[itemKey] || TYPE_NAMES[order.item_type] || order.item_type || '—');
  const fabricName = d.fabric ? (FABRIC_NAMES[d.fabric] || d.fabric) : '';
  const techName = d.tech ? (TECH_NAMES[d.tech] || d.tech) : '';

  return (
    <div
      className="kb-card"
      draggable
      onDragStart={e => e.dataTransfer.setData('orderId', String(order.id))}
    >
      <div className="kb-card-bar" style={{ background: statusColor }} />
      <div className="kb-card-content">
        <div className="kb-card-top">
          <div className="kb-card-id">
            {mainNum}
            {bx && <span className="bx-tag">BX</span>}
          </div>
          <div className="kb-card-date">{dateStr}</div>
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
        </div>
        <div className="kb-card-bottom">
          <div className="kb-card-sum">{(order.total_sum || 0).toLocaleString('ru-RU')} ₽</div>
          <div className="kb-card-actions">
            <button className="kb-open" onClick={() => onOpenTZ(order)}>Открыть</button>
            <button onClick={() => onDuplicate(order)} title="Дублировать">⎘</button>
            <button onClick={() => onDelete(order.id)} title="Удалить">✕</button>
          </div>
        </div>
      </div>

      {/* Status menu on right-click or ••• */}
      <button className="kb-card-menu-btn" onClick={() => setShowMenu(!showMenu)}>•••</button>
      {showMenu && (
        <div className="kb-card-menu">
          {STATUS_LIST.filter(s => s !== order.status).map(s => (
            <button key={s} onClick={() => { onStatusChange(order.id, s); setShowMenu(false); }}>
              <span className="kb-status-dot" style={{ background: STATUS_COLORS[s] }} />
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function KanbanBoard({ onClose, onNavigate }) {
  const { orders, loading, filter, search, setFilter, setSearch, fetchOrders, updateStatus, deleteOrder, duplicateOrder, getFiltered } = useOrdersStore();
  const loadOrder = useStore(s => s.loadOrder);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const filtered = getFiltered();

  const columns = {};
  for (const s of STATUS_LIST) columns[s] = [];
  for (const o of filtered) {
    const s = o.status || 'draft';
    if (columns[s]) columns[s].push(o);
  }
  // Sort each column by date descending
  for (const s of STATUS_LIST) {
    columns[s].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  const totalQty = orders.reduce((s, o) => s + (o.total_qty || 0), 0);
  const totalSum = orders.reduce((s, o) => s + (o.total_sum || 0), 0);

  const handleDrop = (e, status) => {
    e.preventDefault();
    e.currentTarget.querySelector('.kanban-col-body')?.classList.remove('drag-over');
    const orderId = e.dataTransfer.getData('orderId');
    if (orderId) {
      updateStatus(Number(orderId) || orderId, status);
      toast.success('Статус: ' + (STATUS_LABELS[status] || status));
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const body = e.currentTarget.querySelector('.kanban-col-body');
    if (body) body.classList.add('drag-over');
  };

  const handleDragLeave = (e) => {
    const body = e.currentTarget.querySelector('.kanban-col-body');
    if (body) body.classList.remove('drag-over');
  };

  // Open TZ: load order into store, then navigate to print preview
  const handleOpenTZ = (order) => {
    loadOrder(order);
    if (onNavigate) onNavigate('print');
  };

  // Visible statuses based on filter
  const visibleStatuses = filter === 'all' ? STATUS_LIST : [filter];

  return (
    <div className="kanban-page">
      {/* ── Header ── */}
      <div className="sku-ed-header">
        <div className="sku-ed-header-left">
          <h1 className="sku-ed-title">ЗАКАЗЫ <span>Kanban</span></h1>
        </div>
        <div className="sku-ed-header-right">
          <input
            className="kb-search"
            placeholder="Поиск..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="pe-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* ── Stats bar (black) ── */}
      <div className="kanban-stats-bar">
        <div className="ks-item"><span className="ks-count">{orders.length}</span> заказов</div>
        <div className="ks-separator" />
        <div className="ks-item"><span className="ks-count">{totalQty.toLocaleString('ru-RU')}</span> шт</div>
        <div className="ks-separator" />
        <div className="ks-item"><span className="ks-total">{totalSum.toLocaleString('ru-RU')} ₽</span></div>
        <div style={{ flex: 1 }} />
        {STATUS_LIST.map(s => {
          const count = orders.filter(o => o.status === s).length;
          return count > 0 ? (
            <div key={s} className="ks-item">
              <span className="ks-dot" style={{ background: STATUS_COLORS[s] }} />
              <span className="ks-count" style={{ color: STATUS_COLORS[s] }}>{count}</span>
            </div>
          ) : null;
        })}
      </div>

      {/* ── Filter bar ── */}
      <div className="kanban-filter-bar">
        <div className={`kanban-filter-btn${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>Все</div>
        {STATUS_LIST.map(s => (
          <div
            key={s}
            className={`kanban-filter-btn${filter === s ? ' active' : ''}`}
            onClick={() => setFilter(s)}
          >
            <span className="kf-dot" style={{ background: STATUS_COLORS[s] }} />
            {STATUS_LABELS[s]}
          </div>
        ))}
      </div>

      {/* ── Board ── */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Загрузка...</div>
      ) : (
        <div className="kanban-board">
          {visibleStatuses.map(s => {
            const colSum = columns[s].reduce((a, o) => a + (o.total_sum || 0), 0);
            return (
              <div
                key={s}
                className="kanban-col"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={e => handleDrop(e, s)}
              >
                <div className="kanban-col-header" style={{ borderColor: STATUS_COLORS[s] }}>
                  <span className="kanban-col-title" style={{ color: STATUS_COLORS[s] }}>{STATUS_LABELS[s]}</span>
                  {colSum > 0 && <span className="kanban-col-sum">{colSum.toLocaleString('ru-RU')} ₽</span>}
                  <span className="kanban-col-count" style={{ background: STATUS_COLORS[s] }}>{columns[s].length}</span>
                </div>
                <div className="kanban-col-body">
                  {columns[s].length === 0 ? (
                    <div style={{ padding: 30, textAlign: 'center', color: '#ccc', fontSize: 11, fontWeight: 600 }}>Пусто</div>
                  ) : (
                    columns[s].map(o => (
                      <KanbanCard
                        key={o.id}
                        order={o}
                        statusColor={STATUS_COLORS[s]}
                        onStatusChange={updateStatus}
                        onDelete={deleteOrder}
                        onDuplicate={duplicateOrder}
                        onOpenTZ={handleOpenTZ}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
