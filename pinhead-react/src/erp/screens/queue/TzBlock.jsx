import { useMemo, useState } from 'react';
import { formatDateShort } from '../../utils/time';
import {
  BRANDING_METHOD_LABELS,
  MATERIAL_STATUS_LABELS,
  PACKAGING_LABELS,
  STICKERS_LABELS,
} from '../../types';
import styles from '../../erp.module.css';

/**
 * Полное ТЗ позиции: сетка, нанесения, упаковка, материалы.
 * По умолчанию — сворачиваемый блок (очередь цеха). `hideToggle` + `defaultOpen` — статичный
 * режим для вкладки «ТЗ» боковой карточки заказа (без кнопки, всегда раскрыт).
 */
export function TzBlock({ order, item, defaultOpen = false, hideToggle = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = hideToggle || open;
  const prints = useMemo(
    () => [...(item.prints ?? [])].sort((a, b) => a.seq - b.seq),
    [item.prints],
  );
  const allSizes = useMemo(
    () => (item.size_grid?.length
      ? [...new Set(item.size_grid.flatMap((r) => Object.keys(r.sizes)))]
      : []),
    [item.size_grid],
  );

  return (
    <>
      {!hideToggle && (
        <button
          type="button"
          className={`btn btn-secondary ${styles.tzToggle}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          📋 ТЗ позиции {open ? '▲' : '▼'}
        </button>
      )}

      {expanded && (
        <div className={styles.tzBlock}>
          <div className={styles.checkRow}>
            {item.variant && (
              <span className={`${styles.chip} ${styles.chipNeutral}`}>Вариант: {item.variant}</span>
            )}
            {order.packaging && order.packaging !== 'none' && (
              <span className={`${styles.chip} ${styles.chipNeutral}`}>
                📦 {PACKAGING_LABELS[order.packaging]}
                {order.packaging_note ? `: ${order.packaging_note}` : ''}
              </span>
            )}
            {order.stickers && order.stickers !== 'none' && (
              <span className={`${styles.chip} ${styles.chipNeutral}`}>
                🏷 Стикеры: {STICKERS_LABELS[order.stickers]}
                {order.stickers_note ? ` — ${order.stickers_note}` : ''}
              </span>
            )}
            {order.no_chestny_znak && (
              <span className={`${styles.chip} ${styles.chipDanger}`}>Без Честного знака</span>
            )}
          </div>

          {item.size_grid && item.size_grid.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Цв/Разм</th>
                    {allSizes.map((sz) => <th key={sz}>{sz}</th>)}
                    <th>Итог</th>
                  </tr>
                </thead>
                <tbody>
                  {item.size_grid.map((r, i) => (
                    <tr key={i}>
                      <td><strong>{r.color}</strong></td>
                      {allSizes.map((sz) => (
                        <td key={sz} className={styles.progressCell}>{r.sizes[sz] ?? '—'}</td>
                      ))}
                      <td className={styles.progressCell}>
                        <strong>{Object.values(r.sizes).reduce((a, b) => a + b, 0)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {prints.map((p) => (
            <div key={p.id} className={styles.printBlock}>
              <div className={styles.checkRow}>
                <strong>Нанесение №{p.seq} · {BRANDING_METHOD_LABELS[p.method] || p.method}</strong>
                {p.zone && <span>{p.zone}</span>}
                {(p.width_mm || p.height_mm) && (
                  <span className={styles.progressCell}>
                    {p.height_mm ?? '?'}×{p.width_mm ?? '?'} мм
                  </span>
                )}
                {p.pantone && (
                  <span className={`${styles.chip} ${styles.chipNeutral}`}>Pantone {p.pantone}</span>
                )}
              </div>
              {(p.offset_note || p.comment) && (
                <div className={styles.subText}>
                  {[p.offset_note, p.comment].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          ))}

          <div>
            <div className={styles.fieldLabel}>Материалы</div>
            {(order.materials ?? []).length > 0 ? (
              <ul className={styles.tzMatList}>
                {order.materials.map((m) => {
                  const pending = m.status !== 'received' && m.status !== 'not_needed';
                  const eta = pending ? formatDateShort(m.eta_date) : '';
                  return (
                    <li key={m.id}>
                      {m.name}
                      {m.qty ? ` · ${m.qty}` : ''}
                      <span className={styles.subText}> — {MATERIAL_STATUS_LABELS[m.status] || m.status}</span>
                      {pending && (
                        <span className={styles.subText}> · план {eta || 'не указан'}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className={styles.subText}>Материалы не ожидаются.</div>
            )}
          </div>

          {item.notes && <div className={styles.subText}>Заметка: {item.notes}</div>}
        </div>
      )}
    </>
  );
}
