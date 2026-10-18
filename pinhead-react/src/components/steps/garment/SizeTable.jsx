import { useRef, useState } from 'react';
import { useStore } from '../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { SIZES } from '../../../data';
import { isAccessory, getUnitPrice } from '../../../utils/pricing';
import { sizeOrder } from '../../../store/slices/helpers';
import { useEffectiveRules } from '../../../hooks/useEffectiveRules';
import { isSizeAvailable as checkSizeRule } from '../../../utils/skuRules';
import { Icon } from '../../../erp/components/Icon';
import panel from './panel.module.css';
import styles from './SizeTable.module.css';

function buildSortedRows(stdSizes, sizes, customSizes) {
  const stdRows = stdSizes.map(s => ({ type: 'std', label: s, qty: sizes[s] || 0 }));
  const customRows = (customSizes || []).map((cs, i) => ({ type: 'custom', label: cs.label, qty: cs.qty || 0, idx: i }));
  const all = [...stdRows, ...customRows];
  all.sort((a, b) => sizeOrder(a.label) - sizeOrder(b.label));
  return all;
}

/**
 * Размеры позиции. `readOnly` — поля и кнопки закрыты, добавить размер нельзя.
 * `showPrice` — колонки цены и суммы по прайсу визарда: в рабочем месте заказа
 * выключены, цена там одна — из `priceOrder`.
 */
