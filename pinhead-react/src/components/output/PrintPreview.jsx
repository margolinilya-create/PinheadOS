import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { TYPE_NAMES, FABRIC_NAMES, TECH_NAMES, ZONE_LABELS, SIZES } from '../../data';
import { calcTotal, getUnitPrice, getTotalQty, getLabelConfigPrice } from '../../utils/pricing';
import { LABEL_CONFIG } from '../../data/extras';

export default function PrintPreview() {
  const navigate = useNavigate();
  const onClose = () => navigate('/');
  const state = useStore();
  const total = calcTotal(state);
  const unitPrice = getUnitPrice(state);
  const totalQty = getTotalQty(state);
  const labelPrice = getLabelConfigPrice(state.labelConfig);

  const orderNumber = state._editingOrderNumber || ('PH-' + Date.now().toString(36).toUpperCase());
  const now = new Date().toLocaleDateString('ru-RU');

  const sizeEntries = state.sku?.category === 'accessories'
    ? [['ONE SIZE', state.sizes['ONE SIZE'] || 1]]
    : SIZES.map(s => [s, state.sizes[s] || 0]).filter(([, q]) => q > 0);

  // Custom sizes
  const customEntries = (state.customSizes || []).filter(c => (parseInt(c.qty) || 0) > 0);

  const handlePrint = () => window.print();

  // Section counter
  let sectionNum = 0;
  const nextSection = () => String(++sectionNum).padStart(2, '0');

  return (
    <div className="pp-overlay">
      {/* ── Toolbar ── */}
      <div className="pp-toolbar no-print">
        <button className="btn btn-primary" onClick={handlePrint}>ПЕЧАТЬ / PDF</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>ЗАКРЫТЬ</button>
      </div>

      <div className="pp-page">
        {/* ── Header ── */}
        <div className="pp-header">
          <div className="pp-logo">
            <svg className="pp-logo-mark" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
              <line x1="16" y1="2" x2="16" y2="30" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="2" y1="16" x2="30" y2="16" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="5" y1="5" x2="27" y2="27" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="27" y1="5" x2="5" y2="27" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
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

        {/* ── 01 Изделие ── */}
        <div className="pp-section">
          <div className="pp-section-head">
            <span className="pp-section-num">{nextSection()}</span>
            <span className="pp-section-name">ИЗДЕЛИЕ</span>
          </div>
          <div className="pp-kv">
            <div className="pp-kv-row">
              <span>Тип</span>
              <span className="pp-kv-dots" />
              <b>{state.sku?.name || TYPE_NAMES[state.type] || '—'}</b>
            </div>
            <div className="pp-kv-row">
              <span>Ткань</span>
              <span className="pp-kv-dots" />
              <b>{FABRIC_NAMES[state.fabric] || state.fabric || '—'}</b>
            </div>
            <div className="pp-kv-row">
              <span>Цвет</span>
              <span className="pp-kv-dots" />
              <b>{state.color || '—'}</b>
            </div>
            <div className="pp-kv-row">
              <span>Дата</span>
              <span className="pp-kv-dots" />
              <b>{now}</b>
            </div>
            {state.deadline && (
              <div className="pp-kv-row">
                <span>Дедлайн</span>
                <span className="pp-kv-dots" />
                <b>{state.deadline}</b>
              </div>
            )}
          </div>
        </div>

        {/* ── 02 Размеры и тираж ── */}
        <div className="pp-section">
          <div className="pp-section-head">
            <span className="pp-section-num">{nextSection()}</span>
            <span className="pp-section-name">РАЗМЕРЫ И ТИРАЖ</span>
          </div>
          <table className="pp-table">
            <thead>
              <tr>
                <th>Размер</th>
                <th>Кол-во</th>
                <th>Цена/шт</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {sizeEntries.map(([size, qty]) => (
                <tr key={size}>
                  <td>{size}</td>
                  <td>{qty}</td>
                  <td>{unitPrice.toLocaleString('ru-RU')} ₽</td>
                  <td><b>{(qty * unitPrice).toLocaleString('ru-RU')} ₽</b></td>
                </tr>
              ))}
              {customEntries.map((c, i) => (
                <tr key={`c-${i}`}>
                  <td>{c.label || c.size}</td>
                  <td>{c.qty}</td>
                  <td>{unitPrice.toLocaleString('ru-RU')} ₽</td>
                  <td><b>{((parseInt(c.qty) || 0) * unitPrice).toLocaleString('ru-RU')} ₽</b></td>
                </tr>
              ))}
              <tr className="pp-table-total">
                <td>ИТОГО</td>
                <td><b>{totalQty}</b></td>
                <td />
                <td><b>{total.toLocaleString('ru-RU')} ₽</b></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── 03 Нанесение ── */}
        {!state.noPrint && state.zones?.length > 0 && (
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">НАНЕСЕНИЕ</span>
            </div>
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Зона</th>
                  <th>Техника</th>
                  <th>Параметры</th>
                  <th>Макет</th>
                </tr>
              </thead>
              <tbody>
                {state.zones.map(z => {
                  const tech = state.zoneTechs?.[z] || 'screen';
                  const fmt = state.zoneFormats?.[z] || '—';
                  const col = state.zoneColors?.[z] || '';
                  const params = [fmt, col ? `${col} цв.` : ''].filter(Boolean).join(', ') || '—';
                  return (
                    <tr key={z}>
                      <td>{ZONE_LABELS[z] || z}</td>
                      <td>{TECH_NAMES[tech] || tech}</td>
                      <td>{params}</td>
                      <td>—</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── 04 Бирки ── */}
        {labelPrice > 0 && (
          <div className="pp-section">
            <div className="pp-section-head">
              <span className="pp-section-num">{nextSection()}</span>
              <span className="pp-section-name">БИРКИ И ЭТИКЕТКИ</span>
            </div>
            <div className="pp-kv">
              {state.labelConfig?.careLabel?.enabled && (
                <div className="pp-kv-row">
                  <span>Бирка по уходу</span>
                  <span className="pp-kv-dots" />
                  <b>{LABEL_CONFIG.careLabel.options.find(o => o.key === state.labelConfig.careLabel.logoOption)?.name || '—'}</b>
                </div>
              )}
              {state.labelConfig?.mainLabel?.option !== 'none' && (
                <div className="pp-kv-row">
                  <span>Основная бирка</span>
                  <span className="pp-kv-dots" />
                  <b>{LABEL_CONFIG.mainLabel.options.find(o => o.key === state.labelConfig.mainLabel.option)?.name || '—'}</b>
                </div>
              )}
              {state.labelConfig?.hangTag?.option !== 'none' && (
                <div className="pp-kv-row">
                  <span>Хэнг-тег</span>
                  <span className="pp-kv-dots" />
                  <b>{LABEL_CONFIG.hangTag.options.find(o => o.key === state.labelConfig.hangTag.option)?.name || '—'}</b>
                </div>
              )}
            </div>
          </div>
        )}

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
          ИТОГО: {total.toLocaleString('ru-RU')} ₽
        </div>
      </div>
    </div>
  );
}
