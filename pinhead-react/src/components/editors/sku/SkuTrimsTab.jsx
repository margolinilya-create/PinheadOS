const SUPPLIER_COLORS = {
  'Медас': '#2B2BF0',
  'ТД Коттон': '#06A77D',
  'ТониТекс': '#C87137',
};


export default function SkuTrimsTab({
  trimCatalog, changedTrims,
  updateTrim, addTrim, deleteTrim,
}) {
  return (
    <div className="sku-ed-body">
      <div className="sku-ed-toolbar">
        <span className="sku-ed-count">{trimCatalog.length} отделок</span>
        <button className="sku-ed-add-btn" onClick={addTrim}>+ Добавить</button>
      </div>
      <table className="fabrics-table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Поставщик</th>
            <th>Вид</th>
            <th>Цена, ₽</th>
            <th>Ед.</th>
            <th>м/кг</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {trimCatalog.map((t, i) => (
            <tr key={t.code + i} className={changedTrims.has(i) ? 'fabric-changed' : ''}>
              <td>{t.name}</td>
              <td>
                <span className="supplier-dot" style={{ background: SUPPLIER_COLORS[t.supplier] || 'var(--text-dim)' }} />
                {t.supplier || '—'}
              </td>
              <td>
                <select className="fabric-price-inp" value={t.kind || ''} aria-label={`Вид отделки: ${t.name}`}
                  onChange={e => updateTrim(i, 'kind', e.target.value || null)}>
                  <option value="">по названию</option>
                  <option value="ribana">рибана</option>
                  <option value="kashkorse">кашкорсе</option>
                  <option value="collar">воротник</option>
                </select>
              </td>
              <td>
                <input className="fabric-price-inp" type="number" step="0.01" min="0" value={t.priceRub ?? ''}
                  aria-label={`Цена: ${t.name}`}
                  onChange={e => updateTrim(i, 'priceRub', Number(e.target.value) || 0)} />
                {!(t.priceRub > 0) && t.priceUSD > 0 && (
                  <div className="fabric-legacy-hint">было {t.priceUSD} $ — проверить: цена за кг?</div>
                )}
              </td>
              <td>
                <select className="fabric-price-inp" value={t.unit || 'm'} aria-label={`Единица: ${t.name}`}
                  onChange={e => updateTrim(i, 'unit', e.target.value)}>
                  <option value="m">за метр</option>
                  <option value="pcs">за штуку</option>
                </select>
              </td>
              <td>
                {t.unit === 'pcs' ? '—' : (
                  <input className="fabric-price-inp" type="number" step="0.01" min="0" value={t.mPerKg ?? ''}
                    aria-label={`Метров в килограмме: ${t.name}`}
                    onChange={e => updateTrim(i, 'mPerKg', Number(e.target.value) || null)} />
                )}
              </td>
              <td><button className="sku-del-btn" onClick={() => deleteTrim(i)} aria-label="Удалить отделку">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pe-hint">Рибана — футболкам и лонгам, кашкорсе — худи и свитшотам, воротник — поло и регбийкам (в штуках). Отделка берётся у поставщика выбранной ткани.</p>
    </div>
  );
}
