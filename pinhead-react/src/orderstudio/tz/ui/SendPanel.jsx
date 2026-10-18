import { useEffect, useRef, useState } from 'react';
import { toast } from '../../../store/useToastStore';
import { pluralize } from '../../../utils/i18n';
import { canSendToWork } from '../../layout/orderNav';
import { ddmm } from '../../payment/paymentText';
import { sendToWork } from '../sendToWork';
import ChecklistView from './ChecklistView';
import styles from './tz.module.css';

/** Шаг цепочки → текст индикатора и кнопки */
function stageText(p) {
  if (!p) return '';
  const of = p.total > 1 ? ` ${p.group} из ${p.total}` : '';
  return {
    flush: 'Сохраняем заказ…',
    check: 'Проверяем чек-лист…',
    engine: 'Готовим сборку ТЗ…',
    build: `Собираем ТЗ${of}…`,
    upload: `Загружаем ТЗ${of}…`,
    save: 'Сохраняем ТЗ в заказе…',
    transition: 'Отправляем…',
  }[p.stage] ?? 'Отправляем…';
}

/** Почему кнопка недоступна (пусто — доступна) */
function blockReason(blocking, catalogs, catalogsFailed, ready) {
  if (blocking > 0) return `Исправьте ${blocking} ${pluralize(blocking, 'пункт', 'пункта', 'пунктов')} чек-листа, чтобы отправить`;
  if (catalogsFailed) return 'Справочники ТЗ не загрузились — обновите страницу';
  if (!catalogs) return 'Загружаем справочники ТЗ…';
  if (!ready) return 'Проверяем чек-лист…';
  return '';
}

/**
 * «Отправить в работу» (веха 6+7, задача 5) — ЕДИНСТВЕННАЯ точка отправки
 * (якорь `#send`; кнопка шапки рабочего места только ведёт сюда).
 *
 * Чек-лист из `sendChecklist` (T2): блокирующие сверху со ссылкой на место
 * правки. Есть блокирующие — кнопка `aria-disabled` с причиной
 * (`aria-describedby`): клик ведёт фокус на первый пункт, отправка не зовётся.
 * `disabled` — только пока идёт отправка; кнопка показывает шаг и держит
 * ширину. Успех — тост и фокус на заголовок «Отправлен в работу …»; отказ —
 * текст шага (`role=alert`, фокус на него).
 *
 * @param {{
 *   order: import('../../model/types').SalesOrder, user: object,
 *   checklist: import('../model/sendChecklist').CheckItem[] | null,
 *   catalogs: import('../model/tzDocTypes').TzCatalogs | null, catalogsFailed?: boolean,
 *   today: string, focusHeading?: boolean, onFocused?: () => void,
 * }} props
 */
export default function SendPanel({ order, user, checklist = null, catalogs, catalogsFailed = false, today, focusHeading = false, onFocused }) {
  const headRef = useRef(null);
  const firstRef = useRef(null);
  const errRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [justSent, setJustSent] = useState(false);
  const draft = order.status === 'draft';

  useEffect(() => {
    if (!focusHeading) return;
    headRef.current?.focus();
    onFocused?.();
  }, [focusHeading, onFocused]);
  useEffect(() => { if (error) errRef.current?.focus(); }, [error]);
  useEffect(() => { if (justSent && !draft) headRef.current?.focus(); }, [justSent, draft]);

  if (!draft) {
    return (
      <section id="send" className={styles.panel} aria-labelledby="wp-send-head">
        <h2 id="wp-send-head" ref={headRef} tabIndex={-1} className={styles.title}>
          {order.sent_at ? `Отправлен в работу ${ddmm(order.sent_at)} — правка закрыта` : 'Заказ в работе — правка закрыта'}
        </h2>
      </section>
    );
  }

  // `null` — модель чек-листа ещё грузится (ленивый чанк рабочего места)
  const ready = Array.isArray(checklist);
  const blocking = ready ? checklist.filter((i) => i.blocking && !i.ok).length : 0;
  const reason = blockReason(blocking, catalogs, catalogsFailed, ready);
  const allowed = canSendToWork(user, order);

  const send = async () => {
    if (busy) return;
    if (reason) {
      (firstRef.current ?? headRef.current)?.focus();
      return;
    }
    setBusy(true);
    setError('');
    const r = await sendToWork(order.id, { catalogs, today, onStage: setProgress });
    setBusy(false);
    setProgress(null);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    toast.success('Заказ отправлен в работу');
    setJustSent(true);
  };

  const step = busy ? stageText(progress) || 'Отправляем…' : '';
  return (
    <section id="send" className={styles.panel} aria-labelledby="wp-send-head" aria-busy={busy || undefined}>
      <h2 id="wp-send-head" ref={headRef} tabIndex={-1} className={styles.title}>Отправить в работу</h2>
      {catalogs && ready ? <ChecklistView items={checklist} firstRef={firstRef} /> : <p className={styles.muted}>{reason}</p>}
      {allowed ? (
        <>
          <button
            type="button"
            className={`btn btn-primary ${styles.send}`}
            disabled={busy}
            aria-disabled={reason ? 'true' : undefined}
            aria-describedby={reason ? 'wp-send-why' : undefined}
            onClick={send}
          >
            {busy ? step : 'Отправить в работу'}
          </button>
          {reason && <p id="wp-send-why" className={styles.reason}>{reason}</p>}
          <p className={styles.progress} aria-live="polite">{step}</p>
        </>
      ) : (
        <p className={styles.muted}>Отправить в работу может автор заказа или руководитель продаж</p>
      )}
      {error && <p ref={errRef} tabIndex={-1} role="alert" className={styles.error}>{error}</p>}
    </section>
  );
}
