import { useMemo } from 'react';
import { sendChecklist } from '../tz/model/sendChecklist';
import RouteView from './RouteView';
import styles from './Launch.module.css';

/** Пункты, которые экран показывает отдельно: маржа — строкой сводки, мост — в маршруте */
const SHOWN_ELSEWHERE = /^(margin|bridge:)/;

/**
 * Нижняя часть правой колонки «К запуску»: чек-лист в форме факта для МС и
 * маршрут. Чек-лист только для чтения и запуск не блокирует: блокирующих у
 * отправленного заказа быть не должно (сервер проверил при отправке), но
 * справочники могли смениться — МС видит это и возвращает менеджеру.
 *
 * @param {{
 *   order: import('../model/types').SalesOrder,
 *   catalogs: import('../tz/model/tzDocTypes').TzCatalogs | null,
 *   warnings: string[],
 * }} props
 */
export default function LaunchSide({ order, catalogs, warnings }) {
  const items = useMemo(() => {
    if (!catalogs) return null;
    return sendChecklist(order, catalogs, { audience: 'ms', marginPct: null, minMarginPct: null })
      .filter((i) => !SHOWN_ELSEWHERE.test(i.id));
  }, [order, catalogs]);

  return (
    <>
      <section className={styles.block} aria-labelledby="launch-check">
        <h3 id="launch-check" className={styles.blockTitle}>Проверка заказа</h3>
        {items === null && <p className={styles.muted}>Справочники загружаются…</p>}
        {items?.length === 0 && <p className={styles.ok}>Замечаний нет</p>}
        {items && items.length > 0 && (
          <ul className={styles.checklist}>
            {items.map((i) => (
              <li key={i.id} className={i.blocking ? styles.blocking : undefined}>
                {i.blocking && <span className={styles.srOnly}>Блокирует: </span>}
                {i.text}
              </li>
            ))}
          </ul>
        )}
      </section>
      <RouteView order={order} warnings={warnings} />
    </>
  );
}
