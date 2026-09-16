import { gridCells, gridRowsTotal, gridSizes, NO_COLOR } from '../../utils/sizeGrid';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import styles from '../../styles';

/**
 * РАЗБИВКА ЗАКУПКИ ПО РАЗМЕРАМ, ТОЛЬКО ДЛЯ ЧТЕНИЯ (правка 16.09, п. 2).
 *
 * Показывает то, что уже решено заказом: «100 шт — XS 10 / S 20 / M 30 /
 * L 25 / XL 15». Правится разбивка ТАМ, где ей место, — в позиции заказа;
 * здесь её редактирование означало бы, что закупка и заказ расходятся молча,
 * а склад принимает по третьему числу.
 *
 * Одна строка на цвет: у позиции с цветовым делением «XS» само по себе
 * не адресует ячейку.
 */
export function SizeGridView({ grid, caption = 'Размерная разбивка' }) {
  const sizes = gridSizes(grid);
  const total = gridRowsTotal(grid);
  if (sizes.length === 0) return null;

  const cells = gridCells(grid);
  const colors = [...new Set(cells.map((c) => c.color))];
  const qtyOf = (color, size) => cells.find((c) => c.color === color && c.size === size)?.qty ?? 0;
  const rowTotal = (color) => cells
    .filter((c) => c.color === color)
    .reduce((s, c) => s + c.qty, 0);

  return (
    <ScrollHintBox className={styles.tableWrap} label={caption}>
      {/* Липкая первая колонка — правило раздела для матриц «цвет × размер» */}
      <table className={`${styles.table} ${styles.gridStickyFirst}`}>
        <thead>
          <tr>
            <th scope="col">{colors.length === 1 && colors[0] === NO_COLOR ? 'Размеры' : 'Цвет'}</th>
            {sizes.map((size) => <th key={size} scope="col">{size}</th>)}
            <th scope="col">Итого</th>
          </tr>
        </thead>
        <tbody>
          {colors.map((color) => (
            <tr key={color}>
              <th scope="row">{color}</th>
              {sizes.map((size) => <td key={size}>{qtyOf(color, size) || '—'}</td>)}
              <td><b>{rowTotal(color)}</b></td>
            </tr>
          ))}
        </tbody>
        {colors.length > 1 && (
          <tfoot>
            <tr>
              <th scope="row">Всего</th>
              {sizes.map((size) => (
                <td key={size}>
                  {colors.reduce((s, color) => s + qtyOf(color, size), 0) || '—'}
                </td>
              ))}
              <td><b>{total}</b></td>
            </tr>
          </tfoot>
        )}
      </table>
    </ScrollHintBox>
  );
}
