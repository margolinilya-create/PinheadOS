import { useState, useCallback } from 'react';
import { PRICES } from '../../data/prices';

const STORAGE_KEY = 'ph_prices';
const HISTORY_KEY = 'ph_price_history';

const FLEX_TIERS = [1, 20, 35, 50];
const FLEX_FORMATS = ['A6', 'A5', 'A4', 'A3'];
const FLEX_MAX_COLORS = 3;

const DEFAULT_FLEX_MATRIX = {
  'A6': { 1: [450, 159, 141, 128], 2: [450, 206, 177, 148], 3: [450, 238, 203, 188] },
  'A5': { 1: [600, 238, 203, 172], 2: [600, 285, 244, 204], 3: [600, 316, 270, 227] },
  'A4': { 1: [750, 316, 270, 227], 2: [750, 405, 345, 291], 3: [750, 475, 405, 341] },
  'A3': { 1: [850, 423, 352, 296], 2: [850, 519, 443, 374], 3: [850, 632, 540, 454] },
};

function clonePrices() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  const base = JSON.parse(JSON.stringify(PRICES));
  if (!base.flexMatrix) base.flexMatrix = JSON.parse(JSON.stringify(DEFAULT_FLEX_MATRIX));
  return base;
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

const TABS = [
  { id: 'screen', name: 'Шелкография' },
  { id: 'embroidery', name: 'Вышивка' },
  { id: 'dtf', name: 'DTF' },
  { id: 'dtg', name: 'DTG' },
  { id: 'flex', name: 'Флекс' },
  { id: 'extras', name: 'Доп' },
  { id: 'history', name: 'История' },
];

const EMB_AREA_LABELS = { s: 'S до 7 см', m: 'M до 12 см', l: 'L до 20 см' };
const DTF_FORMAT_ORDER = ['A6', 'A5', 'A4', 'A3', 'A3+'];
const DTG_FORMAT_ORDER = ['A6', 'A5', 'A4', 'A3', 'A3+'];

