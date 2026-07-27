import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Drawer } from '../../components/Drawer';
import { Badge } from '../../components/Badge';
import { Skeleton } from '../../../components/shared/Skeleton';
import InlineEdit from '../../components/InlineEdit';
import { formatDateShort } from '../../utils/time';
import { orderProgress } from '../../utils/progress';
import {
  ORDER_STATUS_LABELS,
  SHIPPED_STATUS_LABELS,
  MATERIAL_STATUS_LABELS,
  PACKAGING_LABELS,
  STICKERS_LABELS,
} from '../../types';
import styles from '../../erp.module.css';
import { FilesSection } from './FilesSection';
import { fmt, fmtTs } from './format';
import { OrderItemSection } from './OrderItemSection';
import { CommentsSection } from './CommentsSection';
import { HistorySection } from './HistorySection';
import { NotificationsSection } from './NotificationsSection';
import { TzBlock } from '../queue/TzBlock';
import { TzDocsSection, TzMissingBanner } from './TzDocsSection';
import { useOrderDetail } from './useOrderDetail';

/**
 * Боковая карточка заказа (редизайн): те же данные, что и страница /orders/:id, но в правом
 * Drawer с вкладками — открывается из канбана/таблицы/очереди без ухода с экрана. Вся логика
 * общая с OrderCard (useOrderDetail); контент разбит по вкладкам Информация/Маршрут/Материалы/
 * ТЗ/Файлы/Комментарии/История. Ссылка «Открыть на странице» ведёт на полный маршрут (диплинк).
 */

const TABS = [
  { key: 'info', label: 'Информация' },
  { key: 'route', label: 'Маршрут' },
  { key: 'materials', label: 'Материалы' },
  { key: 'tz', label: 'ТЗ' },
  { key: 'files', label: 'Файлы' },
  { key: 'comments', label: 'Комментарии' },
  { key: 'history', label: 'История' },
];


