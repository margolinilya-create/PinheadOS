import { useId, useMemo, useRef } from 'react';
import { DesignIcon } from '../DesignIcon';
import { orderArtworks } from '../../model/orderArtworks';
import styles from '../DesignTab.module.css';

const ACCEPT = '.svg,.png,.jpg,.jpeg,.webp,.pdf,.ai,image/svg+xml,image/png,image/jpeg,image/webp,application/pdf';

/**
 * «Загрузить логотип» и «Логотипы заказа» (план, задача 5: файл — сразу в бакет,
 * нанесение — одним `commit`). `onAdded(key)` — ключ поставленного нанесения:
 * вкладка выбирает его и ставит фокус в «Ширину».
 */
export default function ArtworkPicker({ order, art, onAdded }) {
  const inputId = useId();
  const reasonId = useId();
  // Закрыто по условию (силуэт не от модели) — aria-disabled с причиной: кнопка в фокусе, причина видна
  const blocked = art.blockedReason || '';
  const inputRef = useRef(null);
  const known = useMemo(() => orderArtworks(order), [order]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const key = await art.addFile(file);
    if (key) onAdded(key);
  };

  return (
    <section className={styles.section} aria-label="Логотипы">
      <input id={inputId} ref={inputRef} type="file" accept={ACCEPT} className={styles.fileInput} tabIndex={-1} aria-hidden="true" onChange={onFile} />
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => { if (!blocked) inputRef.current?.click(); }}
        disabled={art.busy}
        aria-busy={art.busy}
        aria-disabled={blocked ? 'true' : undefined}
        aria-describedby={blocked ? reasonId : undefined}
      >
        <DesignIcon name="upload" />
        {art.busy ? 'Загружаю логотип…' : 'Загрузить логотип'}
      </button>
      {blocked && <p id={reasonId} className={`${styles.notice} ${styles.warn}`}>{blocked}</p>}
      <p className={styles.muted}>PNG, JPEG, WEBP, SVG, PDF или AI (PDF-совместимый) до 25 МБ. Можно перетащить на холст или вставить Ctrl+V.</p>
      {known.length > 0 && (
        <details className={styles.details}>
          <summary>Логотипы заказа · {known.length}</summary>
          <div className={styles.row}>
            {known.map((a) => (
              <button
                key={a.path}
                type="button"
                className={styles.btn}
                disabled={art.busy}
                aria-disabled={blocked ? 'true' : undefined}
                aria-describedby={blocked ? reasonId : undefined}
                onClick={async () => {
                  if (blocked) return;
                  const key = await art.addExisting(a);
                  if (key) onAdded(key);
                }}
              >
                Поставить «{a.asset.source_file || 'логотип'}»
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
