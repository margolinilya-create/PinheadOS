import { useParams, Link } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { ScreenSkeleton } from '../components/ErpSkeletons';
import InlineEdit from '../components/InlineEdit';
import { formatDateShort } from '../utils/time';
import {
  ORDER_STATUS_LABELS,
  SHIPPED_STATUS_LABELS,
  MATERIAL_STATUS_LABELS,
  PACKAGING_LABELS,
  STICKERS_LABELS,
} from '../types';
import styles from '../erp.module.css';
import { fmt, fmtTs } from './orderCard/format';
import { OrderItemSection } from './orderCard/OrderItemSection';
import { CommentsSection } from './orderCard/CommentsSection';
import { HistorySection } from './orderCard/HistorySection';
import { NotificationsSection } from './orderCard/NotificationsSection';
import { useOrderDetail } from './orderCard/useOrderDetail';

/**
 * Карточка заказа (страница /orders/:id) — «трекинг посылки»: маршрут по этапам с план/фактом,
 * материалы, история. Общая логика — в useOrderDetail (её же использует боковой OrderDrawer).
 */
export default function OrderCard() {
  const { orderId } = useParams();
  const {
    order, notFound, events, audit, comments, preview, previewError, setPreviewErrorFor,
    saveOrderField, onSavePlan, onSendComment, readyToShip, shippedByName,
    deptById, deptNameById, stageById,
  } = useOrderDetail(orderId);

  if (notFound) {
    return (
      <>
        <PageHead title="Заказ не найден" />
        <Link to="/orders" className="btn btn-secondary">← К списку заказов</Link>
      </>
    );
  }
  if (!order) return <ScreenSkeleton />;

  return (
    <>
      <div className={styles.toolbar} style={{ marginBottom: 4 }}>
        <Link to="/orders" className={styles.subText}>← Заказы</Link>
      </div>
      <PageHead title={`${order.bitrix_id ? `№${order.bitrix_id} · ` : ''}${order.title}`} />
      <div className={styles.toolbar} style={{ gap: 18, marginTop: -8 }}>
        <span>
          <span className={styles.subText}>Менеджер: </span>
          <InlineEdit value={order.manager} ariaLabel="Менеджер" onSave={(v) => saveOrderField({ manager: v })} />
        </span>
        <span>
          <span className={styles.subText}>Запуск: </span>
          <InlineEdit type="date" value={order.launch_date} format={fmt} ariaLabel="Дата запуска" onSave={(v) => saveOrderField({ launch_date: v })} />
        </span>
        <span>
          <span className={styles.subText}>Срок клиента: </span>
          <InlineEdit type="date" value={order.due_date} format={fmt} ariaLabel="Срок клиента" onSave={(v) => saveOrderField({ due_date: v })} />
        </span>
        <span>
          <span className={styles.subText}>Заметка: </span>
          <InlineEdit value={order.notes === 'imported' ? null : order.notes} placeholder="добавить…" ariaLabel="Заметка" onSave={(v) => saveOrderField({ notes: v })} />
        </span>
      </div>
      {preview && !previewError && (
        <img
          src={preview} alt={`Превью заказа «${order.title}»`}
          onError={() => setPreviewErrorFor(orderId)}
          style={{ maxHeight: 140, maxWidth: 260, borderRadius: 8, border: '1px solid var(--border-light)', marginBottom: 10, objectFit: 'contain' }}
        />
      )}
      {preview && previewError && (
        <div className={styles.queueThumbStub} style={{ marginBottom: 10 }} role="img" aria-label="Превью не загрузилось" title="Превью не загрузилось">🖼</div>
      )}
      <div className={styles.toolbar}>
        <span className={`${styles.chip} ${order.status === 'active' ? styles.chipProgress : styles.chipNeutral}`}>{ORDER_STATUS_LABELS[order.status]}</span>
        {readyToShip && <span className={`${styles.chip} ${styles.chipReady}`}>✅ Готов к отгрузке</span>}
        <span className={`${styles.chip} ${order.shipped_status === 'shipped' ? styles.chipReady : styles.chipNeutral}`}>{SHIPPED_STATUS_LABELS[order.shipped_status]}</span>
        {readyToShip && order.shipped_status !== 'shipped' && <span className={styles.subText}>🚚 Отгрузка — во вкладке «Склад»</span>}
        {order.shipped_at && <span className={styles.subText}>Отгружен {fmtTs(order.shipped_at)}{shippedByName ? ` · ${shippedByName}` : ''}</span>}
        {order.delivered_at && <span className={styles.subText}>сдан {fmt(order.delivered_at)}</span>}
        {order.packaging && order.packaging !== 'none' && (
          <span className={`${styles.chip} ${styles.chipNeutral}`}>📦 {PACKAGING_LABELS[order.packaging]}{order.packaging_note ? `: ${order.packaging_note}` : ''}</span>
        )}
        {order.stickers && order.stickers !== 'none' && (
          <span className={`${styles.chip} ${styles.chipNeutral}`}>🏷 Стикеры: {STICKERS_LABELS[order.stickers]}{order.stickers_note ? ` — ${order.stickers_note}` : ''}</span>
        )}
        {order.no_chestny_znak && <span className={`${styles.chip} ${styles.chipDanger}`}>Без Честного знака</span>}
      </div>

      <NotificationsSection order={order} stageById={stageById} deptById={deptById} />

      {order.items.map((item) => (
        <OrderItemSection key={item.id} item={item} order={order} deptById={deptById} deptNameById={deptNameById} events={events} onSavePlan={onSavePlan} />
      ))}

      <section className={styles.matSection}>
        <div className={styles.matSectionHead}><strong>Материалы</strong></div>
        {order.materials.length > 0 ? (
          <div className={styles.stageChips}>
            {order.materials.map((m) => {
              const pending = m.status !== 'received' && m.status !== 'not_needed';
              const eta = pending ? formatDateShort(m.eta_date) : '';
              return (
                <span key={m.id} className={`${styles.chip} ${pending ? styles.chipProgress : styles.chipReady}`}>
                  {m.name} · {MATERIAL_STATUS_LABELS[m.status]}{pending && (eta ? ` · план ${eta}` : ' · план не указан')}
                </span>
              );
            })}
          </div>
        ) : (
          <div className={styles.subText}>Материалы не ожидаются.</div>
        )}
      </section>

      <CommentsSection comments={comments} onSend={onSendComment} />

      <HistorySection events={events} audit={audit} stageById={stageById} deptById={deptById} />
    </>
  );
}
