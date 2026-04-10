import { useEffect, useState, memo } from 'react';
import { useCommentsStore } from '../../store/useCommentsStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useShallow } from 'zustand/react/shallow';
import { STATUS_LIST, STATUS_LABELS, STATUS_COLORS } from '../../store/useOrdersStore';
import { TYPE_NAMES, FABRIC_NAMES, TECH_NAMES } from '../../data';
import { getDeadlineInfo } from '../../utils/deadline';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { toast } from '../../store/useToastStore';
import styles from './KanbanBoard.module.css';

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

export default OrderDrawer;
