import { useMemo, useState } from 'react';
import { formatDateShort } from '../../utils/time';
import {
  BRANDING_METHOD_LABELS,
  MATERIAL_STATUS_LABELS,
} from '../../types';
import { hasPackaging, itemPackaging, packagingLabel, stickersLabel } from '../../utils/packaging';
import styles from '../../erp.module.css';
import { Icon } from '../../components/Icon';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { Button } from '../../components/Button';

/** Технический блок изделия: подпись и колонка. Порядок — как в форме создания */
const TECH_FIELDS = [
  ['trim_material', 'Отделочный материал'],
  ['cutting_note', 'Раскрой'],
  ['sewing_note', 'Пошив'],
  ['labels_note', 'Бирки'],
];

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
  /**
   * Упаковка позиции: своя или общая по заказу — одно правило на весь проект
   * (`utils/packaging`), потому что мест, где может лежать ответ, стало два.
   */
  const packaging = useMemo(() => itemPackaging(order, item), [order, item]);
  const stickers = stickersLabel(order.stickers, order.stickers_note);
  const allSizes = useMemo(
    () => (item.size_grid?.length
      ? [...new Set(item.size_grid.flatMap((r) => Object.keys(r.sizes)))]
      : []),
    [item.size_grid],
  );

  return (
    <>
      {!hideToggle && (
        <Button
          variant="secondary"
          className={styles.tzToggle}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}>
          <Icon name="orders" size={15} /> ТЗ позиции
          <Icon name="chevronDown" size={15} className={open ? styles.chevronUp : undefined} />
        </Button>
      )}

      {expanded && (
        <div className={styles.tzBlock}>
          <div className={styles.checkRow}>
            {item.variant && (
              <span className={`${styles.chip} ${styles.chipNeutral}`}>Вариант: {item.variant}</span>
            )}
            {item.fit && (
              <span className={`${styles.chip} ${styles.chipNeutral}`}>Крой: {item.fit}</span>
            )}
            {/* Упаковка ПОЗИЦИИ: своя, а при `inherit` — общая по заказу.
                Правило разрешения одно на весь проект — utils/packaging. */}
            {hasPackaging(packaging) && (
              <span className={`${styles.chip} ${styles.chipNeutral}`}>
                <Icon name="box" size={13} />{packagingLabel(packaging)}
                {packaging.inherited ? '' : ' (у этого изделия)'}
              </span>
            )}
            {stickers && (
              <span className={`${styles.chip} ${styles.chipNeutral}`}>
                <Icon name="tag" size={13} />Стикеры: {stickers}
              </span>
            )}
            {order.no_chestny_znak && (
              <span className={`${styles.chip} ${styles.chipWaiting}`}>Без Честного знака</span>
            )}
          </div>

          {item.size_grid && item.size_grid.length > 0 && (
            <ScrollHintBox className={styles.tableWrap} label="Документы ТЗ">
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
            </ScrollHintBox>
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

          {/* Технический блок изделия (правка заказчика 16.08): цех читает его
              здесь же, где сетку и нанесения. Пустые поля не показываются —
              подпись без значения это шум, а не «поле есть». */}
          {TECH_FIELDS.some(([key]) => item[key]) && (
            <div>
              <div className={styles.fieldLabel}>Технические особенности</div>
              <ul className={styles.tzMatList}>
                {TECH_FIELDS.map(([key, label]) => item[key] && (
                  <li key={key}>
                    <span className={styles.subText}>{label}: </span>{item[key]}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {item.notes && <div className={styles.subText}>Заметка: {item.notes}</div>}
        </div>
      )}
    </>
  );
}
