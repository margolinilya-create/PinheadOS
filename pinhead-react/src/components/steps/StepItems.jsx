import { useStore } from '../../store/useStore';
import { TYPE_NAMES, FABRIC_NAMES } from '../../data';
import { calcItemTotal, getItemUnitPrice, getItemTotalQty } from '../../utils/pricing';
import { findColorEntry } from '../../data';
import { getGarmentSVG } from '../../utils/mockup';

export default function StepItems() {
  const { items, activeItemIdx, nextStep, prevStep, addNewItem, editItem, removeItem,
    fabricsCatalog, trimCatalog, extrasCatalog, usdRate, packOption, urgentOption } = useStore();

  const catalogs = { fabricsCatalog, trimCatalog, extrasCatalog, usdRate, packOption, urgentOption };

  return (
    <div className="step-panel">
      <div className="step-header">
        <div className="step-header-label">// 04 — Позиции</div>
        <h1 className="step-header-title">ПОЗИЦИИ<br/>ЗАКАЗА</h1>
        <p className="step-header-desc">
          {items.length === 0 ? 'Нет добавленных позиций' : `${items.length} ${items.length === 1 ? 'позиция' : items.length < 5 ? 'позиции' : 'позиций'} в заказе`}
        </p>
      </div>

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
                  <span className="item-card-total">{itemTotal.toLocaleString('ru-RU')} ₽</span>
                </div>
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

      {/* Grand total */}
      {items.length > 1 && (
        <div className="items-grand-total">
          <span>Итого по всем позициям:</span>
          <span className="items-grand-sum">
            {items.reduce((sum, it) => sum + calcItemTotal(it, catalogs), 0).toLocaleString('ru-RU')} ₽
          </span>
        </div>
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
