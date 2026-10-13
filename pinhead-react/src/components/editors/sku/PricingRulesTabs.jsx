// Вкладки редактора цен по правкам CRM 13.10: вышивка, DTF, DTG, наценки,
// накладные и срочность. Правят ровно те ключи, что читает формула
// (`utils/costRules`, `utils/printRules`); прежние поля (`dtgFormatAdd`,
// `embPricePerThousand`, `markupByType`, `urgentMult`) больше не читаются.
import {
  MARKUP_TIERS, MARKUP_GROUPS, MARKUP_GROUP_OF, URGENT_BY_DAYS, DEFAULT_OVERHEAD,
} from '../../../utils/costRules';
import {
  EMB_TIERS, EMB_RATES, EMB_SURCHARGES, EMB_MODE_LABELS, DTF_STEPS,
  DTG_TIERS, DTG_TABLE, DTG_SIZES, DTG_PLACEMENT_MULT,
} from '../../../utils/printRules';

const pct = (v) => Math.round((v ?? 0) * 1000) / 10;

function Num({ value, onChange, label, step = 1, unit }) {
  return (
    <label className="pe-input-row">
      <span className="pe-input-label">{label}</span>
      <input type="number" step={step} min="0" value={value ?? ''} onChange={e => onChange(Number(e.target.value))} />
      {unit && <span className="pe-input-unit">{unit}</span>}
    </label>
  );
}

function Cell({ value, onChange, label, step = 1 }) {
  return (
    <td>
      <input type="number" className="pe-matrix-input" step={step} min="0" value={value ?? ''}
        aria-label={label} onChange={e => onChange(Number(e.target.value))} />
    </td>
  );
}

export function OverheadUrgencyBlock({ prices, setAt }) {
  const days = { ...URGENT_BY_DAYS, ...(prices.urgentByDays || {}) };
  return (
    <>
      <h3>Накладные и срочный пошив</h3>
      <div className="pe-grid">
        <Num label="Накладные расходы" unit="%" value={pct(prices.overhead ?? DEFAULT_OVERHEAD)}
          onChange={v => setAt(['overhead'], v / 100)} />
        <Num label="Курс $ (для старых карточек в $)" unit="₽" step="0.01" value={prices.usdRate}
          onChange={v => setAt(['usdRate'], v)} />
        {Object.keys(URGENT_BY_DAYS).map(d => (
          <Num key={d} label={`Срок раньше на ${d} дней`} unit="%" value={pct(days[d])}
            onChange={v => setAt(['urgentByDays', d], v / 100)} />
        ))}
      </div>
      <p className="pe-hint">Цена изделия без нанесений = (ткань + отделка + пошив + доп. материалы + обработки) × (1 + накладные) × (1 + наценка) × (1 + срочность). Срочность к нанесениям не применяется.</p>
    </>
  );
}

const GROUP_LABELS = { A: 'А — футболки, лонги, свитшоты, худи, зипы, халф-зипы, олимпийки, бомберы', B: 'Б — поло, регбийки, штаны, шорты', C: 'В — шопперы' };

