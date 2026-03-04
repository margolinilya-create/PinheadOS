import { useStore } from '../../store/useStore';
import { TYPE_NAMES, FABRIC_NAMES, TECH_NAMES, ZONE_LABELS, SIZES } from '../../data';
import { calcTotal, getUnitPrice, getTotalQty, getLabelConfigPrice } from '../../utils/pricing';
import { LABEL_CONFIG } from '../../data/extras';

export default function PrintPreview({ onBack }) {
  const state = useStore();
  const total = calcTotal(state);
  const unitPrice = getUnitPrice(state);
  const totalQty = getTotalQty(state);
  const labelPrice = getLabelConfigPrice(state.labelConfig);
  const orderId = 'PH-' + Date.now().toString(36).toUpperCase();
  const now = new Date().toLocaleString('ru-RU');

  // Размеры
  const sizeEntries = state.sku?.category === 'accessories'
    ? [['ONE SIZE', state.sizes['ONE SIZE'] || 1]]
    : SIZES.map(s => [s, state.sizes[s] || 0]).filter(([, q]) => q > 0);

  const handlePrint = () => window.print();

  return (
    <div className="pp-page-wrap">
      <div className="pp-toolbar no-print">
        <button className="page-back-btn" onClick={onBack}>← Назад</button>
        <button className="btn-accent" onClick={handlePrint}>Печать / PDF</button>
      </div>

      <div className="pp-page">
        {/* Шапка */}
        <div className="pp-header">
          <div className="pp-logo">✳ PINHEAD</div>
          <div className="pp-meta">
            <div className="pp-order-id">{orderId}</div>
            <div className="pp-date">{now}</div>
          </div>
        </div>

        <h1 className="pp-title">Техническое задание</h1>

        {/* 01 — Изделие */}
        <div className="pp-section">
          <div className="pp-section-num">01</div>
          <div className="pp-section-content">
            <h2>Изделие</h2>
            <div className="pp-grid">
              <div className="pp-row"><span>Артикул</span><b>{state.sku?.article || state.sku?.code || '—'}</b></div>
              <div className="pp-row"><span>Изделие</span><b>{state.sku?.name || TYPE_NAMES[state.type] || '—'}</b></div>
              <div className="pp-row"><span>Ткань</span><b>{FABRIC_NAMES[state.fabric] || state.fabric || '—'}</b></div>
              <div className="pp-row"><span>Крой</span><b>{state.fit === 'oversized' ? 'Oversized' : 'Regular'}</b></div>
              <div className="pp-row"><span>Цвет</span><b>{state.color || '—'}</b></div>
              <div className="pp-row"><span>Тираж</span><b>{totalQty} шт</b></div>
            </div>
          </div>
        </div>

        {/* 02 — Размеры */}
        <div className="pp-section">
          <div className="pp-section-num">02</div>
          <div className="pp-section-content">
            <h2>Размеры</h2>
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Размер</th>
                  <th>Кол-во</th>
                </tr>
              </thead>
              <tbody>
                {sizeEntries.map(([size, qty]) => (
                  <tr key={size}>
                    <td>{size}</td>
                    <td><b>{qty}</b></td>
                  </tr>
                ))}
                <tr className="pp-table-total">
                  <td>Итого</td>
                  <td><b>{totalQty}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 03 — Нанесение */}
        {!state.noPrint && state.zones.length > 0 && (
          <div className="pp-section">
            <div className="pp-section-num">03</div>
            <div className="pp-section-content">
              <h2>Нанесение</h2>
              {state.zones.map(z => {
                const tech = state.zoneTechs[z] || 'screen';
                return (
                  <div key={z} className="pp-zone-row">
                    <span className="pp-zone-name">{ZONE_LABELS[z] || z}</span>
                    <span className="pp-zone-tech">{TECH_NAMES[tech] || tech}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 04 — Бирки */}
        {labelPrice > 0 && (
          <div className="pp-section">
            <div className="pp-section-num">04</div>
            <div className="pp-section-content">
              <h2>Бирки и этикетки</h2>
              {state.labelConfig.careLabel.enabled && (
                <div className="pp-row"><span>Бирка по уходу</span><b>{LABEL_CONFIG.careLabel.options.find(o => o.key === state.labelConfig.careLabel.logoOption)?.name}</b></div>
              )}
              {state.labelConfig.mainLabel.option !== 'none' && (
                <div className="pp-row"><span>Основная бирка</span><b>{LABEL_CONFIG.mainLabel.options.find(o => o.key === state.labelConfig.mainLabel.option)?.name}</b></div>
              )}
              {state.labelConfig.hangTag.option !== 'none' && (
                <div className="pp-row"><span>Хэнг-тег</span><b>{LABEL_CONFIG.hangTag.options.find(o => o.key === state.labelConfig.hangTag.option)?.name}</b></div>
              )}
            </div>
          </div>
        )}

        {/* 05 — Клиент */}
        <div className="pp-section">
          <div className="pp-section-num">05</div>
          <div className="pp-section-content">
            <h2>Клиент</h2>
            <div className="pp-grid">
              {state.name && <div className="pp-row"><span>Имя</span><b>{state.name}</b></div>}
              {state.contact && <div className="pp-row"><span>Контакт</span><b>{state.contact}</b></div>}
              {state.email && <div className="pp-row"><span>Email</span><b>{state.email}</b></div>}
              {state.phone && <div className="pp-row"><span>Телефон</span><b>{state.phone}</b></div>}
              {state.deadline && <div className="pp-row"><span>Дедлайн</span><b>{state.deadline}</b></div>}
              {state.address && <div className="pp-row"><span>Адрес</span><b>{state.address}</b></div>}
              {state.notes && <div className="pp-row"><span>Заметки</span><b>{state.notes}</b></div>}
            </div>
          </div>
        </div>

        {/* Итого */}
        <div className="pp-total-block">
          <div className="pp-total-row">
            <span>Цена за единицу</span>
            <b>{unitPrice.toLocaleString('ru-RU')} ₽</b>
          </div>
          <div className="pp-total-row pp-grand-total">
            <span>ИТОГО</span>
            <b>{total.toLocaleString('ru-RU')} ₽</b>
          </div>
        </div>
      </div>
    </div>
  );
}
