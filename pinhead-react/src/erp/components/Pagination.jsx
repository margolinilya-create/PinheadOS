import styles from '../erp.module.css';

/** Диапазон номеров страниц с многоточиями (1 … n-1 n n+1 … last) */
function pageRange(page, count) {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const set = new Set([1, count, page, page - 1, page + 1]);
  const arr = [...set].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of arr) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}

/** Пагинация таблиц (редизайн): номера страниц + «Показывать по: N» */
export function Pagination({ page, pageCount, total, pageSize, onPage, onPageSize, pageSizes = [10, 25, 50] }) {
  if (!total) return null;
  return (
    <div className={styles.pagination}>
      <span className={styles.subText}>Всего записей: {total}</span>
      {pageCount > 1 && (
        <div className={styles.pager}>
          <button type="button" className={styles.pageBtn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Назад">‹</button>
          {pageRange(page, pageCount).map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} className={styles.pageEllipsis}>…</span>
            ) : (
              <button
                key={p} type="button" aria-current={p === page ? 'page' : undefined}
                className={`${styles.pageBtn} ${p === page ? styles.pageBtnActive : ''}`}
                onClick={() => onPage(p)}
              >
                {p}
              </button>
            ))}
          <button type="button" className={styles.pageBtn} disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Вперёд">›</button>
        </div>
      )}
      {onPageSize && (
        <label className={styles.subText}>
          Показывать по:{' '}
          <select
            className={styles.select} value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Размер страницы"
          >
            {pageSizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
