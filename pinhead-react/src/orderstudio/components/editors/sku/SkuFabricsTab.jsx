import { FABRIC_SUPPLIERS } from '../../../../data/fabricsCatalog';

const CATEGORY_NAMES = {
  tshirts:'Футболки', longsleeves:'Лонгсливы', polo:'Поло',
  sweatshirts:'Свитшоты', halfzips:'Халф-зипы',
  hoodies:'Худи', ziphoodies:'Зип-худи',
  pants:'Штаны', shorts:'Шорты', bombers:'Бомберы',
};

const SUPPLIER_COLORS = {
  'Медас': '#2B2BF0',
  'ТД Коттон': '#06A77D',
  'ТониТекс': '#C87137',
};

export default function SkuFabricsTab({
  fabricSupplierFilter, setFabricSupplierFilter,
  fabricSearch, setFabricSearch,
  filteredFabrics, fabricsCatalog, changedFabrics, usdRate,
  updateFabric, addFabric, deleteFabric,
}) {
  return (
    <div className="sku-ed-body">
      <div className="sku-ed-toolbar">
        <div className="supplier-filter">
          <button className={`supplier-filter-btn${fabricSupplierFilter === 'all' ? ' active' : ''}`} onClick={() => setFabricSupplierFilter('all')}>Все</button>
          {FABRIC_SUPPLIERS.map(s => (
            <button key={s} className={`supplier-filter-btn${fabricSupplierFilter === s ? ' active' : ''}`} onClick={() => setFabricSupplierFilter(s)}>{s}</button>
          ))}
        </div>
        <input className="page-search" placeholder="Поиск по названию / составу..." value={fabricSearch} onChange={e => setFabricSearch(e.target.value)} style={{ maxWidth: 220 }} />
        <span className="sku-ed-count">{filteredFabrics.length} тканей</span>
        <button className="sku-ed-add-btn" onClick={addFabric}>+ Добавить</button>
      </div>
      <table className="fabrics-table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Состав</th>
            <th>Плотность</th>
            <th>Поставщик</th>
            <th>Используется в</th>
            <th>$/м</th>
            <th>≈ ₽/м</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filteredFabrics.map((f) => {
            const realIdx = fabricsCatalog.indexOf(f);
            return (
              <tr key={f.code + realIdx} className={changedFabrics.has(realIdx) ? 'fabric-changed' : ''}>
                <td>{f.name}</td>
                <td style={{ fontSize: 11, color: 'var(--text-dim)' }}>{f.composition || '—'}</td>
                <td style={{ textAlign: 'center' }}>{f.density ? f.density + ' г/м²' : '—'}</td>
                <td>
                  <span className="supplier-dot" style={{ background: SUPPLIER_COLORS[f.supplier] || 'var(--text-dim)' }} />
                  {f.supplier || '—'}
                </td>
                <td>
                  {(f.forCategories || []).map(c => (
                    <span key={c} className="cat-pill">{CATEGORY_NAMES[c] || c}</span>
                  ))}
                </td>
                <td>
                  <input className="fabric-price-inp" type="number" step="0.1" value={f.priceUSD}
                    onChange={e => updateFabric(realIdx, 'priceUSD', Number(e.target.value) || 0)} />
                </td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'right' }}>{Math.round(f.priceUSD * usdRate)} ₽</td>
                <td><button className="sku-del-btn" onClick={() => deleteFabric(realIdx)} aria-label="Удалить ткань">✕</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