export default function SizeTable({ readOnly = false, showPrice = true }) {
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
      <div className={panel.section}>
        <div className={panel.sectionLabel}>Тираж</div>
        <div className={styles.qty}>
          <button className={styles.qtyBtn} aria-label="Уменьшить тираж" disabled={readOnly} onClick={() => setOneSizeQty(qty - 1)}>−</button>
          <input type="number" className={styles.qtyInput} aria-label="Тираж" value={qty} min={1} max={99999} disabled={readOnly} onChange={e => setOneSizeQty(Math.min(99999, parseInt(e.target.value) || 1))} />
          <button className={styles.qtyBtn} aria-label="Увеличить тираж" disabled={readOnly} onClick={() => setOneSizeQty(qty + 1)}>+</button>
          <span className={styles.unit}>шт</span>
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
    <div className={panel.section}>
      <div className={panel.sectionLabel}>Размеры</div>

      {/* Desktop table */}
      <table className={`${styles.table} ${styles.desktop}`}>
        <thead>
          <tr>
            <th>Размер</th>
            <th>Количество</th>
            {showPrice && <th className={styles.num}>Цена/шт</th>}
            {showPrice && <th className={styles.num}>Сумма</th>}
          </tr>
        </thead>
        <tbody>
          {allRows.map((row, idx) => {
            const q = parseInt(row.qty) || 0;
            const rowSum = q * price;
            const available = row.type === 'std' ? isSizeAvailable(row.label) : true;
            const inputKey = row.type === 'std' ? row.label : 'cs-' + row.idx;
            const removeBtn = row.type === 'custom' && !readOnly
              ? <button className={styles.removeBtn} onClick={() => removeCustomSize(row.idx)} aria-label={`Удалить размер ${row.label}`}><Icon name="x" size={16} /></button>
              : null;
            return row.type === 'std' ? (
              <tr key={row.label} className={!available ? styles.unavailable : undefined} title={!available ? `${row.label} недоступен для этого артикула` : undefined}>
                <td><b>{row.label}</b></td>
                <td>
                  <div className={styles.qty}>
                    <button className={styles.qtyBtn} aria-label={`Уменьшить ${row.label}`} disabled={!available || readOnly} onClick={() => setSize(row.label, Math.max(0, (parseInt(sizes[row.label]) || 0) - 1))}>−</button>
                    <input
                      ref={el => { sizeRefs.current[inputKey] = el; }}
                      type="number"
                      className={styles.qtyInput}
                      min={0}
                      max={99999}
                      value={sizes[row.label] || ''}
                      placeholder="0"
                      aria-label={`Размер ${row.label}`}
                      disabled={!available || readOnly}
                      tabIndex={available ? idx + 1 : -1}
                      onChange={e => setSize(row.label, e.target.value)}
                      onKeyDown={e => handleSizeKeyDown(e, inputKey, allInputLabels)}
                    />
                    <button className={styles.qtyBtn} aria-label={`Увеличить ${row.label}`} disabled={!available || readOnly} onClick={() => setSize(row.label, (parseInt(sizes[row.label]) || 0) + 1)}>+</button>
                  </div>
                </td>
                {showPrice && <td className={`${styles.num} ${styles.price}`}>{price.toLocaleString('ru-RU')} ₽</td>}
                {showPrice && <td className={`${styles.num} ${styles.sum}`}>{q > 0 ? (rowSum.toLocaleString('ru-RU') + ' ₽') : '—'}</td>}
              </tr>
            ) : (
              <tr key={'cs-' + row.idx}>
                <td>
                  <input
                    type="text"
                    className={styles.labelInput}
                    aria-label="Название размера"
                    disabled={readOnly}
                    value={row.label}
                    onChange={e => setCustomSizeLabel(row.idx, e.target.value)}
                  />
                </td>
                <td>
                  <div className={styles.qty}>
                    <button className={styles.qtyBtn} aria-label={`Уменьшить ${row.label}`} disabled={readOnly} onClick={() => setCustomSizeQty(row.idx, Math.max(0, (parseInt(row.qty) || 0) - 1))}>−</button>
                    <input
                      ref={el => { sizeRefs.current[inputKey] = el; }}
                      type="number"
                      className={styles.qtyInput}
                      min={0}
                      value={row.qty || ''}
                      placeholder="0"
                      aria-label={`Размер ${row.label}`}
                      disabled={readOnly}
                      tabIndex={idx + 1}
                      onChange={e => setCustomSizeQty(row.idx, e.target.value)}
                      onKeyDown={e => handleSizeKeyDown(e, inputKey, allInputLabels)}
                    />
                    <button className={styles.qtyBtn} aria-label={`Увеличить ${row.label}`} disabled={readOnly} onClick={() => setCustomSizeQty(row.idx, (parseInt(row.qty) || 0) + 1)}>+</button>
                  </div>
                  {/* Без цены колонок две, как в шапке: ✕ — рядом с количеством */}
                  {!showPrice && removeBtn}
                </td>
                {showPrice && <td className={`${styles.num} ${styles.price}`}>{price.toLocaleString('ru-RU')} ₽</td>}
                {showPrice && (
                  <td className={`${styles.num} ${styles.sum}`}>
                    <span>{q > 0 ? (rowSum.toLocaleString('ru-RU') + ' ₽') : '—'}</span>
                    {removeBtn}
                  </td>
                )}
              </tr>
            );
          })}
          <tr className={styles.totalRow}>
            <td>ИТОГО</td>
            <td>{totalQty} шт</td>
            {showPrice && <td></td>}
            {showPrice && <td className={styles.num}>{totalSum > 0 ? (totalSum.toLocaleString('ru-RU') + ' ₽') : '0 ₽'}</td>}
          </tr>
        </tbody>
      </table>

      {/* Mobile vertical list */}
      <div className={styles.mobile}>
        {allRows.map((row) => {
          const available = row.type === 'std' ? isSizeAvailable(row.label) : true;
          const inputKey = row.type === 'std' ? row.label : 'cs-' + row.idx;
          return (
            <div key={inputKey} className={`${styles.mobileRow}${!available ? ` ${styles.unavailable}` : ''}`} title={!available ? `${row.label} недоступен для этого артикула` : undefined}>
              <span className={styles.mobileLabel}>{row.label}</span>
              <div className={styles.qty}>
                <button className={styles.qtyBtn} aria-label={`Уменьшить ${row.label}`} disabled={!available || readOnly} onClick={() => row.type === 'std' ? setSize(row.label, Math.max(0, (parseInt(sizes[row.label]) || 0) - 1)) : setCustomSizeQty(row.idx, Math.max(0, (parseInt(row.qty) || 0) - 1))}>−</button>
                <input
                  type="number"
                  className={styles.qtyInput}
                  min={0}
                  value={row.type === 'std' ? (sizes[row.label] || '') : (row.qty || '')}
                  placeholder="0"
                  aria-label={`Размер ${row.label}`}
                  disabled={!available || readOnly}
                  inputMode="numeric"
                  onChange={e => row.type === 'std' ? setSize(row.label, e.target.value) : setCustomSizeQty(row.idx, e.target.value)}
                />
                <button className={styles.qtyBtn} aria-label={`Увеличить ${row.label}`} disabled={!available || readOnly} onClick={() => row.type === 'std' ? setSize(row.label, (parseInt(sizes[row.label]) || 0) + 1) : setCustomSizeQty(row.idx, (parseInt(row.qty) || 0) + 1)}>+</button>
              </div>
              <span className={styles.unit}>шт</span>
              {row.type === 'custom' && !readOnly && <button className={styles.removeBtn} onClick={() => removeCustomSize(row.idx)} aria-label={`Удалить размер ${row.label}`}><Icon name="x" size={16} /></button>}
            </div>
          );
        })}
        <div className={styles.mobileTotal}>Итого: {totalQty} шт{showPrice ? ` · ${totalSum > 0 ? (totalSum.toLocaleString('ru-RU') + ' ₽') : '0 ₽'}` : ''}</div>
      </div>

      {/* Add custom size */}
      {readOnly ? null : showAddForm ? (
        <div className={styles.addForm}>
          <label htmlFor="add-size-label" className={styles.addLabel}>РАЗМЕР</label>
          <input
            id="add-size-label"
            type="text"
            className={styles.addInput}
            placeholder="4XL, 5XL..."
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddSize()}
            autoFocus
          />
          <label htmlFor="add-size-qty" className={styles.addLabel}>КОЛ-ВО</label>
          <input
            id="add-size-qty"
            type="number"
            className={`${styles.addInput} ${styles.addQty}`}
            min={0}
            value={newQty || ''}
            placeholder="0"
            onChange={e => setNewQty(parseInt(e.target.value) || 0)}
            onKeyDown={e => e.key === 'Enter' && handleAddSize()}
          />
          <button className={styles.formBtn} onClick={handleAddSize}>ДОБАВИТЬ</button>
          <button className={`${styles.formBtn} ${styles.formBtnGhost}`} onClick={() => { setShowAddForm(false); setNewLabel(''); setNewQty(0); }}>ОТМЕНА</button>
        </div>
      ) : (
        <button className={styles.addBtn} onClick={() => setShowAddForm(true)}>+ ДОБАВИТЬ РАЗМЕР</button>
      )}
    </div>
  );
}
