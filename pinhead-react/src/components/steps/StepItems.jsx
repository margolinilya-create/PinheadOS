import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { TYPE_NAMES, FABRIC_NAMES } from '../../data';
import { useState } from 'react';
import { calcItemTotal, calcItemBreakdown, getItemUnitPrice, getItemTotalQty } from '../../utils/pricing';
import { findColorEntry } from '../../data';
import { getGarmentSVG } from '../../utils/mockup';
import PriceBreakdown from '../shared/PriceBreakdown';

export default function StepItems() {
  const { items, activeItemIdx, nextStep, prevStep, addNewItem, editItem, removeItem,
    fabricsCatalog, trimCatalog, extrasCatalog, usdRate, packOption, urgentOption } = useStore(
    useShallow(s => ({ items: s.items, activeItemIdx: s.activeItemIdx, nextStep: s.nextStep, prevStep: s.prevStep,
      addNewItem: s.addNewItem, editItem: s.editItem, removeItem: s.removeItem,
      fabricsCatalog: s.fabricsCatalog, trimCatalog: s.trimCatalog, extrasCatalog: s.extrasCatalog,
      usdRate: s.usdRate, packOption: s.packOption, urgentOption: s.urgentOption }))
  );

  const [openBreakdown, setOpenBreakdown] = useState(null);

  const catalogs = { fabricsCatalog, trimCatalog, extrasCatalog, usdRate, packOption, urgentOption };

  const grandTotal = items.reduce((sum, it) => sum + calcItemTotal(it, catalogs), 0);
  const grandQty = items.reduce((sum, it) => sum + getItemTotalQty(it), 0);

  return (
    <div className="step-panel">
      <div className="step-header">
        <div className="step-header-label">// 04 — Позиции</div>
        <h1 className="step-header-title">ПОЗИЦИИ<br/>ЗАКАЗА</h1>
        <p className="step-header-desc">
          {items.length === 0 ? 'Нет добавленных позиций' : `${items.length} ${items.length === 1 ? 'позиция' : items.length < 5 ? 'позиции' : 'позиций'} в заказе`}
        </p>
      </div>

      <button className="btn-add-item" onClick={addNewItem}>
        <span className="btn-add-item-icon">+</span>
        Добавить позицию
      </button>

      <div className="items-tray">
        {items.map((item, idx) => {
          const qty = getItemTotalQty(item);
          const unitPrice = getItemUnitPrice(item, catalogs);
          const itemTotal = calcItemTotal(item, catalogs);
          const colorEntry = findColorEntry(item.color);
          const typeName = item.sku?.name || TYPE_NAMES[item.type] || item.type;

          return (
            <div key={idx} className={`item-card${idx === activeItemIdx ? ' active' : ''}`}>
              <div className="item-card-mockup" dangerouslySetInnerHTML={{ __html: getGarmentSVG(item.type, item.color) }} />
              <div className="item-card-body">
                <div className="item-card-header">
                  <span className="item-card-num">#{idx + 1}</span>
                  <span className="item-card-type">{typeName}</span>
                </div>
                <div className="item-card-details">
                  {item.fabric && <span>{FABRIC_NAMES[item.fabric] || item.fabric}</span>}
                  {colorEntry && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span className="swatch-mini" style={{ backgroundColor: colorEntry.hex }} />
                      {colorEntry.name}
                    </span>
                  )}
                  <span>{qty} шт</span>
                  {item.zones?.length > 0 && <span>{item.zones.length} {item.zones.length === 1 ? 'зона' : 'зоны'}</span>}
                </div>
                <div className="item-card-price">
                  <span>{unitPrice.toLocaleString('ru-RU')} ₽/шт</span>
                  <span
                    className="item-card-total"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setOpenBreakdown(openBreakdown === idx ? null : idx)}
                    title="Показать детализацию"
                  >{itemTotal.toLocaleString('ru-RU')} ₽</span>
                </div>
                {openBreakdown === idx && (
                  <PriceBreakdown breakdown={calcItemBreakdown(item, catalogs)} defaultOpen compact />
                )}
              </div>
              <div className="item-card-actions">
                <button className="btn-icon" title="Изменить" onClick={() => editItem(idx)}>&#9998;</button>
                {items.length > 1 && (
                  <button className="btn-icon btn-icon-danger" title="Удалить" onClick={() => removeItem(idx)}>&times;</button>
                )}
              </div>
            </div>
          );
        })}

        <button className="item-card item-card-add" onClick={addNewItem}>
          <span className="item-add-icon">+</span>
          <span>Добавить позицию</span>
        </button>
      </div>

      {/* Summary table */}
      {items.length > 0 && (
        <table className="items-summary-table" data-testid="items-summary-table">
          <thead>
            <tr>
              <th>Позиция</th>
              <th className="items-th-right">Кол-во</th>
              <th className="items-th-right">Цена/шт</th>
              <th className="items-th-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const qty = getItemTotalQty(item);
              const unitPrice = getItemUnitPrice(item, catalogs);
              const itemTotal = calcItemTotal(item, catalogs);
              const typeName = item.sku?.name || TYPE_NAMES[item.type] || item.type;
              return (
                <tr key={idx}>
                  <td className="items-td-name">{typeName}</td>
                  <td className="items-td-right">{qty} шт</td>
                  <td className="items-td-right">{unitPrice.toLocaleString('ru-RU')} ₽</td>
                  <td className="items-td-right items-td-sum">{itemTotal.toLocaleString('ru-RU')} ₽</td>
                </tr>
              );
            })}
            <tr className="items-total-row">
              <td className="items-total-label">ИТОГО</td>
              <td className="items-td-right items-total-val">{grandQty} шт</td>
              <td className="items-td-right">—</td>
              <td className="items-td-right items-total-sum">{grandTotal.toLocaleString('ru-RU')} ₽</td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="btn-row">
        <button className="btn-prev" onClick={prevStep}>&#8592; Назад</button>
        <button className={`btn-next${items.length === 0 ? ' disabled' : ''}`}
          onClick={() => items.length > 0 && nextStep()}>
          Далее
        </button>
      </div>
    </div>
  );
}
