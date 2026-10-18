import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { cutExtrasText } from '../../utils/cutExtras';
import { NO_COLOR } from '../../utils/sizeGrid';
import css from './CutResultTable.module.css';

/**
 * «РЕЗУЛЬТАТ КРОЯ» (правки 19.10, Р5): выпуск вводится ОДИН раз — по сетке
 * позиции, сколько бы материалов (полотно, рибана) ни ушло в крой. Прежде
 * размеры вводились на каждом рулоне, и два материала одной позиции
 * удваивали годные. Брак и комментарий — общие поля формы, не здесь.
 *
 * Размер, которого нет в заказе, — только отдельным действием «Размер вне
 * заказа…» (правка 05.10, п. 2: стандартная шкала не подставляется).
 */
export function CutResultTable({ cut, disabled = false }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [color, setColor] = useState('');
  const [addError, setAddError] = useState('');
  const titleId = useId();
  const addErrorId = useId();
  const colors = [...new Set(cut.sizesRows.filter((r) => !r.extra).map((r) => r.color))]
    .filter((c) => c !== NO_COLOR);

  const add = () => {
    const err = cut.addSize(draft, color || colors[0] || NO_COLOR);
    setAddError(err ?? '');
    if (!err) { setDraft(''); setAdding(false); }
  };

  return (
    <section className={css.section} aria-labelledby={titleId}>
      <h3 id={titleId} className={css.title}>Результат кроя</h3>
      {!cut.hasGrid && (
        <p className={css.warn} role="note">
          <Icon name="alert" size={13} />
          {' '}
          У позиции нет размерной сетки. Стандартные размеры не подставляются —
          укажите размер вручную («Размер вне заказа…»).
        </p>
      )}
      {cut.sizesRows.length > 0 && (
        <table className={css.table}>
          <thead>
            <tr>
              <th scope="col">Размер</th>
              <th scope="col">В заказе</th>
              <th scope="col">Скроено сейчас, шт</th>
            </tr>
          </thead>
          <tbody>
            {cut.sizesRows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className={css.size}>
                  {row.label}
                  {row.reported > 0 && <span className={css.sub}> · записано {row.reported}</span>}
                </th>
                <td className={css.num}>{row.extra ? <span className={css.sub}>вне заказа</span> : row.planned}</td>
                <td>
                  <input
                    type="number" min="0" step="1" inputMode="numeric"
                    className={css.input}
                    value={cut.cells[row.key] ?? ''}
                    disabled={disabled}
                    onChange={(e) => cut.setCell(row.key, e.target.value)}
                    onBlur={cut.commit}
                    aria-label={`Скроено, шт — ${row.label}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding ? (
        <div className={css.addRow}>
          {colors.length > 1 && (
            <label className={css.field}>
              <span className={css.label}>Цвет</span>
              <select className={css.input} value={color || colors[0]} onChange={(e) => setColor(e.target.value)}>
                {colors.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          <label className={css.field}>
            <span className={css.label}>Размер вне заказа</span>
            <input
              type="text"
              className={css.input}
              value={draft}
              autoFocus /* действие открыто кнопкой — фокус сразу в поле */
              aria-invalid={addError ? true : undefined}
              aria-describedby={addError ? addErrorId : undefined}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            />
          </label>
          <Button variant="secondary" size="sm" disabled={disabled} onClick={add}>Добавить размер</Button>
          <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setAddError(''); }}>Отмена</Button>
          {addError && <span id={addErrorId} className={css.error}>{addError}</span>}
        </div>
      ) : (
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Размер вне заказа…
        </Button>
      )}

      <p className={css.sub}>
        Записано сейчас: <b>{cut.goodTotal}</b> шт
        {cut.extras.total > 0 && <> · Плюс: {cutExtrasText(cut.extras)}</>}
      </p>
    </section>
  );
}
