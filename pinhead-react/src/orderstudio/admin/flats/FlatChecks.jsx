import { VIEW_LABELS } from '../../design/catalog/flatLabels';
import { DesignIcon } from '../../design/ui/DesignIcon';
import styles from './FlatEditor.module.css';
import checks from './FlatChecks.module.css';

/** Где замечание: «Перед · зона chest» */
function where(i) {
  return [i.view ? VIEW_LABELS[i.view] : null, i.areaId ? `зона ${i.areaId}` : null].filter(Boolean).join(' · ');
}

function Group({ id, title, icon, items, onGo }) {
  if (!items.length) return null;
  return (
    <div className={checks.checkGroup} data-kind={id}>
      <h4 id={`flat-checks-${id}`} className={checks.checkTitle}>
        <DesignIcon name={icon} />
        {`${title} (${items.length})`}
      </h4>
      <ul aria-labelledby={`flat-checks-${id}`}>
        {items.map((i, n) => (
          <li key={`${n}-${i.text}`} className={checks.checkItem}>
            <span>
              {i.text}
              {where(i) && <span className={styles.hint}>{` — ${where(i)}`}</span>}
            </span>
            <button type="button" className={styles.goBtn} onClick={() => onGo(i)} aria-label={`Перейти: ${i.text}`}>Перейти</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Замечания проверки флэта над кнопкой сохранения: «Нужно исправить (N)»
 * и «Стоит проверить (N)» — иконкой и текстом, не только цветом. «Перейти»
 * выбирает вид и зону и ставит фокус в поле замечания.
 */
export default function FlatChecks({ check, onGo }) {
  if (!check.errors.length && !check.warnings.length) return null;
  return (
    <div className={checks.checks2} id="flat-checks">
      <Group id="errors" title="Нужно исправить" icon="close" items={check.errors} onGo={onGo} />
      <Group id="warnings" title="Стоит проверить" icon="warning" items={check.warnings} onGo={onGo} />
    </div>
  );
}
