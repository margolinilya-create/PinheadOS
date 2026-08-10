import { formatDateHuman } from '../utils/time';
import styles from '../erp.module.css';

/**
 * Поле даты: нативный `<input type="date">` плюс подпись под ним.
 *
 * Поле остаётся нативным намеренно — на планшетах цехов это системный календарь,
 * лучший тач-ввод, какой вообще есть, и свой компонент был бы хуже. Но формат
 * отображения задаёт локаль браузера: при en-US поле показывает `mm/dd/yyyy`,
 * и «08/14» читается двояко. Поэтому под полем всегда есть однозначное эхо
 * («14 авг. 2026»), а у пустого — ожидаемый порядок («дд.мм.гггг»).
 *
 * ПРЕСЕТЫ «Сегодня / +3 дня / +7 дней» УБРАНЫ (правки заказчика 10.08, P3):
 * блок дат просили упростить, а три кнопки под каждым полем занимали больше
 * места, чем само поле.
 *
 * ЭХО ОСТАВЛЕНО СОЗНАТЕЛЬНО, хотя документ называл его дублирующим. Оно и
 * появилось для того, чтобы снять неоднозначность нативного формата: без него
 * «08/14» в браузере с en-US читается и как 8 августа, и как 14 августа.
 * На сроках заказа это дороже одной строки под полем.
 *
 * Рендерит фрагмент: подпись поля даёт родительский `<label>`, как у остальных полей.
 */
export function DateField({
  value, onChange, showFormatHint = true, className, ...rest
}) {
  const echo = formatDateHuman(value);
  // В компактных строках фильтров подсказку пустого поля не показываем: там она
  // растянула бы строку вдвое, а цена ошибки — не производственная, а «не нашлось»
  if (!echo && !showFormatHint) {
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
      </span>
    </>
  );
}
