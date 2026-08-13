import styles from '../erp.module.css';

/**
 * Видимая часть единого паттерна валидации форм ERP: текст ошибки под полем
 * и сводка у кнопки. Логика — в `useFormGate` (отдельный файл: смешивать
 * хук с компонентами в одном модуле не даёт fast-refresh).
 */

/** Текст ошибки под полем */
export function FieldError({ id, text }) {
  if (!text) return null;
  return <span id={id} className={styles.fieldError}>{text}</span>;
}

/**
 * Сводка у кнопки: «Осталось заполнить: …» и «Проверьте: …».
 *
 * Появляется только после первой попытки — до неё форма ничего не требует,
 * человек ещё её заполняет.
 */
export function FormGateHint({ gate }) {
  if (!gate.submitted) return null;
  return (
    <>
      {gate.missing.length > 0 && (
        <span className={styles.remainingHint} role="status">
          Осталось заполнить: {gate.missing.join(', ')}
        </span>
      )}
      {gate.invalid.length > 0 && (
        <span className={styles.remainingHint} role="status">
          Проверьте: {gate.invalid.join(', ')}
        </span>
      )}
    </>
  );
}
