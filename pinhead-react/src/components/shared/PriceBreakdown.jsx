import { useState } from 'react';

export default function PriceBreakdown({ breakdown, defaultOpen = false, compact = false }) {
  const [open, setOpen] = useState(defaultOpen);

  if (!breakdown || breakdown.qty === 0) return null;

  const { base, extras, labels, print, pack, discount, urgent, unitPrice, total, qty } = breakdown;

  return (
    <div className={`pb-wrap${compact ? ' pb-compact' : ''}`}>
      <button className="pb-toggle" onClick={() => setOpen(!open)}>
        Детализация цены {open ? '\u25B2' : '\u25BC'}
      </button>
      {open && (
        <div className="pb-body" data-testid="pb-body">
          <div className="pb-row">
            <span className="pb-name">Базовая цена</span>
            <span className="pb-val">{base.toLocaleString('ru-RU')} \u20BD</span>
          </div>
          {extras > 0 && (
            <div className="pb-row">
              <span className="pb-name">Обработки</span>
              <span className="pb-val">+{extras.toLocaleString('ru-RU')} \u20BD</span>
            </div>
          )}
          {labels > 0 && (
            <div className="pb-row">
              <span className="pb-name">Этикетки</span>
              <span className="pb-val">+{labels.toLocaleString('ru-RU')} \u20BD</span>
            </div>
          )}
          {print > 0 && (
            <div className="pb-row">
              <span className="pb-name">Нанесение</span>
              <span className="pb-val">+{print.toLocaleString('ru-RU')} \u20BD</span>
            </div>
          )}
          {pack > 0 && (
            <div className="pb-row">
              <span className="pb-name">Упаковка</span>
              <span className="pb-val">+{pack.toLocaleString('ru-RU')} \u20BD</span>
            </div>
          )}
          {discount > 0 && (
            <div className="pb-row pb-row-discount">
              <span className="pb-name">Скидка</span>
              <span className="pb-val">-{discount.toLocaleString('ru-RU')} \u20BD</span>
            </div>
          )}
          {urgent > 0 && (
            <div className="pb-row pb-row-urgent">
              <span className="pb-name">Срочность</span>
              <span className="pb-val">+{urgent.toLocaleString('ru-RU')} \u20BD</span>
            </div>
          )}
          <div className="pb-divider" />
          <div className="pb-row pb-row-unit">
            <span className="pb-name">Итого за шт.</span>
            <span className="pb-val">{unitPrice.toLocaleString('ru-RU')} \u20BD</span>
          </div>
          <div className="pb-row">
            <span className="pb-name">Кол-во</span>
            <span className="pb-val">{qty} шт</span>
          </div>
          <div className="pb-row pb-row-total">
            <span className="pb-name">ИТОГО</span>
            <span className="pb-val">{total.toLocaleString('ru-RU')} \u20BD</span>
          </div>
        </div>
      )}
    </div>
  );
}
