import { useState } from 'react';
import {
  SIZE_PRESETS, SIZE_PRESET_LABELS, gridTotal, rowTotal, toggleSize,
} from '../../../utils/orderForm';
import { Icon } from '../../../components/Icon';
import { ScrollHintBox } from '../../../components/ScrollHintBox';
import { useCompactLayout } from '../../../layout/useCompactLayout';
import styles from '../../../styles';
import { Button } from '../../../components/Button';

/**
 * Редактор размерной сетки позиции: чипсы-пресеты задают СОСТАВ КОЛОНОК,
 * таблица — количества по цветам, итог по цвету справа, общий итог снизу.
 *
 * ТАБЛИЦА ВМЕСТО СТРОК С ПОДПИСЯМИ (правки заказчика 07.09, пп. 6–7:
 * «строки по цветам, столбцы по размерам, в ячейках количество; справа
 * показывать итог по цвету, отдельно общий итог по позиции»). Прежняя
 * раскладка повторяла подпись размера у КАЖДОЙ ячейки каждого цвета —
 * при трёх цветах и одиннадцати размерах это 33 подписи вместо одной шапки,
 * а сверить два цвета по одному размеру глазами было нельзя вовсе: колонки
 * не выстраивались.
 *
 * МОДЕЛЬ ДАННЫХ НЕ МЕНЯЛАСЬ: `size_grid` и так хранит `[{color, sizes}]` —
 * ровно «цвет × размер × количество». Правка касается ВИДА ввода, поэтому
 * ни миграции, ни `gridToPayload` здесь не участвуют.
 */
