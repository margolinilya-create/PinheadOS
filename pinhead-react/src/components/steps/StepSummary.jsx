import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { useOrdersStore } from '../../store/useOrdersStore';
import { toast } from '../../store/useToastStore';
import { TYPE_NAMES, FABRIC_NAMES, ZONE_LABELS, TECH_NAMES, SIZES } from '../../data';
import { isAccessory, calcItemTotal, calcItemBreakdown, getItemUnitPrice, getItemTotalQty, getTotalSurcharge, getLabelConfigPrice } from '../../utils/pricing';
import { validateEmail, validatePhone, validateRequired } from '../../utils/validate';
import PriceBreakdown from '../shared/PriceBreakdown';
import { findColorEntry } from '../../data';
import { getGarmentSVG } from '../../utils/mockup';

function EditBtn({ step, goToStep }) {
  return (
    <button className="summary-edit-btn" title="Изменить" onClick={e => { e.stopPropagation(); goToStep(step); }}>
      &#9998; Изменить
    </button>
  );
}

function getZoneTechSummary(zone, item) {
  const tech = item.zoneTechs?.[zone] || 'screen';
  const label = TECH_NAMES[tech] || tech;
  if (tech === 'screen') {
    const p = item.zonePrints?.[zone] || { size: 'A4', colors: 1 };
    return `${label} ${p.size || 'A4'}, ${p.colors || 1} цв.`;
  }
  if (tech === 'flex') {
    const p = item.flexZones?.[zone] || { size: 'A4', colors: 1 };
    return `${label} ${p.size || 'A4'}, ${p.colors || 1} цв.`;
  }
  if (tech === 'dtg') {
    const p = item.dtgZones?.[zone] || { size: 'A4' };
    return `${label} ${p.size || 'A4'}`;
  }
  if (tech === 'embroidery') {
    const p = item.embZones?.[zone] || { width_mm: 50, height_mm: 50 };
    return `${label} ${p.width_mm || 50}×${p.height_mm || 50}мм`;
  }
  if (tech === 'dtf') {
    const p = item.dtfZones?.[zone] || { fmt: 'A4' };
    return `${label} ${p.fmt || p.size || 'A4'}`;
  }
  return label;
}

function getLabelsSummary(labelConfig) {
  if (!labelConfig) return [];
  const lines = [];
  if (labelConfig.careLabel?.enabled) {
    const opt = labelConfig.careLabel.option || 'standard';
    lines.push(`Составник (${opt === 'my-logo' ? 'с лого' : opt === 'no-logo' ? 'без лого' : 'стандарт'})`);
  }
  if (labelConfig.mainLabel?.option && labelConfig.mainLabel.option !== 'none') {
    const opt = labelConfig.mainLabel.option;
    lines.push(`Осн. бирка (${opt === 'send-own' ? 'свои' : opt === 'custom' ? 'кастом' : 'стандарт'})`);
  }
  if (labelConfig.hangTag?.option && labelConfig.hangTag.option !== 'none') {
    const opt = labelConfig.hangTag.option;
    lines.push(`Хэнг-тег (${opt === 'custom' ? 'кастом' : 'стандарт'})`);
  }
  return lines;
}

// ─── copyTZ: формирует текстовое ТЗ и копирует в буфер ───
function buildItemTZBlock(item, idx, catalogs) {
  const colorEntry = findColorEntry(item.color);
  const qty = getItemTotalQty(item);
  const unitPrice = getItemUnitPrice(item, catalogs);
  const itemTotal = calcItemTotal(item, catalogs);
  const sizeLines = [
    ...SIZES.filter(s => (item.sizes?.[s] || 0) > 0).map(s => `${s} — ${item.sizes[s]} шт`),
    ...(item.customSizes || []).filter(c => c.qty > 0).map(c => `${c.label} — ${c.qty} шт`),
  ];
  const zoneLines = (item.zones || []).map(z => {
    const tech = item.zoneTechs?.[z] || 'screen';
    return `  ${ZONE_LABELS[z] || z}: ${TECH_NAMES[tech] || tech}`;
  });
  const extrasNames = (item.extras || []).map(code => {
    const e = catalogs.extrasCatalog?.find(x => x.code === code);
    return e ? e.name : code;
  });

  return `ПОЗИЦИЯ #${idx + 1}
Тип: ${item.sku ? item.sku.name + (item.sku.article ? ' [' + item.sku.article + ']' : '') : TYPE_NAMES[item.type] || item.type}
${item.fabric ? 'Ткань: ' + (FABRIC_NAMES[item.fabric] || item.fabric) : ''}
Цвет: ${item.color}${colorEntry ? ' — ' + colorEntry.name : ''}
Крой: ${item.fit || 'regular'}
Тираж: ${qty} шт
Размеры: ${sizeLines.length ? sizeLines.join(', ') : '—'}
${item.zones?.length > 0 ? 'Нанесение: ' + zoneLines.join('; ') : 'Без нанесения'}
${extrasNames.length ? 'Обработки: ' + extrasNames.join(', ') : ''}
Цена/шт: ${unitPrice.toLocaleString('ru-RU')} ₽ | Сумма: ${itemTotal.toLocaleString('ru-RU')} ₽`;
}

