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
import { AttachmentList } from '../../components/AttachmentList';
import { itemAttachments } from '../../utils/attachments';

/** Технический блок изделия: подпись и колонка. Порядок — как в форме создания */
/** Упаковка изделия: поля, которые документ перечисляет отдельно (п. 1) */
const PACKAGING_FIELDS = [
  ['packaging_size', 'Размер пакета'],
  ['sticker_place', 'Стикер'],
  ['marking_place', 'Маркировка'],
  ['packaging_note', 'Доп. требования'],
];

const TECH_FIELDS = [
  // Основная ткань идёт ПЕРВОЙ: ТЗ заказчика начинается с полотна,
  // а до правки 22.08 поля для неё не было вовсе (п. 5.1)
  ['main_fabric', 'Основная ткань'],
  ['trim_material', 'Отделочный материал'],
  ['cutting_note', 'Раскрой'],
  ['sewing_note', 'Пошив'],
  // Свободное поле бирок осталось для заказов, заведённых до правки 22.08:
  // структурные бирки показываются отдельным блоком ниже
  ['labels_note', 'Бирки (текстом)'],
];

/** Макет нанесения — вложение, привязанное к строке нанесения */
function PrintArtwork({ order, printId }) {
  const files = (order.attachments ?? []).filter((a) => a.print_id === printId);
  if (files.length === 0) return null;
  return <AttachmentList files={files} />;
}

/** Изображения заметки — вложения, привязанные к её строке */
function NoteImages({ order, noteId }) {
  const files = (order.attachments ?? []).filter((a) => a.note_id === noteId);
  if (files.length === 0) return null;
  return <AttachmentList files={files} />;
}

/** Макет бирки — вложение, привязанное к строке бирки */
function LabelArtwork({ order, labelId }) {
  const files = (order.attachments ?? []).filter((a) => a.label_id === labelId);
  if (files.length === 0) return null;
  return <AttachmentList files={files} />;
}

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
              {/*
                МАКЕТ ЭТОГО НАНЕСЕНИЯ (правка 22.08, п. 5.2). Раньше макеты
                лежали общей кучей файлов ТЗ, и при трёх-четырёх нанесениях
                цех сам угадывал, какой к какому относится.
              */}
              <PrintArtwork order={order} printId={p.id} />
            </div>
          ))}

          {/*
            БИРКИ ПОЗИЦИИ (п. 5.3). Одно текстовое поле на все бирки означало,
            что половина сведений теряется при беглом чтении, а макет
            не привязан ни к чему.
          */}
          {(item.labels ?? []).length > 0 && (
            <div>
              <div className={styles.fieldLabel}>Бирки</div>
              {[...item.labels].sort((a, b) => a.seq - b.seq).map((l) => (
                <div key={l.id} className={styles.printBlock}>
                  <div className={styles.checkRow}>
                    <strong>{l.label_type || `Бирка №${l.seq}`}</strong>
                    {l.place && <span>{l.place}</span>}
                    {l.size && <span className={styles.progressCell}>{l.size}</span>}
                  </div>
                  {l.comment && <div className={styles.subText}>{l.comment}</div>}
                  <LabelArtwork order={order} labelId={l.id} />
                </div>
              ))}
            </div>
          )}

          {/*
            ЗАМЕТКИ К ЗАКАЗУ (правка 22.08, п. 5.8): «они должны попадать
            в итоговое ТЗ для производства». Уровня заказа, поэтому стоят
            после позиции и подписаны как заметки — структурные поля выше
            они не заменяют.
          */}
          {(order.notes_list ?? []).length > 0 && (
            <div>
              <div className={styles.fieldLabel}>Заметки к заказу</div>
              {[...order.notes_list].sort((a, b) => a.seq - b.seq).map((n) => (
                <div key={n.id} className={styles.printBlock}>
                  {n.text && <div>{n.text}</div>}
                  <NoteImages order={order} noteId={n.id} />
                </div>
              ))}
            </div>
          )}

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
          {/* Файлы техблока и упаковки: схема узла, расположение бирки и
              стикера. Ради этого их и просили — адресат здесь, в задании цеха */}
          <AttachmentList
            label="Файлы техблока"
            files={itemAttachments(order, item.id, 'tech')}
          />
          {/* Размер пакета, стикер и маркировка — то, что цех читает
              при упаковке. В свободном комментарии они терялись */}
          {PACKAGING_FIELDS.some(([key]) => item[key]) && (
            <div>
              <div className={styles.fieldLabel}>Упаковка изделия</div>
              <ul className={styles.tzMatList}>
                {PACKAGING_FIELDS.map(([key, label]) => item[key] && (
                  <li key={key}>
                    <span className={styles.subText}>{label}: </span>{item[key]}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <AttachmentList
            label="Файлы упаковки"
            files={itemAttachments(order, item.id, 'packaging')}
          />

          {item.notes && <div className={styles.subText}>Заметка: {item.notes}</div>}
        </div>
      )}
    </>
  );
}
