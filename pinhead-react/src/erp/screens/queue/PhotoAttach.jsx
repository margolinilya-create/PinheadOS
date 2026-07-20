import styles from '../../erp.module.css';

/** Кнопка «прикрепить фото» (камера на планшете/телефоне) */
export function PhotoAttach({ file, onFile, label }) {
  return (
    <label className={styles.fileBtn}>
      <span aria-hidden="true">📷</span>
      <span className={styles.fileBtnText}>{file ? file.name : label}</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.visuallyHidden}
        aria-label={label}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}
