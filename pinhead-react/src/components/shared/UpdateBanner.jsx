import { useShallow } from 'zustand/react/shallow';
import { useAppUpdateStore } from '../../store/useAppUpdateStore';
import { UPDATE_TITLE } from '../../lib/appUpdate';
import styles from './UpdateBanner.module.css';

export const UPDATE_BANNER_TEXT = 'Обновите страницу, когда закончите текущее '
  + 'действие: несохранённое в открытых формах при этом пропадёт.';

/**
 * Плашка «Вышло обновление приложения».
 *
 * Появляется, когда наблюдатель версии (`lib/appVersion`) увидел на сервере
 * другую сборку, — ДО того, как первый ленивый экран не загрузится. Живёт
 * в `GlobalHosts`: обновление одинаково касается «Производства», Order Studio
 * и экранов входа, а две точки монтирования — два условия показа.
 *
 * Не модалка и не тост: тост исчезает сам, а это сообщение обязано дождаться,
 * пока человек закончит действие; модалка перебила бы ввод. «Позже» прячет
 * на полчаса (`SNOOZE_MS`), потом плашка возвращается — выкатка никуда
 * не делась, и следующий переход всё равно упрётся в неё.
 *
 * Регион смонтирован всегда, даже пустой: скринридер объявляет изменения
 * ВНУТРИ существующего live-региона (то же правило, что у `Toast`
 * и `StaleDataBar`). Имя региона своё — «статусов» на странице несколько.
 */
export default function UpdateBanner({ onReload = () => window.location.reload() }) {
  const { available, snoozedUntil, snooze } = useAppUpdateStore(useShallow((s) => ({
    available: s.available,
    snoozedUntil: s.snoozedUntil,
    snooze: s.snooze,
  })));
  const show = available && snoozedUntil === 0;

  return (
    <div
      className={show ? styles.bar : styles.hidden}
      role="status"
      aria-live="polite"
      aria-label="Обновление приложения"
    >
      {show && (
        <>
          <span className={styles.text}>
            <strong>{UPDATE_TITLE}.</strong> {UPDATE_BANNER_TEXT}
          </span>
          <span className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onReload}>Обновить</button>
            <button type="button" className={styles.ghost} onClick={() => snooze()}>Позже</button>
          </span>
        </>
      )}
    </div>
  );
}
