import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrdersStore, STATUS_LIST, STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { TYPE_NAMES } from '../../data';
import { toast } from '../../store/useToastStore';
import styles from './KanbanBoard.module.css';
import KanbanCard from './KanbanCard';
import OrderDrawer from './OrderDrawer';

const FINAL_STATUSES = ['done'];

export default function KanbanBoard() {
  const navigate = useNavigate();
  const { orders, loading, search, setSearch, fetchOrders, updateStatus, deleteOrder, duplicateOrder, hasMore, loadingMore, fetchMoreOrders } = useOrdersStore(
    useShallow(s => ({ orders: s.orders, loading: s.loading, search: s.search, setSearch: s.setSearch,
      fetchOrders: s.fetchOrders, updateStatus: s.updateStatus, deleteOrder: s.deleteOrder,
      duplicateOrder: s.duplicateOrder, hasMore: s.hasMore, loadingMore: s.loadingMore, fetchMoreOrders: s.fetchMoreOrders }))
  );
  const loadOrder = useStore(s => s.loadOrder);

  const [drawerOrder, setDrawerOrder] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');

  const handleDuplicate = async (order) => {
    const dup = await duplicateOrder(order);
    if (dup) {
      loadOrder(dup);
      navigate('/');
      toast.success('Заказ скопирован — проверь и сохрани');
    }
  };

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const availableTypes = useMemo(() => {
    const types = new Set();
    for (const o of orders) {
      const items = o.data?.items;
      const t = items?.length > 0 ? items[0].type : (o.item_type || '');
      if (t) types.add(t);
    }
    return [...types].sort();
  }, [orders]);

  const columns = useMemo(() => {
    const cols = {};
    for (const s of STATUS_LIST) cols[s] = [];

    let list = orders;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        (o.order_number || '').toLowerCase().includes(q) ||
        (o.data?.name || '').toLowerCase().includes(q) ||
        (o.item_type || '').toLowerCase().includes(q) ||
        (o.bitrix_deal || '').toLowerCase().includes(q)
      );
    }
    if (typeFilter) {
      list = list.filter(o => {
        const items = o.data?.items;
        const t = items?.length > 0 ? items[0].type : (o.item_type || '');
        return t === typeFilter;
      });
    }

    for (const o of list) {
      const s = o.status || 'draft';
      if (cols[s]) cols[s].push(o);
    }
    for (const s of STATUS_LIST) {
      cols[s].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return cols;
  }, [orders, search, typeFilter]);

  const totalQty = orders.reduce((s, o) => s + (o.total_qty || 0), 0);
  const totalSum = orders.reduce((s, o) => s + (o.total_sum || 0), 0);

  const handleDrop = async (e, status) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const body = e.currentTarget.querySelector('.kanban-col-body');
    if (body) body.classList.remove('drag-over');

    const orderId = e.dataTransfer.getData('text/plain');
    if (!orderId) return;

    const id = Number(orderId) || orderId;
    const order = orders.find(o => String(o.id) === String(orderId));
    if (order && order.status !== status) {
      if (FINAL_STATUSES.includes(status)) {
        const confirmed = window.confirm(`Перевести заказ в статус «${STATUS_LABELS[status]}»?`);
        if (!confirmed) return;
      }
      const { error } = await updateStatus(id, status);
      if (error) {
        toast.error('Ошибка сохранения статуса');
      } else {
        toast.success('Статус: ' + (STATUS_LABELS[status] || status));
        setDrawerOrder(prev => prev && String(prev.id) === String(orderId) ? { ...prev, status } : prev);
      }
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const body = e.currentTarget.querySelector('.kanban-col-body');
    if (body) body.classList.add('drag-over');
  };

  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      const body = e.currentTarget.querySelector('.kanban-col-body');
      if (body) body.classList.remove('drag-over');
    }
  };

  const handleOpenTZ = (order) => {
    loadOrder(order);
    navigate('/print');
  };

  const handleStatusChange = useCallback((id, status) => {
    updateStatus(id, status);
    setDrawerOrder(prev => prev && prev.id === id ? { ...prev, status } : prev);
  }, [updateStatus]);

  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape' && showShortcuts) {
        setShowShortcuts(false);
        return;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        setShowShortcuts(v => !v);
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.querySelector('.kb-search')?.focus();
      }
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
        navigate('/');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, showShortcuts]);

  return (
    <div className="kanban-page">
      {/* ── Filters bar ── */}
      <div className="kb-filters-bar">
        <select
          className="kb-type-filter"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          data-testid="type-filter"
        >
          <option value="">Все типы</option>
          {availableTypes.map(t => (
            <option key={t} value={t}>{TYPE_NAMES[t] || t}</option>
          ))}
        </select>
        <input
          className="kb-search"
          placeholder="Поиск..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* ── Stats bar ── */}
      <div className="kanban-stats-bar">
        <div className="ks-item"><span className="ks-count">{orders.length}</span> заказов</div>
        <div className="ks-separator" />
        <div className="ks-item"><span className="ks-count">{totalQty.toLocaleString('ru-RU')}</span> шт</div>
        <div className="ks-separator" />
        <div className="ks-item"><span className="ks-total">{totalSum.toLocaleString('ru-RU')} ₽</span></div>
        <div className={styles.boardSpacer} />
        {STATUS_LIST.map(s => {
          const count = columns[s].length;
          return count > 0 ? (
            <div key={s} className="ks-item">
              <span className="ks-dot" style={{ background: STATUS_COLORS[s].bar }} />
              <span className="ks-count" style={{ color: STATUS_COLORS[s].bar }}>{count}</span>
            </div>
          ) : null;
        })}
      </div>

      {/* ── Board ── */}
      {loading ? (
        <div className={`kb-empty-col ${styles.loadingCol}`}>Загрузка...</div>
      ) : (
        <div className="kanban-board">
          {STATUS_LIST.map(s => {
            const colSum = columns[s].reduce((a, o) => a + (o.total_sum || 0), 0);
            return (
              <div
                key={s}
                className="kanban-col"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={e => handleDrop(e, s)}
              >
                <div className="kanban-col-header" style={{ borderColor: STATUS_COLORS[s].bar }}>
                  <span className="kanban-col-title" style={{ color: STATUS_COLORS[s].text }}>{STATUS_LABELS[s]}</span>
                  {colSum > 0 && <span className="kanban-col-sum">{colSum.toLocaleString('ru-RU')} ₽</span>}
                  <span className="kanban-col-count" style={{ background: STATUS_COLORS[s].bar }}>{columns[s].length}</span>
                </div>
                <div className="kanban-col-body">
                  {columns[s].length === 0 ? (
                    <div className="kb-empty-col">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </div>
                  ) : (
                    columns[s].map(o => (
                      <KanbanCard
                        key={o.id} order={o} statusColor={STATUS_COLORS[s]}
                        onStatusChange={handleStatusChange} onDelete={deleteOrder} onDuplicate={handleDuplicate}
                        onOpenTZ={handleOpenTZ} onCardClick={setDrawerOrder}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Load more ── */}
      {hasMore && (
        <div className={styles.moreRow}>
          <button
            className={`btn ${styles.moreBtn}`}
            onClick={fetchMoreOrders}
            disabled={loadingMore}
          >
            {loadingMore ? 'Загрузка...' : 'Загрузить ещё'}
          </button>
        </div>
      )}

      {/* ── Order Drawer ── */}
      {drawerOrder && (
        <OrderDrawer
          order={drawerOrder}
          onClose={() => setDrawerOrder(null)}
          onStatusChange={handleStatusChange}
          onOpenTZ={handleOpenTZ}
          onDuplicate={handleDuplicate}
        />
      )}

      {/* ── Keyboard shortcuts help ── */}
      {showShortcuts && (
        <div className={styles.shortcutsOverlay}
          role="dialog" aria-modal="true" aria-label="Горячие клавиши"
          onClick={() => setShowShortcuts(false)}>
          <div className={styles.shortcutsDialog} onClick={e => e.stopPropagation()}>
            <div className={styles.shortcutsTitle}>Горячие клавиши</div>
            <div className={styles.shortcutsList}>
              <div><kbd className={styles.shortcutsKey}>/</kbd> — Поиск</div>
              <div><kbd className={styles.shortcutsKey}>n</kbd> — Новый заказ</div>
              <div><kbd className={styles.shortcutsKey}>1-5</kbd> — Статус (в карточке)</div>
              <div><kbd className={styles.shortcutsKey}>Esc</kbd> — Закрыть</div>
              <div><kbd className={styles.shortcutsKey}>?</kbd> — Эта справка</div>
            </div>
            <button className={`btn ${styles.shortcutsCloseBtn}`} onClick={() => setShowShortcuts(false)}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
}
