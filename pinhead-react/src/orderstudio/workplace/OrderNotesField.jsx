import { useId } from 'react';
import { pluralize } from '../../utils/i18n';
import sales from '../screens/Sales.module.css';

/** Предел длины держит таблица (CHECK `orders_notes_len`, миграция L) и RPC (22023, миграция K) */
export const NOTES_MAX = 2000;
/** С этой длины — отдельная живая строка «Осталось N знаков» */
export const NOTES_WARN_FROM = 1900;

/**
 * «Комментарий для цехов» (`orders.notes`, веха 8, К5): печатается в ТЗ блоком
 * «Общее», видят все цеха. Подсказка и счётчик — в `aria-describedby`
 * (счётчик — не живой регион, иначе читалка говорила бы на каждую букву);
 * близко к пределу — отдельная живая строка. Правка закрыта вне черновика
 * (`fieldset disabled` вкладки) — поле только для чтения.
 */
export default function OrderNotesField({ value, onChange }) {
  const id = useId();
  const len = value.length;
  const left = NOTES_MAX - len;
  return (
    <div className={sales.field}>
      <label htmlFor={`${id}-notes`}>Комментарий для цехов</label>
      <textarea
        id={`${id}-notes`}
        className={sales.textarea}
        rows={3}
        maxLength={NOTES_MAX}
        value={value}
        aria-describedby={`${id}-hint ${id}-count`}
        onChange={(e) => onChange(e.target.value.slice(0, NOTES_MAX))}
      />
      <span id={`${id}-hint`} className={sales.muted}>Попадёт в ТЗ в блок „Общее“. Видят все цеха</span>
      <span id={`${id}-count`} className={sales.muted}>{len} из {NOTES_MAX}</span>
      <span role="status" className={sales.muted}>
        {len >= NOTES_WARN_FROM ? `Осталось ${left} ${pluralize(left, 'знак', 'знака', 'знаков')}` : ''}
      </span>
    </div>
  );
}

