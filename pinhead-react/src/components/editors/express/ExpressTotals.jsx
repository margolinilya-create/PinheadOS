import { Icon } from '../../../erp/components/Icon';
import { pluralize } from '../../../utils/i18n';
import { rub } from './expressModel';
import s from '../ExpressCalc.module.css';

/**
 * Итог экспресса. Сумма — в `<output aria-live="polite">`: при смене тиража,
 * зоны или техники читалка сообщает новый итог, не уводя фокус с кнопки.
 * Склонение «зона/зоны/зон» — `pluralize` (было «5 зоны»).
 */
export default function ExpressTotals({ calc, qty }) {
  if (!calc) {
    return (
      <div className={`${s.result} ${s.empty}`}>
        <span className={s.emptyIcon}><Icon name="tag" size={30} /></span>
        <span className={s.emptyTitle}>Выберите изделие</span>
        <span className={s.emptyText}>Расчёт стоимости появится здесь.</span>
      </div>
    );
  }
  const print = calc.zoneCount > 0
    ? `Нанесение × ${calc.zoneCount} ${pluralize(calc.zoneCount, 'зона', 'зоны', 'зон')}`
    : 'Нанесение';

  return (
    <div className={s.result}>
      <h2 className={s.resultTitle}>Расчёт стоимости</h2>
      <dl className={s.rows}>
        <div className={s.row}>
          <dt>Себестоимость{calc.extrasCost > 0 ? ` (с обработками: ${rub(calc.extrasCost)})` : ''}</dt>
          <dd>{rub(calc.baseRaw)}</dd>
        </div>
        <div className={s.row}>
          <dt>Накладные +{Math.round(calc.overheadPct * 100)} %, наценка +{Math.round(calc.markupPct * 100)} % ({qty} шт)</dt>
          <dd>{rub(calc.base)}</dd>
        </div>
        <div className={s.row}>
          <dt>{print}</dt>
          <dd>{rub(calc.techTotal)}</dd>
        </div>
        <div className={`${s.row} ${s.unit}`}>
          <dt>Цена за штуку</dt>
          <dd>{rub(calc.unitPrice)}</dd>
        </div>
      </dl>
      <output className={s.total} aria-live="polite">
        <span>Итого за {qty} шт</span>
        <b className={s.totalValue}>{rub(calc.total)}</b>
      </output>
    </div>
  );
}