export function SizeGridEditor({ grid, onChange }) {
  const sizes = grid?.sizes ?? [];
  const rows = grid?.rows ?? [];
  const compact = useCompactLayout();
  const [preset, setPreset] = useState(() => {
    const inKids = sizes.some((s) => SIZE_PRESETS.kids.includes(s));
    const inAdult = sizes.some((s) => SIZE_PRESETS.adult.includes(s));
    return inKids && !inAdult ? 'kids' : 'adult';
  });
  const [customSize, setCustomSize] = useState('');
  const set = (patch) => onChange({ sizes, rows, ...patch });
  const total = gridTotal(grid);

  const onToggleSize = (sz) => {
    const g = toggleSize(grid, sz);
    // первая активация размера — сразу даём строку цвета для ввода количеств
    onChange(g.sizes.length > 0 && (g.rows?.length ?? 0) === 0
      ? { ...g, rows: [{ color: '', sizes: {} }] }
      : g);
  };

  const addCustom = () => {
    const v = customSize.trim();
    if (!v) return;
    if (!sizes.includes(v)) onToggleSize(v);
    setCustomSize('');
  };

  const setColor = (ri, value) =>
    set({ rows: rows.map((r, i) => (i === ri ? { ...r, color: value } : r)) });

  const setQty = (ri, sz, value) =>
    set({
      rows: rows.map((r, i) => (
        i === ri ? { ...r, sizes: { ...r.sizes, [sz]: Number(value) || 0 } } : r
      )),
    });

  const removeRow = (ri) => set({ rows: rows.filter((_, i) => i !== ri) });

  const presetSizes = preset === 'custom' ? [] : SIZE_PRESETS[preset];
  const shownSizes = [...presetSizes, ...sizes.filter((s) => !presetSizes.includes(s))];

  return (
    <div className={styles.sizeGrid}>
      <div className={styles.checkRow}>
        <span className={styles.fieldLabel}>Шкала</span>
        <div className={styles.tileRow} role="radiogroup" aria-label="Шкала размеров">
          {Object.entries(SIZE_PRESET_LABELS).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={preset === v}
              className={`${styles.tile} ${styles.tileSm} ${preset === v ? styles.tileActive : ''}`}
              onClick={() => setPreset(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.checkRow}>
        <span className={styles.fieldLabel}>Размеры</span>
        <div className={styles.tileRow} aria-label="Размеры сетки">
          {shownSizes.map((sz) => (
            <button
              key={sz}
              type="button"
              aria-pressed={sizes.includes(sz)}
              className={`${styles.tile} ${styles.tileSm} ${sizes.includes(sz) ? styles.tileActive : ''}`}
              onClick={() => onToggleSize(sz)}
            >
              {sz}
            </button>
          ))}
          {shownSizes.length === 0 && (
            <span className={styles.subText}>Добавьте свой размер ниже</span>
          )}
        </div>
      </div>
      {preset === 'custom' && (
        <div className={styles.checkRow}>
          <input
            className={`${styles.input} ${styles.inputSm} ${styles.customSizeInput}`}
            placeholder="Размер (56, 4XL…)"
            aria-label="Свой размер"
            value={customSize}
            onChange={(e) => setCustomSize(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
            }}
          />
          <Button variant="secondary" onClick={addCustom}>
            Добавить
          </Button>
        </div>
      )}

      {/*
        КОМПАКТНАЯ РАСКЛАДКА ОБЯЗАТЕЛЬНА (правило проекта — экран с таблицей).
        Одиннадцать размеров плюс цвет, итог и удаление — это тринадцать
        колонок; на планшете 768px они не помещаются даже с прокруткой, а
        поле ввода ужалось бы до нечитаемого. Карточка — на ЦВЕТ, внутри
        подписанные поля размеров: тот же приём, что у `DeptLoadCard`,
        и по той же причине — здесь МАТРИЦА, а не список.
      */}
      {sizes.length > 0 && compact && (
        <div className={styles.dataCardList} role="list" aria-label="Размерная сетка по цветам">
          {rows.map((row, ri) => (
            <div key={ri} className={styles.dataCard} role="listitem">
              <div className={styles.dataCardHead}>
                <input
                  className={`${styles.input} ${styles.inputSm} ${styles.colorInput}`}
                  placeholder="Цвет"
                  value={row.color}
                  aria-label={`Цвет ${ri + 1}`}
                  onChange={(e) => setColor(ri, e.target.value)}
                />
                <Button
                  variant="ghost"
                  aria-label={`Убрать цвет ${ri + 1}`}
                  onClick={() => removeRow(ri)}>
                  <Icon name="x" size={14} />
                </Button>
              </div>
              <div className={styles.dataCardFields}>
                {sizes.map((sz) => (
                  <label key={sz} className={styles.dataCardField}>
                    <span className={styles.dataCardFieldLabel}>{sz}</span>
                    <input
                      type="number"
                      min="0"
                      className={`${styles.input} ${styles.inputSm} ${styles.qtyCellInput}`}
                      value={row.sizes[sz] ?? ''}
                      aria-label={`${row.color || `Цвет ${ri + 1}`}, размер ${sz}`}
                      onChange={(e) => setQty(ri, sz, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              <div className={styles.dataCardGroup}>
                <span className={styles.subText}>
                  Итого по цвету: <strong>{rowTotal(row, sizes)} шт</strong>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {sizes.length > 0 && !compact && (
        <ScrollHintBox className={styles.tableWrap} label="Размерная сетка: цвет × размер">
          <table className={`${styles.table} ${styles.sizeGridTable}`}>
            <thead>
              <tr>
                <th scope="col">Цвет</th>
                {sizes.map((sz) => <th key={sz} scope="col">{sz}</th>)}
                <th scope="col">Итого</th>
                <th scope="col"><span className={styles.visuallyHidden}>Убрать цвет</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {/*
                    `scope="row"` у ячейки цвета: это МАТРИЦА, и без заголовков
                    строки скринридер читает число без ответа на вопрос «чьё
                    оно» (WCAG 1.3.1). У колонок — `scope="col"` выше.
                  */}
                  <th scope="row">
                    <input
                      className={`${styles.input} ${styles.inputSm} ${styles.colorInput}`}
                      placeholder="Цвет"
                      value={row.color}
                      aria-label={`Цвет ${ri + 1}`}
                      onChange={(e) => setColor(ri, e.target.value)}
                    />
                  </th>
                  {sizes.map((sz) => (
                    <td key={sz}>
                      <input
                        type="number"
                        min="0"
                        className={`${styles.input} ${styles.inputSm} ${styles.qtyCellInput}`}
                        value={row.sizes[sz] ?? ''}
                        aria-label={`${row.color || `Цвет ${ri + 1}`}, размер ${sz}`}
                        onChange={(e) => setQty(ri, sz, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className={styles.sizeGridTotal}>{rowTotal(row, sizes)}</td>
                  <td>
                    <Button
                      variant="ghost"
                      aria-label={`Убрать цвет ${ri + 1}`}
                      onClick={() => removeRow(ri)}>
                      <Icon name="x" size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Всего</th>
                {sizes.map((sz) => (
                  <td key={sz} className={styles.sizeGridTotal}>
                    {rows.reduce((s, r) => s + (Number(r.sizes?.[sz]) || 0), 0) || ''}
                  </td>
                ))}
                <td className={styles.sizeGridTotal}>{total}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </ScrollHintBox>
      )}

      {sizes.length > 0 && (
        <div className={styles.checkRow}>
          <Button variant="secondary" onClick={() => set({ rows: [...rows, { color: '', sizes: {} }] })}>
            + Цвет
          </Button>
        </div>
      )}
      <div className={styles.subText} aria-live="polite">
        Сумма по сетке: <strong>{total} шт</strong>
        {total > 0 && ' — подставится в количество позиции'}
      </div>
    </div>
  );
}
