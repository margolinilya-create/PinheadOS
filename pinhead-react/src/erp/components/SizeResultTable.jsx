import { useId } from 'react';
import { useCompactLayout } from '../layout/useCompactLayout';
import { ScrollHintBox } from './ScrollHintBox';
import styles from '../styles';

/**
 * ТАБЛИЦА РЕЗУЛЬТАТА ПО РАЗМЕРАМ (правки заказчика 16.09, пп. 1, 4, 6).
 *
 * ОДНА таблица на три правки: приёмка готового изделия («заказано → принято»),
 * раскрой с рулона («заказано → скроено») и результат пошива («принято из
 * закроя → сшито / брак / в переделку»). Колонки задаёт вызывающий, потому
 * что различаются они только колонками — а строки, итоги, раскладка
 * и доступность у всех трёх одни и те же.
 *
 * ПОЧЕМУ У НЕЁ ДВЕ РАСКЛАДКИ. Это цеховой экран: приёмку открывают со склада,
 * результат сдают из цеха, то есть с планшета. Таблица с полями ввода
 * в третьей колонке жмётся там в треть экрана — на этом уже ловились
 * (приёмка материалов, сессия 62, её пришлось перестраивать в форму).
 * Поэтому строки объявлены ОДИН раз, а рисуются либо таблицей, либо
 * карточками; повторять описание строк нельзя — копии разъезжаются.
 *
 * ПОДПИСЬ КАЖДОГО ПОЛЯ СВЯЗАНА С КОНТРОЛОМ. В таблице `<label>` вокруг
 * `<input>` внутри ячейки был бы избыточен, поэтому связь даёт
 * `aria-label` с ПОЛНЫМ смыслом («XS · чёрный, сшито») — иначе скринридер
 * читает десять одинаковых «Сшито» подряд и не говорит, к какому размеру
 * каждое относится.
 */
export function SizeResultTable({
  rows,
  columns,
  values,
  onChange,
  expectedLabel = 'Заказано',
  caption,
  disabled = false,
}) {
  const compact = useCompactLayout();
  const tableId = useId();

  const cellValue = (row, col) => values?.[row.key]?.[col.code] ?? '';

  const totals = columns.map((col) => rows.reduce(
    (sum, row) => sum + (Number(cellValue(row, col)) || 0), 0,
  ));
  const expectedTotal = rows.reduce((sum, row) => sum + (Number(row.expected) || 0), 0);

  const field = (row, col) => (
    <input
      type="number"
      min="0"
      max={col.max ? col.max(row) : undefined}
      inputMode="numeric"
      className={`${styles.input} ${styles.qtySmallInput}`}
      value={cellValue(row, col)}
      disabled={disabled}
      onChange={(e) => onChange(row.key, col.code, e.target.value)}
      aria-label={`${row.label}, ${col.label}`}
    />
  );

  if (compact) {
    return (
      <div className={styles.dataCardList} role="list" aria-label={caption}>
        {rows.map((row) => (
          <div key={row.key} className={styles.dataCard} role="listitem">
            <div className={styles.dataCardHead}>
              <span className={styles.dataCardTitle}>{row.label}</span>
              <span className={styles.subText}>{expectedLabel}: {row.expected}</span>
            </div>
            <div className={styles.dataCardFields}>
              {columns.map((col) => (
                <div key={col.code} className={styles.dataCardField}>
                  <span className={styles.dataCardFieldLabel}>{col.label}</span>
                  {field(row, col)}
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className={styles.queueReason} role="status">
          Итого {expectedLabel.toLowerCase()}: <b>{expectedTotal}</b>
          {columns.map((col, i) => (
            <span key={col.code}> · {col.label}: <b>{totals[i]}</b></span>
          ))}
        </p>
      </div>
    );
  }

  return (
    <ScrollHintBox className={styles.tableWrap} label={caption}>
      {/* Липкая первая колонка — правило раздела для матриц «цвет × размер»:
          дойдя до XXL горизонтальной прокруткой, цех иначе теряет имя строки */}
      <table className={`${styles.table} ${styles.gridStickyFirst}`} id={tableId}>
        <thead>
          <tr>
            <th scope="col">Размер</th>
            <th scope="col">{expectedLabel}</th>
            {columns.map((col) => <th key={col.code} scope="col">{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {/* Первая колонка — заголовок строки: без `scope="row"` экранный
                  диктор не связывает поле ввода с размером */}
              <th scope="row">{row.label}</th>
              <td>{row.expected}</td>
              {columns.map((col) => <td key={col.code}>{field(row, col)}</td>)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Итого</th>
            <td><b>{expectedTotal}</b></td>
            {columns.map((col, i) => <td key={col.code}><b>{totals[i]}</b></td>)}
          </tr>
        </tfoot>
      </table>
    </ScrollHintBox>
  );
}
