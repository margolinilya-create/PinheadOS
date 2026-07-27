import { useRef } from 'react';
import styles from '../../../erp.module.css';

/**
 * Мелкие примитивы формы создания заказа: секция-аккордеон, текст ошибки поля
 * и кнопка выбора PDF. Вынесены из CreateOrderModal — они не знают ничего
 * о состоянии формы и переиспользуются всеми её секциями.
 */

export function FormSection({ id, title, summary, open, onToggle, children }) {
  return (
    <section className={styles.accSection}>
      <button
        type="button"
        className={styles.accHeader}
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <span className={styles.accChevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className={styles.accTitle}>{title}</span>
        {!open && summary && <span className={styles.accSummary}>{summary}</span>}
      </button>
      {open && <div id={id} className={styles.accBody}>{children}</div>}
    </section>
  );
}

/** Кнопка выбора PDF-файла ТЗ: скрытый input + вид обычной кнопки */
export function PdfPick({ label, onPick }) {
  const ref = useRef(null);
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => ref.current?.click()}>
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          onPick(file);
        }}
      />
    </>
  );
}

/** Текст ошибки под полем (инлайн-валидация) */
export function FieldError({ id, text }) {
  if (!text) return null;
  return <span id={id} className={styles.fieldError}>{text}</span>;
}
