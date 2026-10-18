// Вкладки редактора цен с матрицами по формату и тиражу (шелкография, флекс),
// «Доп» и «История» — вынесены из `PricingTabContent.jsx` (веха 8, задача 3):
// экран не растёт. Правку передают наверх `onMatrix` / `onScalar` / `onUndo`.
import { FLEX_MATRIX as DEFAULT_FLEX_MATRIX } from '../../../data/prices';
import { Button } from '../../../erp/components/Button';
import ScrollTable from './ScrollTable';
import { useReadOnly } from './readOnlyContext';
import p from './Pricing.module.css';

const FLEX_TIERS = [1, 20, 35, 50];
const FLEX_FORMATS = ['A6', 'A5', 'A4', 'A3'];
const FLEX_MAX_COLORS = 3;
const SCREEN_FORMATS = ['A4', 'A3', 'A3+', 'Max'];

/** Матрица «цвета × тираж» одного формата */
function Matrix({ title, tiers, rows, label, onChange }) {
  const readOnly = useReadOnly();
  return (
    <div className={p.block}>
      <h4 className={p.blockTitle}>{title}</h4>
      <ScrollTable className={p.scroll} label={`${label} ${title}`}>
        <table className={p.matrix} aria-label={`${label} ${title}`}>
          <thead>
            <tr>
              <th scope="col">Цвета</th>
              {tiers.map((t, i) => <th key={i} scope="col">{t}+</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ colors, values }) => (
              <tr key={colors}>
                <th scope="row" className={p.label}>{colors}</th>
                {values.map((val, ti) => (
                  <td key={ti}>
                    <input type="number" className={p.cell} value={val} disabled={readOnly}
                      aria-label={`${label} ${title}, ${colors} цв., тираж ${tiers[ti]}+`}
                      onChange={(e) => onChange(title, String(colors), ti, e.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
    </div>
  );
}

function Scalar({ label, value, onChange, step, unit }) {
  const readOnly = useReadOnly();
  return (
    <label className={p.row}>
      <span className={p.rowLabel}>{label}</span>
      <input type="number" className={p.field} step={step} value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />
      {unit && <span className={p.unit}>{unit}</span>}
    </label>
  );
}

const SCREEN_MULTS = [
  ['screenColoredMult', 'Цветной текстиль', 1.3, '0.1'],
  ['screenFutherMult', 'Футер', 1.5, '0.1'],
  ['screenFxStoneMult', 'К. база', 2.0, '0.1'],
  ['screenFxPuffMult', 'PUFF', 1.5, '0.1'],
  ['screenFxMetallicMult', 'Металлик', 1.2, '0.1'],
  ['screenFxFluorMult', 'Флюр', 1.2, '0.1'],
  ['screenFxDischargeMult', 'Вытравка', 1.35, '0.05'],
];

export function ScreenTab({ prices, onMatrix, onScalar }) {
  const tiers = prices.screenTiers || [];
  const colors = Array.from({ length: prices.screenMaxColors || 8 }, (_, c) => c + 1);
  return (
    <div className={p.section}>
      <h3 className={p.title}>Матрица шелкографии</h3>
      <p className={p.hint}>Пороги тиража: {tiers.join(', ')}</p>
      {(prices.screenFormats || SCREEN_FORMATS).map((fmt) => (
        <Matrix key={fmt} title={fmt} tiers={tiers} label="Шелкография"
          rows={colors.map((c) => ({ colors: c, values: prices.screenMatrix?.[fmt]?.[c] || [] }))}
          onChange={(f, c, ti, v) => onMatrix('screenMatrix', f, c, ti, v)} />
      ))}
      <h3 className={p.title}>Наценки шелкографии</h3>
      <p className={p.hint}>Надбавки «цветной» и «футер» не складываются — берётся большая, затем коэффициент эффекта.</p>
      <div className={p.grid}>
        {SCREEN_MULTS.map(([key, label, def, step]) => (
          <Scalar key={key} label={label} step={step} value={prices[key] ?? def} onChange={(v) => onScalar(key, v)} />
        ))}
      </div>
    </div>
  );
}

export function FlexTab({ prices, onMatrix }) {
  const matrix = prices.flexMatrix || DEFAULT_FLEX_MATRIX;
  const colors = Array.from({ length: FLEX_MAX_COLORS }, (_, c) => c + 1);
  return (
    <div className={p.section}>
      <h3 className={p.title}>Матрица флекс-печати</h3>
      <p className={p.hint}>Пороги тиража: {FLEX_TIERS.join(', ')}</p>
      {FLEX_FORMATS.map((fmt) => (
        <Matrix key={fmt} title={fmt} tiers={FLEX_TIERS} label="Флекс"
          rows={colors.map((c) => ({ colors: c, values: matrix[fmt]?.[c] || [] }))}
          onChange={(f, c, ti, v) => onMatrix('flexMatrix', f, c, ti, v)} />
      ))}
    </div>
  );
}

export function ExtrasTab({ prices, onScalar }) {
  return (
    <div className={p.section}>
      <h3 className={p.title}>Дополнительные услуги</h3>
      <div className={p.grid}>
        <Scalar label="Бирка" unit="₽" value={prices.label ?? 30} onChange={(v) => onScalar('label', v)} />
        <Scalar label="Упаковка" unit="₽" value={prices.pack ?? 15} onChange={(v) => onScalar('pack', v)} />
      </div>
      <h3 className={p.title}>Минимальный тираж по технике</h3>
      <p className={p.hint}>Настраивается через конфигурацию заказа</p>
    </div>
  );
}

export function HistoryTab({ history, onUndo, readOnly }) {
  return (
    <div className={p.section}>
      <h3 className={p.title}>История изменений</h3>
      {history.length === 0 ? (
        <p className={p.empty}>Изменений пока нет</p>
      ) : (
        <ul className={p.history}>
          {history.map((h, i) => (
            <li key={i} className={p.historyItem}>
              <span className={p.historyField}>{h.field}</span>
              <span className={p.historyChange}>
                <span className={p.was}>{h.was}</span> → {h.now}
              </span>
              <span className={p.historyTime}>{h.date} {h.time}</span>
              {!readOnly && <Button icon="undo" onClick={() => onUndo(h)}>Отменить</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
