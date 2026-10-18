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
import { sameJson } from '../../../utils/sameJson';
import { EmbroideryTab, DtfTab, DtgTab, MarkupGroupsTab } from './PricingRulesTabs';
import { ScreenTab, FlexTab, ExtrasTab, HistoryTab } from './PricingMatrixTabs';
import { Tabs, TabPanel } from '../../../erp/components/Tabs';
import { Button } from '../../../erp/components/Button';
import { ReadOnlyContext } from './readOnlyContext';
import p from './Pricing.module.css';
import { setIn, getIn } from '../../../utils/pathSet';

const STORAGE_KEY = 'ph_prices';
const HISTORY_KEY = 'ph_price_history';

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
  { id: 'screen', label: 'Шелкография' },
  { id: 'embroidery', label: 'Вышивка' },
  { id: 'dtf', label: 'DTF' },
  { id: 'dtg', label: 'DTG' },
  { id: 'flex', label: 'Флекс' },
  { id: 'markup', label: 'Наценки и накладные' },
  { id: 'extras', label: 'Доп' },
  { id: 'history', label: 'История' },
];

/**
 * PricingTabContent — pricing editor UI, designed to be embedded as a tab
 * inside SkuEditor. Accepts onDirtyChange callback to report dirty state.
 * `readOnly` (телефон, ≤ 760 px) — просмотр: поля закрыты, сохранения и загрузки нет.
 */
export default function PricingTabContent({ onDirtyChange, readOnly = false }) {
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

  /**
   * Матрица, которой в прайсе нет (флекс до сида миграции G), начинается
   * с умолчаний кода — иначе ушла бы разреженная матрица из одной ячейки
   * и расчёт перестал бы брать FLEX_MATRIX для остальных форматов.
   */
  const matrixOf = (p, matrixKey) => p[matrixKey]
    ?? (matrixKey === 'flexMatrix' ? clone(DEFAULT_FLEX_MATRIX) : {});

  const updateMatrix = (matrixKey, fmt, col, tierIdx, value) => {
    const num = Number(value);
    if (isNaN(num) || num < 0) return;
    const old = matrixOf(prices, matrixKey)?.[fmt]?.[col]?.[tierIdx];
    setPrices(p => {
      const m = { ...matrixOf(p, matrixKey) };
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

  const tabBody = {
    screen: () => <ScreenTab prices={prices} onMatrix={updateMatrix} onScalar={updateScalar} />,
    embroidery: () => <EmbroideryTab prices={prices} setAt={setAt} />,
    dtf: () => <DtfTab prices={prices} setAt={setAt} />,
    dtg: () => <DtgTab prices={prices} setAt={setAt} />,
    flex: () => <FlexTab prices={prices} onMatrix={updateMatrix} />,
    markup: () => <MarkupGroupsTab prices={prices} setAt={setAt} />,
    extras: () => <ExtrasTab prices={prices} onScalar={updateScalar} />,
    history: () => <HistoryTab history={history} onUndo={undoItem} readOnly={readOnly} />,
  };

  return (
    <div className={p.root}>
      {loaded.state === 'conflict' && (
        <div className={p.notice} role="alert">
          <p>Прайс уже изменили — в другой вкладке, другой администратор или ERP. Ваши правки не сохранены. Загрузите свежую версию и внесите их снова.</p>
          <Button onClick={reload}>Загрузить свежую версию</Button>
        </div>
      )}
      {loaded.state === 'fallback' && (
        <div className={p.notice} role="status">
          <p>Прайс не загрузился — сохранение недоступно, чтобы не записать встроенные значения поверх базы.</p>
          <Button onClick={reload}>Загрузить снова</Button>
        </div>
      )}

      <div className={p.actions}>
        <span aria-live="polite">{changed > 0 && <span className={p.changed}>{changed} изм.</span>}</span>
        <div className={p.actionsRight}>
          <Button icon="download" onClick={exportJSON}>Выгрузить JSON</Button>
          {!readOnly && (
            <>
              <Button icon="undo" onClick={reset}>Сбросить к умолчаниям</Button>
              <Button icon="arrowUpToLine" onClick={importJSON}>Загрузить JSON</Button>
              <Button variant="primary" onClick={save} loading={saving} disabled={loaded.state !== 'ready'}>
                {saving ? 'Сохраняю…' : 'Сохранить цены'}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className={p.subTabs}>
        <Tabs idPrefix="sku-pricing" label="Разделы прайса" tabs={TABS} active={tab} onSelect={setTab} />
      </div>

      <TabPanel idPrefix="sku-pricing" active={tab} className={p.body}>
        <ReadOnlyContext.Provider value={readOnly}>
          {tabBody[tab]?.()}
        </ReadOnlyContext.Provider>
      </TabPanel>
    </div>
  );
}
