import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { TYPE_NAMES, FABRIC_NAMES, TECH_NAMES, ZONE_LABELS, SIZES, findColorEntry } from '../../data';
import { calcItemTotal, calcItemBreakdown, getItemUnitPrice, getItemTotalQty } from '../../utils/pricing';
import { LABEL_CONFIG } from '../../data/extras';
import ZoneMockup from '../steps/ZoneMockup';

function getZoneParams(zone, item) {
  const tech = item.zoneTechs?.[zone] || 'screen';
  if (tech === 'screen') {
    const p = item.zonePrints?.[zone] || { size: 'A4', colors: 1 };
    return `${p.size || 'A4'}, ${p.colors || 1} цв.`;
  }
  if (tech === 'flex') {
    const p = item.flexZones?.[zone] || { size: 'A4', colors: 1 };
    return `${p.size || 'A4'}, ${p.colors || 1} цв.`;
  }
  if (tech === 'dtg') {
    const p = item.dtgZones?.[zone] || { size: 'A4' };
    return p.size || 'A4';
  }
  if (tech === 'embroidery') {
    const p = item.embZones?.[zone] || { width_mm: 50, height_mm: 50 };
    return `${p.width_mm || 50}×${p.height_mm || 50}мм`;
  }
  if (tech === 'dtf') {
    const p = item.dtfZones?.[zone] || { fmt: 'A4' };
    return p.fmt || p.size || 'A4';
  }
  return '—';
}

function getLabelLines(labelConfig) {
  if (!labelConfig) return [];
  const lines = [];
  if (labelConfig.careLabel?.enabled) {
    const opt = labelConfig.careLabel.logoOption || labelConfig.careLabel.option || 'standard';
    const label = LABEL_CONFIG.careLabel?.options?.find(o => o.key === opt);
    lines.push({ name: 'Бирка по уходу', value: label?.name || opt });
  }
  if (labelConfig.mainLabel?.option && labelConfig.mainLabel.option !== 'none') {
    const opt = labelConfig.mainLabel.option;
    const label = LABEL_CONFIG.mainLabel?.options?.find(o => o.key === opt);
    lines.push({ name: 'Основная бирка', value: label?.name || opt });
  }
  if (labelConfig.hangTag?.option && labelConfig.hangTag.option !== 'none') {
    const opt = labelConfig.hangTag.option;
    const label = LABEL_CONFIG.hangTag?.options?.find(o => o.key === opt);
    lines.push({ name: 'Хэнг-тег', value: label?.name || opt });
  }
  return lines;
}

