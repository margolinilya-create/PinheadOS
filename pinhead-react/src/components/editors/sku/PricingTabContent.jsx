import { useState, useCallback, useEffect } from 'react';
import { PRICES, FLEX_MATRIX as DEFAULT_FLEX_MATRIX } from '../../../data/prices';
import { useStore } from '../../../store/useStore';
import { toast } from '../../../store/useToastStore';
import { invalidatePricesCache } from '../../../utils/pricing';
import { confirm } from '../../../store/useConfirmStore';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { storageGet, storageSet } from '../../../lib/storage';
import { mergePrices } from '../../../store/slices/catalogSlice';
import { patchPrices, PRICE_RULE_KEYS } from '../../../orderstudio/api/catalogAdmin';
import { sameJson } from '../../../orderstudio/admin/useCatalogEditor';
import { EmbroideryTab, DtfTab, DtgTab, MarkupGroupsTab } from './PricingRulesTabs';
import { setIn, getIn } from '../../../utils/pathSet';

const STORAGE_KEY = 'ph_prices';
const HISTORY_KEY = 'ph_price_history';

const FLEX_TIERS = [1, 20, 35, 50];
const FLEX_FORMATS = ['A6', 'A5', 'A4', 'A3'];
const FLEX_MAX_COLORS = 3;

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Умолчания кода для «Сброса» — поверх текущего прайса и только по ключам
 * кода: ключ, которого в коде нет, и правила цены «Справочников заказа»
 * (упаковка, подготовка, порог маржи — их правит руководство продаж)
 * сброс не трогает.
 */
function withDefaults(current) {
  const d = clone(PRICES);
  for (const k of PRICE_RULE_KEYS) delete d[k];
  if (current.flexMatrix) d.flexMatrix = clone(DEFAULT_FLEX_MATRIX);
  return { ...current, ...d };
}

/** Верхние ключи прайса, изменённые на экране относительно открытого */
function changedKeys(prices, opened) {
  return [...new Set([...Object.keys(prices), ...Object.keys(opened)])]
    .filter((k) => !sameJson(prices[k], opened[k]));
}

function loadHistory() {
  return storageGet(HISTORY_KEY, []);
}

const TABS = [
  { id: 'screen', name: 'Шелкография' },
  { id: 'embroidery', name: 'Вышивка' },
  { id: 'dtf', name: 'DTF' },
  { id: 'dtg', name: 'DTG' },
  { id: 'flex', name: 'Флекс' },
  { id: 'markup', name: 'Наценки и накладные' },
  { id: 'extras', name: 'Доп' },
  { id: 'history', name: 'История' },
];

/**
 * PricingTabContent — pricing editor UI, designed to be embedded as a tab
 * inside SkuEditor. Accepts onDirtyChange callback to report dirty state.
 */
