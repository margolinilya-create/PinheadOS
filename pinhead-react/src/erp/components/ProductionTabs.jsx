import { NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import styles from '../erp.module.css';

/**
 * Вкладки раздела «Производство»: Доска · План · Загрузка.
 *
 * Зачем. В меню было три соседних пункта — «Производство» (вёл на /board
 * с заголовком «Производственный план»), «План производства» (/plan) и
 * «Загрузка цехов» (/load). Название пункта не совпадало с заголовком
 * страницы, а два из трёх экранов отвечали на близкие вопросы: «что сейчас
 * в цехах» и «что цеха должны сдать по дням». Человек не мог предсказать,
 * куда ведёт какой пункт, и ходил перебором.
 *
 * Решение заказчика 03.08.2026: один пункт меню, внутри вкладки.
 *
 * Адреса /board, /plan и /load СОХРАНЕНЫ и стали адресами вкладок — вместо
 * переезда на /board/plan с редиректами. Так живы все закладки, ссылки в
 * переписке и `location.state.from`, по которому возвращаются экраны
 * задания; редирект же добавил бы лишний переход на самом частом пути.
 */

const TABS = [
  { to: '/board', label: 'Доска', icon: 'board', end: true,
    hint: 'Позиции по цехам: где что стоит прямо сейчас' },
  { to: '/plan', label: 'План', icon: 'calendar',
    hint: 'Недельная раскладка по дням: план, факт, отклонения' },
  { to: '/load', label: 'Загрузка', icon: 'route',
    hint: 'Сколько штук цех обязался сдать по дням' },
];

export function ProductionTabs() {
  return (
    <div className={styles.prodTabs} role="group" aria-label="Разделы производства">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          title={t.hint}
          className={({ isActive }) =>
            isActive ? `${styles.prodTab} ${styles.prodTabActive}` : styles.prodTab}
        >
          <Icon name={t.icon} size={15} />
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
