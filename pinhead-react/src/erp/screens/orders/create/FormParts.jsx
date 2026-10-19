import { useRef } from 'react';
import { Icon } from '../../../components/Icon';
import styles from '../../../styles';
import { Button } from '../../../components/Button';

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
        <span className={styles.accChevron} aria-hidden="true">
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        </span>
        <span className={styles.accTitle}>{title}</span>
        {!open && summary && <span className={styles.accSummary}>{summary}</span>}
      </button>
      {open && <div id={id} className={styles.accBody}>{children}</div>}
    </section>
  );
}

/**
 * Кнопка выбора файлов ТЗ: скрытый input + вид обычной кнопки.
 *
 * Пачкой (правка 19.10, п. 4): «при одном открытии окна выбора выделить
 * несколько файлов». `onPick` получает массив — пустой при отмене выбора.
 */
export function PdfPick({ label, onPick }) {
  const ref = useRef(null);
  return (
    <>
      {/* `data-pick-focus` — сюда возвращается фокус, когда убрана последняя строка */}
      <Button variant="secondary" data-pick-focus onClick={() => ref.current?.click()}>
        {label}
      </Button>
      <input
        ref={ref}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Сброс значения: иначе повторный выбор того же файла не поднимет change
          e.target.value = '';
          if (files.length > 0) onPick(files);
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
