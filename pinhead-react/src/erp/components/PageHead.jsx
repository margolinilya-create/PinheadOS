import { useEffect } from 'react';
import { Icon } from './Icon';
import styles from '../erp.module.css';

/** Общий хвост заголовка вкладки — по нему раздел узнают среди десятка вкладок */
const TITLE_SUFFIX = 'PINHEAD ERP';

/**
 * Заголовок экрана. Он же задаёт `document.title` (M-13 отчёта QA 13.08.2026):
 * во всех разделах ERP во вкладке браузера стояло «Pinhead Order Studio» —
 * чужое имя, одинаковое на всех страницах. При десятке открытых вкладок
 * (обычный день диспетчера) отличить склад от закупки было нельзя, история
 * браузера превращалась в список одинаковых строк, а закладка не говорила,
 * куда ведёт.
 *
 * Заголовок ставит именно `PageHead`, а не таблица «маршрут → название»:
 * второй список разошёлся бы с первым, а здесь название ровно то, что человек
 * видит на странице. Экран без `PageHead` заголовка не меняет — это заметно
 * сразу, в отличие от забытой строки в таблице.
 */
export function PageHead({ title, sub }) {
  useEffect(() => {
    if (!title) return undefined;
    const prev = document.title;
    document.title = `${title} · ${TITLE_SUFFIX}`;
    // Возврат прежнего значения обязателен: экраны размонтируются при переходе,
    // и без него заголовок «залипал» бы от предыдущей страницы при уходе
    // на экран без PageHead.
    return () => { document.title = prev; };
  }, [title]);

  return (
    <div className={styles.pageHead}>
      <h1 className={styles.pageTitle}>{title}</h1>
      {sub && <div className={styles.pageSub}>{sub}</div>}
    </div>
  );
}

export function Stub({ icon = 'settings', title, text, phase }) {
  return (
    <div className={styles.stub}>
      <div className={styles.stubIcon}><Icon name={icon} size={34} /></div>
      <div>{title}</div>
      {text && <div className={styles.stubText}>{text}</div>}
      {phase && <div className={styles.stubPhase}>{phase}</div>}
    </div>
  );
}
