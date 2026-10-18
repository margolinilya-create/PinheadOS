import { FABRIC_SUPPLIERS } from '../../../data/fabricsCatalog';
import { SearchInput } from '../../../erp/components/SearchInput';
import ScrollTable from './ScrollTable';
import { Button } from '../../../erp/components/Button';
import a11y from '../../../orderstudio/ui/a11y.module.css';
import SupplierName from './SupplierName';
import t from './skuTable.module.css';

const CATEGORY_NAMES = {
  tshirts:'Футболки', longsleeves:'Лонгсливы', polo:'Поло',
  sweatshirts:'Свитшоты', halfzips:'Халф-зипы',
  hoodies:'Худи', ziphoodies:'Зип-худи',
  pants:'Штаны', shorts:'Шорты', bombers:'Бомберы', accessories:'Шопперы',
};

/** Вкладка «Основная ткань»: цена — за погонный метр, поиск по модели, поставщику и ткани */
export default function SkuFabricsTab({
  fabricSupplierFilter, setFabricSupplierFilter,
  fabricSearch, setFabricSearch,
  filteredFabrics, fabricsCatalog, changedFabrics,
  updateFabric, addFabric, deleteFabric, readOnly = false,
}) {
  return (
    <div className={t.body}>
      <div className={t.toolbar}>
        <div className={t.chips} role="group" aria-label="Поставщик">
          {['all', ...FABRIC_SUPPLIERS].map((s) => (
            <button key={s} type="button" className={t.chip} aria-pressed={fabricSupplierFilter === s}
              onClick={() => setFabricSupplierFilter(s)}>
              {s === 'all' ? 'Все' : s}
            </button>
          ))}
        </div>
        <SearchInput value={fabricSearch} onChange={setFabricSearch}
          placeholder="Модель, поставщик, ткань: «худи медас футер»" ariaLabel="Поиск тканей" />
        <span className={t.count}>Тканей: {filteredFabrics.length}</span>
        <span className={t.spacer} />
        {!readOnly && <Button icon="plus" onClick={addFabric}>Добавить ткань</Button>}
      </div>

        <ScrollTable label="Основные ткани" readOnly={readOnly}>
          <table className={t.table}>
            <thead>
              <tr>
                <th scope="col">Название</th>
                <th scope="col">Состав</th>
                <th scope="col">Плотность</th>
                <th scope="col">Поставщик</th>
                <th scope="col">Используется в</th>
                <th scope="col">₽ за пог. м</th>
                <th scope="col">м/кг</th>
                <th scope="col">≈ ₽/кг</th>
                <th scope="col"><span className={a11y.srOnly}>Удалить</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredFabrics.map((f) => {
                const realIdx = fabricsCatalog.indexOf(f);
                return (
                  <tr key={f.code + realIdx} className={changedFabrics.has(realIdx) ? t.changed : undefined}>
                    <td>{f.name}</td>
                    <td className={t.dim}>{f.composition || '—'}</td>
                    <td className={t.num}>{f.density ? `${f.density} г/м²` : '—'}</td>
                    <td><SupplierName name={f.supplier} /></td>
                    <td>
                      {(f.forCategories || []).map((c) => (
                        <span key={c} className={t.pill}>{CATEGORY_NAMES[c] || c}</span>
                      ))}
                    </td>
                    <td>
                      <input className={`${t.input} ${t.numInput}`} type="number" step="0.01" min="0" value={f.priceRub ?? ''}
                        aria-label={`Цена за метр: ${f.name}`}
                        onChange={(e) => updateFabric(realIdx, 'priceRub', Number(e.target.value) || 0)} />
                      {!(f.priceRub > 0) && f.priceUSD > 0 && (
                        <div className={t.legacy}>было {f.priceUSD} $ — проверить: цена за кг?</div>
                      )}
                    </td>
                    <td>
                      <input className={`${t.input} ${t.numInput}`} type="number" step="0.01" min="0" value={f.mPerKg ?? ''}
                        aria-label={`Метров в килограмме: ${f.name}`}
                        onChange={(e) => updateFabric(realIdx, 'mPerKg', Number(e.target.value) || null)} />
                    </td>
                    <td className={`${t.num} ${t.right}`}>
                      {f.priceRub > 0 && f.mPerKg > 0 ? `${Math.round(f.priceRub * f.mPerKg)} ₽` : '—'}
                    </td>
                    <td>
                      <Button variant="ghost" icon="trash" iconOnly aria-label={`Удалить ткань: ${f.name}`}
                        onClick={() => deleteFabric(realIdx)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollTable>
      {filteredFabrics.length === 0 && (
        <p className={t.hint} role="status">Ткань не найдена — уточните запрос: модель, поставщик, название или плотность.</p>
      )}
      <p className={t.hint}>Цена — за 1 погонный метр. «м/кг» нужен только для пересчёта при закупке в килограммах; цену за кг сюда не вписывать.</p>
    </div>
  );
}
