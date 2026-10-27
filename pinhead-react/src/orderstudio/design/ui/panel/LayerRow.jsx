import { useId } from 'react';
import { DesignIcon } from '../DesignIcon';
import { printMethodProfile } from '../../../model/printMethods';
import { PRINT_STATUS_TEXT } from './printStatus';
import styles from '../DesignTab.module.css';

/**
 * Строка слоя (перенос DM `LayerRow`): номер нанесения в позиции (номер в ТЗ),
 * зона, Ш × В, техника. Кнопки — выше, ниже, дубль, «Снять с изделия»;
 * у каждой `aria-label` с номером нанесения, тач-цель ≥ 44 px.
 * Удаления строки здесь нет — только на вкладке «Изделие» (проверка скиллами).
 */
export default function LayerRow({
  entry, selected, readOnly, first, last, mainRef, onSelect, onUp, onDown, onDuplicate, onUnplace, status = null,
}) {
  const statusId = useId();
  const { print, index } = entry;
  const st = status ? PRINT_STATUS_TEXT[status] : null;
  const n = index + 1;
  const size = print.width_mm && print.height_mm ? `${print.width_mm} × ${print.height_mm} мм` : 'без размера';
  return (
    <li className={`${styles.layer}${selected ? ` ${styles.layerSelected}` : ''}`}>
      <button
        ref={mainRef}
        type="button"
        className={styles.layerMain}
        aria-pressed={selected}
        aria-describedby={st ? statusId : undefined}
        onClick={() => onSelect(selected ? null : print.key)}
      >
        Нанесение {n} · {print.zone || 'без зоны'} · {size} · {printMethodProfile(print.method).short}
        {entry.pl.stale ? ' · силуэт обновлён' : ''}
      </button>
      {/* Статус проверки (веха 5в, Э2): текстом, знак — только глазам */}
      {st && (
        <span id={statusId} className={`${styles.layerStatus} ${styles[`status_${status}`]}`}>
          <span aria-hidden="true">{st.sign} </span>{st.text}
        </span>
      )}
      {!readOnly && (
        <>
          <button type="button" className={styles.iconBtn} onClick={onUp} disabled={last} aria-label={`Выше: нанесение ${n}`}>
            <DesignIcon name="chevronUp" />
          </button>
          <button type="button" className={styles.iconBtn} onClick={onDown} disabled={first} aria-label={`Ниже: нанесение ${n}`}>
            <DesignIcon name="chevronDown" />
          </button>
          <button type="button" className={styles.iconBtn} onClick={onDuplicate} aria-label={`Дублировать нанесение ${n}`}>
            <DesignIcon name="copy" />
          </button>
          <button type="button" className={styles.iconBtn} onClick={onUnplace} aria-label={`Снять с изделия нанесение ${n}`}>
            <DesignIcon name="close" />
          </button>
        </>
      )}
    </li>
  );
}
