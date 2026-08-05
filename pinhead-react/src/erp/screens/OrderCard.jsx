import { useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { ScreenSkeleton } from '../components/ErpSkeletons';
import { LoadFailed } from '../components/ErpStates';
import InlineEdit from '../components/InlineEdit';
import { Icon } from '../components/Icon';
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
import { TzDocsSection, TzMissingBanner } from './orderCard/TzDocsSection';
import { FilesSection } from './orderCard/FilesSection';
import { CommentsSection } from './orderCard/CommentsSection';
import { HistorySection } from './orderCard/HistorySection';
import { NotificationsSection } from './orderCard/NotificationsSection';
import { useOrderDetail } from './orderCard/useOrderDetail';
import { ButtonLink } from '../components/Button';
import { useErpAccess } from '../store/useErpAccess';
import { OrderCardTabs } from './orderCard/OrderCardTabs';

/**
 * Карточка заказа (страница /orders/:id) — «трекинг посылки»: маршрут по этапам с план/фактом,
 * материалы, история. Общая логика — в useOrderDetail (её же использует боковой OrderDrawer).
 */
export default function OrderCard() {
  const { orderId } = useParams();
  const {
    order, notFound, loaded, loadError, loadAll,
    events, audit, comments, preview, previewError, setPreviewErrorFor,
    saveOrderField, onSavePlan, onSendComment, readyToShip, shippedByName,
    deptById, deptNameById, stageById, departments,
  } = useOrderDetail(orderId);

  /**
   * Правка полей заказа — право `order.manage`, ровно как на сервере
   * (страж `erp_order_guard`, миграция 20260803280000). Без права поля
   * показываются НА ЧТЕНИЕ, а не пропадают: срок клиента и менеджер нужны
   * цеху, чтобы понимать, что он делает, — тот же приём, что у плановых дат.
   */
  const canManageOrder = useErpAccess().can('order.manage');

  /**
   * Активная вкладка — в адресе: ссылку на карточку шлют коллегам, и «смотри
   * историю по этому заказу» должно открываться сразу нужной панелью.
   * `replace`, чтобы переключение вкладок не забивало историю браузера:
   * «Назад» обязан вернуть к списку заказов, а не пройти шесть вкладок.
   */
  const [params, setParams] = useSearchParams();
  const tabs = useMemo(() => [
    { id: 'items', label: 'Позиции', count: order?.items.length ?? 0 },
    { id: 'tz', label: 'ТЗ', count: order?.tz_documents?.filter((d) => d.is_current).length ?? 0 },
    { id: 'materials', label: 'Материалы', count: order?.materials.length ?? 0 },
    { id: 'files', label: 'Файлы', count: order?.attachments?.length ?? 0 },
    { id: 'comments', label: 'Комментарии', count: comments?.length ?? 0 },
    { id: 'history', label: 'История', count: (events?.length ?? 0) + (audit?.length ?? 0) },
  ], [order, comments, events, audit]);
  const requested = params.get('tab');
  const tab = tabs.some((t) => t.id === requested) ? requested : 'items';

  if (notFound) {
    return (
      <>
        <PageHead title="Заказ не найден" />
        <ButtonLink to="/orders" variant="secondary" className={styles.cellWithIcon}>
          <Icon name="chevronLeft" size={14} />К списку заказов
        </ButtonLink>
      </>
    );
  }
  if (loadError && !loaded) {
    return (
      <>
        <PageHead title="Заказ" />
        <LoadFailed onRetry={loadAll} what="заказ" />
      </>
    );
  }
  if (!order) return <ScreenSkeleton />;

  return (
    <>
      <div className={styles.toolbar} style={{ marginBottom: 4 }}>
        <Link to="/orders" className={`${styles.subText} ${styles.cellWithIcon}`}>
          <Icon name="chevronLeft" size={13} />Заказы
        </Link>
      </div>
      <PageHead title={`${order.bitrix_id ? `№${order.bitrix_id} · ` : ''}${order.title}`} />
      <div className={styles.toolbar} style={{ gap: 18, marginTop: -8 }}>
        {/* Клиент собирается формой создания и правится в боковой карточке, но на
            полной странице его не было вовсе — а именно её ссылку шлют коллегам */}
        <span>
          <span className={styles.subText}>Клиент: </span>
          <InlineEdit
            value={order.customer}
            placeholder="добавить…"
            ariaLabel="Клиент"
            onSave={(v) => saveOrderField({ customer: v })} disabled={!canManageOrder}
          />
        </span>
        <span>
          <span className={styles.subText}>Менеджер: </span>
          <InlineEdit value={order.manager} ariaLabel="Менеджер" onSave={(v) => saveOrderField({ manager: v })} disabled={!canManageOrder} />
        </span>
        <span>
          <span className={styles.subText}>Запуск: </span>
          <InlineEdit type="date" value={order.launch_date} format={fmt} ariaLabel="Дата запуска" onSave={(v) => saveOrderField({ launch_date: v })} disabled={!canManageOrder} />
        </span>
        <span>
          <span className={styles.subText}>Срок клиента: </span>
          <InlineEdit type="date" value={order.due_date} format={fmt} ariaLabel="Срок клиента" onSave={(v) => saveOrderField({ due_date: v })} disabled={!canManageOrder} />
        </span>
        <span>
          <span className={styles.subText}>Заметка: </span>
          <InlineEdit value={order.notes === 'imported' ? null : order.notes} placeholder="добавить…" ariaLabel="Заметка" onSave={(v) => saveOrderField({ notes: v })} disabled={!canManageOrder} />
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
        <div className={styles.queueThumbStub} style={{ marginBottom: 10 }} role="img" aria-label="Превью не загрузилось" title="Превью не загрузилось"><Icon name="image" size={22} /></div>
      )}
      <div className={styles.toolbar}>
        <span className={`${styles.chip} ${order.status === 'active' ? styles.chipProgress : styles.chipNeutral}`}>{ORDER_STATUS_LABELS[order.status]}</span>
        {readyToShip && <span className={`${styles.chip} ${styles.chipReady}`}><Icon name="checkCircle" size={13} /> Готов к отгрузке</span>}
        <span className={`${styles.chip} ${order.shipped_status === 'shipped' ? styles.chipReady : styles.chipNeutral}`}>{SHIPPED_STATUS_LABELS[order.shipped_status]}</span>
        {readyToShip && order.shipped_status !== 'shipped' && <span className={styles.subText}><span className={styles.cellWithIcon}><Icon name="truck" size={13} /> Отгрузка — во вкладке «Склад»</span></span>}
        {order.shipped_at && <span className={styles.subText}>Отгружен {fmtTs(order.shipped_at)}{shippedByName ? ` · ${shippedByName}` : ''}</span>}
        {order.delivered_at && <span className={styles.subText}>сдан {fmt(order.delivered_at)}</span>}
        {order.packaging && order.packaging !== 'none' && (
          <span className={`${styles.chip} ${styles.chipNeutral}`}><Icon name="box" size={13} /> {PACKAGING_LABELS[order.packaging]}{order.packaging_note ? `: ${order.packaging_note}` : ''}</span>
        )}
        {order.stickers && order.stickers !== 'none' && (
          <span className={`${styles.chip} ${styles.chipNeutral}`}><Icon name="tag" size={13} /> Стикеры: {STICKERS_LABELS[order.stickers]}{order.stickers_note ? ` — ${order.stickers_note}` : ''}</span>
        )}
        {order.no_chestny_znak && <span className={`${styles.chip} ${styles.chipWaiting}`}>Без Честного знака</span>}
      </div>

      {/* Уведомления и баннер ТЗ — ВНЕ вкладок: это «почему заказ стоит»,
          и прятать его за переключателем значит показывать проблему только
          тому, кто угадал вкладку. */}
      <NotificationsSection order={order} stageById={stageById} deptById={deptById} />
      <TzMissingBanner order={order} departments={departments} />

      <OrderCardTabs
        tabs={tabs}
        active={tab}
        onSelect={(id) => setParams((prev) => {
          const next = new URLSearchParams(prev);
          if (id === 'items') next.delete('tab'); else next.set('tab', id);
          return next;
        }, { replace: true })}
      />

      <div id="order-tabpanel" role="tabpanel" aria-labelledby={`order-tab-${tab}`} tabIndex={-1}>
        {tab === 'items' && order.items.map((item) => (
          <OrderItemSection key={item.id} item={item} order={order} deptById={deptById} deptNameById={deptNameById} events={events} onSavePlan={onSavePlan} />
        ))}

        {tab === 'tz' && (
          <section className={styles.matSection}>
            {order.items.map((item) => (
              <div key={item.id}>
                <div className={styles.matSectionHead}>
                  <strong>{item.product_type}{item.variant ? ` · ${item.variant}` : ''}</strong>
                  <span className={styles.queueQty}>{item.qty} шт</span>
                </div>
                <TzDocsSection order={order} item={item} deptById={deptById} />
              </div>
            ))}
          </section>
        )}

        {tab === 'materials' && (
          <section className={styles.matSection}>
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
              <div className={styles.subText}>Материалы по этому заказу не закупаются.</div>
            )}
          </section>
        )}

        {tab === 'files' && <FilesSection attachments={order.attachments} />}

        {tab === 'comments' && <CommentsSection comments={comments} onSend={onSendComment} />}

        {tab === 'history' && (
          <HistorySection events={events} audit={audit} stageById={stageById} deptById={deptById} />
        )}
      </div>
    </>
  );
}
