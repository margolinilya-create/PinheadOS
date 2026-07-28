import { useFocusTrap } from '../../../hooks/useFocusTrap';
import styles from '../../erp.module.css';
import { Icon } from '../../components/Icon';

/**
 * Полноэкранный просмотр превью: закрытие по клику и Escape.
 * Фокус запирается тем же хуком, что и в TzViewer, — раньше при объявленном
 * `aria-modal` Tab свободно уходил на фон под оверлеем.
 */
export function Lightbox({ src, alt, onClose }) {
  const trapRef = useFocusTrap(true, onClose);
  return (
    <div
      ref={trapRef}
      className={styles.lightbox}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      <img src={src} alt={alt} className={styles.lightboxImg} />
      <button
        type="button"
        className={styles.lightboxClose}
        aria-label="Закрыть просмотр"
        onClick={onClose}
        autoFocus
      >
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}
