import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../../store/useAuthStore';
import { useStore } from '../../store/useStore';
import { toast } from '../../store/useToastStore';
import { EmptyState } from '../../erp/components/ErpStates';
/*
 * Скелетон и пустое состояние — примитивы ERP, как у списка заказов. Импорт
 * обоих держит ErpStates, ErpSkeletons и общий CSS в прежних чанках: без них
 * экран (Modal, Button, useMediaQuery) требовал часть общего чанка без
 * ErpStates, и Rollup перекраивал оболочку ERP (веха 6+7, задача 6, замер).
 */
import { ScreenSkeleton } from '../../erp/components/ErpSkeletons';
import { useSalesStore } from '../store/useSalesStore';
import { transitionOrder } from '../api/salesTransitions';
import { canLaunch, canReturn, canSeeLaunchQueue } from '../layout/orderNav';
import { launchToErp, bridgeWarningTexts } from '../bridge/launch';
import { tzToErpDraft } from '../bridge/tzToErpDraft';
import { checkTzHashes } from '../bridge/tzCheck';
import { useTzCatalogs } from '../tz/tzCatalogs';
import { rulesFromPrices, useOrderPrice } from '../screens/useOrderPrice';
import PaymentPanel from '../payment/PaymentPanel';
import { isoLocal, nextWorkingDay } from './nextWorkingDay';
import { STAGE_TEXT, launchDateError, launchDateWarnings, launchSummary, marginLine } from './launchView';
import LaunchOutcome from './LaunchOutcome';
import LaunchSide from './LaunchSide';
import ReturnDialog from './ReturnDialog';
import TzFrame from './TzFrame';
import styles from './Launch.module.css';

export const NO_PAYMENT = 'Нет отметки оплаты — отметьте оплату или попросите руководителя разрешить запуск без оплаты';
const CHECKING = 'Сверяем ТЗ с данными заказа…';

/**
 * «К запуску» (`/sales/:id/launch`, К22) — экран МС. Запуск — `launchToErp`
 * (стор ERP грузится только по кнопке), возврат — `order_v4_transition(draft)`
 * с причиной. Без оптимизма: экран ждёт ответа RPC и кладёт его `applyServer`.
 * Недоступный запуск — `aria-disabled` с причиной (кнопка остаётся в Tab-порядке),
 * клик ведёт фокус к причине; `disabled` — только на время запуска.
 */
