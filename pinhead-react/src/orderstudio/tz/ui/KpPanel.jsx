import { useId, useState } from 'react';
import { handlePossibleUpdate } from '../../../lib/appUpdate';
import { saveBlob } from '../../../utils/saveBlob';
import styles from './tz.module.css';

export const MSG_KP_EMPTY = 'Добавьте изделие — КП собирается по позициям заказа';
export const MSG_KP_FAILED = 'КП не собралось — обновите страницу и повторите';

/**
 * «КП для клиента» (веха 5в, Э6): PDF с мокапами, нанесениями, ценами и сроком.
 * Собирается по клику (`import()` движка — не в чанке «ТЗ и цена»), ничего не
 * пишет; статуса «КП отправлено» нет (переходы статусов — только RPC, решение
 * владельца). Нечего собрать — `aria-disabled` с причиной.
 */
export default function KpPanel({ order, price, catalogs, today }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reason = order.items.length === 0 || !price ? MSG_KP_EMPTY : null;
  const run = async () => {
    if (reason || busy) return;
    setBusy(true);
    setError('');
    try {
      const [doc, pdf, mock] = await Promise.all([import('../kp/kpDocument'), import('../pdf/kpPdf'), import('../kp/kpMockups')]);
      const blob = await pdf.buildKpPdf(doc.kpDocument(order, price, today), { mockup: mock.kpMockupLoader(order, catalogs) });
      saveBlob(blob, doc.kpFileName(order.number));
    } catch (e) {
      console.error('KpPanel', e);
      // Отказ, понятный человеку (знаки вне шрифта), — его текстом; прочее — общий
      if (!handlePossibleUpdate(e)) setError(e?.kp ? `КП не собрано: ${e.message}` : MSG_KP_FAILED);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.panel} aria-labelledby={`${id}-head`}>
      <h2 id={`${id}-head`} className={styles.title}>КП для клиента</h2>
      <p className={styles.muted}>PDF с мокапами, нанесениями, ценами и ориентировочным сроком — для отправки клиенту.</p>
      <div className={styles.actions}>
        <button type="button" className="btn" aria-disabled={reason ? 'true' : undefined}
          aria-describedby={reason ? `${id}-why` : undefined} disabled={busy} onClick={run}>
          {busy ? 'Собираю КП…' : 'Скачать КП (PDF)'}
        </button>
      </div>
      {reason && <p id={`${id}-why`} className={styles.muted}>{reason}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </section>
  );
}
