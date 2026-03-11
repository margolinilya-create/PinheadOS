import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrdersStore, STATUS_LIST, STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { useStore } from '../../store/useStore';
import { TYPE_NAMES, FABRIC_NAMES, TECH_NAMES } from '../../data';
import { toast } from '../shared/Toast';

/* ── helpers ── */
function getDeadlineInfo(deadline) {
  if (!deadline) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dl = new Date(deadline);
  dl.setHours(0, 0, 0, 0);
  const diff = Math.ceil((dl - now) / 86400000);
  if (diff < 0) return { label: 'ПРОСРОЧЕН', color: '#e53e3e', urgent: true };
  if (diff <= 3) return { label: `${diff} дн`, color: '#c04500', urgent: true };
  if (diff <= 7) return { label: `${diff} дн`, color: '#b89000', urgent: false };
  return { label: dl.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }), color: '#888', urgent: false };
}

function getInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function groupByDeadlineWeek(orders) {
  const now = new Date();
  const thisWeek = getWeekStart(now);
  const nextWeek = thisWeek + 7 * 86400000;
  const groups = { thisWeek: [], nextWeek: [], later: [], noDeadline: [] };
  for (const o of orders) {
    const dl = o.data?.deadline;
    if (!dl) { groups.noDeadline.push(o); continue; }
    const ws = getWeekStart(new Date(dl));
    if (ws === thisWeek) groups.thisWeek.push(o);
    else if (ws === nextWeek) groups.nextWeek.push(o);
    else groups.later.push(o);
  }
  return groups;
}

