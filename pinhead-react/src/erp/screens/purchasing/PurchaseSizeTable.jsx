import { useMemo } from 'react';
import { SizeResultTable } from '../../components/SizeResultTable';
import { gridCells, cellsToGrid, NO_COLOR } from '../../utils/sizeGrid';
import styles from '../../styles';

/**
 * РАЗМЕРЫ ВНУТРИ ЗАКУПКИ ГОТОВОГО ИЗДЕЛИЯ (правка заказчика 20.09, п. 2).
 *
 * Документ: «Внутри закупки показывать таблицу „Размер / Количество к заказу /
 * Фактическое количество". Количество к заказу — потребность из заказа.
 * Фактическое количество — сколько реально заказали у поставщика по каждому
 * размеру… Одна позиция заказа — одна закупка. Все размеры этой позиции
 * находятся внутри неё».
 *
 * ЧТО БЫЛО ДО ПРАВКИ. Разбивка показывалась ровно в одном месте — форме
 * «Новая закупка», и только на чтение (`SizeGridView`). В самой строке
 * закупки от неё оставалась однострочная сводка, а поля «сколько заказали
 * по размеру» не существовало ни в схеме, ни в интерфейсе. Заказчик так
 * и написал: «требование реализовано не полностью… размерной разбивки
 * на скриншоте нет».
 *
 * ПОЧЕМУ ТА ЖЕ ТАБЛИЦА, ЧТО У ЦЕХОВ. `SizeResultTable` уже умеет две
 * раскладки (таблица и карточки на планшете), связанные подписи и итоги.
 * Вторая реализация того же самого разошлась бы с первой — в проекте это
 * записанное правило, а не предпочтение.
 *
 * ИЗДЕЛИЕ БЕЗ РАЗМЕРОВ ТАБЛИЦЫ НЕ ПОЛУЧАЕТ: «для изделий без размеров
 * показывать только общее количество» — пустая таблица на ручку или
 * ежедневник была бы шумом.
 */
export function PurchaseSizeTable({
  plannedGrid,
  orderedGrid,
  onChange,
  disabled = false,
  caption = 'Размеры закупки',
}) {
  const planned = useMemo(() => gridCells(plannedGrid), [plannedGrid]);
  const ordered = useMemo(() => gridCells(orderedGrid), [orderedGrid]);

  const rows = useMemo(() => planned.map((cell) => ({
    key: `${cell.color}|${cell.size}`,
    color: cell.color,
    size: cell.size,
    label: cell.color === NO_COLOR ? cell.size : `${cell.size} · ${cell.color}`,
    expected: cell.qty,
  })), [planned]);

  const values = useMemo(() => Object.fromEntries(rows.map((row) => {
    const hit = ordered.find((c) => c.color === row.color && c.size === row.size);
    return [row.key, { ordered: hit ? String(hit.qty) : '' }];
  })), [rows, ordered]);

  if (rows.length === 0) return null;

  /**
   * Наружу уезжает СЕТКА, а не строки: `erp_materials.size_grid_ordered`
   * хранит тот же формат `[{color, sizes}]`, что и потребность, — и его же
   * понимают приёмка склада и сводки. Свой формат здесь означал бы
   * преобразование в каждом читателе.
   */
  const emit = (key, value) => {
    const next = rows.map((row) => {
      const raw = row.key === key ? value : values[row.key]?.ordered;
      return { color: row.color, size: row.size, qty: Math.max(Number(raw) || 0, 0) };
    });
    onChange(cellsToGrid(next));
  };

  return (
    <div className={styles.fieldWide}>
      <SizeResultTable
        rows={rows}
        columns={[{ code: 'ordered', label: 'Фактическое количество' }]}
        values={values}
        onChange={(key, _code, value) => emit(key, value)}
        expectedLabel="Количество к заказу"
        caption={caption}
        disabled={disabled}
      />
    </div>
  );
}
