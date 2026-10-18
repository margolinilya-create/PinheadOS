import ScrollTable from './ScrollTable';
import { Button } from '../../../erp/components/Button';
import a11y from '../../../orderstudio/ui/a11y.module.css';
import SupplierName from './SupplierName';
import t from './skuTable.module.css';

/** Вкладка «Отделочная ткань»: рибана и кашкорсе — за метр, воротник — за штуку */
export default function SkuTrimsTab({ trimCatalog, changedTrims, updateTrim, addTrim, deleteTrim, readOnly = false }) {
  return (
    <div className={t.body}>
      <div className={t.toolbar}>
        <span className={t.count}>Отделок: {trimCatalog.length}</span>
        <span className={t.spacer} />
        {!readOnly && <Button icon="plus" onClick={addTrim}>Добавить отделку</Button>}
      </div>
        <ScrollTable label="Отделочные ткани" readOnly={readOnly}>
          <table className={t.table}>
            <thead>
              <tr>
                <th scope="col">Название</th>
                <th scope="col">Поставщик</th>
                <th scope="col">Вид</th>
                <th scope="col">Цена, ₽</th>
                <th scope="col">Ед.</th>
                <th scope="col">м/кг</th>
                <th scope="col"><span className={a11y.srOnly}>Удалить</span></th>
              </tr>
            </thead>
            <tbody>
              {trimCatalog.map((tr, i) => (
                <tr key={tr.code + i} className={changedTrims.has(i) ? t.changed : undefined}>
                  <td>{tr.name}</td>
                  <td><SupplierName name={tr.supplier} /></td>
                  <td>
                    <select className={t.select} value={tr.kind || ''} aria-label={`Вид отделки: ${tr.name}`}
                      onChange={(e) => updateTrim(i, 'kind', e.target.value || null)}>
                      <option value="">по названию</option>
                      <option value="ribana">рибана</option>
                      <option value="kashkorse">кашкорсе</option>
                      <option value="collar">воротник</option>
                    </select>
                  </td>
                  <td>
                    <input className={`${t.input} ${t.numInput}`} type="number" step="0.01" min="0" value={tr.priceRub ?? ''}
                      aria-label={`Цена: ${tr.name}`}
                      onChange={(e) => updateTrim(i, 'priceRub', Number(e.target.value) || 0)} />
                    {!(tr.priceRub > 0) && tr.priceUSD > 0 && (
                      <div className={t.legacy}>было {tr.priceUSD} $ — проверить: цена за кг?</div>
                    )}
                  </td>
                  <td>
                    <select className={t.select} value={tr.unit || 'm'} aria-label={`Единица: ${tr.name}`}
                      onChange={(e) => updateTrim(i, 'unit', e.target.value)}>
                      <option value="m">за метр</option>
                      <option value="pcs">за штуку</option>
                    </select>
                  </td>
                  <td>
                    {tr.unit === 'pcs' ? <span className={t.dim}>—</span> : (
                      <input className={`${t.input} ${t.numInput}`} type="number" step="0.01" min="0" value={tr.mPerKg ?? ''}
                        aria-label={`Метров в килограмме: ${tr.name}`}
                        onChange={(e) => updateTrim(i, 'mPerKg', Number(e.target.value) || null)} />
                    )}
                  </td>
                  <td>
                    <Button variant="ghost" icon="trash" iconOnly aria-label={`Удалить отделку: ${tr.name}`}
                      onClick={() => deleteTrim(i)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      <p className={t.hint}>Рибана — футболкам и лонгам, кашкорсе — худи и свитшотам, воротник — поло и регбийкам (в штуках). Отделка берётся у поставщика выбранной ткани.</p>
    </div>
  );
}
