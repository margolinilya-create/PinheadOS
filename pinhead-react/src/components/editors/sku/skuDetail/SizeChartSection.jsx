import { Button } from '../../../../erp/components/Button';
import ScrollTable from '../ScrollTable';
import m from '../SkuModal.module.css';

const DEFAULT_SIZE_CHART = {
  headers: ['Размер', 'Длина', 'Ширина'], rows: [['S', '', ''], ['M', '', ''], ['L', '', ''], ['XL', '', '']],
};

/** Табель мер модели, см: колонки и строки правятся на месте */
export default function SizeChartSection({ sku, skuIndex, onUpdate }) {
  const chart = sku.sizeChart || DEFAULT_SIZE_CHART;
  const put = (next) => onUpdate(skuIndex, 'sizeChart', next);

  const setCell = (ri, ci, value) => put({ ...chart, rows: chart.rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? value : c)) : r)) });
  const setHeader = (ci, value) => put({ ...chart, headers: chart.headers.map((h, i) => (i === ci ? value : h)) });
  const addRow = () => put({ ...chart, rows: [...chart.rows, chart.headers.map(() => '')] });
  const removeRow = (ri) => put({ ...chart, rows: chart.rows.filter((_, i) => i !== ri) });
  const addColumn = () => put({ headers: [...chart.headers, 'Новая'], rows: chart.rows.map((r) => [...r, '']) });
  const removeColumn = (ci) => {
    if (chart.headers.length <= 2) return;
    put({ headers: chart.headers.filter((_, i) => i !== ci), rows: chart.rows.map((r) => r.filter((_, i) => i !== ci)) });
  };

  return (
    <section className={m.section} aria-labelledby="sku-detail-chart">
      <h3 id="sku-detail-chart" className={m.sectionHead}>
        Табель мер, см
        <span className={m.push} />
        <Button icon="plus" onClick={addColumn}>Колонка</Button>
        <Button icon="plus" onClick={addRow}>Размер</Button>
      </h3>
      <ScrollTable className={m.scroll} label="Табель мер, см">
        <table className={m.chart}>
          <thead>
            <tr>
              {chart.headers.map((h, ci) => (
                <th key={ci} scope="col">
                  <span className={m.headCell}>
                    <input className={m.cell} value={h} aria-label={`Название колонки ${ci + 1}`}
                      onChange={(e) => setHeader(ci, e.target.value)} />
                    {ci > 0 && (
                      <Button variant="ghost" iconOnly icon="x" aria-label={`Удалить колонку «${h}»`}
                        onClick={() => removeColumn(ci)} />
                    )}
                  </span>
                </th>
              ))}
              <th scope="col"><span className={m.inherited}>Строка</span></th>
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>
                    <input className={m.cell} value={cell} aria-label={`${chart.headers[ci] || 'Колонка'}, строка ${ri + 1}`}
                      onChange={(e) => setCell(ri, ci, e.target.value)} />
                  </td>
                ))}
                <td>
                  <Button variant="ghost" iconOnly icon="trash" aria-label={`Удалить строку ${ri + 1}`}
                    onClick={() => removeRow(ri)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
    </section>
  );
}
