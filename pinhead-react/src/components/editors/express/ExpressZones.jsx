import { useId } from 'react';
import { Icon } from '../../../erp/components/Icon';
import { ZONE_LABELS } from '../../../data';
import { fmtPerUnit } from '../../../utils/displayNames';
import OptionGroup from './OptionGroup';
import ExpressSilk from './ExpressSilk';
import ExpressFlex from './ExpressFlex';
import ExpressDtf from './ExpressDtf';
import ExpressDtg from './ExpressDtg';
import ExpressEmbroidery from './ExpressEmbroidery';
import { TECH_OPTIONS, activeCount, zoneSurcharge } from './expressModel';
import s from '../ExpressCalc.module.css';

const PARAMS = { screen: ExpressSilk, flex: ExpressFlex, dtf: ExpressDtf, dtg: ExpressDtg, embroidery: ExpressEmbroidery };
const SCREEN_MOQ = 50;

const zoneName = (id) => ZONE_LABELS[id] || id;

/**
 * Зоны нанесения: переключатели зон (`aria-pressed`) и блок каждой включённой зоны —
 * техника и её параметры. До рестайла включённая зона выключалась щелчком по шапке
 * блока (`<div onClick>`), а выключенная включалась чипом-`<div>`: с клавиатуры ни то,
 * ни другое. Последнюю включённую зону не выключить (расчёт без нанесения экспресс
 * не делает) — её кнопка недоступна, подсказка — во всплывающем `title`.
 */
export default function ExpressZones({ zones, data, qty, fabricCode, onToggle, onTech, onParam }) {
  const titleId = useId();
  const single = activeCount(data) <= 1;

  return (
    <div className={s.block}>
      <span id={titleId} className={s.groupLabel}>Зоны нанесения</span>
      <div role="group" aria-labelledby={titleId} className={s.options}>
        {zones.map((id) => {
          const on = !!data[id]?.active;
          return (
            <button
              type="button"
              key={id}
              aria-pressed={on}
              disabled={on && single}
              title={on && single ? 'Хотя бы одна зона нужна для расчёта' : undefined}
              className={s.opt}
              onClick={() => onToggle(id)}
            >
              <Icon name={on ? 'check' : 'plus'} size={15} />
              {zoneName(id)}
            </button>
          );
        })}
      </div>

      {zones.filter((id) => data[id]?.active).map((id) => (
        <ZoneBlock
          key={id}
          id={id}
          entry={data[id]}
          surcharge={zoneSurcharge(data[id], qty, fabricCode)}
          screenWarn={data[id].tech === 'screen' && qty > 0 && qty < SCREEN_MOQ}
          onTech={(tech) => onTech(id, tech)}
          onParam={(key, val) => onParam(id, key, val)}
        />
      ))}
    </div>
  );
}

function ZoneBlock({ id, entry, surcharge, screenWarn, onTech, onParam }) {
  const headId = useId();
  const Params = PARAMS[entry.tech];
  return (
    <section className={s.zone} aria-labelledby={headId}>
      <h3 id={headId} className={s.zoneHead}>
        <span>{zoneName(id)}</span>
        <span className={s.zonePrice}>{fmtPerUnit(surcharge)}</span>
      </h3>
      <div className={s.zoneBody}>
        <OptionGroup label="Техника" options={TECH_OPTIONS} value={entry.tech} onChange={onTech} />
        {Params && <Params entry={entry} onParam={onParam} />}
        {screenWarn && <p className={s.warn}>Шелкография — тираж от {SCREEN_MOQ} шт</p>}
      </div>
    </section>
  );
}