export default function LaunchScreen() {
  const { id } = useParams();
  const uid = useId();
  const user = useAuthStore((s) => s.user);
  const { order, loading, open } = useSalesStore(useShallow((s) => ({ order: s.current, loading: s.currentLoading, open: s.open })));
  const prices = useStore((s) => s.prices);
  const { catalogs, failed } = useTzCatalogs();
  const price = useOrderPrice(order);
  const [date, setDate] = useState(() => nextWorkingDay(new Date()));
  const [today] = useState(() => isoLocal(new Date()));
  const [tz, setTz] = useState({ key: '', ok: null, reason: '' });
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState(null);
  const [returning, setReturning] = useState(false);
  const payRef = useRef(null);
  const tzRef = useRef(null);
  const errRef = useRef(null);
  const returnRef = useRef(null);
  const dateRef = useRef(null);

  /** Какой заказ уже открыт этим экраном: до ответа — «Загрузка», а не «не найден» */
  const [opened, setOpened] = useState('');
  useEffect(() => {
    let alive = true;
    if (id) void open(id).then(() => { if (alive) setOpened(id); });
    return () => { alive = false; };
  }, [id, open]);
  useEffect(() => { if (error) errRef.current?.focus(); }, [error]);

  const tzKey = order && catalogs ? `${order.id}|${order.updated_at}` : '';
  useEffect(() => {
    if (!tzKey || !order || !catalogs) return undefined;
    let alive = true;
    void checkTzHashes(order, catalogs).then((r) => { if (alive) setTz({ key: tzKey, ok: r.ok, reason: r.ok ? '' : r.reason }); });
    return () => { alive = false; };
  }, [tzKey, order, catalogs]);

  const warnings = useMemo(() => (order ? bridgeWarningTexts(order, tzToErpDraft(order).warnings) : []), [order]);

  if (!canSeeLaunchQueue(user)) return <Navigate to={`/sales/${id}`} replace />;
  if (loading || opened !== id || (order && order.id !== id)) return <ScreenSkeleton />;
  if (!order) {
    return (
      <div className={styles.page}>
        <EmptyState icon="orders" title="Заказ не найден или недоступен" text="Проверьте ссылку или откройте очередь «К запуску»." />
      </div>
    );
  }

  const head = (
    <div className={styles.head}>
      <h1 className={styles.title}>К запуску: {order.number || 'без номера'}</h1>
      <p className={styles.sub}>{[order.customer, order.title].filter(Boolean).join(' · ')} · <Link to={`/sales/${order.id}`}>Открыть заказ</Link></p>
    </div>
  );
  // Итог — только своего заказа: «Следующий к запуску» меняет id, а экран тот же
  const mine = outcome?.id === order.id ? outcome : null;
  // «Сдан» перекрывает итог запуска: после «Отметить: заказ сдан» заголовок — «Заказ сдан»
  const kind = order.status === 'done' ? 'done' : mine?.kind ?? (order.status === 'ready_to_launch' ? null : order.status);
  if (kind) {
    return <div className={styles.page}>{head}<LaunchOutcome order={order} user={user} kind={kind} warnings={mine?.warnings} /></div>;
  }

  const tzState = tz.key === tzKey ? tz : { ok: null, reason: '' };
  const unpaid = !order.paid_at && !order.paid_override_reason;
  const dateError = launchDateError(date, today);
  const blocked = unpaid ? NO_PAYMENT : dateError || (tzState.ok === false ? tzState.reason : tzState.ok === null ? (failed ? 'Справочники ТЗ не загрузились — обновите страницу' : CHECKING) : '');
  const margin = price ? marginLine(price.margin_pct, rulesFromPrices(prices ?? {}).minMarginPct) : null;
  const dateWarnings = launchDateWarnings(date, order.due_date);

  const launch = async () => {
    if (blocked) {
      (unpaid ? payRef.current?.querySelector('h2') : dateError ? dateRef.current : tzRef.current)?.focus();
      return;
    }
    setBusy(true);
    setError('');
    const r = await launchToErp(order, { launchDate: date, catalogs, actor: user?.id ?? '', onStage: setStage });
    setBusy(false);
    setStage('');
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    if (r.patch) useSalesStore.getState().applyServer(r.patch);
    setOutcome({ id: order.id, kind: 'launched', warnings: r.warnings });
  };

  const sendBack = async (reason) => {
    const res = await transitionOrder(order.id, 'draft', reason);
    if (!res) return false;
    setReturning(false);
    useSalesStore.getState().applyServer({ ...res, id: order.id });
    toast.success(`Заказ ${order.number} возвращён менеджеру`);
    setOutcome({ id: order.id, kind: 'returned', warnings: [] });
    return true;
  };

  return (
    <div className={styles.page}>
      {head}
      <div className={styles.layout}>
        <div className={styles.side}>
          <section className={styles.block} aria-label="Сводка запуска">
            <p id={`${uid}-summary`} className={styles.summary}>{launchSummary(order, date, warnings.length)}</p>
            {margin && <p className={margin.low ? styles.warn : styles.muted}>{margin.low && <span aria-hidden="true">⚠ </span>}{margin.text}{margin.low && ' — ниже порога'}</p>}
            {tzState.ok === false && <p ref={tzRef} tabIndex={-1} role="status" className={styles.warn}>{tzState.reason}</p>}
          </section>
          <div ref={payRef}><PaymentPanel order={order} user={user} /></div>
          <div className={styles.block}>
            <label htmlFor={`${uid}-date`} className={styles.label}>Дата запуска</label>
            <input ref={dateRef} id={`${uid}-date`} type="date" className={styles.date} min={today} value={date}
              aria-invalid={dateError ? 'true' : undefined}
              aria-describedby={`${uid}-date-hint${dateError ? ` ${uid}-date-err` : ''}`} onChange={(e) => setDate(e.target.value)} />
            <p id={`${uid}-date-hint`} className={styles.hint}>По умолчанию — следующий рабочий день</p>
            {dateError && <p id={`${uid}-date-err`} className={styles.error}>{dateError}</p>}
            {dateWarnings.map((w) => <p key={w} className={styles.warn}>{w}</p>)}
          </div>
          <div className={styles.actions}>
            {canReturn(user, order) && (
              <button ref={returnRef} type="button" className={`btn btn-ghost ${styles.touch}`} disabled={busy} onClick={() => setReturning(true)}>
                Вернуть менеджеру
              </button>
            )}
            {canLaunch(user, order) && (
              <button type="button" className={`btn btn-primary ${styles.touch}`} disabled={busy} aria-disabled={blocked ? 'true' : undefined}
                aria-describedby={`${uid}-summary${blocked ? ` ${uid}-why` : ''}`} onClick={launch}>
                {busy ? 'Запускаем…' : 'Запустить в производство'}
              </button>
            )}
          </div>
          {blocked && <p id={`${uid}-why`} className={styles.hint}>{blocked}</p>}
          <p className={styles.srOnly} aria-live="polite">{busy ? (STAGE_TEXT[stage] ?? 'Запускаем…') : ''}</p>
          {error && <p ref={errRef} tabIndex={-1} role="alert" className={styles.error}>Запуск не выполнен: {error}</p>}
          <LaunchSide order={order} catalogs={catalogs} warnings={warnings} />
        </div>
        <div className={styles.tzCol}><TzFrame order={order} /></div>
      </div>
      {returning && <ReturnDialog onSubmit={sendBack} onClose={() => { setReturning(false); returnRef.current?.focus(); }} />}
    </div>
  );
}
