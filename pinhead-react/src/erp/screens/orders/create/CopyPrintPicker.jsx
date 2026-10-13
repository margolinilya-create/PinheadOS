import { BRANDING_METHOD_LABELS } from '../../../types';
import styles from '../../../styles';

/**
 * Выбор «откуда копировать нанесение» (п. 5.4).
 *
 * Селект, а не кнопка «копировать всё»: позиций бывает четыре, нанесений
 * в каждой несколько, и человеку нужно назвать КОНКРЕТНОЕ. Показываем только
 * заполненные нанесения других позиций — пустая строка в списке
 * не отличалась бы от заполненной.
 */
export function CopyPrintPicker({ items, target, onCopy }) {
  const options = [];
  (items ?? []).forEach((src, si) => {
    if (si === target) return;
    (src.prints ?? []).forEach((p, pi) => {
      if (!p.zone?.trim() && !p.pantone?.trim() && !p.comment?.trim()) return;
      options.push({
        si,
        pi,
        label: `Поз. ${si + 1}${src.product_type ? ` (${src.product_type})` : ''} · `
          + `${BRANDING_METHOD_LABELS[p.method] || p.method}`
          + `${p.zone?.trim() ? ` — ${p.zone.trim()}` : ''}`,
      });
    });
  });
  if (options.length === 0 || !onCopy) return null;

  return (
    <label className={styles.checkLabel}>
      <span className={styles.subText}>Копировать нанесение:</span>
      <select
        className={`${styles.select} ${styles.inputSm}`}
        value=""
        aria-label={`Копировать нанесение в позицию ${target + 1}`}
        onChange={(e) => {
          const opt = options[Number(e.target.value)];
          if (opt) onCopy(target, opt.si, opt.pi);
          e.target.value = '';
        }}
      >
        <option value="">выбрать источник…</option>
        {options.map((o, idx) => (
          <option key={`${o.si}:${o.pi}`} value={idx}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
