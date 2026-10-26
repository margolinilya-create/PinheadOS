import { useMemo } from 'react';
import { LEVEL_LABELS, preflightIssues } from './preflightIssues';
import styles from '../DesignTab.module.css';

const LEVEL = {
  serious: { label: LEVEL_LABELS.serious, cls: styles.serious },
  warn: { label: LEVEL_LABELS.warn, cls: styles.warnText },
  info: { label: LEVEL_LABELS.info, cls: '' },
};

/**
 * Проверка макета (перенос DM `preflight`): только геометрия и файл, ничего
 * не блокирует (ответ владельца 17.10). Замечание с нанесением — кнопкой
 * «Показать» (выбрать его на холсте).
 */
export default function PreflightList({ flat, placements, rules, modelMismatch = false, onShow }) {
  const issues = useMemo(() => preflightIssues(flat, placements, rules, modelMismatch), [flat, placements, rules, modelMismatch]);
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
