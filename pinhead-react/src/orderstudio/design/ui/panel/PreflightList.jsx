import { useMemo } from 'react';
import { allowedMethods, printMethodProfile } from '../../../model/printMethods';
import { MSG_NO_PRINTS, preflight } from '../../export/preflight';
import styles from '../DesignTab.module.css';

const LEVEL = {
  serious: { label: 'Серьёзно', cls: styles.serious },
  warn: { label: 'Внимание', cls: styles.warnText },
  info: { label: 'Подсказка', cls: '' },
};

/**
 * Проверка макета (перенос DM `preflight`): только геометрия и файл, ничего
 * не блокирует (ответ владельца 17.10). Замечание с нанесением — кнопкой
 * «Показать» (выбрать его на холсте).
 */
export default function PreflightList({ flat, placements, rules, modelMismatch = false, onShow }) {
  const issues = useMemo(() => (placements.length === 0 && !modelMismatch ? [] : preflight({
    flat,
    placements,
    profileOf: printMethodProfile,
    methodAllowed: (area, method) => allowedMethods(area, rules).includes(method),
    modelMismatch,
  }).filter((i) => placements.length > 0 || i.message !== MSG_NO_PRINTS)), [flat, placements, rules, modelMismatch]);
  if (issues.length === 0) return null;
  return (
    <section className={styles.section} aria-label="Проверка макета">
      <h3 className={styles.sectionTitle}>Проверка макета</h3>
      <ul className={styles.issues}>
        {issues.map((iss, i) => (
          <li key={`${iss.printKey ?? ''}-${i}`} className={styles.issue}>
            <span className={LEVEL[iss.level].cls}>{LEVEL[iss.level].label}: {iss.message}</span>
            {iss.printKey && (
              <button type="button" className={styles.btn} onClick={() => onShow(iss.printKey)}>Показать</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
