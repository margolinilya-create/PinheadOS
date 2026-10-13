import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import {
  choiceKey, isSizeTaken, freeChoices, normalizeSize,
} from '../../utils/sizeChoices';
import { NO_COLOR } from '../../utils/sizeGrid';
import { cellKey } from '../../utils/cellKey';
import styles from '../../styles';

/** Значение селекта, включающее ручной ввод размера */
const OTHER = '__other__';

/**
 * РАЗМЕРЫ С ОДНОГО РУЛОНА — СТРОКИ, А НЕ КОЛОНКИ ТАБЛИЦЫ (правка 20.09, п. 7).
 *
 * Раньше здесь рисовалась таблица по ВСЕМ ячейкам размерной сетки позиции,
 * и у позиции без сетки не оставалось ничего, кроме одного поля «Скроено,
 * шт» — именно это заказчик и описал как «не фиксируется, какие размеры
 * выкроены». Теперь строку добавляют и удаляют, две появляются сразу
 * («с одного рулона обычно кроят сразу два размера»), а список размеров
 * берётся из сетки, когда она есть, и из стандартной шкалы, когда её нет.
 *
 * Вынесено из `CutRollsSection` 27.09 (п. 4): секция получила учёт
 * в метрах и параметры рулона, и потолок размера файла требовал резки.
 *
 * КОМПАКТНО И С ЗАПИСАННЫМ (правка 05.10, п. 5): «компактную таблицу
 * выпуска по размерам и цветам… уже записанный выпуск и новую партию
 * показывать отдельно». У строки — сколько этого размера уже записано
 * прежними сдачами (`reported`, ключ ячейки), поле — только новая партия.
 */
export function CutSizeRows({ rows, choices, disabled, onRows, reported = {} }) {
  return (
    <div className={styles.cutSizes}>
      <span className={styles.fieldLabel}>Выпуск с этого рулона, шт</span>
      {rows.map((row, ri) => {
        const isOther = Boolean(row.size)
          && !choices.some((c) => c.size === row.size && c.color === row.color);
        const current = choices.find((c) => c.size === row.size && c.color === row.color);
        const already = row.size ? (reported[cellKey(row.color || NO_COLOR, row.size)] ?? 0) : 0;
        return (
          <div key={ri} className={styles.cutSizeRow}>
            <label className={styles.field}>
              <span className={styles.visuallyHidden}>Размер, строка {ri + 1}</span>
              <select
                className={styles.select}
                value={isOther ? OTHER : (current ? choiceKey(current) : '')}
                disabled={disabled}
                aria-label={`Размер, строка ${ri + 1}`}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === OTHER) {
                    onRows(rows.map((r, i) => (i === ri ? { ...r, size: '', color: NO_COLOR } : r)));
                    return;
                  }
                  const pick = choices.find((c) => choiceKey(c) === v);
                  onRows(rows.map((r, i) => (i === ri
                    ? { ...r, size: pick?.size ?? '', color: pick?.color ?? NO_COLOR }
                    : r)));
                }}
              >
                <option value="">{choices.length ? 'Выберите размер…' : 'Сетки нет — размер вне заказа'}</option>
                {choices.map((c) => (
                  <option
                    key={choiceKey(c)}
                    value={choiceKey(c)}
                    /* Занятый в ЭТОМ рулоне размер не выбирается повторно:
                       документ просит менять количество в существующей
                       строке, а не заводить вторую */
                    disabled={isSizeTaken(rows, c, ri)}
                  >
                    {c.label}
                    {c.planned !== null ? ` (в заказе ${c.planned})` : ''}
                    {isSizeTaken(rows, c, ri) ? ' — уже в этом рулоне' : ''}
                  </option>
                ))}
                <option value={OTHER}>Размер вне заказа…</option>
              </select>
            </label>

            {/* Ручной ввод — для позиций, заведённых без размерной сетки,
                и для нестандартных обозначений старых заказов */}
            {isOther || (!row.size && !current) ? (
              <label className={styles.field}>
                <span className={styles.visuallyHidden}>Свой размер, строка {ri + 1}</span>
                <input
                  type="text"
                  className={`${styles.input} ${styles.qtySmallInput}`}
                  value={row.size}
                  disabled={disabled}
                  placeholder="свой"
                  aria-label={`Свой размер, строка ${ri + 1}`}
                  onChange={(e) => onRows(rows.map((r, i) => (i === ri
                    ? { ...r, size: normalizeSize(e.target.value) } : r)))}
                />
              </label>
            ) : null}

            <label className={`${styles.field} ${styles.cutQtyField}`}>
              <span className={styles.visuallyHidden}>Скроено, строка {ri + 1}</span>
              <input
                type="number" min="0" step="1" inputMode="numeric"
                className={`${styles.input} ${styles.qtySmallInput}`}
                value={row.qty}
                disabled={disabled}
                placeholder="шт"
                aria-label={`Скроено, шт${row.size ? `, размер ${row.size}` : ''}, строка ${ri + 1}`}
                onChange={(e) => onRows(rows.map((r, i) => (i === ri
                  ? { ...r, qty: e.target.value } : r)))}
              />
            </label>
            {already > 0 && <span className={styles.subText}>записано {already}</span>}

            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label={`Убрать строку размера ${ri + 1}`}
              onClick={() => onRows(rows.filter((_, i) => i !== ri))}
            >
              ✕
            </Button>
          </div>
        );
      })}

      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => onRows([
          ...rows,
          ...freeChoices(choices, rows, 1).map(
            (c) => ({ size: c.size, color: c.color, qty: '' }),
          ),
          // Свободных вариантов не осталось — строка заводится пустой:
          // размер в ней человек напишет руками
          ...(freeChoices(choices, rows, 1).length === 0
            ? [{ size: '', color: NO_COLOR, qty: '' }] : []),
        ])}
      >
        <Icon name="plus" size={14} /> Добавить размер
      </Button>
    </div>
  );
}
