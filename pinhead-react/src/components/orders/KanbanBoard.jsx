import { useEffect, useState } from 'react';
import { useOrdersStore, STATUS_LIST, STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { TYPE_NAMES, FABRIC_NAMES, TECH_NAMES } from '../../data';

function KanbanCard({ order, onStatusChange, onDelete, onDuplicate }) {
  const [showMenu, setShowMenu] = useState(false);
  const d = order.data || {};
  const date = order.created_at ? new Date(order.created_at).toLocaleDateString('ru-RU') : '';

  return (
    <div
      className="kb-card"
      draggable
      onDragStart={e => e.dataTransfer.setData('orderId', String(order.id))}
    >
      <div className="kb-card-head">
        <span className="kb-card-id">{order.order_number || '—'}</span>
        <span className="kb-card-date">{date}</span>
      </div>
      {d.name && <div className="kb-card-client">{d.name}</div>}
      <div className="kb-card-info">
        {d.type && <span>{TYPE_NAMES[d.type] || d.type}</span>}
        {d.fabric && <span>{FABRIC_NAMES[d.fabric] || d.fabric}</span>}
      </div>
      {order.total_qty > 0 && (
        <div className="kb-card-qty">{order.total_qty} шт</div>
      )}
      {order.total_sum > 0 && (
        <div className="kb-card-sum">{Number(order.total_sum).toLocaleString('ru-RU')} ₽</div>
      )}
      <div className="kb-card-actions">
        <button className="kb-card-btn" onClick={() => setShowMenu(!showMenu)}>•••</button>
        {showMenu && (
          <div className="kb-card-menu">
            {STATUS_LIST.filter(s => s !== order.status).map(s => (
              <button key={s} onClick={() => { onStatusChange(order.id, s); setShowMenu(false); }}>
                <span className="kb-status-dot" style={{ background: STATUS_COLORS[s] }} />
                {STATUS_LABELS[s]}
              </button>
            ))}
            <div className="kb-menu-sep" />
            <button onClick={() => { onDuplicate(order); setShowMenu(false); }}>Дублировать</button>
            <button className="kb-menu-danger" onClick={() => { onDelete(order.id); setShowMenu(false); }}>Удалить</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function KanbanBoard({ onClose }) {
  const { orders, loading, filter, search, setFilter, setSearch, fetchOrders, updateStatus, deleteOrder, duplicateOrder, getFiltered } = useOrdersStore();

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const filtered = getFiltered();

  // Группировка по статусу
  const columns = {};
  for (const s of STATUS_LIST) columns[s] = [];
  for (const o of filtered) {
    const s = o.status || 'draft';
    if (columns[s]) columns[s].push(o);
  }

  // Статистика
  const totalQty = orders.reduce((s, o) => s + (o.total_qty || 0), 0);
  const totalSum = orders.reduce((s, o) => s + (o.total_sum || 0), 0);

  const handleDrop = (e, status) => {
    e.preventDefault();
    const orderId = e.dataTransfer.getData('orderId');
    if (orderId) updateStatus(Number(orderId) || orderId, status);
  };

  return (
    <div className="kb-overlay">
      <div className="kb-panel">
        <div className="kb-header">
          <div className="kb-header-left">
            <span className="kb-title">Заказы</span>
            <span className="kb-count">{orders.length}</span>
          </div>
          <div className="kb-header-right">
            <input
              className="kb-search"
              placeholder="Поиск..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button className="kb-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="kb-stats">
          <span>Заказов: <b>{orders.length}</b></span>
          <span>Тираж: <b>{totalQty.toLocaleString('ru-RU')}</b> шт</span>
          <span>Сумма: <b>{totalSum.toLocaleString('ru-RU')} ₽</b></span>
          <div className="kb-stats-dots">
            {STATUS_LIST.map(s => {
              const count = orders.filter(o => o.status === s).length;
              return count > 0 ? (
                <span key={s} className="kb-stat-dot" style={{ background: STATUS_COLORS[s] }} title={`${STATUS_LABELS[s]}: ${count}`}>
                  {count}
                </span>
              ) : null;
            })}
          </div>
        </div>

        <div className="kb-filters">
          <button className={`kb-filter${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>Все</button>
          {STATUS_LIST.map(s => (
            <button
              key={s}
              className={`kb-filter${filter === s ? ' active' : ''}`}
              onClick={() => setFilter(s)}
              style={filter === s ? { borderColor: STATUS_COLORS[s], color: STATUS_COLORS[s] } : {}}
            >
              <span className="kb-status-dot" style={{ background: STATUS_COLORS[s] }} />
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="kb-loading">Загрузка заказов...</div>
        ) : filter !== 'all' ? (
          // Фильтрованный вид — список
          <div className="kb-list">
            {filtered.length === 0 ? (
              <div className="kb-empty">Нет заказов</div>
            ) : (
              filtered.map(o => (
                <KanbanCard
                  key={o.id}
                  order={o}
                  onStatusChange={updateStatus}
                  onDelete={deleteOrder}
                  onDuplicate={duplicateOrder}
                />
              ))
            )}
          </div>
        ) : (
          // Канбан-доска
          <div className="kb-board">
            {STATUS_LIST.map(s => (
              <div
                key={s}
                className="kb-column"
                onDragOver={e => e.preventDefault()}
                onDrop={e => handleDrop(e, s)}
              >
                <div className="kb-col-header">
                  <span className="kb-col-dot" style={{ background: STATUS_COLORS[s] }} />
                  <span className="kb-col-name">{STATUS_LABELS[s]}</span>
                  <span className="kb-col-count">{columns[s].length}</span>
                </div>
                <div className="kb-col-cards">
                  {columns[s].map(o => (
                    <KanbanCard
                      key={o.id}
                      order={o}
                      onStatusChange={updateStatus}
                      onDelete={deleteOrder}
                      onDuplicate={duplicateOrder}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
