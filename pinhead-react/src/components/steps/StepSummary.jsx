import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useOrdersStore } from '../../store/useOrdersStore';
import { toast } from '../shared/Toast';
import { TYPE_NAMES, FABRIC_NAMES, ZONE_LABELS, TECH_NAMES, SIZES } from '../../data';
import { PRICES } from '../../data/prices';
import { calcTotal, getUnitPrice, getTotalQty, getSkuEstPrice, getTotalSurcharge, getLabelConfigPrice, isAccessory, getVolumeDiscount } from '../../utils/pricing';
import { findColorEntry } from '../../data';
import { getGarmentSVG } from '../../utils/mockup';

// ─── copyTZ: формирует текстовое ТЗ и копирует в буфер (как оригинал) ───
function buildTZText(state, total, totalQty, unitPrice, colorEntry) {
  const sizeLines = [
    ...SIZES.filter(s => (state.sizes[s] || 0) > 0).map(s => `${s} — ${state.sizes[s]} шт`),
    ...(state.customSizes || []).filter(c => c.qty > 0).map(c => `${c.label} — ${c.qty} шт`),
  ];
  const orderNum = state._editingOrderNumber || state._lastSavedOrderNum || '';

  const zoneLines = (state.zones || []).map(z => {
    const tech = state.zoneTechs?.[z] || 'screen';
    return `  ${ZONE_LABELS[z] || z}: ${TECH_NAMES[tech] || tech}`;
  });

  const extrasNames = (state.extras || []).map(code => {
    const e = state.extrasCatalog.find(x => x.code === code);
    return e ? e.name : code;
  });

  return `━━━━━━━━━━━━━━━━━━━━
✳ PINHEAD ORDER STUDIO
ТЗ ${orderNum ? '#' + orderNum : ''}
━━━━━━━━━━━━━━━━━━━━

ИЗДЕЛИЕ
Тип: ${state.sku ? state.sku.name + (state.sku.article ? ' [' + state.sku.article + ']' : '') : TYPE_NAMES[state.type] || state.type}
${state.fabric ? 'Ткань: ' + (FABRIC_NAMES[state.fabric] || state.fabric) : ''}
Цвет: ${state.color}${colorEntry ? ' — ' + colorEntry.name : ''}
Крой: ${state.fit || 'regular'}
Тираж: ${totalQty} шт

РАЗМЕРЫ
${sizeLines.length ? sizeLines.join('\n') : '—'}

${state.zones.length > 0 ? `НАНЕСЕНИЕ
${zoneLines.join('\n')}
Зоны: ${state.zones.map(z => ZONE_LABELS[z] || z).join(', ')}` : 'БЕЗ НАНЕСЕНИЯ'}

КЛИЕНТ
${state.name ? 'Имя: ' + state.name : ''}
${state.bitrixDeal ? 'Bitrix: ' + state.bitrixDeal : ''}
${state.contact ? 'Контакт: ' + state.contact : ''}
${state.email ? 'Email: ' + state.email : ''}
${state.phone ? 'Телефон: ' + state.phone : ''}
${state.deadline ? 'Дедлайн: ' + state.deadline : ''}
${state.address ? 'Адрес: ' + state.address : ''}
${state.notes ? 'Примечания: ' + state.notes : ''}

ОПЦИИ
${extrasNames.length ? 'Обработки: ' + extrasNames.join(', ') : ''}
Упаковка: ${state.packOption ? 'Да' : 'Нет'}
Срочно: ${state.urgentOption ? 'Да' : 'Нет'}

Цена/шт: ${unitPrice.toLocaleString('ru-RU')} ₽
ИТОГО: ${total.toLocaleString('ru-RU')} ₽
━━━━━━━━━━━━━━━━━━━━`.replace(/\n{3,}/g, '\n\n').trim();
}

