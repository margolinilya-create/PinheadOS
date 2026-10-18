import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { zonesCount } from '../tabs/flatsView';
import { flatHref, flatLinkId } from './flatsListView';
import styles from '../tabs/FlatsTab.module.css';

/**
 * Список флэтов: на компьютере — таблица, вся строка — ссылка на флэт
 * (растянутая ссылка в названии, видимый фокус); на телефоне — карточки
 * (имя, тип, версия, статус). `focusId` — ссылка, на которую вернуть фокус.
 */
export default function FlatsList({ rows, compact, focusId, onFocused }) {
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(flatLinkId(focusId))?.focus();
    onFocused();
  }, [focusId, onFocused]);

  if (compact) {
    return (
      <ul className={styles.cards} aria-label={`Флэтов в справочнике: ${rows.length}`}>
        {rows.map((r) => (
          <li key={r.id} className={r.active ? styles.card : `${styles.card} ${styles.off}`}>
            <Link id={flatLinkId(r.id)} to={flatHref(r.id)} className={styles.cardLink}>
              <span className={styles.cardName}>{r.name}</span>
              <span className={styles.code}>{`${r.type} · версия ${r.version}${r.active ? '' : ' · снят'}`}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    // Таблица шире окна прокручивается сама: область в порядке Tab и с именем (axe, как PaletteEditor)
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- axe scrollable-region-focusable
    <div className={styles.scroll} role="region" aria-labelledby="flats-caption" tabIndex={0}>
      <table className={styles.table}>
        <caption id="flats-caption" className={styles.caption}>{`Флэтов в справочнике: ${rows.length}`}</caption>
        <thead>
          <tr>
            <th scope="col">Название</th>
            <th scope="col">Тип</th>
            <th scope="col">Подбор</th>
            <th scope="col">Версия</th>
            <th scope="col">Виды</th>
            <th scope="col">Зоны</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.active ? styles.row : `${styles.row} ${styles.off}`}>
              <th scope="row">
                <Link id={flatLinkId(r.id)} to={flatHref(r.id)} className={styles.rowLink}>{r.name}</Link>
                <span className={styles.code}>{r.id}</span>
                {!r.active && <span className={styles.badge}>Снят</span>}
              </th>
              <td>{r.type}</td>
              <td>
                {r.kind}
                {r.models && <span className={styles.code}>{`Модели: ${r.models}`}</span>}
              </td>
              <td>{r.version}</td>
              <td>{r.views}</td>
              <td>
                {zonesCount(r.zoneCount)}
                <span className={styles.code}>{r.zones.join(', ')}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
