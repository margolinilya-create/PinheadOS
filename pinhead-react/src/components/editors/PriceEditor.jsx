import { useState, useCallback } from 'react';
import { PRICES } from '../../data/prices';
import { TYPE_NAMES, FABRIC_NAMES, TECH_NAMES } from '../../data';

const STORAGE_KEY = 'ph_prices';
const HISTORY_KEY = 'ph_price_history';

function clonePrices() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return JSON.parse(JSON.stringify(PRICES));
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

const TABS = [
  { id: 'base', name: 'Базовые цены' },
  { id: 'screen', name: 'Шелкография' },
  { id: 'flex', name: 'Флекс' },
  { id: 'surcharges', name: 'Надбавки' },
  { id: 'history', name: 'История' },
];

export default function PriceEditor({ onBack }) {
  const [tab, setTab] = useState('base');
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
    if (parts.length === 2) {
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
    setPrices(JSON.parse(JSON.stringify(PRICES)));
    localStorage.removeItem(STORAGE_KEY);
    setChanged(0);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-left">
          <button className="page-back-btn" onClick={onBack}>← Назад</button>
          <div className="step-label">// Цены</div>
          <h1 className="step-title">РЕДАКТОР ЦЕН</h1>
          <p className="step-desc">Управление ценами на пошив, ткани и нанесение</p>
        </div>
        <div className="page-header-right">
          {changed > 0 && <span className="pe-changed-badge">{changed} изм.</span>}
          <button className="btn-secondary" onClick={exportJSON}>Экспорт</button>
          <button className="btn-secondary" onClick={importJSON}>Импорт</button>
          <button className="btn-secondary" onClick={reset}>Сброс</button>
          <button className="btn-accent" onClick={save}>Сохранить</button>
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
        {tab === 'base' && (
          <div className="pe-section">
            <h3>Базовые цены по типу изделия (пошив)</h3>
            <div className="pe-grid">
              {Object.entries(prices.type || {}).map(([key, val]) => (
                <div key={key} className="pe-input-row">
                  <span className="pe-input-label">{TYPE_NAMES[key] || key}</span>
                  <input type="number" value={val} onChange={e => updateField('type', key, e.target.value)} />
                  <span className="pe-input-unit">₽</span>
                </div>
              ))}
            </div>

            <h3>Надбавки по тканям</h3>
            <div className="pe-grid">
              {Object.entries(prices.fabric || {}).map(([key, val]) => (
                <div key={key} className="pe-input-row">
                  <span className="pe-input-label">{FABRIC_NAMES[key] || key}</span>
                  <input type="number" value={val} onChange={e => updateField('fabric', key, e.target.value)} />
                  <span className="pe-input-unit">₽</span>
                </div>
              ))}
            </div>

            <h3>Базовые техники</h3>
            <div className="pe-grid">
              {Object.entries(prices.tech || {}).map(([key, val]) => (
                <div key={key} className="pe-input-row">
                  <span className="pe-input-label">{TECH_NAMES[key] || key}</span>
                  <input type="number" value={val} onChange={e => updateField('tech', key, e.target.value)} />
                  <span className="pe-input-unit">₽</span>
                </div>
              ))}
            </div>

            <h3>Крой</h3>
            <div className="pe-grid">
              {Object.entries(prices.fit || {}).map(([key, val]) => (
                <div key={key} className="pe-input-row">
                  <span className="pe-input-label">{key}</span>
                  <input type="number" value={val} onChange={e => updateField('fit', key, e.target.value)} />
                  <span className="pe-input-unit">₽</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'screen' && (
          <div className="pe-section">
            <h3>Матрица шелкографии</h3>
            <p className="pe-hint">Пороги тиража: {(prices.screenTiers || []).join(', ')}</p>
            {(prices.screenFormats || ['A4','A3','A3+','Max']).map(fmt => (
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

            <h3>Множители</h3>
            <div className="pe-grid">
              <div className="pe-input-row">
                <span className="pe-input-label">Цветной текстиль</span>
                <input type="number" step="0.1" value={prices.screenColoredMult || 1.3} onChange={e => updateScalar('screenColoredMult', e.target.value)} />
                <span className="pe-input-unit">×</span>
              </div>
              <div className="pe-input-row">
                <span className="pe-input-label">Футер</span>
                <input type="number" step="0.1" value={prices.screenFutherMult || 1.5} onChange={e => updateScalar('screenFutherMult', e.target.value)} />
                <span className="pe-input-unit">×</span>
              </div>
              <div className="pe-input-row">
                <span className="pe-input-label">Эффекты (FX)</span>
                <input type="number" step="0.1" value={prices.screenFxMult || 2.0} onChange={e => updateScalar('screenFxMult', e.target.value)} />
                <span className="pe-input-unit">×</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'flex' && (
          <div className="pe-section">
            <h3>Матрица флекс-печати</h3>
            <p className="pe-hint">Пороги: 1, 20, 35, 50</p>
            <div className="pe-empty">
              Флекс-матрица использует те же форматы (A6, A5, A4, A3) с порогами 1/20/35/50.
              Редактирование доступно через экспорт/импорт JSON.
            </div>
          </div>
        )}

        {tab === 'surcharges' && (
          <div className="pe-section">
            <h3>DTG — надбавки за формат</h3>
            <div className="pe-grid">
              {Object.entries(prices.dtgFormatAdd || {}).map(([key, val]) => (
                <div key={key} className="pe-input-row">
                  <span className="pe-input-label">{key}</span>
                  <input type="number" value={val} onChange={e => updateField('dtgFormatAdd', key, e.target.value)} />
                  <span className="pe-input-unit">₽</span>
                </div>
              ))}
            </div>
            <div className="pe-input-row" style={{ marginTop: 8 }}>
              <span className="pe-input-label">Белая подложка DTG</span>
              <input type="number" value={prices.dtgWhiteUnder || 60} onChange={e => updateScalar('dtgWhiteUnder', e.target.value)} />
              <span className="pe-input-unit">₽</span>
            </div>

            <h3>Вышивка — надбавки</h3>
            <div className="pe-grid">
              {Object.entries(prices.embAreaAdd || {}).map(([key, val]) => (
                <div key={key} className="pe-input-row">
                  <span className="pe-input-label">Область {key.toUpperCase()}</span>
                  <input type="number" value={val} onChange={e => updateField('embAreaAdd', key, e.target.value)} />
                  <span className="pe-input-unit">₽</span>
                </div>
              ))}
            </div>
            <div className="pe-input-row" style={{ marginTop: 8 }}>
              <span className="pe-input-label">Доп. цвет нити</span>
              <input type="number" value={prices.embColorAdd || 20} onChange={e => updateScalar('embColorAdd', e.target.value)} />
              <span className="pe-input-unit">₽/цвет</span>
            </div>

            <h3>DTF — надбавки за формат</h3>
            <div className="pe-grid">
              {Object.entries(prices.dtfFormatAdd || {}).map(([key, val]) => (
                <div key={key} className="pe-input-row">
                  <span className="pe-input-label">{key}</span>
                  <input type="number" value={val} onChange={e => updateField('dtfFormatAdd', key, e.target.value)} />
                  <span className="pe-input-unit">₽</span>
                </div>
              ))}
            </div>

            <h3>Прочие</h3>
            <div className="pe-grid">
              <div className="pe-input-row">
                <span className="pe-input-label">Бирка</span>
                <input type="number" value={prices.label || 30} onChange={e => updateScalar('label', e.target.value)} />
                <span className="pe-input-unit">₽</span>
              </div>
              <div className="pe-input-row">
                <span className="pe-input-label">Упаковка</span>
                <input type="number" value={prices.pack || 15} onChange={e => updateScalar('pack', e.target.value)} />
                <span className="pe-input-unit">₽</span>
              </div>
              <div className="pe-input-row">
                <span className="pe-input-label">Срочный заказ</span>
                <input type="number" step="0.01" value={prices.urgentMult || 0.2} onChange={e => updateScalar('urgentMult', e.target.value)} />
                <span className="pe-input-unit">×</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'history' && (
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
                      <span className="pe-history-arrow">→</span>
                      <span className="pe-history-now">{h.now}</span>
                    </div>
                    <div className="pe-history-time">{h.date} {h.time}</div>
                    <button className="pe-history-undo" onClick={() => undoItem(h)}>Отменить</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
