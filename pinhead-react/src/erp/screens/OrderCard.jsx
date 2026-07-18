import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { ScreenSkeleton } from '../components/ErpSkeletons';
import { Skeleton } from '../../components/shared/Skeleton';
import InlineEdit from '../components/InlineEdit';
import { supabase } from '../../lib/supabase';
import { useErpStore, orderPreviewUrl } from '../store/useErpStore';
import { isStageReady, waitingReason } from '../utils/routes';
import { formatDateShort } from '../utils/time';
import { deptShortName } from '../data/departments';
import { STAGE_CHIP_CLASS, isOrderReadyToShip } from '../utils/stageUi';
import { confirm } from '../../store/useConfirmStore';
import {
  ORDER_STATUS_LABELS,
  SHIPPED_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  PRODUCTION_TYPE_LABELS,
  MATERIAL_STATUS_LABELS,
  BRANDING_METHOD_LABELS,
  PACKAGING_LABELS,
  STICKERS_LABELS,
} from '../types';
import styles from '../erp.module.css';

/**
 * Карточка заказа — «трекинг посылки»: маршрут по этапам с план/фактом,
 * ручные плановые даты, материалы, история событий.
 */

const fmt = (d) => (d ? new Date(d).toLocaleDateString('ru-RU') : '—');
const fmtTs = (d) => (d ? new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

function PlanCell({ stage, onSave }) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(stage.planned_start || '');
  const [end, setEnd] = useState(stage.planned_end || '');

  if (!editing) {
    const overdueEnd =
      stage.planned_end && stage.status !== 'done' &&
      stage.planned_end < new Date().toISOString().slice(0, 10);
    return (
      <button
        type="button"
        className={styles.planBtn}
        title="Задать плановые даты"
        onClick={() => setEditing(true)}
      >
        {stage.planned_start || stage.planned_end ? (
          <span className={overdueEnd ? styles.overdue : undefined}>
            {fmt(stage.planned_start)} → {fmt(stage.planned_end)}
          </span>
        ) : (
          <span className={styles.subText}>задать план…</span>
        )}
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="date" className={styles.input} style={{ minHeight: 30, padding: '2px 6px' }}
        value={start} onChange={(e) => setStart(e.target.value)} aria-label="План: начало" />
      <input type="date" className={styles.input} style={{ minHeight: 30, padding: '2px 6px' }}
        value={end} onChange={(e) => setEnd(e.target.value)} aria-label="План: конец" />
      <button type="button" className="btn btn-primary" style={{ padding: '2px 10px' }}
        onClick={async () => {
          await onSave({ planned_start: start || null, planned_end: end || null });
          setEditing(false);
        }}>
        ✓
      </button>
      <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px' }}
        onClick={() => setEditing(false)}>✕</button>
    </span>
  );
}


const AUDIT_FIELD_LABELS = {
  title: 'Название',
  manager: 'Менеджер',
  bitrix_id: '№ сделки',
  launch_date: 'Дата запуска',
  due_date: 'Срок клиента',
  buffer_days: 'Буфер, дн',
  priority: 'Приоритет',
  status: 'Статус заказа',
  shipped_status: 'Отгрузка',
  delivered_at: 'Сдан',
  notes: 'Заметка',
  packaging: 'Упаковка',
  packaging_note: 'Упаковка: уточнение',
  stickers: 'Стикеры',
  stickers_note: 'Стикеры: уточнение',
  no_chestny_znak: 'Без Честного знака',
  planned_start: 'План этапа: начало',
  planned_end: 'План этапа: конец',
};

/** Поля-даты аудита — показываем в русском формате */
const AUDIT_DATE_FIELDS = new Set([
  'launch_date', 'due_date', 'delivered_at', 'planned_start', 'planned_end',
]);

/** Читабельные значения аудита: статусы, даты и флаги — на русском */
function auditValue(field, v) {
  if (v == null || v === '') return '—';
  if (field === 'status') return ORDER_STATUS_LABELS[v] || v;
  if (field === 'shipped_status') return SHIPPED_STATUS_LABELS[v] || v;
  if (field === 'packaging') return PACKAGING_LABELS[v] || v;
  if (field === 'stickers') return STICKERS_LABELS[v] || v;
  if (field === 'no_chestny_znak') return v === 'true' ? 'да' : 'нет';
  if (AUDIT_DATE_FIELDS.has(field)) return fmt(v);
  return v;
}

/** Тонкая лента этапов позиции (паттерн kontora24 OrderStepper) */
function StageStepper({ item, order, deptById, events }) {
  const lastEventByStage = useMemo(() => {
    const m = new Map();
    for (const ev of events ?? []) {
      if (!m.has(ev.stage_id)) m.set(ev.stage_id, ev); // events отсортированы desc
    }
    return m;
  }, [events]);

  return (
    <div className={styles.stepper} role="list" aria-label="Лента этапов">
      {item.stages.map((st, i) => {
        const dept = deptById.get(st.department_id);
        const effReady = st.status === 'waiting' &&
          isStageReady(st, item.stages, order.materials, dept?.code);
        const display = effReady ? 'ready' : st.status;
        const ev = lastEventByStage.get(st.id);
        const tooltip = [
          dept?.name,
          STAGE_STATUS_LABELS[display],
          st.finished_at && `завершён ${fmtTs(st.finished_at)}`,
          ev?.actor && `последний: ${ev.actor}`,
        ].filter(Boolean).join(' · ');
        const dotCls = [
          styles.stepperDot,
          display === 'done' && styles.stepperDotDone,
          (display === 'in_progress' || display === 'ready') && styles.stepperDotActive,
          display === 'blocked' && styles.stepperDotBlocked,
        ].filter(Boolean).join(' ');
        return (
          <span key={st.id} className={styles.stepperItem} role="listitem">
            {i > 0 && (
              <span className={`${styles.stepperLine} ${st.status === 'done' ? styles.stepperLineDone : ''}`} />
            )}
            <span className={dotCls} title={tooltip} aria-label={tooltip}>
              {display === 'done' ? '✓' : i + 1}
            </span>
            <span className={styles.stepperLabel}>
              {dept ? deptShortName(dept.code, dept.name) : '?'}
            </span>
          </span>
        );
      })}
    </div>
  );
}

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
  const [commentDraft, setCommentDraft] = useState('');
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

      {order.items.map((item) => (
        <section key={item.id} className={styles.matSection}>
          <div className={styles.matSectionHead}>
            <div>
              <strong>{item.product_type}</strong>
              {item.variant && <span className={styles.subText}> · {item.variant}</span>}
              <span className={styles.subText}> · {PRODUCTION_TYPE_LABELS[item.production_type]}</span>
            </div>
            <span className={styles.queueQty}>{item.qty} шт</span>
          </div>
          <StageStepper item={item} order={order} deptById={deptById} events={events} />

          {item.size_grid && item.size_grid.length > 0 && (
            <div className={styles.tableWrap} style={{ marginBottom: 10, maxWidth: 560 }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Цв/Разм</th>
                    {[...new Set(item.size_grid.flatMap((r) => Object.keys(r.sizes)))].map((sz) => (
                      <th key={sz}>{sz}</th>
                    ))}
                    <th>Итог</th>
                  </tr>
                </thead>
                <tbody>
                  {item.size_grid.map((r, i) => {
                    const allSizes = [...new Set(item.size_grid.flatMap((x) => Object.keys(x.sizes)))];
                    return (
                      <tr key={i}>
                        <td><strong>{r.color}</strong></td>
                        {allSizes.map((sz) => (
                          <td key={sz} className={styles.progressCell}>{r.sizes[sz] ?? '—'}</td>
                        ))}
                        <td className={styles.progressCell}>
                          <strong>{Object.values(r.sizes).reduce((a, b) => a + b, 0)}</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {(item.prints ?? []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {[...item.prints].sort((a, b) => a.seq - b.seq).map((p) => (
                <div key={p.id} className={styles.printBlock}>
                  <div className={styles.checkRow}>
                    <strong>Нанесение №{p.seq} · {BRANDING_METHOD_LABELS[p.method] || p.method}</strong>
                    {p.zone && <span>{p.zone}</span>}
                    {(p.width_mm || p.height_mm) && (
                      <span className={styles.progressCell}>
                        {p.height_mm ?? '?'}×{p.width_mm ?? '?'} мм
                      </span>
                    )}
                    {p.pantone && (
                      <span className={`${styles.chip} ${styles.chipNeutral}`}>Pantone {p.pantone}</span>
                    )}
                  </div>
                  {(p.offset_note || p.comment) && (
                    <div className={styles.subText}>
                      {[p.offset_note, p.comment].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Этап</th><th>Статус</th><th>План</th><th>Факт</th><th>Сделано</th>
                </tr>
              </thead>
              <tbody>
                {item.stages.map((st) => {
                  const dept = deptById.get(st.department_id);
                  const effReady = st.status === 'waiting' &&
                    isStageReady(st, item.stages, order.materials, dept?.code);
                  const display = effReady ? 'ready' : st.status;
                  const reason = display === 'waiting' || display === 'blocked'
                    ? waitingReason(st, item.stages, order.materials, deptNameById, dept?.code)
                    : null;
                  return (
                    <tr key={st.id}>
                      <td><strong>{dept ? deptShortName(dept.code, dept.name) : '?'}</strong></td>
                      <td>
                        <span className={`${styles.chip} ${styles[STAGE_CHIP_CLASS[display]]}`}>
                          {STAGE_STATUS_LABELS[display]}
                        </span>
                        {reason && <div className={styles.subText}>{reason}</div>}
                      </td>
                      <td>
                        <PlanCell
                          stage={st}
                          onSave={async (plan) => {
                            const ok = await setStagePlan(st.id, plan);
                            if (ok) refreshAudit();
                            return ok;
                          }}
                        />
                      </td>
                      <td className={styles.subText}>
                        {st.started_at || st.finished_at
                          ? `${fmtTs(st.started_at)} → ${fmtTs(st.finished_at)}`
                          : '—'}
                      </td>
                      <td className={styles.progressCell}>
                        {st.qty_done > 0 ? `${st.qty_done}` : '—'}
                        {st.qty_rework > 0 && (
                          <span className={styles.overdue}> · брак {st.qty_rework}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
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

      <section className={styles.matSection}>
        <div className={styles.matSectionHead}><strong>Комментарии</strong></div>
        <div className={styles.commentList}>
          {comments === null && <Skeleton width="45%" height={12} />}
          {comments && comments.length === 0 && (
            <div className={styles.subText}>Пока пусто — обсуждайте заказ прямо здесь.</div>
          )}
          {comments && comments.map((c) => (
            <div key={c.id} className={styles.commentItem}>
              <div className={styles.commentMeta}>{c.author} · {fmtTs(c.created_at)}</div>
              {c.text}
            </div>
          ))}
        </div>
        <form
          className={styles.commentForm}
          onSubmit={async (e) => {
            e.preventDefault();
            const text = commentDraft.trim();
            if (!text) return;
            const row = await addComment(order.id, text);
            if (row) {
              setCommentDraft('');
              setComments((prev) => (prev && !prev.some((c) => c.id === row.id) ? [...prev, row] : prev));
            }
          }}
        >
          <input
            className={styles.input}
            placeholder="Комментарий для производства…"
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            aria-label="Новый комментарий"
          />
          <button type="submit" className="btn btn-primary" disabled={!commentDraft.trim()}>
            Отправить
          </button>
        </form>
      </section>

      <section className={styles.matSection}>
        <div className={styles.matSectionHead}><strong>История</strong></div>
        {events === null && <Skeleton width="45%" height={12} />}
        {events && events.length === 0 && (!audit || audit.length === 0) && (
          <div className={styles.subText}>Событий пока нет — история пишется при смене статусов и правках.</div>
        )}
        {events && (events.length > 0 || (audit && audit.length > 0)) && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Когда</th><th>Кто</th><th>Этап</th><th>Что</th></tr>
              </thead>
              <tbody>
                {[
                  ...(events ?? []).map((ev) => ({ kind: 'stage', at: ev.created_at, row: ev })),
                  ...(audit ?? []).map((a) => ({ kind: 'audit', at: a.changed_at, row: a })),
                ]
                  .sort((x, y) => y.at.localeCompare(x.at))
                  .slice(0, 120)
                  .map(({ kind, row }) => {
                    if (kind === 'audit') {
                      return (
                        <tr key={`a-${row.id}`}>
                          <td className={styles.subText}>{fmtTs(row.changed_at)}</td>
                          <td>{row.changed_by || '—'}</td>
                          <td><span className={`${styles.chip} ${styles.chipNeutral}`}>правка</span></td>
                          <td>
                            {AUDIT_FIELD_LABELS[row.field_name] || row.field_name}:{' '}
                            <span className={styles.subText}>{auditValue(row.field_name, row.old_value)}</span>
                            {' → '}
                            <strong>{auditValue(row.field_name, row.new_value)}</strong>
                          </td>
                        </tr>
                      );
                    }
                    const ev = row;
                    const info = stageById.get(ev.stage_id);
                    const dept = info ? deptById.get(info.st.department_id) : null;
                    return (
                      <tr key={`e-${ev.id}`}>
                        <td className={styles.subText}>{fmtTs(ev.created_at)}</td>
                        <td>{ev.actor || '—'}</td>
                        <td>{dept ? deptShortName(dept.code, dept.name) : '—'}
                          {info?.it?.variant ? ` · ${info.it.variant}` : ''}
                        </td>
                        <td>
                          {STAGE_STATUS_LABELS[ev.to_status] || ev.to_status}
                          {ev.qty_done ? ` · ${ev.qty_done} шт` : ''}
                          {ev.qty_rework ? ` · брак ${ev.qty_rework} шт` : ''}
                          {ev.comment && <div className={styles.subText}>{ev.comment}</div>}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
