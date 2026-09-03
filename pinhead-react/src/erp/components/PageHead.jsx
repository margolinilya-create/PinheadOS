import { useEffect } from 'react';
import { Icon } from './Icon';
import styles from '../erp.module.css';

/**
 * Шапка экрана: единственный `h1` страницы и подпись под ним.
 *
 * ОНА ЖЕ СТАВИТ `document.title` (правка 03.09). Во всём разделе заголовок
 * документа не менялся НИ РАЗУ: пятнадцать экранов жили под общим
 * «Pinhead Order Studio» из `index.html`. Для скринридера это значит, что
 * при переходе не сообщается, куда человек пришёл (WCAG 2.4.2), а диспетчер
 * с пятью открытыми вкладками — обычный рабочий день — различал их только
 * по памяти о порядке открытия.
 *
 * Заголовок ставится ЗДЕСЬ, а не в роутере: `PageHead` уже знает название
 * экрана и уже рисуется внутри каждого из них, а таблица «маршрут → название»
 * в роутере была бы вторым источником тех же слов — и разошлась бы с первым
 * в первую же правку.
 */
const SUFFIX = 'Pinhead';

export function PageHead({ title, sub }) {
  useEffect(() => {
    if (!title) return undefined;
    const prev = document.title;
    document.title = `${title} · ${SUFFIX}`;
    // Возврат прежнего значения при размонтировании: экран ушёл — его имя
    // не должно оставаться в заголовке вкладки
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