export default function PriceEditor({ onClose }) {
  const [tab, setTab] = useState('screen');
  const [prices, setPrices] = useState(clonePrices);
  const [history, setHistory] = useState(loadHistory);
  const [changed, setChanged] = useState(0);

  const save = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prices));
    setChanged(0);
  }, [prices]);

  const addHistory = (field, was, now) => {
    const entry = { field, was, now, time: new Date().toLocaleTimeString('ru-RU'), date: new Date().toLocaleDateString('ru-RU') };
    const h = [entry, ...history].slice(0, 50);
    setHistory(h);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
    setChanged(c => c + 1);
  };

  const undoItem = (entry) => {
    const parts = entry.field.split('.');
    const p = { ...prices };
    if (parts.length === 1) {
      p[parts[0]] = entry.was;
    } else if (parts.length === 2) {
      p[parts[0]] = { ...p[parts[0]], [parts[1]]: entry.was };
    } else if (parts.length === 4) {
      const [section, fmt, col, tier] = parts;
      p[section] = { ...p[section] };
      p[section][fmt] = { ...p[section][fmt] };
      p[section][fmt][col] = [...p[section][fmt][col]];
      p[section][fmt][col][Number(tier)] = entry.was;
    }
    setPrices(p);
    setChanged(c => c + 1);
  };

  const updateField = (section, key, value) => {
    const old = prices[section]?.[key];
    const num = Number(value);
    if (isNaN(num)) return;
    setPrices(p => ({ ...p, [section]: { ...p[section], [key]: num } }));
    addHistory(`${section}.${key}`, old, num);
  };

  const updateScalar = (key, value) => {
    const old = prices[key];
    const num = Number(value);
    if (isNaN(num)) return;
    setPrices(p => ({ ...p, [key]: num }));
    addHistory(key, old, num);
    setChanged(c => c + 1);
  };

  const updateMatrix = (matrixKey, fmt, col, tierIdx, value) => {
    const num = Number(value);
    if (isNaN(num)) return;
    const old = prices[matrixKey]?.[fmt]?.[col]?.[tierIdx];
    setPrices(p => {
      const m = { ...p[matrixKey] };
      m[fmt] = { ...m[fmt] };
      m[fmt][col] = [...(m[fmt][col] || [])];
      m[fmt][col][tierIdx] = num;
      return { ...p, [matrixKey]: m };
    });
    addHistory(`${matrixKey}.${fmt}.${col}.${tierIdx}`, old, num);
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(prices, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'pinhead-prices.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        setPrices(data);
        setChanged(c => c + 1);
      } catch {}
    };
    input.click();
  };

  const reset = () => {
    if (!confirm('Сбросить все цены к значениям по умолчанию?')) return;
    const base = JSON.parse(JSON.stringify(PRICES));
    if (!base.flexMatrix) base.flexMatrix = JSON.parse(JSON.stringify(DEFAULT_FLEX_MATRIX));
    setPrices(base);
    localStorage.removeItem(STORAGE_KEY);
    setChanged(0);
  };

  /* ── Render helpers ── */

  const renderScreenTab = () => (
    <div className="pe-section">
      <h3>Матрица шелкографии</h3>
      <p className="pe-hint">Пороги тиража: {(prices.screenTiers || []).join(', ')}</p>
      {(prices.screenFormats || ['A4', 'A3', 'A3+', 'Max']).map(fmt => (
        <div key={fmt} className="pe-matrix-block">
          <div className="pe-matrix-title">{fmt}</div>
          <table className="pe-matrix-table">
            <thead>
              <tr>
                <th>Цвета</th>
                {(prices.screenTiers || []).map((t, i) => <th key={i}>{t}+</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: prices.screenMaxColors || 8 }, (_, c) => c + 1).map(c => (
                <tr key={c}>
                  <td className="pe-matrix-label">{c}</td>
                  {(prices.screenMatrix?.[fmt]?.[c] || []).map((val, ti) => (
                    <td key={ti}>
                      <input
                        type="number"
                        className="pe-matrix-input"
                        value={val}
                        onChange={e => updateMatrix('screenMatrix', fmt, String(c), ti, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <h3>Наценки</h3>
      <div className="pe-grid">
        <div className="pe-input-row">
          <span className="pe-input-label">Цветной текстиль</span>
          <input type="number" step="0.1" value={prices.screenColoredMult ?? 1.3} onChange={e => updateScalar('screenColoredMult', e.target.value)} />
          <span className="pe-input-unit">&times;</span>
        </div>
        <div className="pe-input-row">
          <span className="pe-input-label">Футер</span>
          <input type="number" step="0.1" value={prices.screenFutherMult ?? 1.5} onChange={e => updateScalar('screenFutherMult', e.target.value)} />
          <span className="pe-input-unit">&times;</span>
        </div>
        <div className="pe-input-row">
          <span className="pe-input-label">Эффекты FX</span>
          <input type="number" step="0.1" value={prices.screenFxMult ?? 2.0} onChange={e => updateScalar('screenFxMult', e.target.value)} />
          <span className="pe-input-unit">&times;</span>
        </div>
      </div>
    </div>
  );

  const renderEmbroideryTab = () => (
    <div className="pe-section">
      <h3>Вышивка</h3>

      <div className="pe-grid">
        <div className="pe-input-row">
          <span className="pe-input-label">Базовая цена</span>
          <input type="number" value={prices.tech?.embroidery ?? 350} onChange={e => updateField('tech', 'embroidery', e.target.value)} />
          <span className="pe-input-unit">&#8381;</span>
        </div>
      </div>

      <h3>Надбавки за область</h3>
      <div className="pe-grid">
        {Object.entries(prices.embAreaAdd || {}).map(([key, val]) => (
          <div key={key} className="pe-input-row">
            <span className="pe-input-label">{EMB_AREA_LABELS[key] || key.toUpperCase()}</span>
            <input type="number" value={val} onChange={e => updateField('embAreaAdd', key, e.target.value)} />
            <span className="pe-input-unit">&#8381;</span>
          </div>
        ))}
      </div>

      <h3>Дополнительный цвет нити</h3>
      <div className="pe-grid">
        <div className="pe-input-row">
          <span className="pe-input-label">Цена за доп. цвет</span>
          <input type="number" value={prices.embColorAdd ?? 20} onChange={e => updateScalar('embColorAdd', e.target.value)} />
          <span className="pe-input-unit">&#8381;/цвет</span>
        </div>
      </div>
    </div>
  );

  const renderDtfTab = () => (
    <div className="pe-section">
      <h3>DTF</h3>

      <div className="pe-grid">
        <div className="pe-input-row">
          <span className="pe-input-label">Базовая цена</span>
          <input type="number" value={prices.tech?.dtf ?? 180} onChange={e => updateField('tech', 'dtf', e.target.value)} />
          <span className="pe-input-unit">&#8381;</span>
        </div>
      </div>

      <h3>Надбавки за формат</h3>
      <div className="pe-grid">
        {DTF_FORMAT_ORDER.map(key => (
          <div key={key} className="pe-input-row">
            <span className="pe-input-label">{key}</span>
            <input type="number" value={prices.dtfFormatAdd?.[key] ?? 0} onChange={e => updateField('dtfFormatAdd', key, e.target.value)} />
            <span className="pe-input-unit">&#8381;</span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderDtgTab = () => (
    <div className="pe-section">
      <h3>DTG</h3>

      <div className="pe-grid">
        <div className="pe-input-row">
          <span className="pe-input-label">Базовая цена</span>
          <input type="number" value={prices.tech?.dtg ?? 280} onChange={e => updateField('tech', 'dtg', e.target.value)} />
          <span className="pe-input-unit">&#8381;</span>
        </div>
      </div>

      <h3>Надбавки за формат</h3>
      <div className="pe-grid">
        {DTG_FORMAT_ORDER.map(key => (
          <div key={key} className="pe-input-row">
            <span className="pe-input-label">{key}</span>
            <input type="number" value={prices.dtgFormatAdd?.[key] ?? 0} onChange={e => updateField('dtgFormatAdd', key, e.target.value)} />
            <span className="pe-input-unit">&#8381;</span>
          </div>
        ))}
      </div>

      <h3>Белая подложка</h3>
      <div className="pe-grid">
        <div className="pe-input-row">
          <span className="pe-input-label">Цена подложки</span>
          <input type="number" value={prices.dtgWhiteUnder ?? 60} onChange={e => updateScalar('dtgWhiteUnder', e.target.value)} />
          <span className="pe-input-unit">&#8381;</span>
        </div>
      </div>
    </div>
  );

  const renderFlexTab = () => {
    const matrix = prices.flexMatrix || DEFAULT_FLEX_MATRIX;
    return (
      <div className="pe-section">
        <h3>Матрица флекс-печати</h3>
        <p className="pe-hint">Пороги тиража: {FLEX_TIERS.join(', ')}</p>
        {FLEX_FORMATS.map(fmt => (
          <div key={fmt} className="pe-matrix-block">
            <div className="pe-matrix-title">{fmt}</div>
            <table className="pe-matrix-table">
              <thead>
                <tr>
                  <th>Цвета</th>
                  {FLEX_TIERS.map((t, i) => <th key={i}>{t}+</th>)}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: FLEX_MAX_COLORS }, (_, c) => c + 1).map(c => (
                  <tr key={c}>
                    <td className="pe-matrix-label">{c}</td>
                    {(matrix[fmt]?.[c] || []).map((val, ti) => (
                      <td key={ti}>
                        <input
                          type="number"
                          className="pe-matrix-input"
                          value={val}
                          onChange={e => updateMatrix('flexMatrix', fmt, String(c), ti, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    );
  };

  const renderExtrasTab = () => (
    <div className="pe-section">
      <h3>Дополнительные услуги</h3>
      <div className="pe-grid">
        <div className="pe-input-row">
          <span className="pe-input-label">Бирка</span>
          <input type="number" value={prices.label ?? 30} onChange={e => updateScalar('label', e.target.value)} />
          <span className="pe-input-unit">&#8381;</span>
        </div>
        <div className="pe-input-row">
          <span className="pe-input-label">Упаковка</span>
          <input type="number" value={prices.pack ?? 15} onChange={e => updateScalar('pack', e.target.value)} />
          <span className="pe-input-unit">&#8381;</span>
        </div>
        <div className="pe-input-row">
          <span className="pe-input-label">Срочный заказ</span>
          <input
            type="number"
            step="1"
            value={Math.round((prices.urgentMult ?? 0.2) * 100)}
            onChange={e => updateScalar('urgentMult', Number(e.target.value) / 100)}
          />
          <span className="pe-input-unit">%</span>
        </div>
      </div>

      <h3>Минимальный тираж по технике</h3>
      <p className="pe-hint">Настраивается через конфигурацию заказа</p>
    </div>
  );

  const renderHistoryTab = () => (
    <div className="pe-section">
      <h3>История изменений</h3>
      {history.length === 0 ? (
        <div className="pe-empty">Нет изменений</div>
      ) : (
        <div className="pe-history-list">
          {history.map((h, i) => (
            <div key={i} className="pe-history-item">
              <div className="pe-history-field">{h.field}</div>
              <div className="pe-history-change">
                <span className="pe-history-was">{h.was}</span>
                <span className="pe-history-arrow">&rarr;</span>
                <span className="pe-history-now">{h.now}</span>
              </div>
              <div className="pe-history-time">{h.date} {h.time}</div>
              <button className="pe-history-undo" onClick={() => undoItem(h)}>Отменить</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="pe-overlay">
      <div className="pe-panel">
        {/* ── Top Bar ── */}
        <div className="pe-header">
          <div className="pe-header-left">
            <span className="pe-title">Редактор цен</span>
            {changed > 0 && <span className="pe-changed">{changed} изм.</span>}
          </div>
          <div className="pe-header-right">
            <button className="btn" onClick={exportJSON}>Экспорт</button>
            <button className="btn" onClick={importJSON}>Импорт</button>
            <button className="btn" onClick={reset}>Сброс</button>
            <button className="btn btn-primary" onClick={save}>Сохранить</button>
            <button className="pe-close" onClick={onClose}>&times;</button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="pe-tabs">
          {TABS.map(t => (
            <button key={t.id} className={`pe-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.name}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div className="pe-body">
          {tab === 'screen' && renderScreenTab()}
          {tab === 'embroidery' && renderEmbroideryTab()}
          {tab === 'dtf' && renderDtfTab()}
          {tab === 'dtg' && renderDtgTab()}
          {tab === 'flex' && renderFlexTab()}
          {tab === 'extras' && renderExtrasTab()}
          {tab === 'history' && renderHistoryTab()}
        </div>
      </div>
    </div>
  );
}
