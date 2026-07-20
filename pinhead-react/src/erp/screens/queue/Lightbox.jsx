import { useEffect } from 'react';
import styles from '../../erp.module.css';

/** Полноэкранный просмотр превью: закрытие по клику и Escape */
export function Lightbox({ src, alt, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
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
        ✕
      </button>
    </div>
  );
}
