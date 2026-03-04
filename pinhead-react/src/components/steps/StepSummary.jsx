import { useStore } from '../../store/useStore';
import { TYPE_NAMES, FABRIC_NAMES, ZONE_LABELS } from '../../data';
import { calcTotal, getUnitPrice, getTotalQty, getSkuEstPrice, getTotalSurcharge, getLabelConfigPrice, isAccessory } from '../../utils/pricing';
import { findColorEntry } from '../../data';
import { getGarmentSVG } from '../../utils/mockup';

export default function StepSummary() {
  const state = useStore();
  const { sku, type, fabric, color, fit, sizes, extras, extrasCatalog, zones, zoneTechs,
    name, contact, email, phone, deadline, address, notes, role, packOption, urgentOption,
    labelConfig, prevStep, resetOrder, fabricsCatalog, trimCatalog, usdRate } = state;

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

  // Size breakdown
  const sizeEntries = Object.entries(sizes).filter(([, v]) => v > 0);

  return (
    <div className="step-panel">
      <div className="section-label">Итог заказа</div>

      <div className="summary-grid">
        {/* Block 1: Garment */}
        <div className="summary-block">
          <div className="summary-block-title">Изделие</div>
          <div className="summary-mockup" dangerouslySetInnerHTML={{ __html: getGarmentSVG(type, color) }} />
          <div className="summary-row"><span>Тип</span><b>{sku?.name || TYPE_NAMES[type] || type}</b></div>
          {!isAccessory(type) && <div className="summary-row"><span>Лекала</span><b>{fit}</b></div>}
          {fabric && <div className="summary-row"><span>Ткань</span><b>{FABRIC_NAMES[fabric] || fabric}</b></div>}
          {colorEntry && <div className="summary-row"><span>Цвет</span><b style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="swatch-mini" style={{ backgroundColor: colorEntry.hex }} />{colorEntry.name}</b></div>}
          <div className="summary-row"><span>Тираж</span><b>{totalQty} шт</b></div>
        </div>

        {/* Block 2: Sizes */}
        <div className="summary-block">
          <div className="summary-block-title">Размеры</div>
          {sizeEntries.map(([size, qty]) => (
            <div key={size} className="summary-row"><span>{size}</span><b>{qty} шт</b></div>
          ))}
        </div>

        {/* Block 3: Price breakdown */}
        <div className="summary-block">
          <div className="summary-block-title">Расчёт цены</div>
          <div className="summary-row"><span>Базовая стоимость</span><b>{baseCost} ₽</b></div>
          {extrasCost > 0 && <div className="summary-row"><span>Обработки</span><b>+{extrasCost} ₽</b></div>}
          {labelsCost > 0 && <div className="summary-row"><span>Бирки</span><b>+{labelsCost} ₽</b></div>}
          {techSurcharge > 0 && <div className="summary-row"><span>Нанесение ({zones.length} зон)</span><b>+{techSurcharge} ₽</b></div>}
          {packOption && <div className="summary-row"><span>Упаковка</span><b>+15 ₽</b></div>}
          <div className="summary-row summary-unit"><span>Цена за шт</span><b>{unitPrice.toLocaleString('ru-RU')} ₽</b></div>
          {urgentOption && <div className="summary-row"><span>Срочность</span><b>+20%</b></div>}
          <div className="summary-row summary-total"><span>ИТОГО</span><b>{total.toLocaleString('ru-RU')} ₽</b></div>
        </div>

        {/* Block 4: Zones */}
        {zones.length > 0 && (
          <div className="summary-block">
            <div className="summary-block-title">Нанесение</div>
            {zones.map(z => (
              <div key={z} className="summary-row">
                <span>{ZONE_LABELS[z] || z}</span>
                <b>{zoneTechs?.[z] || 'screen'}</b>
              </div>
            ))}
          </div>
        )}

        {/* Block 5: Client */}
        <div className="summary-block">
          <div className="summary-block-title">Клиент</div>
          <div className="summary-row"><span>Имя</span><b>{name}</b></div>
          {contact && <div className="summary-row"><span>Контакт</span><b>{contact}</b></div>}
          {email && <div className="summary-row"><span>Email</span><b>{email}</b></div>}
          {phone && <div className="summary-row"><span>Телефон</span><b>{phone}</b></div>}
          {deadline && <div className="summary-row"><span>Дедлайн</span><b>{deadline}</b></div>}
          {address && <div className="summary-row"><span>Адрес</span><b>{address}</b></div>}
          {notes && <div className="summary-row"><span>Примечания</span><b>{notes}</b></div>}
        </div>
      </div>

      <div className="btn-row">
        <button className="btn-prev" onClick={prevStep}>← Назад</button>
        <button className="btn-accent" onClick={() => alert('Заказ сохранён! (интеграция с Supabase — следующий шаг)')}>
          Сохранить заказ
        </button>
        <button className="btn-secondary" onClick={resetOrder}>Новый заказ</button>
      </div>
    </div>
  );
}
