import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { TYPE_NAMES } from '../../data';

const TABS = [
  { id: 'items', name: 'Изделия' },
  { id: 'fabrics', name: 'Ткани' },
  { id: 'trims', name: 'Фурнитура' },
];

export default function SkuEditor({ onBack }) {
  const [tab, setTab] = useState('items');
  const { skuCatalog, fabricsCatalog, trimCatalog, usdRate, setField } = useStore();
  const [search, setSearch] = useState('');

  const filteredSku = useMemo(() => {
    if (!search.trim()) return skuCatalog;
    const q = search.toLowerCase();
    return skuCatalog.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      (s.article || '').toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q)
    );
  }, [skuCatalog, search]);

  const grouped = useMemo(() => {
    const g = {};
    for (const s of filteredSku) {
      if (!g[s.category]) g[s.category] = [];
      g[s.category].push(s);
    }
    return g;
  }, [filteredSku]);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-left">
          <button className="page-back-btn" onClick={onBack}>← Назад</button>
          <div className="step-label">// Каталог</div>
          <h1 className="step-title">КАТАЛОГ SKU</h1>
          <p className="step-desc">Изделия, ткани и фурнитура</p>
        </div>
        <div className="page-header-right">
          <input
            className="page-search"
            placeholder="Поиск..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="pe-usd-rate">
            <span className="pe-input-label">USD</span>
            <input
              type="number"
              className="pe-usd-input"
              value={usdRate}
              onChange={e => setField('usdRate', Math.max(1, Number(e.target.value) || 1))}
            />
            <span className="pe-input-unit">₽</span>
          </div>
        </div>
      </div>

      <div className="page-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`page-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.name}
          </button>
        ))}
      </div>

      <div className="page-body">
        {tab === 'items' && (
          <div className="pe-section">
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat}>
                <h3>{TYPE_NAMES[cat] || cat}</h3>
                <table className="sku-table">
                  <thead>
                    <tr>
                      <th>Артикул</th>
                      <th>Название</th>
                      <th>Крой</th>
                      <th>Пошив</th>
                      <th>Ткань (м)</th>
                      <th>Зоны</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(s => (
                      <tr key={s.code}>
                        <td className="sku-code">{s.article || s.code}</td>
                        <td>{s.name}</td>
                        <td className="sku-fit">{s.fit || 'regular'}</td>
                        <td className="sku-price">{s.sewingPrice} ₽</td>
                        <td>{s.mainFabricUsage || '—'}</td>
                        <td className="sku-zones">
                          {(s.zones || []).map(z => (
                            <span key={z} className="sku-zone-tag">{z}</span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {tab === 'fabrics' && (
          <div className="pe-section">
            <h3>Ткани</h3>
            <table className="sku-table">
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Название</th>
                  <th>$ / м</th>
                  <th>₽ / м</th>
                  <th>Категории</th>
                </tr>
              </thead>
              <tbody>
                {fabricsCatalog.map(f => (
                  <tr key={f.code}>
                    <td className="sku-code">{f.code}</td>
                    <td>{f.name}</td>
                    <td className="sku-price">${f.priceUSD}</td>
                    <td className="sku-price">{Math.round(f.priceUSD * usdRate)} ₽</td>
                    <td className="sku-zones">
                      {(f.forCategories || []).map(c => (
                        <span key={c} className="sku-zone-tag">{TYPE_NAMES[c] || c}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'trims' && (
          <div className="pe-section">
            <h3>Фурнитура</h3>
            <table className="sku-table">
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Название</th>
                  <th>$ / ед</th>
                  <th>₽ / ед</th>
                </tr>
              </thead>
              <tbody>
                {trimCatalog.map(t => (
                  <tr key={t.code}>
                    <td className="sku-code">{t.code}</td>
                    <td>{t.name}</td>
                    <td className="sku-price">${t.priceUSD}</td>
                    <td className="sku-price">{Math.round(t.priceUSD * usdRate)} ₽</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
