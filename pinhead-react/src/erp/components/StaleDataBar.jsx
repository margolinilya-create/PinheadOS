/**
 * Полоса «данные могли устареть».
 *
 * Реалтайм-канал рвётся молча: планшет уходит в сон, цеховой Wi-Fi мигает,
 * вкладка висит в фоне сутки. События за это время не придут НИКОГДА — их
 * можно только запросить заново. До 22.08 признака разрыва не было вовсе,
 * и экран продолжал показывать позавчерашнюю очередь, выглядя рабочим.
 *
 * Починка без этой полосы была бы невидимой: переподключение и перечитывание
 * происходят сами, но пока они не прошли, человек смотрит на устаревшие данные
 * и не знает об этом. Поэтому здесь же кнопка — ждать автоматики, глядя
 * на заведомо старый экран, никто не обязан.
 */

import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { Button } from './Button';
import styles from '../erp.module.css';

export default function StaleDataBar() {
  const { realtimeLive, realtimeResyncing, resyncRealtime } = useErpStore(
    useShallow((s) => ({
      realtimeLive: s.realtimeLive,
      realtimeResyncing: s.realtimeResyncing,
      resyncRealtime: s.resyncRealtime,
    })),
  );

  if (realtimeLive && !realtimeResyncing) return null;

  return (
    // `role="status"`, а не `alert`: это сообщение о состоянии экрана, а не
    // о происшествии — скринридер прочитает его, не перебивая работу
    <div className={styles.warnBox} role="status">
      {realtimeResyncing
        ? 'Обновляем данные…'
        : 'Связь с сервером потеряна — данные на экране могли устареть. Восстанавливаем.'}
      {!realtimeResyncing && (
        <>
          {' '}
          <Button variant="ghost" size="sm" onClick={() => { void resyncRealtime(); }}>
            Обновить сейчас
          </Button>
        </>
      )}
    </div>
  );
}
