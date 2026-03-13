import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useOrdersStore } from '../../store/useOrdersStore';
import { toast } from '../../store/useToastStore';
import { TYPE_NAMES, FABRIC_NAMES, ZONE_LABELS, TECH_NAMES, SIZES } from '../../data';
import { PRICES } from '../../data/prices';
import { isAccessory, calcItemTotal, getItemUnitPrice, getItemTotalQty } from '../../utils/pricing';
import { findColorEntry } from '../../data';
import { getGarmentSVG } from '../../utils/mockup';

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
  const state = useStore();
  const { items, name, contact, email, phone, deadline, address, notes, role, packOption, urgentOption,
    prevStep, resetOrder, fabricsCatalog, trimCatalog, extrasCatalog, usdRate } = state;
  const saveOrder = useOrdersStore(s => s.saveOrder);
  const updateOrder = useOrdersStore(s => s.updateOrder);
  const [saving, setSaving] = useState(false);
  const [savedNum, setSavedNum] = useState(null);
  const [copyLabel, setCopyLabel] = useState(null);

  const catalogs = { fabricsCatalog, trimCatalog, extrasCatalog, usdRate, packOption, urgentOption };

  // Per-item calculations
  const itemCalcs = items.map(item => {
    const qty = getItemTotalQty(item);
    const itemTotal = calcItemTotal(item, catalogs);
    const unitPrice = qty > 0 ? Math.round(itemTotal / qty) : 0;
    const colorEntry = findColorEntry(item.color);
    return { item, qty, itemTotal, unitPrice, colorEntry };
  });

  const grandTotal = itemCalcs.reduce((sum, ic) => sum + ic.itemTotal, 0);
  const grandQty = itemCalcs.reduce((sum, ic) => sum + ic.qty, 0);

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
    if (saving) return;
    setSaving(true);

    // Serialize items for storage (strip full SKU objects, keep only key fields)
    const serializedItems = items.map(it => ({
      ...it,
      sku: it.sku ? { code: it.sku.code, name: it.sku.name, article: it.sku.article, category: it.sku.category, fit: it.sku.fit } : null,
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
      sku: first.sku ? { code: first.sku.code, name: first.sku.name, article: first.sku.article, category: first.sku.category, fit: first.sku.fit } : null,
      // Shared fields
      name, contact, email, phone, bitrixDeal: state.bitrixDeal, deadline, address, notes,
      role, messenger: state.messenger,
      packOption, urgentOption,
      total: grandTotal, totalQty: grandQty, unitPrice: grandQty > 0 ? Math.round(grandTotal / grandQty) : 0,
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
        <div className="step-header-label">// 06 — Итог</div>
        <h1 className="step-header-title">ТЗ<br/>ГОТОВО</h1>
        <p className="step-header-desc">Проверьте данные заказа и отправьте</p>
      </div>
      <div className="section-label">Позиции заказа ({items.length})</div>

      {/* Per-item summaries */}
      {itemCalcs.map(({ item, qty, itemTotal, unitPrice: uPrice, colorEntry: ce }, idx) => {
        const sizeEntries = Object.entries(item.sizes || {}).filter(([, v]) => v > 0);
        return (
          <div key={idx} className="summary-item-block">
            <div className="summary-item-header">
              <span className="summary-item-num">#{idx + 1}</span>
              <span className="summary-item-type">{item.sku?.name || TYPE_NAMES[item.type] || item.type}</span>
              <span className="summary-item-total">{itemTotal.toLocaleString('ru-RU')} ₽</span>
            </div>
            <div className="summary-grid">
              <div className="summary-block">
                <div className="summary-block-title">Изделие</div>
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

              {item.zones?.length > 0 && (
                <div className="summary-block">
                  <div className="summary-block-title">Нанесение</div>
                  {item.zones.map(z => (
                    <div key={z} className="summary-row">
                      <span className="key">{ZONE_LABELS[z] || z}</span>
                      <span className="val"><b>{TECH_NAMES[item.zoneTechs?.[z]] || item.zoneTechs?.[z] || 'screen'}</b></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="summary-item-price-line">
              <span>{uPrice.toLocaleString('ru-RU')} ₽/шт</span>
              <span> × {qty} шт = <b>{itemTotal.toLocaleString('ru-RU')} ₽</b></span>
            </div>
          </div>
        );
      })}

      {/* Client block */}
      <div className="summary-grid" style={{ marginTop: 16 }}>
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
      </div>

      {/* Grand total */}
      <div className="price-breakdown">
        {itemCalcs.map(({ item, qty, itemTotal }, idx) => (
          <div key={idx} className="price-line">
            <span className="name">#{idx + 1} {item.sku?.name || TYPE_NAMES[item.type] || item.type} ({qty} шт)</span>
            <span className="amount">{itemTotal.toLocaleString('ru-RU')} ₽</span>
          </div>
        ))}
        {packOption && <div className="price-line"><span className="name">Упаковка</span><span className="amount">+15 ₽/шт</span></div>}
        {urgentOption && <div className="price-line"><span className="name">Срочность</span><span className="amount">+20%</span></div>}
        <div className="price-total">
          <span className="name">ИТОГО</span>
          <span className="amount">{grandTotal.toLocaleString('ru-RU')} ₽</span>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn-prev" onClick={prevStep}>&#8592; Назад</button>
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
