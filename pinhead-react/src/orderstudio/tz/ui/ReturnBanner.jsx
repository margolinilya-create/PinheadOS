import { useEffect, useState } from 'react';
import { lastReturn } from '../../api/salesEvents';
import { ddmm } from '../../payment/paymentText';
import { isFreshReturn } from './tzUiText';
import styles from './tz.module.css';

/**
 * Плашки над вкладками рабочего места (веха 6+7, решение 32):
 * - `ready_to_launch` — «Отправлен на запуск 18.10 · правка закрыта…»;
 * - `draft`, вернули менеджеру после отправки (`lastReturn` новее `sent_at`) —
 *   кто, когда и почему вернул. Журнал читается только у черновика, который
 *   уже отправляли (`sent_at`), — у нового черновика возврата быть не может.
 *
 * @param {{ order: import('../../model/types').SalesOrder }} props
 */
export default function ReturnBanner({ order }) {
  const wasSent = order.status === 'draft' && !!order.sent_at && !!order.id;
  const key = wasSent ? `${order.id}|${order.sent_at}` : '';
  const [loaded, setLoaded] = useState({ key: '', note: null });

  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    lastReturn(order.id).then((note) => { if (alive) setLoaded({ key, note }); });
    return () => { alive = false; };
  }, [key, order.id]);

  if (order.status === 'ready_to_launch') {
    return (
      <p className={`${styles.banner} ${styles.bannerSent}`}>
        Отправлен на запуск {ddmm(order.sent_at)} · правка закрыта. Нужна правка — попросите МС вернуть заказ
      </p>
    );
  }
  const note = loaded.key === key ? loaded.note : null;
  if (!wasSent || !isFreshReturn(note, order.sent_at)) return null;
  return (
    <p role="status" className={`${styles.banner} ${styles.bannerReturn}`}>
      Заказ вернул(а) {note.actorName} {ddmm(note.at)}: «{note.reason}». Исправьте и отправьте снова
    </p>
  );
}