export default function PrintPreview() {
  const navigate = useNavigate();
  const onClose = () => navigate('/');
  const { items, fabricsCatalog, trimCatalog, extrasCatalog, usdRate, packOption, packType, urgentOption,
    name: stateName, contact: stateContact, email: stateEmail, phone: statePhone,
    address: stateAddress, notes: stateNotes, deadline: stateDeadline,
    artworkPath, _editingOrderNumber } = useStore(
    useShallow(s => ({ items: s.items, fabricsCatalog: s.fabricsCatalog, trimCatalog: s.trimCatalog,
      extrasCatalog: s.extrasCatalog, usdRate: s.usdRate, packOption: s.packOption, packType: s.packType || 'none', urgentOption: s.urgentOption,
      name: s.name, contact: s.contact, email: s.email, phone: s.phone,
      address: s.address, notes: s.notes, deadline: s.deadline,
      artworkPath: s.artworkPath,
      _editingOrderNumber: s._editingOrderNumber }))
  );
  const catalogs = { fabricsCatalog, trimCatalog, extrasCatalog, usdRate, packOption, packType, urgentOption };
  const grandTotal = items.reduce((sum, it) => sum + calcItemTotal(it, catalogs), 0);
  const grandQty = items.reduce((sum, it) => sum + getItemTotalQty(it), 0);

  const orderNumber = _editingOrderNumber || ('PH-' + Date.now().toString(36).toUpperCase());
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

        {/* ── Urgent Badge ── */}
        {urgentOption && (
          <div className="pp-urgent-badge" data-testid="pp-urgent-badge">⚡ СРОЧНО</div>
        )}

        {/* ── Per-item sections ── */}
        {items.map((item, idx) => {
          const itemQty = getItemTotalQty(item);
          const itemUnitPrice = getItemUnitPrice(item, catalogs);
          const itemTotal = calcItemTotal(item, catalogs);
          const colorEntry = findColorEntry(item.color);
          const labelLines = getLabelLines(item.labelConfig);

          const sizeEntries = item.sku?.category === 'accessories'
            ? [['ONE SIZE', item.sizes?.['ONE SIZE'] || 1]]
            : SIZES.map(s => [s, item.sizes?.[s] || 0]).filter(([, q]) => q > 0);
          const customEntries = (item.customSizes || []).filter(c => (parseInt(c.qty) || 0) > 0);

          return (
            <div key={idx}>
              {items.length > 1 && (
                <div className="pp-position-header" style={{ marginTop: idx > 0 ? 24 : 0, borderTop: idx > 0 ? '2px solid var(--black)' : 'none', paddingTop: idx > 0 ? 16 : 0 }}>
                  ПОЗИЦИЯ {idx + 1} ИЗ {items.length}
                </div>
              )}

              {/* Изделие + Ткань + Цвет */}
              <div className="pp-section">
                <div className="pp-section-head">
                  <span className="pp-section-num">{nextSection()}</span>
                  <span className="pp-section-name">ИЗДЕЛИЕ</span>
                </div>
                <div className="pp-kv">
                  <div className="pp-kv-row"><span>Тип</span><span className="pp-kv-dots" /><b>{item.sku?.name || TYPE_NAMES[item.type] || '—'}</b></div>
                  <div className="pp-kv-row"><span>Ткань</span><span className="pp-kv-dots" /><b>{FABRIC_NAMES[item.fabric] || item.fabric || '—'}</b></div>
                  <div className="pp-kv-row">
                    <span>Цвет</span><span className="pp-kv-dots" />
                    <b style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {colorEntry && <span className="pp-color-swatch" style={{ backgroundColor: colorEntry.hex }} />}
                      {colorEntry?.name || item.color || '—'}
                    </b>
                  </div>
                  {item.fit && <div className="pp-kv-row"><span>Крой</span><span className="pp-kv-dots" /><b>{item.fit}</b></div>}
                  {idx === 0 && <div className="pp-kv-row"><span>Дата</span><span className="pp-kv-dots" /><b>{now}</b></div>}
                  {idx === 0 && stateDeadline && <div className="pp-kv-row"><span>Дедлайн</span><span className="pp-kv-dots" /><b>{stateDeadline}</b></div>}
                </div>
              </div>

              {/* Размеры и тираж */}
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

              {/* Мокап изделия с зонами */}
              {!item.noPrint && item.zones?.length > 0 && item.sku?.mockupType && (
                <div style={{
                  display: 'flex', justifyContent: 'center',
                  margin: '12px 0', pageBreakInside: 'avoid'
                }}>
                  <div style={{ width: 200, height: 200 }}>
                    <ZoneMockup
                      garmentType={item.sku.mockupType}
                      activeZones={item.zones}
                      color={item.color}
                      zoneTechs={item.zoneTechs}
                      zonePrints={item.zonePrints}
                      flexZones={item.flexZones}
                      dtgZones={item.dtgZones}
                      embZones={item.embZones}
                      dtfZones={item.dtfZones}
                    />
                  </div>
                </div>
              )}

              {/* Зоны нанесения с параметрами */}
              {!item.noPrint && item.zones?.length > 0 && (
                <div className="pp-section">
                  <div className="pp-section-head">
                    <span className="pp-section-num">{nextSection()}</span>
                    <span className="pp-section-name">ЗОНЫ НАНЕСЕНИЯ</span>
                  </div>
                  <table className="pp-table">
                    <thead><tr><th>Зона</th><th>Техника</th><th>Параметры</th></tr></thead>
                    <tbody>
                      {item.zones.map(z => {
                        const tech = item.zoneTechs?.[z] || 'screen';
                        return (
                          <tr key={z}>
                            <td>{ZONE_LABELS[z] || z}</td>
                            <td>{TECH_NAMES[tech] || tech}</td>
                            <td>{getZoneParams(z, item)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {artworkPath && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  Папка с макетами: <code>{artworkPath}</code>
                </div>
              )}

              {/* Бирки */}
              {labelLines.length > 0 && (
                <div className="pp-section" data-testid={`pp-labels-${idx}`}>
                  <div className="pp-section-head">
                    <span className="pp-section-num">{nextSection()}</span>
                    <span className="pp-section-name">БИРКИ И ЭТИКЕТКИ</span>
                  </div>
                  <div className="pp-kv">
                    {labelLines.map((l, i) => (
                      <div key={i} className="pp-kv-row"><span>{l.name}</span><span className="pp-kv-dots" /><b>{l.value}</b></div>
                    ))}
                  </div>
                </div>
              )}

              {/* Детализация цены */}
              {(() => {
                const bd = calcItemBreakdown(item, catalogs);
                return bd.qty > 0 && (
                  <div className="pp-section" data-testid={`pp-breakdown-${idx}`}>
                    <div className="pp-section-head">
                      <span className="pp-section-num">{nextSection()}</span>
                      <span className="pp-section-name">ДЕТАЛИЗАЦИЯ ЦЕНЫ</span>
                    </div>
                    <div className="pp-kv">
                      <div className="pp-kv-row"><span>Базовая цена</span><span className="pp-kv-dots" /><b>{bd.base.toLocaleString('ru-RU')} &#8381;</b></div>
                      {item.extras?.length > 0 && item.extras.map(code => {
                        const ex = extrasCatalog.find(e => e.code === code);
                        if (!ex) return null;
                        return <div className="pp-kv-row" key={code}><span>{ex.name}</span><span className="pp-kv-dots" /><b>+{ex.price} &#8381;</b></div>;
                      })}
                      {bd.extras > 0 && <div className="pp-kv-row"><span>Итого обработки</span><span className="pp-kv-dots" /><b>+{bd.extras.toLocaleString('ru-RU')} &#8381;</b></div>}
                      {bd.labels > 0 && <div className="pp-kv-row"><span>Этикетки</span><span className="pp-kv-dots" /><b>+{bd.labels.toLocaleString('ru-RU')} &#8381;</b></div>}
                      {bd.print > 0 && <div className="pp-kv-row"><span>Нанесение</span><span className="pp-kv-dots" /><b>+{bd.print.toLocaleString('ru-RU')} &#8381;</b></div>}
                      {bd.pack > 0 && <div className="pp-kv-row"><span>Упаковка — {item.packType === 'zip' ? 'ЗИП пакет' : item.packType === 'bopp' ? 'БОПП пакет' : 'упаковка'}</span><span className="pp-kv-dots" /><b>+{bd.pack.toLocaleString('ru-RU')} &#8381;</b></div>}
                      {bd.cost > 0 && <div className="pp-kv-row"><span>Себестоимость</span><span className="pp-kv-dots" /><b>{bd.cost.toLocaleString('ru-RU')} &#8381;</b></div>}
                      {bd.markup > 0 && <div className="pp-kv-row"><span>Наценка +{Math.round((bd.markupPct||0)*100)}%</span><span className="pp-kv-dots" /><b>+{bd.markup.toLocaleString('ru-RU')} &#8381;</b></div>}
                      {bd.urgent > 0 && <div className="pp-kv-row"><span>Срочность</span><span className="pp-kv-dots" /><b>+{bd.urgent.toLocaleString('ru-RU')} &#8381;</b></div>}
                      <div className="pp-kv-row"><span>Итого за шт.</span><span className="pp-kv-dots" /><b>{bd.unitPrice.toLocaleString('ru-RU')} &#8381;</b></div>
                      <div className="pp-kv-row"><span>Кол-во</span><span className="pp-kv-dots" /><b>{bd.qty} шт</b></div>
                      <div className="pp-kv-row" style={{ fontWeight: 700 }}><span>ИТОГО</span><span className="pp-kv-dots" /><b>{bd.total.toLocaleString('ru-RU')} &#8381;</b></div>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}

        {/* ── Multi-item summary table ── */}
        {items.length > 1 && (
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">СВОДНАЯ ТАБЛИЦА</span>
            </div>
            <table className="pp-table" data-testid="pp-summary-table">
              <thead><tr><th>Позиция</th><th>Кол-во</th><th>Сумма</th></tr></thead>
              <tbody>
                {items.map((item, idx) => {
                  const qty = getItemTotalQty(item);
                  const total = calcItemTotal(item, catalogs);
                  return (
                    <tr key={idx}>
                      <td>{item.sku?.name || TYPE_NAMES[item.type] || item.type}</td>
                      <td>{qty} шт</td>
                      <td><b>{total.toLocaleString('ru-RU')} ₽</b></td>
                    </tr>
                  );
                })}
                <tr className="pp-table-total">
                  <td>ИТОГО</td>
                  <td><b>{grandQty} шт</b></td>
                  <td><b>{grandTotal.toLocaleString('ru-RU')} ₽</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── Опции ── */}
        <div className="pp-section">
          <div className="pp-section-head">
            <span className="pp-section-num">{nextSection()}</span>
            <span className="pp-section-name">ОПЦИИ</span>
          </div>
          <div className="pp-kv">
            {urgentOption && (
              <div className="pp-kv-row"><span>Срочный заказ</span><span className="pp-kv-dots" /><b>Да (+20%)</b></div>
            )}
            {packType && packType !== 'none' && (
              <div className="pp-kv-row"><span>Упаковка</span><span className="pp-kv-dots" /><b>{packType === 'zip' ? 'ЗИП пакет' : packType === 'bopp' ? 'БОПП пакет' : 'Да'}</b></div>
            )}
            {!urgentOption && (!packType || packType === 'none') && (
              <div className="pp-options-note">Стандартные условия</div>
            )}
          </div>
        </div>

        {/* ── Клиент ── */}
        {(stateName || stateContact || stateEmail || statePhone) && (
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">КЛИЕНТ</span>
            </div>
            <div className="pp-kv">
              {stateName && <div className="pp-kv-row"><span>Имя</span><span className="pp-kv-dots" /><b>{stateName}</b></div>}
              {statePhone && <div className="pp-kv-row"><span>Телефон</span><span className="pp-kv-dots" /><b>{statePhone}</b></div>}
              {stateContact && <div className="pp-kv-row"><span>Контакт</span><span className="pp-kv-dots" /><b>{stateContact}</b></div>}
              {stateEmail && <div className="pp-kv-row"><span>Email</span><span className="pp-kv-dots" /><b>{stateEmail}</b></div>}
              {stateAddress && <div className="pp-kv-row"><span>Адрес</span><span className="pp-kv-dots" /><b>{stateAddress}</b></div>}
            </div>
          </div>
        )}

        {/* ── Заметки ── */}
        {stateNotes && (
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">ЗАМЕТКИ</span>
            </div>
            <div className="pp-notes">{stateNotes}</div>
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
