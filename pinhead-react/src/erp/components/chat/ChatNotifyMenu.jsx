import { useEffect, useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { Icon } from '../Icon';
import styles from '../../styles';

/**
 * РЕЖИМ УВЕДОМЛЕНИЙ ПО ЗАКАЗУ (правка заказчика 20.09, п. 4).
 *
 * «Режимы на заказ: „Все сообщения", „Упоминания и ответы", „Без
 * уведомлений". Последний отключает и персональные уведомления, но НЕ учёт
 * непрочитанных сообщений».
 *
 * Последняя оговорка — не формальность: «без уведомлений» означает «не зови
 * меня», а не «считай, что я всё прочитал». Счётчик остаётся, и человек
 * сам решает, когда открыть.
 *
 * ПОЧЕМУ СЕЛЕКТ, А НЕ ТРИ КНОПКИ. Значения взаимоисключающие и читаются
 * подписью целиком («Упоминания и ответы» — это фраза, а не ярлык);
 * три кнопки в шапке окна заняли бы место, которое нужно названию заказа.
 */
const LABELS = {
  all: 'Все сообщения',
  mentions: 'Упоминания и ответы',
  none: 'Без уведомлений',
};

export function ChatNotifyMenu({ orderId }) {
  const loadMode = useErpStore((s) => s.loadChatMode);
  const setMode = useErpStore((s) => s.setChatMode);
  const [mode, setLocal] = useState(null);

  useEffect(() => {
    let alive = true;
    loadMode(orderId).then((m) => { if (alive) setLocal(m); });
    return () => { alive = false; };
  }, [orderId, loadMode]);

  return (
    <label className={styles.chatNotify} title="Уведомления по этому заказу">
      <Icon name="bell" size={14} />
      <span className={styles.visuallyHidden}>Уведомления по заказу</span>
      <select
        className={styles.chatNotifySelect}
        value={mode ?? 'mentions'}
        disabled={mode === null}
        aria-label="Режим уведомлений по заказу"
        onChange={async (e) => {
          const next = e.target.value;
          const before = mode;
          setLocal(next);
          // Откат при отказе: режим — это обещание системы, и показать
          // выбранным то, чего сервер не принял, значит соврать о нём
          const ok = await setMode(orderId, next);
          if (!ok) setLocal(before);
        }}
      >
        {Object.entries(LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
    </label>
  );
}
