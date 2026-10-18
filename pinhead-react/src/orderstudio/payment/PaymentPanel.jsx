import { useEffect, useId, useRef, useState } from 'react';
import { setPayment } from '../api/salesTransitions';
import { lastOverride } from '../api/salesEvents';
import { useSalesStore } from '../store/useSalesStore';
import { confirm } from '../../store/useConfirmStore';
import { canSetPayment, canSetPaymentOverride, isMs, isSalesLead } from '../layout/orderNav';
import { OVERRIDE_MAX, overrideText, paymentStatusText } from './paymentText';
import styles from './payment.module.css';

const KIND_LABEL = { prepaid: 'предоплату', full: 'полную оплату' };

/**
 * Оплата заказа v4 (веха 6+7, К16) — общая для «ТЗ и цена» и «К запуску».
 *
 * Статус — текстом; действия — отдельными кнопками без автосмены (не
 * радиогруппа: стрелки в ней сразу меняли бы выбор и слали RPC). У МС перед
 * RPC — подтверждение: снять отметку он не сможет. «Снять отметку» и
 * «Разрешить запуск без оплаты» (причина до 500 знаков) — только руководство
 * продаж. Порядок: сохранить правки (`flush`) → RPC → `applyServer` (новая
 * версия строки). После успеха фокус — на заголовок, после ошибки — на текст
 * ошибки. Окончательно права решает сервер (`order.manage` у МС, свой заказ).
 */
export default function PaymentPanel({ order, user }) {
  const uid = useId();
  const headRef = useRef(null);
  const errRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');
  /** Запись журнала «без оплаты» — с ключом, к какому заказу и причине она относится */
  const [loaded, setLoaded] = useState({ key: '', note: null });

  const canMark = canSetPayment(user, order);
  const lead = canSetPaymentOverride(user) && (order.status === 'draft' || order.status === 'ready_to_launch');
  const asMs = canMark && isMs(user) && !isSalesLead(user) && order.created_by !== user?.id;
  const overrideReason = order.paid_override_reason;
  const noteKey = overrideReason && order.id ? `${order.id}|${overrideReason}` : '';
  const note = noteKey && loaded.key === noteKey ? loaded.note : null;

  useEffect(() => {
    if (!noteKey) return undefined;
    let alive = true;
    lastOverride(order.id).then((n) => { if (alive) setLoaded({ key: noteKey, note: n }); });
    return () => { alive = false; };
  }, [order.id, noteKey]);

  useEffect(() => {
    if (error) errRef.current?.focus();
  }, [error]);

  async function run(kind, why) {
    if (busy) return;
    setBusy(true);
    setError('');
    const store = useSalesStore.getState();
    if (store.current?.id === order.id) await store.flush();
    const res = await setPayment(order.id, kind, why);
    setBusy(false);
    if (!res) {
      setError('Оплата не отмечена — причина в уведомлении выше, попробуйте ещё раз');
      return;
    }
    useSalesStore.getState().applyServer({ ...res, id: order.id });
    setReasonOpen(false);
    setReason('');
    headRef.current?.focus();
  }

  async function mark(kind) {
    if (asMs) {
      const { ok } = await confirm({
        title: `Отметить ${KIND_LABEL[kind]}?`,
        message: 'Снять отметку сможет только руководитель',
        confirmLabel: 'Отметить',
      });
      if (!ok) return;
    }
    await run(kind);
  }

  function submitOverride(e) {
    e.preventDefault();
    const why = reason.trim();
    if (!why) {
      setError('Укажите причину запуска без оплаты');
      return;
    }
    if (why.length > OVERRIDE_MAX) {
      setError(`Причина — не длиннее ${OVERRIDE_MAX} символов`);
      return;
    }
    void run(null, why);
  }

  const paid = !!order.paid_kind;
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-head`}>
      <h2 id={`${uid}-head`} ref={headRef} tabIndex={-1} className={styles.title}>Оплата</h2>
      <p className={styles.status} aria-live="polite">{paymentStatusText(order)}</p>
      {overrideReason && <p className={styles.override}>{overrideText(overrideReason, note)}</p>}
      {(canMark || lead) && (
        <div className={styles.actions}>
          {canMark && order.paid_kind !== 'prepaid' && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => mark('prepaid')}>
              Отметить предоплату
            </button>
          )}
          {canMark && order.paid_kind !== 'full' && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => mark('full')}>
              Отметить полную оплату
            </button>
          )}
          {lead && (paid || overrideReason) && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(null)}>
              Снять отметку
            </button>
          )}
          {lead && !overrideReason && !reasonOpen && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setError(''); setReasonOpen(true); }}>
              Разрешить запуск без оплаты
            </button>
          )}
        </div>
      )}
      {lead && reasonOpen && (
        <form className={styles.reasonForm} onSubmit={submitOverride}>
          <label htmlFor={`${uid}-reason`} className={styles.label}>Почему запускаем без оплаты</label>
          <textarea
            id={`${uid}-reason`}
            className={styles.reason}
            value={reason}
            maxLength={OVERRIDE_MAX}
            rows={3}
            autoFocus
            aria-describedby={`${uid}-count`}
            onChange={(e) => setReason(e.target.value)}
          />
          <span id={`${uid}-count`} className={styles.count}>{reason.length} / {OVERRIDE_MAX}</span>
          <div className={styles.actions}>
            <button type="submit" className="btn btn-primary" disabled={busy}>Разрешить запуск без оплаты</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setReasonOpen(false); setReason(''); setError(''); }}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {error && <p ref={errRef} tabIndex={-1} role="alert" className={styles.error}>{error}</p>}
    </section>
  );
}
