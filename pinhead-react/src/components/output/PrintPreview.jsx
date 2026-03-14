import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { TYPE_NAMES, FABRIC_NAMES, TECH_NAMES, ZONE_LABELS, SIZES, findColorEntry } from '../../data';
import { getLabelConfigPrice, calcItemTotal, getItemUnitPrice, getItemTotalQty } from '../../utils/pricing';
import { LABEL_CONFIG } from '../../data/extras';

export default function PrintPreview() {
  const navigate = useNavigate();
  const onClose = () => navigate('/');
  const state = useStore();
  const { items, fabricsCatalog, trimCatalog, extrasCatalog, usdRate, packOption, urgentOption } = state;
  const catalogs = { fabricsCatalog, trimCatalog, extrasCatalog, usdRate, packOption, urgentOption };
  const grandTotal = items.reduce((sum, it) => sum + calcItemTotal(it, catalogs), 0);

  const orderNumber = state._editingOrderNumber || ('PH-' + Date.now().toString(36).toUpperCase());
  const now = new Date().toLocaleDateString('ru-RU');

  const handlePrint = () => window.print();

  // Section counter
  let sectionNum = 0;
  const nextSection = () => String(++sectionNum).padStart(2, '0');

  return (
    <div className="pp-overlay">
      {/* ── Toolbar ── */}
      <div className="pp-toolbar no-print">
        <div className="pp-toolbar-left">
          <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <line x1="16" y1="2" x2="16" y2="30" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="2" y1="16" x2="30" y2="16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="5" y1="5" x2="27" y2="27" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="27" y1="5" x2="5" y2="27" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          <span className="pp-toolbar-title">ТЕХНИЧЕСКОЕ ЗАДАНИЕ</span>
          <span className="pp-toolbar-id">{orderNumber}</span>
        </div>
        <div className="pp-toolbar-actions">
          <button className="btn btn-primary" onClick={handlePrint}>ПЕЧАТЬ / PDF</button>
          <button className="btn" onClick={onClose}>ЗАКРЫТЬ</button>
        </div>
      </div>

      <div className="pp-page">
        {/* ── Header ── */}
        <div className="pp-header">
          <div className="pp-logo">
            <svg className="pp-logo-mark" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
              <line x1="16" y1="2" x2="16" y2="30" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="2" y1="16" x2="30" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="5" y1="5" x2="27" y2="27" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="27" y1="5" x2="5" y2="27" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            PINHEAD
          </div>
          <div className="pp-contacts">
            PNHD.RU / HELLO@PNHD.RU / +7 (812) 407-27-14
          </div>
        </div>

        {/* ── Title Row ── */}
        <div className="pp-title-row">
          <span className="pp-title">ТЕХНИЧЕСКОЕ ЗАДАНИЕ</span>
          <span className="pp-order-id">[{orderNumber}]</span>
        </div>

        {/* ── Per-item sections ── */}
        {items.map((item, idx) => {
          const itemQty = getItemTotalQty(item);
          const itemUnitPrice = getItemUnitPrice(item, catalogs);
          const itemTotal = calcItemTotal(item, catalogs);
          const labelPrice = getLabelConfigPrice(item.labelConfig);

          const sizeEntries = item.sku?.category === 'accessories'
            ? [['ONE SIZE', item.sizes?.['ONE SIZE'] || 1]]
            : SIZES.map(s => [s, item.sizes?.[s] || 0]).filter(([, q]) => q > 0);
          const customEntries = (item.customSizes || []).filter(c => (parseInt(c.qty) || 0) > 0);

          return (
            <div key={idx}>
              {items.length > 1 && (
                <div className="pp-position-header" style={{ marginTop: idx > 0 ? 24 : 0, borderTop: idx > 0 ? '2px solid var(--black)' : 'none', paddingTop: idx > 0 ? 16 : 0 }}>
                  ПОЗИЦИЯ #{idx + 1}
                </div>
              )}

              <div className="pp-section">
                <div className="pp-section-head">
                  <span className="pp-section-num">{nextSection()}</span>
                  <span className="pp-section-name">ИЗДЕЛИЕ</span>
                </div>
                <div className="pp-kv">
                  <div className="pp-kv-row"><span>Тип</span><span className="pp-kv-dots" /><b>{item.sku?.name || TYPE_NAMES[item.type] || '—'}</b></div>
                  <div className="pp-kv-row"><span>Ткань</span><span className="pp-kv-dots" /><b>{FABRIC_NAMES[item.fabric] || item.fabric || '—'}</b></div>
                  <div className="pp-kv-row"><span>Цвет</span><span className="pp-kv-dots" /><b style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {(() => { const c = findColorEntry(item.color); return c ? <span style={{ width: 12, height: 12, borderRadius: '50%', background: c.hex, border: '1px solid #ccc', display: 'inline-block', flexShrink: 0 }} /> : null; })()}
                    {(() => { const c = findColorEntry(item.color); return c?.name || item.color || '—'; })()}
                  </b></div>
                  {idx === 0 && <div className="pp-kv-row"><span>Дата</span><span className="pp-kv-dots" /><b>{now}</b></div>}
                  {idx === 0 && state.deadline && <div className="pp-kv-row"><span>Дедлайн</span><span className="pp-kv-dots" /><b>{state.deadline}</b></div>}
                </div>
              </div>

              <div className="pp-section">
                <div className="pp-section-head">
                  <span className="pp-section-num">{nextSection()}</span>
                  <span className="pp-section-name">РАЗМЕРЫ И ТИРАЖ</span>
                </div>
                <table className="pp-table">
                  <thead><tr><th>Размер</th><th>Кол-во</th><th>Цена/шт</th><th>Сумма</th></tr></thead>
                  <tbody>
                    {sizeEntries.map(([size, qty]) => (
                      <tr key={size}><td>{size}</td><td>{qty}</td><td>{itemUnitPrice.toLocaleString('ru-RU')} ₽</td><td><b>{(qty * itemUnitPrice).toLocaleString('ru-RU')} ₽</b></td></tr>
                    ))}
                    {customEntries.map((c, i) => (
                      <tr key={`c-${i}`}><td>{c.label || c.size}</td><td>{c.qty}</td><td>{itemUnitPrice.toLocaleString('ru-RU')} ₽</td><td><b>{((parseInt(c.qty) || 0) * itemUnitPrice).toLocaleString('ru-RU')} ₽</b></td></tr>
                    ))}
                    <tr className="pp-table-total"><td>ИТОГО</td><td><b>{itemQty}</b></td><td /><td><b>{itemTotal.toLocaleString('ru-RU')} ₽</b></td></tr>
                  </tbody>
                </table>
              </div>

              {!item.noPrint && item.zones?.length > 0 && (
                <div className="pp-section">
                  <div className="pp-section-head">
                    <span className="pp-section-num">{nextSection()}</span>
                    <span className="pp-section-name">НАНЕСЕНИЕ</span>
                  </div>
                  <table className="pp-table">
                    <thead><tr><th>Зона</th><th>Техника</th><th>Параметры</th><th>Макет</th></tr></thead>
                    <tbody>
                      {item.zones.map(z => {
                        const tech = item.zoneTechs?.[z] || 'screen';
                        return <tr key={z}><td>{ZONE_LABELS[z] || z}</td><td>{TECH_NAMES[tech] || tech}</td><td>—</td><td>—</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {labelPrice > 0 && (
                <div className="pp-section">
                  <div className="pp-section-head">
                    <span className="pp-section-num">{nextSection()}</span>
                    <span className="pp-section-name">БИРКИ И ЭТИКЕТКИ</span>
                  </div>
                  <div className="pp-kv">
                    {item.labelConfig?.careLabel?.enabled && (
                      <div className="pp-kv-row"><span>Бирка по уходу</span><span className="pp-kv-dots" /><b>{LABEL_CONFIG.careLabel.options.find(o => o.key === item.labelConfig.careLabel.logoOption)?.name || '—'}</b></div>
                    )}
                    {item.labelConfig?.mainLabel?.option !== 'none' && (
                      <div className="pp-kv-row"><span>Основная бирка</span><span className="pp-kv-dots" /><b>{LABEL_CONFIG.mainLabel.options.find(o => o.key === item.labelConfig.mainLabel.option)?.name || '—'}</b></div>
                    )}
                    {item.labelConfig?.hangTag?.option !== 'none' && (
                      <div className="pp-kv-row"><span>Хэнг-тег</span><span className="pp-kv-dots" /><b>{LABEL_CONFIG.hangTag.options.find(o => o.key === item.labelConfig.hangTag.option)?.name || '—'}</b></div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* ── Опции ── */}
        <div className="pp-section">
          <div className="pp-section-head">
            <span className="pp-section-num">{nextSection()}</span>
            <span className="pp-section-name">ОПЦИИ</span>
          </div>
          <div className="pp-kv">
            {state.urgent ? (
              <div className="pp-kv-row"><span>Срочный заказ</span><span className="pp-kv-dots" /><b>Да</b></div>
            ) : (
              <div className="pp-options-note">Стандартные условия</div>
            )}
            {state.pack && (
              <div className="pp-kv-row"><span>Упаковка</span><span className="pp-kv-dots" /><b>Да</b></div>
            )}
          </div>
        </div>

        {/* ── Клиент ── */}
        {(state.name || state.contact || state.email || state.phone) && (
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">КЛИЕНТ</span>
            </div>
            <div className="pp-kv">
              {state.name && <div className="pp-kv-row"><span>Имя</span><span className="pp-kv-dots" /><b>{state.name}</b></div>}
              {state.phone && <div className="pp-kv-row"><span>Телефон</span><span className="pp-kv-dots" /><b>{state.phone}</b></div>}
              {state.contact && <div className="pp-kv-row"><span>Контакт</span><span className="pp-kv-dots" /><b>{state.contact}</b></div>}
              {state.email && <div className="pp-kv-row"><span>Email</span><span className="pp-kv-dots" /><b>{state.email}</b></div>}
              {state.address && <div className="pp-kv-row"><span>Адрес</span><span className="pp-kv-dots" /><b>{state.address}</b></div>}
            </div>
          </div>
        )}

        {/* ── Заметки ── */}
        {state.notes && (
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">ЗАМЕТКИ</span>
            </div>
            <div className="pp-notes">{state.notes}</div>
          </div>
        )}

        {/* ── Итого ── */}
        <div className="pp-grand-total">
          ИТОГО: {grandTotal.toLocaleString('ru-RU')} ₽
        </div>
      </div>
    </div>
  );
}