/* ── KanbanCard ── */
function KanbanCard({ order, statusColor, onStatusChange, onDelete, onDuplicate, onOpenTZ, onOpenTechCard, onCardClick }) {
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
  const isUrgent = d.priority === 'urgent';
  const dlInfo = getDeadlineInfo(d.deadline);
  const initials = getInitials(d.name);

  const stopAndRun = (fn) => (e) => { e.stopPropagation(); fn(); };

  return (
    <div
      className="kb-card"
      style={isUrgent ? { borderTop: '2px solid #e53e3e' } : undefined}
      draggable
      onDragStart={e => e.dataTransfer.setData('orderId', String(order.id))}
      onClick={() => onCardClick(order)}
    >
      <div className="kb-card-bar" style={{ background: statusColor }} />
      <div className="kb-card-content">
        <div className="kb-card-top">
          <div className="kb-card-id">
            {mainNum}
            {bx && <span className="bx-tag">BX</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {dlInfo && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 6px',
                background: dlInfo.color, color: dlInfo.color === '#888' ? '#444' : '#fff',
                letterSpacing: '.5px',
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
        </div>
        <div className="kb-card-bottom">
          <div className="kb-card-sum">{(order.total_sum || 0).toLocaleString('ru-RU')} ₽</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div className="kb-card-actions">
              <button className="kb-open" onClick={stopAndRun(() => onOpenTZ(order))}>Открыть</button>
              {onOpenTechCard && <button onClick={stopAndRun(() => onOpenTechCard(order))} title="Техкарта">TC</button>}
              <button onClick={stopAndRun(() => onDuplicate(order))} title="Дублировать">⎘</button>
              <button onClick={stopAndRun(() => onDelete(order.id))} title="Удалить">✕</button>
            </div>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', background: '#1D19EA', color: '#fff',
              fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              {initials}
            </div>
          </div>
        </div>
      </div>

      <button className="kb-card-menu-btn" onClick={stopAndRun(() => setShowMenu(!showMenu))}>•••</button>
      {showMenu && (
        <>
          <div className="kb-card-menu-backdrop" onClick={stopAndRun(() => setShowMenu(false))} />
          <div className="kb-card-menu">
            {STATUS_LIST.filter(s => s !== order.status).map(s => (
              <button key={s} onClick={stopAndRun(() => { onStatusChange(order.id, s); setShowMenu(false); })}>
                <span className="kb-status-dot" style={{ background: STATUS_COLORS[s] }} />
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── OrderDrawer ── */
function OrderDrawer({ order, onClose, onStatusChange, onOpenTZ, onOpenTechCard, onDuplicate }) {
  const d = order.data || {};
  const itemKey = (order.item_type || '').toLowerCase();
  const skuName = d.sku ? d.sku.name : (TYPE_NAMES[itemKey] || TYPE_NAMES[order.item_type] || order.item_type || '—');
  const fabricName = d.fabric ? (FABRIC_NAMES[d.fabric] || d.fabric) : '';
  const techName = d.tech ? (TECH_NAMES[d.tech] || d.tech) : '';
  const dlInfo = getDeadlineInfo(d.deadline);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      const num = parseInt(e.key);
      if (num >= 1 && num <= 5) {
        const newStatus = STATUS_LIST[num - 1];
        if (newStatus && newStatus !== order.status) {
          onStatusChange(order.id, newStatus);
          toast.success('Статус: ' + STATUS_LABELS[newStatus]);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [order.id, order.status, onStatusChange, onClose]);

  const sectionLabel = { fontSize: 9, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase', color: '#888', marginBottom: 4, marginTop: 16 };
  const sectionValue = { fontSize: 14, fontWeight: 500, marginBottom: 4 };

  return (
    <div className="exp-overlay" onClick={onClose}>
      <div className="exp-panel" onClick={e => e.stopPropagation()} style={{ width: 380 }}>
        <div className="exp-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="exp-title">{order.order_number || '—'}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', letterSpacing: 1,
              background: STATUS_COLORS[order.status] || '#888', color: '#fff',
            }}>
              {STATUS_LABELS[order.status] || order.status}
            </span>
          </div>
          <button className="exp-close" onClick={onClose}>✕</button>
        </div>
        <div className="exp-body">
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {d.name || '—'}
            {d.company && <span style={{ fontWeight: 400, color: '#888', marginLeft: 8 }}>· {d.company}</span>}
          </div>

          <div style={sectionLabel}>ИЗДЕЛИЕ</div>
          <div style={sectionValue}>{skuName}{fabricName ? ' · ' + fabricName : ''}</div>

          <div style={sectionLabel}>ТИРАЖ</div>
          <div style={sectionValue}>
            {order.total_qty || 0} шт · {(order.total_sum || 0).toLocaleString('ru-RU')} ₽
          </div>

          {techName && (
            <>
              <div style={sectionLabel}>НАНЕСЕНИЕ</div>
              <div style={sectionValue}>{techName}</div>
            </>
          )}

          {d.deadline && (
            <>
              <div style={sectionLabel}>ДЕДЛАЙН</div>
              <div style={{ ...sectionValue, display: 'flex', alignItems: 'center', gap: 8 }}>
                {new Date(d.deadline).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })}
                {dlInfo && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', background: dlInfo.color, color: dlInfo.color === '#888' ? '#444' : '#fff' }}>
                    {dlInfo.label}
                  </span>
                )}
              </div>
            </>
          )}

          {d.notes && (
            <>
              <div style={sectionLabel}>ЗАМЕТКИ</div>
              <div style={{ ...sectionValue, fontSize: 13, color: '#444', whiteSpace: 'pre-wrap' }}>{d.notes}</div>
            </>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 0, marginTop: 24, border: '1.5px solid #000', overflow: 'hidden' }}>
            <button className="btn btn-primary" style={{ flex: 1, borderRight: '1px solid rgba(255,255,255,.2)' }} onClick={() => onOpenTZ(order)}>
              Открыть ТЗ
            </button>
            {onOpenTechCard && (
              <button className="btn" style={{ flex: 1 }} onClick={() => onOpenTechCard(order)}>
                Техкарта
              </button>
            )}
            <button className="btn" style={{ flex: 1 }} onClick={() => { onDuplicate(order); onClose(); }}>
              Дублировать
            </button>
          </div>

          {/* Keyboard hint */}
          <div style={{ marginTop: 16, fontSize: 10, color: '#888', textAlign: 'center', letterSpacing: .5 }}>
            {STATUS_LIST.map((s, i) => (
              <span key={s} style={{ marginRight: 8 }}>
                <span style={{ fontWeight: 900, color: STATUS_COLORS[s] }}>{i + 1}</span> {STATUS_LABELS[s]}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ── */
export default function KanbanBoard({ onOpenTechCard }) {
  const navigate = useNavigate();
  const onClose = () => navigate('/');
  const { orders, loading, filter, search, setFilter, setSearch, fetchOrders, updateStatus, deleteOrder, duplicateOrder, getFiltered } = useOrdersStore();
  const loadOrder = useStore(s => s.loadOrder);

  const [drawerOrder, setDrawerOrder] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [sortMode, setSortMode] = useState('date-desc');

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Get unique item types from orders
  const itemTypes = useMemo(() => {
    const types = new Set();
    orders.forEach(o => { if (o.item_type) types.add(o.item_type); });
    return Array.from(types);
  }, [orders]);

  const hasUrgent = useMemo(() => orders.some(o => o.data?.priority === 'urgent'), [orders]);

  // Apply filters on top of store's getFiltered()
  const filtered = useMemo(() => {
    let result = getFiltered();
    if (typeFilter !== 'all') result = result.filter(o => o.item_type === typeFilter);
    if (urgentOnly) result = result.filter(o => o.data?.priority === 'urgent');
    return result;
  }, [getFiltered, typeFilter, urgentOnly]);

  // Sort function
  const sortOrders = useCallback((arr) => {
    const sorted = [...arr];
    switch (sortMode) {
      case 'date-asc': sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); break;
      case 'sum-desc': sorted.sort((a, b) => (b.total_sum || 0) - (a.total_sum || 0)); break;
      default: sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return sorted;
  }, [sortMode]);

  // Build columns
  const columns = useMemo(() => {
    const cols = {};
    for (const s of STATUS_LIST) cols[s] = [];
    for (const o of filtered) {
      const s = o.status || 'draft';
      if (cols[s]) cols[s].push(o);
    }
    for (const s of STATUS_LIST) cols[s] = sortOrders(cols[s]);
    return cols;
  }, [filtered, sortOrders]);

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

  const handleOpenTZ = (order) => {
    loadOrder(order);
    navigate('/print');
  };

  const handleStatusChange = useCallback((id, status) => {
    updateStatus(id, status);
    // Update drawer if open
    setDrawerOrder(prev => prev && prev.id === id ? { ...prev, status } : prev);
  }, [updateStatus]);

  const visibleStatuses = filter === 'all' ? STATUS_LIST : [filter];

  // Render column body — with week grouping for production
  const renderColumnBody = (status, items) => {
    if (items.length === 0) {
      return <div style={{ padding: 30, textAlign: 'center', color: '#ccc', fontSize: 11, fontWeight: 600 }}>Пусто</div>;
    }

    if (status === 'production') {
      const groups = groupByDeadlineWeek(items);
      const sections = [
        { key: 'thisWeek', label: 'ЭТА НЕДЕЛЯ', items: groups.thisWeek },
        { key: 'nextWeek', label: 'СЛЕДУЮЩАЯ НЕДЕЛЯ', items: groups.nextWeek },
        { key: 'later', label: 'ПОЗЖЕ', items: groups.later },
        { key: 'noDeadline', label: 'БЕЗ ДЕДЛАЙНА', items: groups.noDeadline },
      ].filter(s => s.items.length > 0);

      return sections.map(section => (
        <div key={section.key}>
          <div className="garment-sep" style={{ marginBottom: 4 }}>
            <span className="garment-sep-text">{section.label}</span>
            <span className="garment-sep-line" />
          </div>
          {section.items.map(o => (
            <KanbanCard
              key={o.id} order={o} statusColor={STATUS_COLORS[status]}
              onStatusChange={handleStatusChange} onDelete={deleteOrder} onDuplicate={duplicateOrder}
              onOpenTZ={handleOpenTZ} onOpenTechCard={onOpenTechCard} onCardClick={setDrawerOrder}
            />
          ))}
        </div>
      ));
    }

    return items.map(o => (
      <KanbanCard
        key={o.id} order={o} statusColor={STATUS_COLORS[status]}
        onStatusChange={handleStatusChange} onDelete={deleteOrder} onDuplicate={duplicateOrder}
        onOpenTZ={handleOpenTZ} onOpenTechCard={onOpenTechCard} onCardClick={setDrawerOrder}
      />
    ));
  };

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

      {/* ── Stats bar ── */}
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

      {/* ── Filter bar: status ── */}
      <div className="kanban-filter-bar">
        <div className={`kanban-filter-btn${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>Все</div>
        {STATUS_LIST.map(s => (
          <div key={s} className={`kanban-filter-btn${filter === s ? ' active' : ''}`} onClick={() => setFilter(s)}>
            <span className="kf-dot" style={{ background: STATUS_COLORS[s] }} />
            {STATUS_LABELS[s]}
          </div>
        ))}
      </div>

      {/* ── Filter bar 2: type + urgent + sort ── */}
      <div className="kanban-filter-bar">
        <div className={`kanban-filter-btn${typeFilter === 'all' ? ' active' : ''}`} onClick={() => setTypeFilter('all')}>
          Все типы
        </div>
        {itemTypes.map(t => (
          <div key={t} className={`kanban-filter-btn${typeFilter === t ? ' active' : ''}`} onClick={() => setTypeFilter(t)}>
            {TYPE_NAMES[t] || TYPE_NAMES[t.toLowerCase()] || t}
          </div>
        ))}
        <div style={{ width: 1, height: 16, background: '#ccc', flexShrink: 0 }} />
        <div
          className={`kanban-filter-btn${urgentOnly ? ' active' : ''}`}
          onClick={() => setUrgentOnly(!urgentOnly)}
          style={{ position: 'relative' }}
        >
          {hasUrgent && !urgentOnly && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e53e3e', position: 'absolute', top: 4, right: 4 }} />
          )}
          Срочные
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <div className={`kanban-filter-btn${sortMode === 'date-desc' ? ' active' : ''}`} onClick={() => setSortMode('date-desc')}>Новые</div>
          <div className={`kanban-filter-btn${sortMode === 'date-asc' ? ' active' : ''}`} onClick={() => setSortMode('date-asc')}>Старые</div>
          <div className={`kanban-filter-btn${sortMode === 'sum-desc' ? ' active' : ''}`} onClick={() => setSortMode('sum-desc')}>По сумме</div>
        </div>
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
                  {renderColumnBody(s, columns[s])}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Order Drawer ── */}
      {drawerOrder && (
        <OrderDrawer
          order={drawerOrder}
          onClose={() => setDrawerOrder(null)}
          onStatusChange={handleStatusChange}
          onOpenTZ={handleOpenTZ}
          onOpenTechCard={onOpenTechCard}
          onDuplicate={duplicateOrder}
        />
      )}
    </div>
  );
}
