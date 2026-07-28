import { formatDateHuman, shiftIsoDate } from '../utils/time';
import styles from '../erp.module.css';

/**
 * Пресеты сроков. Кнопки, а не «+N» руками: план завершения этапа и срок клиента
 * почти всегда «сегодня» либо «через несколько дней», и на планшете это одно касание
 * вместо трёх полей календаря.
 */
const PRESETS = [
  { label: 'Сегодня', days: 0 },
  { label: '+3 дня', days: 3 },
  { label: '+7 дней', days: 7 },
];

/**
 * Поле даты: нативный `<input type="date">` плюс подпись под ним.
 *
 * Поле остаётся нативным намеренно — на планшетах цехов это системный календарь,
 * лучший тач-ввод, какой вообще есть, и свой компонент был бы хуже. Но формат
 * отображения задаёт локаль браузера: при en-US поле показывает `mm/dd/yyyy`,
 * и «08/14» читается двояко. Поэтому под полем всегда есть однозначное эхо
 * («14 авг. 2026»), а у пустого — ожидаемый порядок («дд.мм.гггг»).
 *
 * Рендерит фрагмент: подпись поля даёт родительский `<label>`, как у остальных полей.
 */
export function DateField({
  value, onChange, presets = false, showFormatHint = true, className, ...rest
}) {
  const echo = formatDateHuman(value);
  // В компактных строках фильтров подсказку пустого поля не показываем: там она
  // растянула бы строку вдвое, а цена ошибки — не производственная, а «не нашлось»
  if (!echo && !showFormatHint && !presets) {
    return (
      <input
        type="date"
        className={className ?? styles.input}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    );
  }
  return (
    <>
      <input
        type="date"
        className={className ?? styles.input}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      <span className={styles.dateHint}>
        {echo
          ? <span className={styles.dateEcho}>{echo}</span>
          : showFormatHint && <span className={styles.dateFormatHint}>дд.мм.гггг</span>}
        {presets && (
          <span className={styles.datePresets}>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`${styles.chip} ${styles.chipBtn} ${styles.chipNeutral}`}
                onClick={() => onChange(shiftIsoDate(null, p.days))}
              >
                {p.label}
              </button>
            ))}
          </span>
        )}
      </span>
    </>
  );
}
