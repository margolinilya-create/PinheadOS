import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { TYPE_NAMES, FABRIC_NAMES } from '../../data';

const TABS = [
  { id: 'items', name: 'Изделия' },
  { id: 'fabrics', name: 'Ткани' },
  { id: 'trims', name: 'Фурнитура' },
];

export default function SkuEditor({ onClose }) {
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

  // Группировка по категории
  const grouped = useMemo(() => {
    const g = {};
    for (const s of filteredSku) {
      if (!g[s.category]) g[s.category] = [];
      g[s.category].push(s);
    }
    return g;
  }, [filteredSku]);

  return (
    <div className="pe-overlay">
      <div className="pe-panel">
        <div className="pe-header">
          <div className="pe-header-left">
            <span className="pe-title">Каталог SKU</span>
          </div>
          <div className="pe-header-right">
            <input
              className="kb-search"
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
            <button className="pe-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="pe-tabs">
          {TABS.map(t => (
            <button key={t.id} className={`pe-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.name}
            </button>
          ))}
        </div>

        <div className="pe-body">
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
    </div>
  );
}
