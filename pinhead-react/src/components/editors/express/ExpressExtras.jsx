import { Icon } from '../../../erp/components/Icon';
import { fmtPerUnit } from '../../../utils/displayNames';
import s from '../ExpressCalc.module.css';

/**
 * Обработки модели — кнопки-переключатели (`aria-pressed`) в группе «Обработки».
 * До рестайла это были `<div onClick>` (с клавиатуры не выбрать, WCAG 2.1.1)
 * под несвязанной `<label>`; цена — «+N ₽» без единицы, теперь «+N ₽/шт».
 */
export default function ExpressExtras({ extras, selected, total, onToggle }) {
  return (
    <div className={s.block}>
      <p className={s.groupLabel}>
        Обработки
        {selected.length > 0 && <span className={s.groupSum}>{fmtPerUnit(total)}</span>}
      </p>
      <div role="group" aria-label="Обработки" className={s.options}>
        {extras.map((e) => {
          const on = selected.includes(e.code);
          return (
            <button type="button" key={e.code} aria-pressed={on} className={s.opt} onClick={() => onToggle(e.code)}>
              {on && <Icon name="check" size={15} />}
              <span>{e.name}</span>
              <span className={s.optPrice}>{fmtPerUnit(e.price)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