export default function StepSummary() {
  const navigate = useNavigate();
  const state = useStore();
  const { sku, type, fabric, color, fit, sizes, extras, extrasCatalog, zones, zoneTechs,
    name, contact, email, phone, deadline, address, notes, role, packOption, urgentOption,
    labelConfig, prevStep, resetOrder, fabricsCatalog, trimCatalog, usdRate, customSizes } = state;
  const saveOrder = useOrdersStore(s => s.saveOrder);
  const updateOrder = useOrdersStore(s => s.updateOrder);
  const [saving, setSaving] = useState(false);
  const [savedNum, setSavedNum] = useState(null);
  const [copyLabel, setCopyLabel] = useState(null);

  const total = calcTotal(state);
  const unitPrice = getUnitPrice(state);
  const totalQty = getTotalQty(state);
  const colorEntry = findColorEntry(color);
  const techSurcharge = getTotalSurcharge(state);
  const labelsCost = getLabelConfigPrice(labelConfig);

  const extrasDetailed = extras.map(code => {
    const e = extrasCatalog.find(x => x.code === code);
    return e ? { code: e.code, name: e.name, price: e.price } : null;
  }).filter(Boolean);
  const extrasCost = extrasDetailed.reduce((s, e) => s + e.price, 0);

  let baseCostRaw = 0;
  if (sku) {
    baseCostRaw = getSkuEstPrice(sku, fabricsCatalog, trimCatalog, usdRate);
  } else {
    baseCostRaw = (PRICES.type[type] || 480)
      + (!isAccessory(type) && PRICES.fit ? (PRICES.fit[fit || 'regular'] || 0) : 0)
      + (PRICES.fabric[fabric] || 0);
  }
  const volumeDiscount = getVolumeDiscount(totalQty);
  const baseCost = Math.round(baseCostRaw * (1 - volumeDiscount));

  const sizeEntries = Object.entries(sizes).filter(([, v]) => v > 0);

  // ─── copyTZ ───
  const handleCopyTZ = async () => {
    const text = buildTZText(state, total, totalQty, unitPrice, colorEntry);
    try {
      await navigator.clipboard.writeText(text);
      setCopyLabel('Скопировано!');
      toast.success('ТЗ скопировано в буфер');
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setCopyLabel('Скопировано!'); toast.success('ТЗ скопировано'); } catch { setCopyLabel('Ошибка'); toast.error('Не удалось скопировать'); }
      document.body.removeChild(ta);
    }
    setTimeout(() => setCopyLabel(null), 2000);
  };

  // ─── Save / Update ───
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const orderData = {
      type, fabric, color, fit, sizes, customSizes, extras, zones, zoneTechs,
      zonePrints: state.zonePrints, flexZones: state.flexZones, dtgZones: state.dtgZones,
      embZones: state.embZones, dtfZones: state.dtfZones, zoneArtworks: state.zoneArtworks,
      textileColor: state.textileColor, dtgTextile: state.dtgTextile,
      designNotes: state.designNotes,
      name, contact, email, phone, bitrixDeal: state.bitrixDeal, deadline, address, notes,
      role, messenger: state.messenger, sizeComment: state.sizeComment,
      packOption, urgentOption, labelConfig,
      sku: sku ? { code: sku.code, name: sku.name, article: sku.article, category: sku.category, fit: sku.fit } : null,
      total, totalQty, unitPrice,
    };

    let saved;
    if (state._editingOrderId) {
      saved = await updateOrder(state._editingOrderId, orderData);
      if (saved) {
        setSavedNum(state._editingOrderNumber || saved.order_number || 'OK');
        toast.success('Заказ обновлён');
      } else {
        toast.error('Ошибка обновления заказа');
      }
    } else {
      saved = await saveOrder(orderData);
      if (saved) {
        setSavedNum(saved.order_number || 'OK');
        useStore.setState({ _editingOrderId: saved.id, _editingOrderNumber: saved.order_number, _lastSavedOrderNum: saved.order_number });
        toast.success('Заказ сохранён: ' + (saved.order_number || ''));
      } else {
        toast.error('Ошибка сохранения заказа');
      }
    }
    setSaving(false);
  };

  // ─── Success screen ───
  if (savedNum) {
    return (
      <div className="step-panel">
        <div className="success-screen">
          <div className="success-icon">✳</div>
          <div className="success-title">ЗАКАЗ<br />СОХРАНЁН</div>
          <div className="success-sub">Заказ успешно сохранён в системе</div>
          <div className="order-id">{savedNum}</div>
          <div className="success-btns">
            <button className="btn" onClick={handleCopyTZ}>{copyLabel || 'Скопировать ТЗ'}</button>
            <button className="btn" onClick={() => navigate('/print')}>Печать / PDF</button>
            <button className="btn" onClick={() => navigate('/orders')}>Все заказы</button>
            <button className="btn btn-primary" onClick={() => { resetOrder(); setSavedNum(null); }}>Новый заказ</button>
          </div>
        </div>
      </div>
    );
  }

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
          {(customSizes || []).filter(c => c.qty > 0).map(c => (
            <div key={c.label} className="summary-row"><span className="key">{c.label}</span><span className="val"><b>{c.qty} шт</b></span></div>
          ))}
        </div>

        {/* Block 3: Client */}
        <div className="summary-block">
          <div className="summary-block-title">Клиент</div>
          <div className="summary-row"><span className="key">Имя</span><span className="val"><b>{name}</b></span></div>
          {state.bitrixDeal && <div className="summary-row"><span className="key">Bitrix</span><span className="val"><b>{state.bitrixDeal}</b></span></div>}
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
                <span className="val"><b>{TECH_NAMES[zoneTechs?.[z]] || zoneTechs?.[z] || 'screen'}</b></span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Price Breakdown */}
      <div className="price-breakdown">
        <div className="price-line">
          <span className="name">Базовая стоимость</span>
          <span className="amount">
            {volumeDiscount > 0 ? (
              <><s style={{opacity:0.4, marginRight:4}}>{baseCostRaw} ₽</s>{baseCost} ₽</>
            ) : (
              <>{baseCost} ₽</>
            )}
          </span>
        </div>
        {volumeDiscount > 0 && (
          <div className="price-line" style={{color:'var(--accent, #4ade80)'}}>
            <span className="name">Скидка за тираж ({totalQty} шт)</span>
            <span className="amount">−{Math.round(volumeDiscount * 100)}%</span>
          </div>
        )}
        {extrasDetailed.length > 0 && (
          <>
            <div className="price-line"><span className="name">Обработки</span><span className="amount">+{extrasCost} ₽</span></div>
            {extrasDetailed.map(e => (
              <div key={e.code} className="price-line" style={{paddingLeft:12, opacity:0.7, fontSize:'0.9em'}}>
                <span className="name">{e.name}</span>
                <span className="amount">+{e.price} ₽</span>
              </div>
            ))}
          </>
        )}
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

      <div className="btn-row">
        <button className="btn-prev" onClick={prevStep}>← Назад</button>
        <button className="btn-secondary" onClick={handleCopyTZ}>{copyLabel || 'Скопировать ТЗ'}</button>
        <button className="btn-secondary" onClick={() => navigate('/print')}>Печать / PDF</button>
        <button className={`btn-accent${saving ? ' disabled' : ''}`} onClick={handleSave}>
          {saving ? 'Сохранение...' : state._editingOrderId ? 'Обновить заказ ✓' : 'Сохранить заказ ✓'}
        </button>
        <button className="btn-secondary" onClick={resetOrder}>Новый заказ</button>
      </div>
    </div>
  );
}
