const SUPPLIER_COLORS = {
  'Медас': '#2B2BF0',
  'ТД Коттон': '#06A77D',
  'ТониТекс': '#C87137',
};

export default function SkuTrimsTab({
  trimCatalog, changedTrims, usdRate,
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
            <th>$/м</th>
            <th>≈ ₽/м</th>
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
                <input className="fabric-price-inp" type="number" step="0.1" value={t.priceUSD}
                  onChange={e => updateTrim(i, 'priceUSD', Number(e.target.value) || 0)} />
              </td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'right' }}>{Math.round(t.priceUSD * usdRate)} ₽</td>
              <td><button className="sku-del-btn" onClick={() => deleteTrim(i)} aria-label="Удалить отделку">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
