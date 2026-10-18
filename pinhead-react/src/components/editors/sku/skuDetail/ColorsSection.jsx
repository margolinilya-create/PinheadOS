import { useState } from 'react';
import { useStore } from '../../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { sanitizeHex } from '../../../../utils/sanitizeHex';
import { Icon } from '../../../../erp/components/Icon';
import { modelPalettes, paletteCodes } from './modelPalette';
import t from '../skuTable.module.css';
import m from '../SkuModal.module.css';

/** Цвет образца — вычисляемым `--swatch-color`; hex только через sanitizeHex */
const swatchColor = (hex) => ({ '--swatch-color': sanitizeHex(hex) });

/**
 * Ограничение цветов модели (`overrides.allowedColors`). Палитра — объединение
 * палитр поставщиков тканей модели (К10 вехи 8; было — только Медастекс, и
 * у ткани другого поставщика ограничение давало пустую палитру). Значение —
 * прежний список кодов; коды вне палитр модели (старые) не теряются.
 */
export default function ColorsSection({ sku, onChange, onClear }) {
  const { fabricsCatalog, suppliers } = useStore(
    useShallow((s) => ({ fabricsCatalog: s.fabricsCatalog, suppliers: s.suppliers })),
  );
  const [open, setOpen] = useState(false);
  const blocks = modelPalettes(sku, fabricsCatalog || [], suppliers || []);
  const all = paletteCodes(blocks);
  const allowed = sku.overrides?.allowedColors;
  const hasOverride = Array.isArray(allowed);
  const selected = new Set(hasOverride ? allowed : all);
  const shownCount = all.filter((c) => selected.has(c)).length;

  const toggle = (code) => {
    if (!hasOverride) { onChange(all.filter((c) => c !== code)); return; }
    onChange(selected.has(code) ? allowed.filter((c) => c !== code) : [...allowed, code]);
  };

  const names = blocks.map((b) => b.supplier.name).join(', ');

  return (
    <div className={m.swatchGroup}>
      <div className={m.row}>
        <span className={m.rowLabel}>Цвета</span>
        <button type="button" className={t.chip} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {hasOverride ? `${shownCount} из ${all.length}` : `все цвета (${all.length})`}{' '}
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
        </button>
        {hasOverride && (
          <button type="button" className={t.chip} onClick={() => { onClear(); setOpen(false); }}>Сбросить</button>
        )}
      </div>
      {open && (
        <>
          <p className={m.hint}>Палитры поставщиков тканей модели: {names || 'нет палитр'}.</p>
          {blocks.map((b) => (
            <div key={b.supplier.id} className={m.swatchGroup} role="group" aria-label={`Палитра «${b.supplier.name}»`}>
              <span className={m.swatchLabel}>{b.supplier.name}</span>
              <div className={m.swatches}>
                {b.colors.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    className={m.swatch}
                    style={swatchColor(c.hex)}
                    aria-pressed={selected.has(c.code)}
                    aria-label={`${c.name} (${c.code})`}
                    title={`${c.name} (${c.code})`}
                    onClick={() => toggle(c.code)}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