export function OrderDrawer({ orderId, onClose }) {
  const [tab, setTab] = useState('info');
  const {
    order, notFound, events, audit, comments, preview, previewError, setPreviewErrorFor,
    saveOrderField, onSavePlan, onSendComment, readyToShip, shippedByName,
    deptById, deptNameById, stageById, departments,
  } = useOrderDetail(orderId);

  const title = order
    ? `${order.bitrix_id ? `№${order.bitrix_id} · ` : ''}${order.title}`
    : (notFound ? 'Заказ не найден' : 'Загрузка…');
  const badge = order
    ? <Badge variant={order.status === 'active' ? 'progress' : 'neutral'}>{ORDER_STATUS_LABELS[order.status]}</Badge>
    : null;

  return (
    <Drawer
      onClose={onClose}
      title={title}
      subtitle={order ? order.manager || '' : ''}
      badge={badge}
      tabs={order ? TABS : undefined}
      activeTab={tab}
      onTab={setTab}
    >
      <div className={styles.toolbar} style={{ marginTop: -4, marginBottom: 10 }}>
        {/* Правка 6: вместо обезличенного «Открыть на странице» — конкретный номер заказа */}
        <Link to={`/orders/${orderId}`} className="btn btn-secondary" onClick={onClose}>
          Открыть заказ №{order?.bitrix_id || '—'} ↗
        </Link>
      </div>

      {notFound && <div className={styles.subText}>Заказ не найден или был удалён.</div>}
      {!order && !notFound && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton width="60%" height={16} />
          <Skeleton width="100%" height={64} />
          <Skeleton width="90%" height={64} />
        </div>
      )}

      {order && tab === 'info' && (
        <>
          <div className={styles.drawerMeta}>
            <span>
              <span className={styles.subText}>Клиент: </span>
              <InlineEdit value={order.customer} ariaLabel="Клиент" onSave={(v) => saveOrderField({ customer: v })} />
            </span>
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
              style={{ maxHeight: 160, maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border-light)', margin: '10px 0', objectFit: 'contain' }}
            />
          )}
          {preview && previewError && (
            <div className={styles.queueThumbStub} style={{ margin: '10px 0' }} role="img" aria-label="Превью не загрузилось" title="Превью не загрузилось">🖼</div>
          )}

          <div className={styles.toolbar}>
            <Badge variant={order.status === 'active' ? 'progress' : 'neutral'}>{ORDER_STATUS_LABELS[order.status]}</Badge>
            {readyToShip && <Badge variant="ready">✅ Готов к отгрузке</Badge>}
            <Badge variant={order.shipped_status === 'shipped' ? 'ready' : 'neutral'}>{SHIPPED_STATUS_LABELS[order.shipped_status]}</Badge>
            {readyToShip && order.shipped_status !== 'shipped' && <span className={styles.subText}>🚚 Отгрузка — во вкладке «Склад»</span>}
            {order.shipped_at && <span className={styles.subText}>Отгружен {fmtTs(order.shipped_at)}{shippedByName ? ` · ${shippedByName}` : ''}</span>}
            {order.delivered_at && <span className={styles.subText}>сдан {fmt(order.delivered_at)}</span>}
            {order.packaging && order.packaging !== 'none' && (
              <Badge variant="neutral">📦 {PACKAGING_LABELS[order.packaging]}{order.packaging_note ? `: ${order.packaging_note}` : ''}</Badge>
            )}
            {order.stickers && order.stickers !== 'none' && (
              <Badge variant="neutral">🏷 Стикеры: {STICKERS_LABELS[order.stickers]}{order.stickers_note ? ` — ${order.stickers_note}` : ''}</Badge>
            )}
            {order.no_chestny_znak && <Badge variant="danger">Без Честного знака</Badge>}
          </div>
        </>
      )}

      {order && tab === 'route' && (
        <>
          <NotificationsSection order={order} stageById={stageById} deptById={deptById} />
          {(() => {
            const p = orderProgress(order);
            return (
              <div className={styles.routeTotal} style={{ marginBottom: 12 }}>
                <span className={styles.routeTotalLabel}>Готовность заказа</span>
                <div className={styles.progressTrack} aria-hidden="true">
                  <div className={styles.progressFill} style={{ width: `${p.pct}%` }} />
                </div>
                <span className={styles.progressCell}>{p.pct}%</span>
                <span className={styles.subText}>{p.done}/{p.total} шт по этапам</span>
              </div>
            );
          })()}
          {order.items.map((item) => (
            <OrderItemSection key={item.id} item={item} order={order} deptById={deptById} deptNameById={deptNameById} events={events} onSavePlan={onSavePlan} />
          ))}
        </>
      )}

      {order && tab === 'materials' && (
        <section className={styles.matSection}>
          <div className={styles.matSectionHead}><strong>Материалы</strong></div>
          {order.materials.length > 0 ? (
            <div className={styles.stageChips}>
              {order.materials.map((m) => {
                const pending = m.status !== 'received' && m.status !== 'not_needed';
                const eta = pending ? formatDateShort(m.eta_date) : '';
                return (
                  <Badge key={m.id} variant={pending ? 'progress' : 'ready'}>
                    {m.name}
                    {m.supplier ? ` · ${m.supplier}` : ''}
                    {' · '}{MATERIAL_STATUS_LABELS[m.status]}{pending && (eta ? ` · план ${eta}` : ' · план не указан')}
                  </Badge>
                );
              })}
            </div>
          ) : (
            <div className={styles.subText}>Материалы не ожидаются.</div>
          )}
        </section>
      )}

      {order && tab === 'tz' && (
        <>
          <TzMissingBanner order={order} departments={departments} />
          {order.items.map((item) => (
            <section key={item.id} className={styles.matSection}>
              <div className={styles.matSectionHead}>
                <strong>{item.product_type}{item.variant ? ` · ${item.variant}` : ''}</strong>
                <span className={styles.queueQty}>{item.qty} шт</span>
              </div>
              {/* ТЗ в PDF (волна 4) — загрузка, назначение цехам, версии */}
              <TzDocsSection order={order} item={item} deptById={deptById} />
              {/* Структурное ТЗ (сетка, нанесения, упаковка) остаётся рядом */}
              <TzBlock order={order} item={item} defaultOpen hideToggle />
            </section>
          ))}
        </>
      )}

      {order && tab === 'files' && <FilesSection attachments={order.attachments} />}

      {order && tab === 'comments' && (
        <CommentsSection comments={comments} onSend={onSendComment} />
      )}

      {order && tab === 'history' && (
        <HistorySection events={events} audit={audit} stageById={stageById} deptById={deptById} />
      )}
    </Drawer>
  );
}
