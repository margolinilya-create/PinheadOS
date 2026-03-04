import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useOrdersStore } from '../../store/useOrdersStore';
import { TYPE_NAMES, FABRIC_NAMES, ZONE_LABELS } from '../../data';
import { calcTotal, getUnitPrice, getTotalQty, getSkuEstPrice, getTotalSurcharge, getLabelConfigPrice, isAccessory } from '../../utils/pricing';
import { findColorEntry } from '../../data';
import { getGarmentSVG } from '../../utils/mockup';

export default function StepSummary() {
  const state = useStore();
  const { sku, type, fabric, color, fit, sizes, extras, extrasCatalog, zones, zoneTechs,
    name, contact, email, phone, deadline, address, notes, role, packOption, urgentOption,
    labelConfig, prevStep, resetOrder, fabricsCatalog, trimCatalog, usdRate } = state;
  const saveOrder = useOrdersStore(s => s.saveOrder);
  const [saving, setSaving] = useState(false);
  const [savedNum, setSavedNum] = useState(null);

  const total = calcTotal(state);
  const unitPrice = getUnitPrice(state);
  const totalQty = getTotalQty(state);
  const colorEntry = findColorEntry(color);
  const techSurcharge = getTotalSurcharge(state);
  const labelsCost = getLabelConfigPrice(labelConfig);

  const extrasCost = extras.reduce((s, code) => {
    const e = extrasCatalog.find(x => x.code === code);
    return s + (e ? e.price : 0);
  }, 0);

  let baseCost = 0;
  if (sku) baseCost = getSkuEstPrice(sku, fabricsCatalog, trimCatalog, usdRate);

  const sizeEntries = Object.entries(sizes).filter(([, v]) => v > 0);

  return (
    <div className="step-panel">
      <div className="step-header">
        <div className="step-header-label">// 05 — Итог</div>
        <h1 className="step-header-title">ТЗ<br/>ГОТОВО</h1>
        <p className="step-header-desc">Проверьте данные заказа и отправьте</p>
      </div>
      <div className="section-label">Итог заказа</div>

      <div className="summary-grid">
        {/* Block 1: Garment */}
        <div className="summary-block">
          <div className="summary-block-title">Изделие</div>
          <div className="summary-mockup" dangerouslySetInnerHTML={{ __html: getGarmentSVG(type, color) }} />
          <div className="summary-row"><span className="key">Тип</span><span className="val"><b>{sku?.name || TYPE_NAMES[type] || type}</b></span></div>
          {!isAccessory(type) && <div className="summary-row"><span className="key">Лекала</span><span className="val"><b>{fit}</b></span></div>}
          {fabric && <div className="summary-row"><span className="key">Ткань</span><span className="val"><b>{FABRIC_NAMES[fabric] || fabric}</b></span></div>}
          {colorEntry && (
            <div className="summary-row">
              <span className="key">Цвет</span>
              <span className="val" style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span className="swatch-mini" style={{ backgroundColor: colorEntry.hex }} />
                <b>{colorEntry.name}</b>
              </span>
            </div>
          )}
          <div className="summary-row"><span className="key">Тираж</span><span className="val"><b>{totalQty} шт</b></span></div>
        </div>

        {/* Block 2: Sizes */}
        <div className="summary-block">
          <div className="summary-block-title">Размеры</div>
          {sizeEntries.map(([size, qty]) => (
            <div key={size} className="summary-row"><span className="key">{size}</span><span className="val"><b>{qty} шт</b></span></div>
          ))}
        </div>

        {/* Block 3: Client */}
        <div className="summary-block">
          <div className="summary-block-title">Клиент</div>
          <div className="summary-row"><span className="key">Имя</span><span className="val"><b>{name}</b></span></div>
          {contact && <div className="summary-row"><span className="key">Контакт</span><span className="val"><b>{contact}</b></span></div>}
          {email && <div className="summary-row"><span className="key">Email</span><span className="val"><b>{email}</b></span></div>}
          {phone && <div className="summary-row"><span className="key">Телефон</span><span className="val"><b>{phone}</b></span></div>}
          {deadline && <div className="summary-row"><span className="key">Дедлайн</span><span className="val"><b>{deadline}</b></span></div>}
          {address && <div className="summary-row"><span className="key">Адрес</span><span className="val"><b>{address}</b></span></div>}
          {notes && <div className="summary-row"><span className="key">Примечания</span><span className="val"><b>{notes}</b></span></div>}
        </div>

        {/* Block 4: Zones */}
        {zones.length > 0 && (
          <div className="summary-block">
            <div className="summary-block-title">Нанесение</div>
            {zones.map(z => (
              <div key={z} className="summary-row">
                <span className="key">{ZONE_LABELS[z] || z}</span>
                <span className="val"><b>{zoneTechs?.[z] || 'screen'}</b></span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Price Breakdown */}
      <div className="price-breakdown">
        <div className="price-line"><span className="name">Базовая стоимость</span><span className="amount">{baseCost} ₽</span></div>
        {extrasCost > 0 && <div className="price-line"><span className="name">Обработки</span><span className="amount">+{extrasCost} ₽</span></div>}
        {labelsCost > 0 && <div className="price-line"><span className="name">Бирки</span><span className="amount">+{labelsCost} ₽</span></div>}
        {techSurcharge > 0 && <div className="price-line"><span className="name">Нанесение ({zones.length} зон)</span><span className="amount">+{techSurcharge} ₽</span></div>}
        {packOption && <div className="price-line"><span className="name">Упаковка</span><span className="amount">+15 ₽</span></div>}
        <div className="price-line"><span className="name">Цена за шт</span><span className="amount">{unitPrice.toLocaleString('ru-RU')} ₽</span></div>
        {urgentOption && <div className="price-line"><span className="name">Срочность</span><span className="amount">+20%</span></div>}
        <div className="price-total">
          <span className="name">ИТОГО</span>
          <span className="amount">{total.toLocaleString('ru-RU')} ₽</span>
        </div>
      </div>

      {savedNum && (
        <div className="order-saved-banner">
          Заказ <b>{savedNum}</b> сохранён
        </div>
      )}

      <div className="btn-row">
        <button className="btn-prev" onClick={prevStep}>← Назад</button>
        <button className={`btn-accent${saving ? ' disabled' : ''}`} onClick={async () => {
          if (saving) return;
          setSaving(true);
          const orderData = {
            type, fabric, color, fit, sizes, extras, zones, zoneTechs,
            name, contact, email, phone, deadline, address, notes,
            packOption, urgentOption, labelConfig,
            sku: sku ? { code: sku.code, name: sku.name } : null,
            total, totalQty, unitPrice,
          };
          const saved = await saveOrder(orderData);
          setSavedNum(saved?.order_number || 'OK');
          setSaving(false);
        }}>
          {saving ? 'Сохранение...' : 'Сохранить заказ ✓'}
        </button>
        <button className="btn-secondary" onClick={resetOrder}>Новый заказ</button>
      </div>
    </div>
  );
}
