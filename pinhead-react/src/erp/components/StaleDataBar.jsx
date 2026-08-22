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
import { queued } from '../store/offlineQueue';
import { Button } from './Button';
import { pluralize } from '../../utils/i18n';
import styles from '../erp.module.css';

export default function StaleDataBar() {
  const { realtimeLive, realtimeResyncing, resyncRealtime } = useErpStore(
    useShallow((s) => ({
      realtimeLive: s.realtimeLive,
      realtimeResyncing: s.realtimeResyncing,
      resyncRealtime: s.resyncRealtime,
    })),
  );

  /**
   * Очередь читается при рендере полосы, а не держится в сторе: она меняется
   * только в двух местах (приёмка без связи и отправка при её появлении),
   * и оба перерисовывают полосу через `realtimeLive`/`realtimeResyncing`.
   * Дублировать её в стор значило бы завести второй источник правды о том,
   * что лежит в localStorage.
   */
  const waiting = queued().length;

  if (realtimeLive && !realtimeResyncing && waiting === 0) return null;

  return (
    // `role="status"`, а не `alert`: это сообщение о состоянии экрана, а не
    // о происшествии — скринридер прочитает его, не перебивая работу
    <div className={styles.warnBox} role="status">
      {realtimeResyncing
        ? 'Обновляем данные…'
        : realtimeLive
          ? 'Связь есть — отправляем сохранённое.'
          : 'Связь с сервером потеряна — данные на экране могли устареть. Восстанавливаем.'}
      {waiting > 0 && (
        <>
          {' '}
          Ждут отправки: {waiting} {pluralize(waiting, 'действие', 'действия', 'действий')}.
        </>
      )}
      {!realtimeResyncing && (
        <>
          {' '}
          <Button variant="ghost" size="sm" onClick={() => { void resyncRealtime(); }}>
            {waiting > 0 ? 'Отправить сейчас' : 'Обновить сейчас'}
          </Button>
        </>
      )}
    </div>
  );
}