export function MarkupGroupsTab({ prices, setAt }) {
  const tiers = prices.markupGroups ? (prices.markupTiers || MARKUP_TIERS) : MARKUP_TIERS;
  const groups = { ...MARKUP_GROUPS, ...(prices.markupGroups || {}) };
  const groupOf = { ...MARKUP_GROUP_OF, ...(prices.markupGroupOf || {}) };
  return (
    <div className="pe-section">
      <h3>Наценка по группам и тиражу</h3>
      <p className="pe-hint">В % к себестоимости с накладными. Ниже первой ступени — её ставка. Олимпийка в группе А полем модели.</p>
      <table className="pe-matrix-table pe-markup-table">
        <thead>
          <tr><th>Группа</th>{tiers.map((t, i) => <th key={i}>{t}+</th>)}</tr>
        </thead>
        <tbody>
          {Object.keys(GROUP_LABELS).map(g => (
            <tr key={g}>
              <td className="pe-matrix-label pe-markup-cat" title={GROUP_LABELS[g]}>{g}</td>
              {tiers.map((t, ti) => (
                <Cell key={ti} label={`Наценка группы ${g}, от ${t} шт.`} value={pct(groups[g]?.[ti])}
                  onChange={v => setAt(['markupGroups', g, String(ti)], v / 100)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="pe-hint">
        {Object.entries(GROUP_LABELS).map(([g, l]) => <li key={g}>{l}</li>)}
      </ul>
      <p className="pe-hint">Категории: {Object.entries(groupOf).map(([c, g]) => `${c} → ${g}`).join(', ')}</p>
      <OverheadUrgencyBlock prices={prices} setAt={setAt} />
    </div>
  );
}

export function EmbroideryTab({ prices, setAt }) {
  const tiers = prices.embTiers || EMB_TIERS;
  const rates = { ...EMB_RATES, ...(prices.embRates || {}) };
  const sur = { ...EMB_SURCHARGES, ...(prices.embSurcharges || {}) };
  const tierLabel = (i) => (i < tiers.length - 1 ? `${tiers[i]}–${tiers[i + 1] - 1}` : `от ${tiers[i]}`);
  return (
    <div className="pe-section">
      <h3>Вышивка — ₽ за 1000 стежков</h3>
      <table className="pe-matrix-table">
        <thead><tr><th>Способ</th>{tiers.map((t, i) => <th key={i}>{tierLabel(i)} шт.</th>)}</tr></thead>
        <tbody>
          {Object.keys(EMB_MODE_LABELS).map(m => (
            <tr key={m}>
              <td className="pe-matrix-label">{EMB_MODE_LABELS[m]}</td>
              {tiers.map((t, ti) => (
                <Cell key={ti} step="0.5" label={`Вышивка ${EMB_MODE_LABELS[m]}, ${tierLabel(ti)} шт.`} value={rates[m]?.[ti]}
                  onChange={v => setAt(['embRates', m, String(ti)], v)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Надбавки (суммируются)</h3>
      <div className="pe-grid">
        <Num label="Срочность" unit="%" value={pct(sur.urgent)} onChange={v => setAt(['embSurcharges', 'urgent'], v / 100)} />
        <Num label="Металлизированная нить" unit="%" value={pct(sur.metallic)} onChange={v => setAt(['embSurcharges', 'metallic'], v / 100)} />
        <Num label="Объёмная с пуфом" unit="%" value={pct(sur.puff)} onChange={v => setAt(['embSurcharges', 'puff'], v / 100)} />
        <Num label="Стежков на 1 см² (оценка)" value={prices.embStitchesPerCm2 ?? 300} onChange={v => setAt(['embStitchesPerCm2'], v)} />
      </div>
      <h3>Минимум за нанесение</h3>
      <p className="pe-hint">Не согласован (13.10) — 0 значит «без минимума». Ниже 50 шт. тариф согласуется отдельно.</p>
      <div className="pe-grid">
        {Object.keys(EMB_MODE_LABELS).map(m => (
          <Num key={m} label={EMB_MODE_LABELS[m]} unit="₽" value={prices.embMinByMode?.[m] ?? 0}
            onChange={v => setAt(['embMinByMode', m], v)} />
        ))}
      </div>
    </div>
  );
}

export function DtfTab({ prices, setAt }) {
  const steps = prices.dtfSteps || DTF_STEPS;
  return (
    <div className="pe-section">
      <h3>DTF — ступени цены за погонный метр</h3>
      <table className="pe-matrix-table">
        <thead><tr><th>Метраж от, м</th><th>Цена, ₽/м</th></tr></thead>
        <tbody>
          {steps.map(([from, price], i) => (
            <tr key={i}>
              <Cell label={`DTF ступень ${i + 1}: от, м`} step="0.01" value={from} onChange={v => setAt(['dtfSteps', String(i), '0'], v)} />
              <Cell label={`DTF ступень ${i + 1}: ₽/м`} value={price} onChange={v => setAt(['dtfSteps', String(i), '1'], v)} />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pe-grid">
        <Num label="Перенос" unit="₽/шт" value={prices.dtfTransferPrice ?? 50} onChange={v => setAt(['dtfTransferPrice'], v)} />
        <Num label="Ширина плёнки" unit="мм" value={prices.dtfFilmWidth ?? 550} onChange={v => setAt(['dtfFilmWidth'], v)} />
        <Num label="Припуск к ширине и высоте макета" unit="мм" value={prices.dtfPad ?? 10} onChange={v => setAt(['dtfPad'], v)} />
      </div>
      <p className="pe-hint">Тираж раскладывается на плёнке (обе ориентации): макетов на 1 пог. м → оплачиваемые метры вверх до целого; ступень — по непрерывному метражу. Макет шире плёнки блокирует расчёт.</p>
    </div>
  );
}

export function DtgTab({ prices, setAt }) {
  const tiers = prices.dtgTiers || DTG_TIERS;
  const table = { ...DTG_TABLE, ...(prices.dtgTable || {}) };
  const place = { ...DTG_PLACEMENT_MULT, ...(prices.dtgPlacementMult || {}) };
  const tierLabel = (i) => (i < tiers.length - 1 ? `${tiers[i]}–${tiers[i + 1] - 1}` : `от ${tiers[i]}`);
  return (
    <div className="pe-section">
      <h3>DTG — цена за одно нанесение, ₽</h3>
      <table className="pe-matrix-table">
        <thead><tr><th>Размер</th><th>Текстиль</th>{tiers.map((t, i) => <th key={i}>{tierLabel(i)}</th>)}</tr></thead>
        <tbody>
          {DTG_SIZES.flatMap(sz => ['white', 'color'].map(tx => (
            <tr key={sz.key + tx}>
              <td className="pe-matrix-label">{sz.label}</td>
              <td className="pe-matrix-label">{tx === 'white' ? 'белый' : 'цветной'}</td>
              {tiers.map((t, ti) => (
                <Cell key={ti} label={`DTG ${sz.label}, ${tx === 'white' ? 'белый' : 'цветной'}, ${tierLabel(ti)}`}
                  value={table[sz.key]?.[tx]?.[ti]} onChange={v => setAt(['dtgTable', sz.key, tx, String(ti)], v)} />
              ))}
            </tr>
          )))}
        </tbody>
      </table>
      <div className="pe-grid">
        <Num label="Печать по карманам ×" step="0.05" value={place.pocket} onChange={v => setAt(['dtgPlacementMult', 'pocket'], v)} />
        <Num label="Печать по молниям ×" step="0.05" value={place.zipper} onChange={v => setAt(['dtgPlacementMult', 'zipper'], v)} />
      </div>
    </div>
  );
}
