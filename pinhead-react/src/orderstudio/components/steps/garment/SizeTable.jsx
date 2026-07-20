import { useRef, useState } from 'react';
import { useStore } from '../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { SIZES } from '../../../../data';
import { isAccessory, getUnitPrice } from '../../../utils/pricing';
import { sizeOrder } from '../../../store/slices/helpers';
import { useEffectiveRules } from '../../../hooks/useEffectiveRules';
import { isSizeAvailable as checkSizeRule } from '../../../utils/skuRules';

function buildSortedRows(stdSizes, sizes, customSizes) {
  const stdRows = stdSizes.map(s => ({ type: 'std', label: s, qty: sizes[s] || 0 }));
  const customRows = (customSizes || []).map((cs, i) => ({ type: 'custom', label: cs.label, qty: cs.qty || 0, idx: i }));
  const all = [...stdRows, ...customRows];
  all.sort((a, b) => sizeOrder(a.label) - sizeOrder(b.label));
  return all;
}

export default function SizeTable() {
  const { type, sku, sizes, setSize, setOneSizeQty, customSizes, addCustomSize, removeCustomSize, setCustomSizeQty, setCustomSizeLabel } = useStore(
    useShallow(s => ({ type: s.type, sku: s.sku, sizes: s.sizes, setSize: s.setSize, setOneSizeQty: s.setOneSizeQty,
      customSizes: s.customSizes, addCustomSize: s.addCustomSize, removeCustomSize: s.removeCustomSize,
      setCustomSizeQty: s.setCustomSizeQty, setCustomSizeLabel: s.setCustomSizeLabel }))
  );
  const price = useStore(s => getUnitPrice(s));
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newQty, setNewQty] = useState(0);
  const sizeRefs = useRef({});
  const isAcc = isAccessory(type);
  const rules = useEffectiveRules();

  const isSizeAvailable = (s) => {
    // Check per-SKU availableSizes (existing behavior)
    if (sku?.availableSizes && !sku.availableSizes.includes(s)) return false;
    // Check category rules
    if (rules && !checkSizeRule(rules, s)) return false;
    return true;
  };

  const handleSizeKeyDown = (e, currentLabel, allLabels) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      const idx = allLabels.indexOf(currentLabel);
      if (idx >= 0 && idx < allLabels.length - 1) {
        e.preventDefault();
        const nextLabel = allLabels[idx + 1];
        sizeRefs.current[nextLabel]?.focus();
      }
    }
  };

  if (isAcc) {
    const qty = sizes['ONE SIZE'] || 1;
    return (
      <div className="size-section">
        <div className="section-label">Тираж</div>
        <div className="one-size-row">
          <button className="qty-btn" onClick={() => setOneSizeQty(qty - 1)}>−</button>
          <input type="number" className="qty-input" value={qty} min={1} max={99999} onChange={e => setOneSizeQty(Math.min(99999, parseInt(e.target.value) || 1))} />
          <button className="qty-btn" onClick={() => setOneSizeQty(qty + 1)}>+</button>
          <span className="qty-label">шт</span>
        </div>
      </div>
    );
  }

  const stdQty = Object.values(sizes).reduce((s, v) => s + (parseInt(v) || 0), 0);
  const customQty = (customSizes || []).reduce((s, c) => s + (parseInt(c.qty) || 0), 0);
  const totalQty = stdQty + customQty;
  const totalSum = totalQty * price;

  const allRows = buildSortedRows(SIZES, sizes, customSizes);
  const allInputLabels = allRows.filter(r => r.type === 'std' ? isSizeAvailable(r.label) : true).map(r => r.type === 'std' ? r.label : 'cs-' + r.idx);

  const handleAddSize = () => {
    const raw = newLabel.trim().toUpperCase();
    if (!raw) return;
    const xMatch = raw.match(/^(X+)L$/);
    const normalized = xMatch && xMatch[1].length >= 2
      ? `${xMatch[1].length}XL`
      : raw;
    const allExisting = [...SIZES.map(s => s.toUpperCase()), ...(customSizes || []).map(c => c.label.toUpperCase())];
    if (allExisting.includes(normalized)) {
      setNewLabel('');
      return;
    }
    addCustomSize(normalized);
    if (newQty > 0) {
      setTimeout(() => {
        const cs = useStore.getState().customSizes;
        const idx = cs.findIndex(c => c.label === normalized);
        if (idx >= 0) setCustomSizeQty(idx, newQty);
      }, 0);
    }
    setNewLabel('');
    setNewQty(0);
    setShowAddForm(false);
  };

  return (
    <div className="size-section">
      <div className="section-label">Размеры</div>

      {/* Desktop table */}
      <table className="size-table size-table-desktop">
        <thead>
          <tr>
            <th>Размер</th>
            <th>Количество</th>
            <th className="size-th-price">Цена/шт</th>
            <th className="size-th-sum">Сумма</th>
          </tr>
        </thead>
        <tbody>
          {allRows.map((row, idx) => {
            const q = parseInt(row.qty) || 0;
            const rowSum = q * price;
            const available = row.type === 'std' ? isSizeAvailable(row.label) : true;
            const inputKey = row.type === 'std' ? row.label : 'cs-' + row.idx;
            return row.type === 'std' ? (
              <tr key={row.label} className={!available ? 'size-row-disabled' : ''} title={!available ? `${row.label} недоступен для этого артикула` : undefined}>
                <td><b>{row.label}</b></td>
                <td>
                  <div className="qty-control">
                    <button className="qty-btn" disabled={!available} onClick={() => setSize(row.label, Math.max(0, (parseInt(sizes[row.label]) || 0) - 1))}>−</button>
                    <input
                      ref={el => { sizeRefs.current[inputKey] = el; }}
                      type="number"
                      className="qty-input"
                      min={0}
                      max={99999}
                      value={sizes[row.label] || ''}
                      placeholder="0"
                      disabled={!available}
                      tabIndex={available ? idx + 1 : -1}
                      onChange={e => setSize(row.label, e.target.value)}
                      onKeyDown={e => handleSizeKeyDown(e, inputKey, allInputLabels)}
                    />
                    <button className="qty-btn" disabled={!available} onClick={() => setSize(row.label, (parseInt(sizes[row.label]) || 0) + 1)}>+</button>
                  </div>
                </td>
                <td className="size-td-price">{price.toLocaleString('ru-RU')} ₽</td>
                <td className="size-td-sum">{q > 0 ? (rowSum.toLocaleString('ru-RU') + ' ₽') : '—'}</td>
              </tr>
            ) : (
              <tr key={'cs-' + row.idx} className="custom-size-row">
                <td>
                  <input
                    type="text"
                    className="custom-size-label-input"
                    value={row.label}
                    onChange={e => setCustomSizeLabel(row.idx, e.target.value)}
                  />
                </td>
                <td>
                  <div className="qty-control">
                    <button className="qty-btn" onClick={() => setCustomSizeQty(row.idx, Math.max(0, (parseInt(row.qty) || 0) - 1))}>−</button>
                    <input
                      ref={el => { sizeRefs.current[inputKey] = el; }}
                      type="number"
                      className="qty-input"
                      min={0}
                      value={row.qty || ''}
                      placeholder="0"
                      tabIndex={idx + 1}
                      onChange={e => setCustomSizeQty(row.idx, e.target.value)}
                      onKeyDown={e => handleSizeKeyDown(e, inputKey, allInputLabels)}
                    />
                    <button className="qty-btn" onClick={() => setCustomSizeQty(row.idx, (parseInt(row.qty) || 0) + 1)}>+</button>
                  </div>
                </td>
                <td className="size-td-price">{price.toLocaleString('ru-RU')} ₽</td>
                <td className="size-td-sum">
                  <span>{q > 0 ? (rowSum.toLocaleString('ru-RU') + ' ₽') : '—'}</span>
                  <button className="size-rm-btn" onClick={() => removeCustomSize(row.idx)} aria-label="Удалить размер">✕</button>
                </td>
              </tr>
            );
          })}
          <tr className="size-total-row">
            <td className="size-total-label">ИТОГО</td>
            <td className="size-total-qty">{totalQty} шт</td>
            <td></td>
            <td className="size-total-sum">{totalSum > 0 ? (totalSum.toLocaleString('ru-RU') + ' ₽') : '0 ₽'}</td>
          </tr>
        </tbody>
      </table>

      {/* Mobile vertical list */}
      <div className="size-list-mobile">
        {allRows.map((row) => {
          const available = row.type === 'std' ? isSizeAvailable(row.label) : true;
          const inputKey = row.type === 'std' ? row.label : 'cs-' + row.idx;
          return (
            <div key={inputKey} className={`size-mobile-row${!available ? ' disabled' : ''}`} title={!available ? `${row.label} недоступен для этого артикула` : undefined}>
              <span className="size-mobile-label">{row.label}</span>
              <div className="qty-control">
                <button className="qty-btn" disabled={!available} onClick={() => row.type === 'std' ? setSize(row.label, Math.max(0, (parseInt(sizes[row.label]) || 0) - 1)) : setCustomSizeQty(row.idx, Math.max(0, (parseInt(row.qty) || 0) - 1))}>−</button>
                <input
                  type="number"
                  className="qty-input qty-input-mobile"
                  min={0}
                  value={row.type === 'std' ? (sizes[row.label] || '') : (row.qty || '')}
                  placeholder="0"
                  disabled={!available}
                  inputMode="numeric"
                  onChange={e => row.type === 'std' ? setSize(row.label, e.target.value) : setCustomSizeQty(row.idx, e.target.value)}
                />
                <button className="qty-btn" disabled={!available} onClick={() => row.type === 'std' ? setSize(row.label, (parseInt(sizes[row.label]) || 0) + 1) : setCustomSizeQty(row.idx, (parseInt(row.qty) || 0) + 1)}>+</button>
              </div>
              <span className="size-mobile-unit">шт</span>
              {row.type === 'custom' && <button className="size-rm-btn" onClick={() => removeCustomSize(row.idx)} aria-label="Удалить размер">✕</button>}
            </div>
          );
        })}
        <div className="size-mobile-total">Итого: {totalQty} шт · {totalSum > 0 ? (totalSum.toLocaleString('ru-RU') + ' ₽') : '0 ₽'}</div>
      </div>

      {/* Add custom size */}
      {showAddForm ? (
        <div className="add-size-form">
          <label htmlFor="add-size-label" className="add-size-form-label">РАЗМЕР</label>
          <input
            id="add-size-label"
            type="text"
            className="add-size-form-input"
            placeholder="4XL, 5XL..."
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddSize()}
            autoFocus
          />
          <label htmlFor="add-size-qty" className="add-size-form-label">КОЛ-ВО</label>
          <input
            id="add-size-qty"
            type="number"
            className="add-size-form-qty"
            min={0}
            value={newQty || ''}
            placeholder="0"
            onChange={e => setNewQty(parseInt(e.target.value) || 0)}
            onKeyDown={e => e.key === 'Enter' && handleAddSize()}
          />
          <button className="btn-add-size" onClick={handleAddSize}>ДОБАВИТЬ</button>
          <button className="btn-cancel-size" onClick={() => { setShowAddForm(false); setNewLabel(''); setNewQty(0); }}>ОТМЕНА</button>
        </div>
      ) : (
        <button className="add-size-btn" onClick={() => setShowAddForm(true)}>+ ДОБАВИТЬ РАЗМЕР</button>
      )}
    </div>
  );
}
