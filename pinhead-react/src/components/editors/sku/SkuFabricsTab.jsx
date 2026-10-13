import { FABRIC_SUPPLIERS } from '../../../data/fabricsCatalog';

const CATEGORY_NAMES = {
  tshirts:'Футболки', longsleeves:'Лонгсливы', polo:'Поло',
  sweatshirts:'Свитшоты', halfzips:'Халф-зипы',
  hoodies:'Худи', ziphoodies:'Зип-худи',
  pants:'Штаны', shorts:'Шорты', bombers:'Бомберы', accessories:'Шопперы',
};

const SUPPLIER_COLORS = {
  'Медас': '#2B2BF0',
  'ТД Коттон': '#06A77D',
  'ТониТекс': '#C87137',
};

export default function SkuFabricsTab({
  fabricSupplierFilter, setFabricSupplierFilter,
  fabricSearch, setFabricSearch,
  filteredFabrics, fabricsCatalog, changedFabrics,
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
        <input className="page-search" placeholder="Модель, поставщик, ткань: «худи медас футер»" value={fabricSearch} onChange={e => setFabricSearch(e.target.value)} style={{ maxWidth: 260 }} aria-label="Поиск тканей" />
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
            <th>₽ за пог. м</th>
            <th>м/кг</th>
            <th>≈ ₽/кг</th>
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
                  <input className="fabric-price-inp" type="number" step="0.01" min="0" value={f.priceRub ?? ''}
                    aria-label={`Цена за метр: ${f.name}`}
                    onChange={e => updateFabric(realIdx, 'priceRub', Number(e.target.value) || 0)} />
                  {!(f.priceRub > 0) && f.priceUSD > 0 && (
                    <div className="fabric-legacy-hint">было {f.priceUSD} $ — проверить: цена за кг?</div>
                  )}
                </td>
                <td>
                  <input className="fabric-price-inp" type="number" step="0.01" min="0" value={f.mPerKg ?? ''}
                    aria-label={`Метров в килограмме: ${f.name}`}
                    onChange={e => updateFabric(realIdx, 'mPerKg', Number(e.target.value) || null)} />
                </td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'right' }}>
                  {f.priceRub > 0 && f.mPerKg > 0 ? `${Math.round(f.priceRub * f.mPerKg)} ₽` : '—'}
                </td>
                <td><button className="sku-del-btn" onClick={() => deleteFabric(realIdx)} aria-label="Удалить ткань">✕</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {filteredFabrics.length === 0 && (
        <p className="pe-hint" role="status">Ткань не найдена — уточните запрос: модель, поставщик, название или плотность.</p>
      )}
      <p className="pe-hint">Цена — за 1 погонный метр. «м/кг» нужен только для пересчёта при закупке в килограммах; цену за кг сюда не вписывать.</p>
    </div>
  );
}
