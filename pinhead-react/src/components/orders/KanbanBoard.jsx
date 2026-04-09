import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrdersStore, STATUS_LIST, STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { TYPE_NAMES, FABRIC_NAMES, TECH_NAMES } from '../../data';
import { toast } from '../../store/useToastStore';
import { useCommentsStore } from '../../store/useCommentsStore';
import { useAuthStore } from '../../store/useAuthStore';
import { getDeadlineInfo } from '../../utils/deadline';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { confirm } from '../../store/useConfirmStore';
import styles from './KanbanBoard.module.css';

/* ── helpers ── */
function getInitials(name) {
  if (!name?.trim()) return null;
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/* ── KanbanCard ── */
const KanbanCard = memo(function KanbanCard({ order, statusColor, onStatusChange, onDelete, onDuplicate, onOpenTZ, onCardClick }) {
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
  const managerInitials = getInitials(d.managerName);

  const stopAndRun = (fn) => (e) => { e.stopPropagation(); fn(); };

  return (
    <div
      className="kb-card"
      style={isUrgent ? { borderTop: '2px solid #e53e3e' } : undefined}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', String(order.id));
        e.dataTransfer.effectAllowed = 'move';
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
        {/* Mobile status select — visible only on ≤768px via CSS */}
        <select
          className="mobile-status-select"
          value={order.status}
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

/* ── OrderDrawer ── */
const OrderDrawer = memo(function OrderDrawer({ order, onClose, onStatusChange, onOpenTZ, onDuplicate }) {
  const d = order.data || {};
  const itemKey = (order.item_type || '').toLowerCase();
  const skuName = d.sku ? d.sku.name : (TYPE_NAMES[itemKey] || TYPE_NAMES[order.item_type] || order.item_type || '—');
  const fabricName = d.fabric ? (FABRIC_NAMES[d.fabric] || d.fabric) : '';
  const techName = d.tech ? (TECH_NAMES[d.tech] || d.tech) : '';
  const dlInfo = getDeadlineInfo(d.deadline);
  const { comments, loading: commentsLoading, fetchComments, addComment } = useCommentsStore(
    useShallow(s => ({ comments: s.comments, loading: s.loading, fetchComments: s.fetchComments, addComment: s.addComment }))
  );
  const user = useAuthStore(useShallow(s => s.user));
  const [commentText, setCommentText] = useState('');
  const orderComments = comments[order.id] || [];

  useEffect(() => { fetchComments(order.id); }, [order.id, fetchComments]);

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

  const panelRef = useFocusTrap(true, onClose);

  return (
    <div className="exp-overlay" onClick={onClose}>
      <div ref={panelRef} className={`exp-panel ${styles.drawerPanel}`} role="dialog" aria-modal="true" aria-label="Детали заказа" onClick={e => e.stopPropagation()}>
        <div className="exp-header">
          <div className={styles.rowFlexGap10}>
            <span className="exp-title">{order.order_number || '—'}</span>
            <span className="kb-status-badge" style={{
              background: (STATUS_COLORS[order.status] || STATUS_COLORS.draft).bg,
              color: (STATUS_COLORS[order.status] || STATUS_COLORS.draft).text,
            }}>
              {STATUS_LABELS[order.status] || order.status}
            </span>
          </div>
          <button className="exp-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className="exp-body">
          <div className={styles.drawerTitle}>
            {d.name || '—'}
            {d.company && <span className={styles.drawerCompany}>· {d.company}</span>}
          </div>

          <div className="kb-drawer-section-label">ИЗДЕЛИЕ</div>
          {d.items?.length > 1 ? (
            d.items.map((it, i) => (
              <div key={i} className={styles.drawerItemRow}>
                {i + 1}. {it.sku?.name || it.type || '—'}
                {it.fabric ? ' · ' + (FABRIC_NAMES[it.fabric] || it.fabric) : ''}
                {' · '}{Object.values(it.sizes || {}).reduce((a, b) => a + (b || 0), 0)} шт
              </div>
            ))
          ) : (
            <div className="kb-drawer-section-value">{skuName}{fabricName ? ' · ' + fabricName : ''}</div>
          )}

          <div className="kb-drawer-section-label">ТИРАЖ</div>
          <div className="kb-drawer-section-value">
            {order.total_qty || 0} шт · {(order.total_sum || 0).toLocaleString('ru-RU')} ₽
          </div>

          {(d.contact || d.phone || d.email) && (
            <>
              <div className="kb-drawer-section-label">КОНТАКТЫ</div>
              <div className={`kb-drawer-section-value ${styles.drawerSectionFs13}`}>
                {[d.contact, d.phone, d.email].filter(Boolean).join(' · ')}
              </div>
            </>
          )}

          {d.managerName && (
            <>
              <div className="kb-drawer-section-label">МЕНЕДЖЕР</div>
              <div className={`kb-drawer-section-value ${styles.drawerSectionFs13}`}>{d.managerName}</div>
            </>
          )}

          {techName && (
            <>
              <div className="kb-drawer-section-label">НАНЕСЕНИЕ</div>
              <div className="kb-drawer-section-value">{techName}</div>
            </>
          )}

          {d.deadline && (
            <>
              <div className="kb-drawer-section-label">ДЕДЛАЙН</div>
              <div className={`kb-drawer-section-value ${styles.rowFlexGap8}`}>
                {new Date(d.deadline).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })}
                {dlInfo && (
                  <span
                    className={`${styles.drawerDeadlineBadge}${dlInfo.color === '#888' ? ' ' + styles.drawerDeadlineBadgeMuted : ''}`}
                    style={{ background: dlInfo.color }}
                  >
                    {dlInfo.label}
                  </span>
                )}
              </div>
            </>
          )}

          {d.notes && (
            <>
              <div className="kb-drawer-section-label">ЗАМЕТКИ</div>
              <div className={`kb-drawer-section-value ${styles.drawerNotes}`}>{d.notes}</div>
            </>
          )}

          {d.artworkPath && (
            <>
              <div className="kb-drawer-section-label">ПАПКА С МАКЕТАМИ</div>
              <div className={styles.drawerPath}>
                <code className={styles.drawerPathCode}>{d.artworkPath}</code>
                <button className={`btn ${styles.drawerPathBtn}`}
                  onClick={() => { navigator.clipboard.writeText(d.artworkPath); toast.success('Скопировано'); }}>
                  Копировать
                </button>
              </div>
            </>
          )}

          {/* Comments */}
          <div className="kb-drawer-section-label">КОММЕНТАРИИ</div>
          <div className={styles.commentsList}>
            {commentsLoading[order.id] && <div className={styles.commentsHint}>Загрузка...</div>}
            {orderComments.length === 0 && !commentsLoading[order.id] && (
              <div className={styles.commentsHint}>Нет комментариев</div>
            )}
            {orderComments.map(c => (
              <div key={c.id} className={styles.commentRow}>
                <div className={styles.commentHead}>
                  <span className={styles.commentAuthor}>{c.author_name}</span>
                  <span className={styles.commentTime}>
                    {new Date(c.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className={styles.commentText}>{c.text}</div>
              </div>
            ))}
          </div>
          <div className={styles.commentForm}>
            <input
              type="text"
              placeholder="Добавить комментарий..."
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  addComment(order.id, commentText, user?.name || user?.email || 'Менеджер', user?.role || 'manager');
                  setCommentText('');
                }
              }}
              className={styles.commentInput}
            />
            <button
              className={`btn btn-primary ${styles.commentSubmit}`}
              onClick={() => {
                addComment(order.id, commentText, user?.name || user?.email || 'Менеджер', user?.role || 'manager');
                setCommentText('');
              }}
              aria-label="Отправить комментарий"
            >
              →
            </button>
          </div>

          {/* Status change buttons */}
          <div className="kb-drawer-section-label">СМЕНИТЬ СТАТУС</div>
          <div className={styles.statusRow}>
            {STATUS_LIST.map(s => (
              <button
                key={s}
                className={`btn${s === order.status ? ' btn-primary' : ''} ${styles.statusBtn}`}
                disabled={s === order.status}
                onClick={() => { onStatusChange(order.id, s); toast.success('Статус: ' + STATUS_LABELS[s]); }}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className={styles.actionRow}>
            <button className={`btn btn-primary ${styles.actionBtnPrimary}`} onClick={() => onOpenTZ(order)}>
              Открыть ТЗ
            </button>
            <button className={`btn ${styles.actionBtn}`} onClick={() => { onDuplicate(order); onClose(); }}>
              Дублировать
            </button>
          </div>

          {/* Keyboard hint */}
          <div className={styles.keysHint}>
            {STATUS_LIST.map((s, i) => (
              <span key={s} className={styles.keysHintItem}>
                <span className={styles.keysHintNum} style={{ color: STATUS_COLORS[s].text }}>{i + 1}</span> {STATUS_LABELS[s]}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

/* ── Final statuses that require confirmation ── */
const FINAL_STATUSES = ['done'];

/* ── Main Component ── */
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

  // Collect unique item types from orders for the filter
  const availableTypes = useMemo(() => {
    const types = new Set();
    for (const o of orders) {
      const items = o.data?.items;
      const t = items?.length > 0 ? items[0].type : (o.item_type || '');
      if (t) types.add(t);
    }
    return [...types].sort();
  }, [orders]);

  // Build columns — all statuses, sorted by date desc
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
    // Sort each column by date desc
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
      // Confirm final status transitions
      if (FINAL_STATUSES.includes(status)) {
        const confirmed = window.confirm(`Перевести заказ в статус «${STATUS_LABELS[status]}»?`);
        if (!confirmed) return;
      }
      const { error } = await updateStatus(id, status);
      if (error) {
        toast.error('Ошибка сохранения статуса');
      } else {
        toast.success('Статус: ' + (STATUS_LABELS[status] || status));
        // Update drawer if open
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
    // Only remove if actually leaving the column
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
      // Ignore if typing in input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
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
  }, [navigate]);

  return (
    <div className="kanban-page">
      {/* ── Filters bar (below shared Header) ── */}
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
                    <div className="kb-empty-col">Перетащите карточку сюда</div>
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
