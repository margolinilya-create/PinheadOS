import { Icon } from '../../components/Icon';
import styles from '../../styles';

/** Кнопка «прикрепить фото» (камера на планшете/телефоне) */
export function PhotoAttach({ file, onFile, label }) {
  return (
    <label className={styles.fileBtn}>
      <Icon name="image" />
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