function buildTZText(state, grandTotal, catalogs) {
  const orderNum = state._editingOrderNumber || state._lastSavedOrderNum || '';
  const items = state.items || [];

  const itemBlocks = items.map((it, i) => buildItemTZBlock(it, i, catalogs));

  return `━━━━━━━━━━━━━━━━━━━━
✳ PINHEAD ORDER STUDIO
ТЗ ${orderNum ? '#' + orderNum : ''}
━━━━━━━━━━━━━━━━━━━━

${itemBlocks.join('\n\n')}

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
Упаковка: ${state.packOption ? 'Да' : 'Нет'}
Срочно: ${state.urgentOption ? 'Да' : 'Нет'}

ИТОГО: ${grandTotal.toLocaleString('ru-RU')} ₽
━━━━━━━━━━━━━━━━━━━━`.replace(/\n{3,}/g, '\n\n').trim();
}

export default function StepSummary() {
  const navigate = useNavigate();
  const { items, name, contact, email, phone, deadline, address, notes, role, packOption, urgentOption,
    prevStep, resetOrder, fabricsCatalog, trimCatalog, extrasCatalog, usdRate, bitrixDeal, messenger,
    _editingOrderId, _editingOrderNumber, _lastSavedOrderNum } = useStore(
    useShallow(s => ({ items: s.items, name: s.name, contact: s.contact, email: s.email, phone: s.phone,
      deadline: s.deadline, address: s.address, notes: s.notes, role: s.role, packOption: s.packOption,
      urgentOption: s.urgentOption, prevStep: s.prevStep, resetOrder: s.resetOrder,
      fabricsCatalog: s.fabricsCatalog, trimCatalog: s.trimCatalog, extrasCatalog: s.extrasCatalog,
      usdRate: s.usdRate, bitrixDeal: s.bitrixDeal, messenger: s.messenger,
      _editingOrderId: s._editingOrderId, _editingOrderNumber: s._editingOrderNumber,
      _lastSavedOrderNum: s._lastSavedOrderNum }))
  );
  const state = { items, name, contact, email, phone, deadline, address, notes, role, packOption, urgentOption,
    fabricsCatalog, trimCatalog, extrasCatalog, usdRate, bitrixDeal, messenger,
    _editingOrderId, _editingOrderNumber, _lastSavedOrderNum };
  const saveOrder = useOrdersStore(s => s.saveOrder);
  const updateOrder = useOrdersStore(s => s.updateOrder);
  const [saving, setSaving] = useState(false);
  const [savedNum, setSavedNum] = useState(null);
  const [copyLabel, setCopyLabel] = useState(null);

  const goToStep = useStore(s => s.goToStep);
  const [priceOpen, setPriceOpen] = useState(false);

  const catalogs = { fabricsCatalog, trimCatalog, extrasCatalog, usdRate, packOption, urgentOption };

  // Per-item calculations
  const itemCalcs = items.map(item => {
    const qty = getItemTotalQty(item);
    const itemTotal = calcItemTotal(item, catalogs);
    const unitPrice = qty > 0 ? Math.round(itemTotal / qty) : 0;
    const colorEntry = findColorEntry(item.color);
    const breakdown = calcItemBreakdown(item, catalogs);
    return { item, qty, itemTotal, unitPrice, colorEntry, breakdown };
  });

  const grandTotal = itemCalcs.reduce((sum, ic) => sum + ic.itemTotal, 0);
  const grandQty = itemCalcs.reduce((sum, ic) => sum + ic.qty, 0);

  // ─── Validation ───
  const errors = [];
  const nameCheck = validateRequired(name, 'Имя клиента');
  if (!nameCheck.valid) errors.push('Укажите имя клиента');
  if (items.length === 0 || items.every(it => !it.sku)) errors.push('Выберите артикул');
  if (items.length === 0 || itemCalcs.every(ic => ic.qty === 0)) errors.push('Укажите количество');
  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) errors.push(emailCheck.error);
  const phoneCheck = validatePhone(phone);
  if (!phoneCheck.valid) errors.push(phoneCheck.error);
  const hasErrors = errors.length > 0;

  // ─── copyTZ ───
  const handleCopyTZ = async () => {
    const text = buildTZText(state, grandTotal, catalogs);
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
    if (saving || hasErrors) return;
    setSaving(true);
    try {
      // Serialize items for storage (strip full SKU objects, keep only key fields)
      const serializedItems = items.map(it => ({
        ...it,
        sku: it.sku ? { code: it.sku.code, name: it.sku.name, article: it.sku.article, category: it.sku.category, fit: it.sku.fit, zones: it.sku.zones, mockupType: it.sku.mockupType } : null,
      }));

      // Backward compat: also keep first item's flat fields for old consumers (KanbanBoard, TechCard)
      const first = items[0] || {};
      const orderData = {
        items: serializedItems,
        // Flat fields from first item for backward compat
        type: first.type || '', fabric: first.fabric || '', color: first.color || '',
        fit: first.fit || 'regular', sizes: first.sizes || {}, customSizes: first.customSizes || [],
        extras: first.extras || [], zones: first.zones || [], zoneTechs: first.zoneTechs || {},
        zonePrints: first.zonePrints || {}, flexZones: first.flexZones || {},
        dtgZones: first.dtgZones || {}, embZones: first.embZones || {}, dtfZones: first.dtfZones || {},
        zoneArtworks: first.zoneArtworks || {}, textileColor: first.textileColor || 'white',
        designNotes: first.designNotes || '', sizeComment: first.sizeComment || '',
        labelConfig: first.labelConfig,
        sku: first.sku ? { code: first.sku.code, name: first.sku.name, article: first.sku.article, category: first.sku.category, fit: first.sku.fit, zones: first.sku.zones, mockupType: first.sku.mockupType } : null,
        // Shared fields
        name, contact, email, phone, bitrixDeal: bitrixDeal, deadline, address, notes,
        role, messenger: messenger,
        packOption, urgentOption,
        total: grandTotal, totalQty: grandQty, unitPrice: grandQty > 0 ? Math.round(grandTotal / grandQty) : 0,
      };

      let saved;
      if (_editingOrderId) {
        saved = await updateOrder(_editingOrderId, orderData);
        if (saved) {
          localStorage.removeItem('pinhead_draft');
          useStore.setState({ saved: true });
          setSavedNum(_editingOrderNumber || saved.order_number || 'OK');
          toast.success('Заказ обновлён');
        } else {
          toast.error('Ошибка обновления заказа');
        }
      } else {
        saved = await saveOrder(orderData);
        if (saved) {
          localStorage.removeItem('pinhead_draft');
          setSavedNum(saved.order_number || 'OK');
          useStore.setState({ saved: true, _editingOrderId: saved.id, _editingOrderNumber: saved.order_number, _lastSavedOrderNum: saved.order_number });
          toast.success('Заказ сохранён: ' + (saved.order_number || ''));
        } else {
          toast.error('Ошибка сохранения заказа');
        }
      }
    } finally {
      setSaving(false);
    }
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
        <div className="step-header-label">// 06 — Итог</div>
        <h1 className="step-header-title">ТЗ<br/>ГОТОВО</h1>
        <p className="step-header-desc">Проверьте данные заказа и отправьте</p>
      </div>
      <div className="section-label">Позиции заказа ({items.length}) <EditBtn step={3} goToStep={goToStep} /></div>

      {/* Per-item summaries */}
      {itemCalcs.map(({ item, qty, itemTotal, unitPrice: uPrice, colorEntry: ce, breakdown }, idx) => {
        const sizeEntries = Object.entries(item.sizes || {}).filter(([, v]) => v > 0);
        const itemState = { ...item, ...catalogs };
        const printPrice = getTotalSurcharge(itemState);
        const extrasPrice = (item.extras || []).reduce((sum, code) => {
          const ex = extrasCatalog.find(x => x.code === code);
          return sum + (ex ? ex.price : 0);
        }, 0);
        const labelsCost = getLabelConfigPrice(item.labelConfig);
        const labelLines = getLabelsSummary(item.labelConfig);

        return (
          <div key={idx} className="summary-item-block">
            <div className="summary-item-header">
              <span className="summary-item-num">#{idx + 1}</span>
              <span className="summary-item-type">{item.sku?.name || TYPE_NAMES[item.type] || item.type}</span>
              <span className="summary-item-total mono-val">{itemTotal.toLocaleString('ru-RU')} ₽</span>
            </div>
            <div className="summary-grid">
              <div className="summary-block">
                <div className="summary-block-title">Изделие <EditBtn step={0} goToStep={goToStep} /></div>
                <div className="summary-mockup" dangerouslySetInnerHTML={{ __html: getGarmentSVG(item.type, item.color) }} />
                {!isAccessory(item.type) && <div className="summary-row"><span className="key">Лекала</span><span className="val"><b>{item.fit}</b></span></div>}
                {item.fabric && <div className="summary-row"><span className="key">Ткань</span><span className="val"><b>{FABRIC_NAMES[item.fabric] || item.fabric}</b></span></div>}
                {ce && (
                  <div className="summary-row">
                    <span className="key">Цвет</span>
                    <span className="val" style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span className="swatch-mini" style={{ backgroundColor: ce.hex }} />
                      <b>{ce.name}</b>
                    </span>
                  </div>
                )}
                <div className="summary-row"><span className="key">Тираж</span><span className="val"><b>{qty} шт</b></span></div>
              </div>

              <div className="summary-block">
                <div className="summary-block-title">Размеры</div>
                {sizeEntries.map(([size, q]) => (
                  <div key={size} className="summary-row"><span className="key">{size}</span><span className="val"><b>{q} шт</b></span></div>
                ))}
                {(item.customSizes || []).filter(c => c.qty > 0).map(c => (
                  <div key={c.label} className="summary-row"><span className="key">{c.label}</span><span className="val"><b>{c.qty} шт</b></span></div>
                ))}
              </div>

              <div className="summary-block">
                <div className="summary-block-title">Зоны нанесения <EditBtn step={2} goToStep={goToStep} /></div>
                {item.zones?.length > 0 ? item.zones.map(z => (
                  <div key={z} className="summary-row">
                    <span className="key">{ZONE_LABELS[z] || z}</span>
                    <span className="val"><b>{getZoneTechSummary(z, item)}</b></span>
                  </div>
                )) : <div className="summary-row"><span className="key" style={{ opacity: .5 }}>Без нанесения</span></div>}
                {printPrice > 0 && <div className="summary-row summary-row-accent"><span className="key">Печать/шт</span><span className="val"><b>+{printPrice} ₽</b></span></div>}
              </div>

              <div className="summary-block">
                <div className="summary-block-title">Обработки <EditBtn step={1} goToStep={goToStep} /></div>
                {(item.extras || []).length > 0 ? (item.extras || []).map(code => {
                  const ex = extrasCatalog.find(x => x.code === code);
                  return <div key={code} className="summary-row"><span className="key">{ex?.name || code}</span><span className="val"><b>+{ex?.price || 0} ₽</b></span></div>;
                }) : <div className="summary-row"><span className="key" style={{ opacity: .5 }}>Нет обработок</span></div>}
                {extrasPrice > 0 && <div className="summary-row summary-row-accent"><span className="key">Обработки/шт</span><span className="val"><b>+{extrasPrice} ₽</b></span></div>}
              </div>

              {(labelLines.length > 0 || labelsCost > 0) && (
                <div className="summary-block">
                  <div className="summary-block-title">Бирки</div>
                  {labelLines.map((line, i) => <div key={i} className="summary-row"><span className="key">{line}</span></div>)}
                  {labelsCost > 0 && <div className="summary-row summary-row-accent"><span className="key">Бирки/шт</span><span className="val"><b>+{labelsCost} ₽</b></span></div>}
                </div>
              )}
            </div>
            <div className="summary-item-price-line">
              <span className="mono-val">{uPrice.toLocaleString('ru-RU')} ₽/шт</span>
              <span> × {qty} шт = <b className="mono-val">{itemTotal.toLocaleString('ru-RU')} ₽</b></span>
            </div>
            <PriceBreakdown breakdown={breakdown} />
          </div>
        );
      })}

      {/* Urgent surcharge */}
      {urgentOption && (
        <div className="summary-urgent" data-testid="urgent-line">
          ⚡ Срочный заказ: +20% = +{Math.round(grandTotal - grandTotal / 1.2).toLocaleString('ru-RU')} ₽
        </div>
      )}

      {/* Client block */}
      <div className="summary-grid" style={{ marginTop: 16 }}>
        <div className="summary-block">
          <div className="summary-block-title">Клиент <EditBtn step={4} goToStep={goToStep} /></div>
          <div className="summary-row"><span className="key">Имя</span><span className="val"><b>{name}</b></span></div>
          {bitrixDeal && <div className="summary-row"><span className="key">Bitrix</span><span className="val"><b>{bitrixDeal}</b></span></div>}
          {contact && <div className="summary-row"><span className="key">Контакт</span><span className="val"><b>{contact}</b></span></div>}
          {email && <div className="summary-row"><span className="key">Email</span><span className="val"><b>{email}</b></span></div>}
          {phone && <div className="summary-row"><span className="key">Телефон</span><span className="val"><b>{phone}</b></span></div>}
          {deadline && <div className="summary-row"><span className="key">Дедлайн</span><span className="val"><b>{deadline}</b></span></div>}
          {address && <div className="summary-row"><span className="key">Адрес</span><span className="val"><b>{address}</b></span></div>}
          {notes && <div className="summary-row"><span className="key">Примечания</span><span className="val"><b>{notes}</b></span></div>}
        </div>
      </div>

      {/* Collapsible price breakdown */}
      <div className="price-breakdown">
        <button className="price-breakdown-toggle" onClick={() => setPriceOpen(!priceOpen)}>
          Из чего цена {priceOpen ? '▲' : '▼'}
        </button>
        {priceOpen && (
          <div className="price-breakdown-details" data-testid="price-details">
            {itemCalcs.map(({ item, qty, itemTotal }, idx) => {
              const itemState = { ...item, ...catalogs };
              const printP = getTotalSurcharge(itemState);
              const extP = (item.extras || []).reduce((s, c) => { const e = extrasCatalog.find(x => x.code === c); return s + (e ? e.price : 0); }, 0);
              const labP = getLabelConfigPrice(item.labelConfig);
              return (
                <div key={idx} className="price-breakdown-item">
                  <div className="price-line"><span className="name">#{idx + 1} {item.sku?.name || TYPE_NAMES[item.type] || item.type}</span></div>
                  {printP > 0 && <div className="price-line price-line-sub"><span className="name">Печать (зоны)</span><span className="amount">+{printP} ₽/шт</span></div>}
                  {extP > 0 && <div className="price-line price-line-sub"><span className="name">Обработки</span><span className="amount">+{extP} ₽/шт</span></div>}
                  {labP > 0 && <div className="price-line price-line-sub"><span className="name">Бирки</span><span className="amount">+{labP} ₽/шт</span></div>}
                  <div className="price-line"><span className="name">{qty} шт</span><span className="amount">{itemTotal.toLocaleString('ru-RU')} ₽</span></div>
                </div>
              );
            })}
            {packOption && <div className="price-line"><span className="name">Упаковка</span><span className="amount">+15 ₽/шт</span></div>}
            {urgentOption && <div className="price-line price-line-urgent"><span className="name">⚡ Срочность +20%</span><span className="amount">+{Math.round(grandTotal - grandTotal / 1.2).toLocaleString('ru-RU')} ₽</span></div>}
          </div>
        )}
        <div className="price-total">
          <span className="name">ИТОГО</span>
          <span className="amount mono-val">{grandTotal.toLocaleString('ru-RU')} ₽</span>
        </div>
      </div>

      {/* Validation errors */}
      {hasErrors && (
        <div className="summary-errors" data-testid="validation-errors">
          {errors.map((err, i) => (
            <div key={i} className="summary-error-line">⚠️ {err}</div>
          ))}
        </div>
      )}

      <div className="btn-row">
        <button className="btn-prev" onClick={prevStep}>&#8592; Назад</button>
        <button className="btn-secondary" onClick={handleCopyTZ}>{copyLabel || 'Скопировать ТЗ'}</button>
        <button className="btn-secondary" onClick={() => navigate('/print')}>Печать / PDF</button>
        <button
          className={`btn-primary${saving ? ' loading' : ''}`}
          disabled={saving || hasErrors}
          onClick={handleSave}
          title={hasErrors ? 'Заполните обязательные поля' : undefined}
        >
          {saving
            ? <><span className="btn-spinner" />Сохранение...</>
            : _editingOrderId ? 'Обновить заказ' : 'Сохранить заказ'}
        </button>
        <button className="btn-secondary" onClick={resetOrder}>Новый заказ</button>
      </div>
    </div>
  );
}
