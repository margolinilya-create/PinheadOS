import { formatDateHuman } from '../utils/time';
import { shouldShowDateEcho } from '../utils/dateLocale';
import styles from '../erp.module.css';

/**
 * Поле даты: нативный `<input type="date">` плюс подпись под ним.
 *
 * Поле остаётся нативным намеренно — на планшетах цехов это системный календарь,
 * лучший тач-ввод, какой вообще есть, и свой компонент был бы хуже. Но формат
 * отображения задаёт локаль браузера: при en-US поле показывает `mm/dd/yyyy`,
 * и «08/14» читается двояко. Поэтому под полем есть однозначное эхо
 * («14 авг. 2026»), а у пустого — ожидаемый порядок («дд.мм.гггг»).
 *
 * ПРЕСЕТЫ «Сегодня / +3 дня / +7 дней» УБРАНЫ (правки заказчика 10.08, P3):
 * блок дат просили упростить, а три кнопки под каждым полем занимали больше
 * места, чем само поле.
 *
 * ЭХО ТЕПЕРЬ ПОЯВЛЯЕТСЯ ПО ФОРМАТУ БРАУЗЕРА, А НЕ ВСЕГДА (правка 16.09, п. 3).
 *
 * Прежняя редакция этого комментария говорила «эхо оставлено СОЗНАТЕЛЬНО,
 * хотя документ называл его дублирующим», и правило это верное — но оно
 * отвечало не на тот вопрос. Эхо нужно ровно там, где поле показывает дату
 * НЕОДНОЗНАЧНО, то есть месяцем вперёд («10/07»). Когда браузер пишет день
 * первым — «07.10.2026», — эхо повторяет ту же дату теми же цифрами, и вот
 * это и есть дублирование, на которое жалуется документ 16.09.
 *
 * Правило не отменено, а уточнено: `echo="auto"` (по умолчанию) спрашивает
 * `Intl.DateTimeFormat`, что стоит первым — день или месяц
 * (`utils/dateLocale`), и при неизвестном формате ОСТАВЛЯЕТ эхо. Лишняя
 * строка под полем — шум; перепутанный месяц — перенесённый срок заказа.
 *
 * Рендерит фрагмент: подпись поля даёт родительский `<label>`, как у остальных полей.
 */
export function DateField({
  value, onChange, showFormatHint = true, echo: echoMode = 'auto', className, ...rest
}) {
  const echo = shouldShowDateEcho(echoMode) ? formatDateHuman(value) : '';
  // В компактных строках фильтров подсказку пустого поля не показываем: там она
  // растянула бы строку вдвое, а цена ошибки — не производственная, а «не нашлось»
  const hint = showFormatHint && shouldShowDateEcho(echoMode);
  if (!echo && !hint) {
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
          : hint && <span className={styles.dateFormatHint}>дд.мм.гггг</span>}
      </span>
    </>
  );
}
