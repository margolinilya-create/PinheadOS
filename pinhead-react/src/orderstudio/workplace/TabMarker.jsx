import { Icon } from '../../erp/components/Icon';
import a11y from '../ui/a11y.module.css';
import { tabState } from './tabState';
import styles from './Workplace.module.css';

/**
 * Маркер готовности вкладки рабочего места (веха 8, задача 5).
 *
 * Текст маркера всегда в имени вкладки — его читает читалка экрана:
 * «— готово», «— не заполнено», «— не размещено: N». Видно его по ширине:
 * шире 480 px — текстом (готово — иконкой), на ≤ 480 px текст остаётся
 * только читалке, а глазу — точка (у «Дизайна» — бейдж с числом), иначе
 * ряд из четырёх вкладок не помещается в 375 px. Значки — `aria-hidden`.
 * Пробел перед маркером — отдельным текстовым узлом: внутри `<span>`
 * имя вкладки его теряет («Клиент— не заполнено»).
 */
export function TabMarker({ tabKey, order }) {
  const state = tabState(tabKey, order);
  if (!state) return null;
  if (state.ready) {
    return (
      <>
        {' '}
        <Icon name="check" size={14} className={styles.tabCheck} />
        <span className={a11y.srOnly}>— готово</span>
      </>
    );
  }
  return (
    <>
      {' '}
      <span className={styles.tabMarkText}>— {state.text}</span>
      <span
        className={state.count ? styles.tabBadge : styles.tabDot}
        aria-hidden="true"
        data-testid={`tab-mark-${tabKey}`}
      >
        {state.count ?? ''}
      </span>
    </>
  );
}
