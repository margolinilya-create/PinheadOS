import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { ScreenSkeleton } from '../components/ErpSkeletons';
import InlineEdit from '../components/InlineEdit';
import { supabase } from '../../lib/supabase';
import { useErpStore, orderPreviewUrl } from '../store/useErpStore';
import { formatDateShort } from '../utils/time';
import { isOrderReadyToShip } from '../utils/stageUi';
import { confirm } from '../../store/useConfirmStore';
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

/**
 * Карточка заказа — «трекинг посылки»: маршрут по этапам с план/фактом,
 * ручные плановые даты, материалы, история событий.
 */

export default function OrderCard() {
  const { orderId } = useParams();
  const {
    orders, departments, loaded, loadAll, loadOne, setStagePlan,
    loadOrderEvents, loadOrderAudit, updateOrder, loadComments, addComment,
    shipOrder, profilesList, employees,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadAll: s.loadAll,
      loadOne: s.loadOne,
      setStagePlan: s.setStagePlan,
      loadOrderEvents: s.loadOrderEvents,
      loadOrderAudit: s.loadOrderAudit,
      updateOrder: s.updateOrder,
      loadComments: s.loadComments,
      addComment: s.addComment,
      shipOrder: s.shipOrder,
      profilesList: s.profilesList,
      employees: s.employees,
    })),
  );
  const [events, setEvents] = useState(null);
  const [audit, setAudit] = useState(null);
  const [comments, setComments] = useState(null);
  // Ошибка загрузки превью — с привязкой к заказу (смена orderId сбрасывает сама собой)
  const [previewErrorFor, setPreviewErrorFor] = useState(null);
  const previewError = previewErrorFor === orderId;
  // Заказа нет среди загруженных (архив лениво) → однократная точечная догрузка;
  // храним orderId, для которого догрузка уже выполнена (сброс при смене — сам собой)
  const [lookedUpFor, setLookedUpFor] = useState(null);
  const lookedUp = lookedUpFor === orderId;

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  const inStore = orders.some((o) => o.id === orderId);
  useEffect(() => {
    if (!loaded || inStore || lookedUp || !orderId) return;
    let alive = true;
    loadOne(orderId).finally(() => { if (alive) setLookedUpFor(orderId); });
    return () => { alive = false; };
  }, [loaded, inStore, lookedUp, loadOne, orderId]);

  useEffect(() => {
    if (!orderId) return;
    loadOrderEvents(orderId).then((ev) => setEvents(ev ?? []));
    loadOrderAudit(orderId).then((a) => setAudit(a ?? []));
    loadComments(orderId).then((c) => setComments(c ?? []));
    // realtime: уникальное имя канала (паттерн kontora24 — иначе ломается на HMR)
    const channel = supabase
      .channel(`erp-comments-${orderId}-${crypto.randomUUID()}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'erp_order_comments', filter: `order_id=eq.${orderId}` },
        (payload) => {
          setComments((prev) => {
            if (!prev || prev.some((c) => c.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orderId, loadOrderEvents, loadOrderAudit, loadComments]);

  const order = orders.find((o) => o.id === orderId);
  const preview = order ? orderPreviewUrl(order) : null;
  /** Перечитать историю правок — после инлайн-правки её строка сразу видна */
  const refreshAudit = () => loadOrderAudit(orderId).then((a) => setAudit(a ?? []));
  /** Инлайн-правка поля заказа + мгновенное обновление истории */
  const saveOrderField = async (patch) => {
    const ok = await updateOrder(orderId, patch);
    if (ok) refreshAudit();
    return ok;
  };
  /** Плановые даты этапа + мгновенное обновление истории */
  const onSavePlan = async (stageId, plan) => {
    const ok = await setStagePlan(stageId, plan);
    if (ok) refreshAudit();
    return ok;
  };
  /** Отправка комментария + добавление в список (realtime продублирует — дедуп по id) */
  const onSendComment = async (text) => {
    const row = await addComment(order.id, text);
    if (row) setComments((prev) => (prev && !prev.some((c) => c.id === row.id) ? [...prev, row] : prev));
    return row;
  };
  const readyToShip = order ? isOrderReadyToShip(order) : false;
  // Имя отгрузившего: profilesList / erp_employees, если загружены; иначе только дата
  const shippedByName = useMemo(() => {
    if (!order?.shipped_by) return null;
    const p = profilesList.find((x) => x.id === order.shipped_by);
    if (p) return p.name || p.email;
    return employees.find((x) => x.profile_id === order.shipped_by)?.full_name ?? null;
  }, [order, profilesList, employees]);

  const onShip = async () => {
    if (!order) return;
    const ok = await confirm({
      title: `Отгрузить заказ «${order.title}»?`,
      message: 'Заказ уйдёт в архив.',
      confirmLabel: 'Отгрузить',
    });
    if (ok) await shipOrder(order.id);
  };
  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const deptNameById = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
  );
  const stageById = useMemo(() => {
    const m = new Map();
    for (const it of order?.items ?? []) for (const st of it.stages) m.set(st.id, { st, it });
    return m;
  }, [order]);

  if (loaded && !order && lookedUp) {
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
          <InlineEdit
            value={order.manager}
            ariaLabel="Менеджер"
            onSave={(v) => saveOrderField({ manager: v })}
          />
        </span>
        <span>
          <span className={styles.subText}>Запуск: </span>
          <InlineEdit
            type="date"
            value={order.launch_date}
            format={fmt}
            ariaLabel="Дата запуска"
            onSave={(v) => saveOrderField({ launch_date: v })}
          />
        </span>
        <span>
          <span className={styles.subText}>Срок клиента: </span>
          <InlineEdit
            type="date"
            value={order.due_date}
            format={fmt}
            ariaLabel="Срок клиента"
            onSave={(v) => saveOrderField({ due_date: v })}
          />
        </span>
        <span>
          <span className={styles.subText}>Заметка: </span>
          <InlineEdit
            value={order.notes === 'imported' ? null : order.notes}
            placeholder="добавить…"
            ariaLabel="Заметка"
            onSave={(v) => saveOrderField({ notes: v })}
          />
        </span>
      </div>
      {preview && !previewError && (
        <img
          src={preview}
          alt={`Превью заказа «${order.title}»`}
          onError={() => setPreviewErrorFor(orderId)}
          style={{ maxHeight: 140, maxWidth: 260, borderRadius: 8, border: '1px solid var(--border-light)', marginBottom: 10, objectFit: 'contain' }}
        />
      )}
      {preview && previewError && (
        <div
          className={styles.queueThumbStub}
          style={{ marginBottom: 10 }}
          role="img"
          aria-label="Превью не загрузилось"
          title="Превью не загрузилось"
        >
          🖼
        </div>
      )}
      <div className={styles.toolbar}>
        <span className={`${styles.chip} ${order.status === 'active' ? styles.chipProgress : styles.chipNeutral}`}>
          {ORDER_STATUS_LABELS[order.status]}
        </span>
        {readyToShip && (
          <span className={`${styles.chip} ${styles.chipReady}`}>✅ Готов к отгрузке</span>
        )}
        <span className={`${styles.chip} ${order.shipped_status === 'shipped' ? styles.chipReady : styles.chipNeutral}`}>
          {SHIPPED_STATUS_LABELS[order.shipped_status]}
        </span>
        {readyToShip && (
          <button
            type="button"
            className={`btn btn-primary ${styles.shipBtn}`}
            onClick={onShip}
          >
            🚚 Отгрузить
          </button>
        )}
        {order.shipped_at && (
          <span className={styles.subText}>
            Отгружен {fmtTs(order.shipped_at)}{shippedByName ? ` · ${shippedByName}` : ''}
          </span>
        )}
        {order.delivered_at && <span className={styles.subText}>сдан {fmt(order.delivered_at)}</span>}
        {order.packaging && order.packaging !== 'none' && (
          <span className={`${styles.chip} ${styles.chipNeutral}`}>
            📦 {PACKAGING_LABELS[order.packaging]}{order.packaging_note ? `: ${order.packaging_note}` : ''}
          </span>
        )}
        {order.stickers && order.stickers !== 'none' && (
          <span className={`${styles.chip} ${styles.chipNeutral}`}>
            🏷 Стикеры: {STICKERS_LABELS[order.stickers]}{order.stickers_note ? ` — ${order.stickers_note}` : ''}
          </span>
        )}
        {order.no_chestny_znak && (
          <span className={`${styles.chip} ${styles.chipDanger}`}>Без Честного знака</span>
        )}
      </div>

      <NotificationsSection order={order} stageById={stageById} deptById={deptById} />

      {order.items.map((item) => (
        <OrderItemSection
          key={item.id}
          item={item}
          order={order}
          deptById={deptById}
          deptNameById={deptNameById}
          events={events}
          onSavePlan={onSavePlan}
        />
      ))}

      <section className={styles.matSection}>
        <div className={styles.matSectionHead}><strong>Материалы</strong></div>
        {order.materials.length > 0 ? (
          <div className={styles.stageChips}>
            {order.materials.map((m) => {
              const pending = m.status !== 'received' && m.status !== 'not_needed';
              const eta = pending ? formatDateShort(m.eta_date) : '';
              return (
                <span
                  key={m.id}
                  className={`${styles.chip} ${pending ? styles.chipProgress : styles.chipReady}`}
                >
                  {m.name} · {MATERIAL_STATUS_LABELS[m.status]}
                  {pending && (eta ? ` · план ${eta}` : ' · план не указан')}
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