export default function PricingTabContent({ onDirtyChange }) {
  const [tab, setTab] = useState('screen');
  // До ответа базы — прайс стора; сохранять можно только поверх прочитанного
  const [prices, setPrices] = useState(() => useStore.getState().prices);
  // `db` — прайс базы при открытии (база записи), `opened` — он же поверх
  // умолчаний кода, как его видит экран: правкой считается отличие от него
  const [loaded, setLoaded] = useState({ db: null, opened: null, state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState(loadHistory);
  const [changed, setChanged] = useState(0);
  const [saving, setSaving] = useState(false);

  // Свежим запросом, мимо кэша каталогов (веха 4): прочитанное — база записи
  useEffect(() => {
    let alive = true;
    fetchCatalogKey('app_config', 'prices').then((res) => {
      if (!alive) return;
      if (!res || !res.exists || !res.value || typeof res.value !== 'object') {
        setLoaded({ db: null, opened: null, state: 'fallback' });
        return;
      }
      // Поверх умолчаний: ключ, которого в базе нет, редактор видит из кода
      const merged = mergePrices(res.value);
      setPrices(merged);
      setChanged(0);
      setLoaded({ db: res.value, opened: merged, state: 'ready' });
    });
    return () => { alive = false; };
  }, [attempt]);

  const reload = () => {
    setLoaded((l) => ({ ...l, state: 'loading' }));
    setAttempt((n) => n + 1);
  };

  // Report dirty state to parent; уход с вкладки уносит правки — флаг снимается
  useEffect(() => {
    onDirtyChange?.(changed > 0);
  }, [changed, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  /**
   * Только изменённые верхние ключи — `prices_patch` с их значениями при
   * открытии: прайс целиком и умолчания кода в базу не уходят, правка
   * поверх чужой (другая вкладка, админ, ERP) — конфликт.
   */
  const save = useCallback(async () => {
    if (loaded.state !== 'ready') return;
    const { db, opened } = loaded;
    const keys = changedKeys(prices, opened);
    if (keys.length === 0) {
      setChanged(0);
      toast.success('Изменений нет — цены совпадают с сохранёнными');
      return;
    }
    const patch = {};
    const base = {};
    for (const k of keys) {
      patch[k] = prices[k] === undefined ? null : prices[k];
      base[k] = db[k];
    }
    setSaving(true);
    const res = await patchPrices(patch, base);
    setSaving(false);
    if (!res.ok) {
      // Правки остаются на экране; на конфликт — только «Загрузить свежую версию»
      if (res.kind === 'conflict') setLoaded((l) => ({ ...l, state: 'conflict' }));
      return;
    }
    const nextDb = { ...db, ...patch };
    const merged = mergePrices(nextDb);
    useStore.setState({ prices: merged });
    if (typeof patch.usdRate === 'number') useStore.setState({ usdRate: patch.usdRate });
    invalidatePricesCache();
    storageSet(STORAGE_KEY, merged);
    setLoaded({ db: nextDb, opened: prices, state: 'ready' });
    setChanged(0);
    toast.success('Цены сохранены');
  }, [loaded, prices]);

  const addHistory = (field, was, now) => {
    const entry = { field, was, now, time: new Date().toLocaleTimeString('ru-RU'), date: new Date().toLocaleDateString('ru-RU') };
    const h = [entry, ...history].slice(0, 50);
    setHistory(h);
    storageSet(HISTORY_KEY, h);
    setChanged(c => c + 1);
  };

  const undoItem = (entry) => {
    setPrices(p => setIn(p, entry.field.split('.'), entry.was));
    setChanged(c => c + 1);
  };

  /** Запись числа по пути (правки 13.10: таблицы вышивки, DTF, DTG, групп наценки) */
  const setAt = (path, value) => {
    if (typeof value !== 'number' || isNaN(value) || value < 0 || value > 1000000) return;
    const old = getIn(prices, path);
    setPrices(p => setIn(p, path, value));
    addHistory(path.join('.'), old, value);
  };

  const updateScalar = (key, value) => {
    const old = prices[key];
    const num = Number(value);
    if (isNaN(num) || num < 0) return;
    const isMult = key.endsWith('Mult');
    const capped = Math.min(num, isMult ? 10 : 1000000);
    setPrices(p => ({ ...p, [key]: capped }));
    // addHistory сам считает правку — второй счётчик здесь давал «2 изм.» на одну
    addHistory(key, old, capped);
  };

  const updateMatrix = (matrixKey, fmt, col, tierIdx, value) => {
    const num = Number(value);
    if (isNaN(num) || num < 0) return;
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
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
        // Поверх текущего: ключ, которого в файле нет, не пропадает (сервер не даёт очистить ключ прайса)
        setPrices(p => ({ ...p, ...data }));
        setChanged(c => c + 1);
      } catch (err) { console.error('[importJSON]', err); toast.error('Ошибка импорта файла'); }
    };
    input.click();
  };

  const reset = async () => {
    const ok = await confirm({
      title: 'Сбросить цены к умолчаниям?',
      message: 'Цены на экране вернутся к значениям по умолчанию. В базу они попадут после «Сохранить цены». Упаковку, подготовку и порог маржи сброс не трогает — их правят «Справочники заказа».',
      variant: 'danger',
      confirmLabel: 'Сбросить к умолчаниям',
    });
    if (!ok) return;
    setPrices(p => withDefaults(p));
    setChanged(c => c + 1);
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
                  {(prices.screenMatrix?.[fmt]?.[c] || []).map((val, ti) => {
                    const tier = (prices.screenTiers || [])[ti];
                    return (
                    <td key={ti}>
                      <input
                        type="number"
                        className="pe-matrix-input"
                        value={val}
                        aria-label={`Шелкография ${fmt}, ${c} цв., тираж ${tier}+`}
                        onChange={e => updateMatrix('screenMatrix', fmt, String(c), ti, e.target.value)}
                      />
                    </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <h3>Наценки шелкографии</h3>
      <div className="pe-grid pe-grid-surcharges">
        <p className="pe-hint">Надбавки «цветной» и «футер» не складываются — берётся большая, затем коэффициент эффекта.</p>
        <label className="pe-input-row">
          <span className="pe-input-label">Цветной текстиль</span>
          <input type="number" step="0.1" value={prices.screenColoredMult ?? 1.3} onChange={e => updateScalar('screenColoredMult', e.target.value)} />
        </label>
        <label className="pe-input-row">
          <span className="pe-input-label">Футер</span>
          <input type="number" step="0.1" value={prices.screenFutherMult ?? 1.5} onChange={e => updateScalar('screenFutherMult', e.target.value)} />
        </label>
        <label className="pe-input-row">
          <span className="pe-input-label">К. база</span>
          <input type="number" step="0.1" value={prices.screenFxStoneMult ?? 2.0} onChange={e => updateScalar('screenFxStoneMult', e.target.value)} />
        </label>
        <label className="pe-input-row">
          <span className="pe-input-label">PUFF</span>
          <input type="number" step="0.1" value={prices.screenFxPuffMult ?? 1.5} onChange={e => updateScalar('screenFxPuffMult', e.target.value)} />
        </label>
        <label className="pe-input-row">
          <span className="pe-input-label">Металлик</span>
          <input type="number" step="0.1" value={prices.screenFxMetallicMult ?? 1.2} onChange={e => updateScalar('screenFxMetallicMult', e.target.value)} />
        </label>
        <label className="pe-input-row">
          <span className="pe-input-label">Флюр</span>
          <input type="number" step="0.1" value={prices.screenFxFluorMult ?? 1.2} onChange={e => updateScalar('screenFxFluorMult', e.target.value)} />
        </label>
        <label className="pe-input-row">
          <span className="pe-input-label">Вытравка</span>
          <input type="number" step="0.05" value={prices.screenFxDischargeMult ?? 1.35} onChange={e => updateScalar('screenFxDischargeMult', e.target.value)} />
        </label>
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
                          aria-label={`Флекс ${fmt}, ${c} цв., тираж ${FLEX_TIERS[ti]}+`}
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
        <label className="pe-input-row">
          <span className="pe-input-label">Бирка</span>
          <input type="number" value={prices.label ?? 30} onChange={e => updateScalar('label', e.target.value)} />
          <span className="pe-input-unit">&#8381;</span>
        </label>
        <label className="pe-input-row">
          <span className="pe-input-label">Упаковка</span>
          <input type="number" value={prices.pack ?? 15} onChange={e => updateScalar('pack', e.target.value)} />
          <span className="pe-input-unit">&#8381;</span>
        </label>
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
    <div className="pricing-tab-content">
      {loaded.state === 'conflict' && (
        <div className="sku-ed-save-failed" role="alert">
          <p>Прайс уже изменили — в другой вкладке, другой администратор или ERP. Ваши правки не сохранены. Загрузите свежую версию и внесите их снова.</p>
          <button type="button" className="pe-btn" onClick={reload}>Загрузить свежую версию</button>
        </div>
      )}
      {loaded.state === 'fallback' && (
        <div className="sku-ed-save-failed" role="status">
          <p>Прайс не загрузился — сохранение недоступно, чтобы не записать встроенные значения поверх базы.</p>
          <button type="button" className="pe-btn" onClick={reload}>Загрузить снова</button>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="pricing-tab-actions">
        <span className="pricing-tab-status">
          {changed > 0 && <span className="pe-changed">{changed} изм.</span>}
        </span>
        <div className="pricing-tab-actions-right">
          <button className="pe-btn" onClick={reset}>Сбросить к умолчаниям</button>
          <button className="pe-btn" onClick={importJSON}>Импорт</button>
          <button className="pe-btn" onClick={exportJSON}>Экспорт</button>
          <button className="pe-btn pe-btn-primary" onClick={save} disabled={saving || loaded.state !== 'ready'}>{saving ? 'Сохраняю...' : 'Сохранить цены'}</button>
        </div>
      </div>

      {/* ── Sub-tabs ── */}
      <div className="pricing-sub-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`pricing-sub-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.name}
          </button>
        ))}
      </div>

      {/* ── Body ── */}
      <div className="pe-body">
        {tab === 'screen' && renderScreenTab()}
        {tab === 'embroidery' && <EmbroideryTab prices={prices} setAt={setAt} />}
        {tab === 'dtf' && <DtfTab prices={prices} setAt={setAt} />}
        {tab === 'dtg' && <DtgTab prices={prices} setAt={setAt} />}
        {tab === 'flex' && renderFlexTab()}
        {tab === 'markup' && <MarkupGroupsTab prices={prices} setAt={setAt} />}
        {tab === 'extras' && renderExtrasTab()}
        {tab === 'history' && renderHistoryTab()}
      </div>
    </div>
  );
}
