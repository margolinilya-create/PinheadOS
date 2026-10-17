import { useState } from 'react';
import { useStore } from '../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { isAccessory } from '../../../utils/pricing';
import { useEffectiveRules } from '../../../hooks/useEffectiveRules';
import { sanitizeHex } from '../../../utils/sanitizeHex';
import {
  codeOwner, defaultSupplier, findPaletteColor, offeredColors, supplierForFabric,
} from '../../../orderstudio/catalog/suppliers';

/** Подсказка у поля «Свой цвет», когда палитры у поставщика ткани нет */
export const OWN_COLOR_HINT = 'У поставщика нет палитры — впишите цвет, как в накладной';

/** Палитра: поставщик ткани из каталога, иначе выбранная (`colorSupplier`), иначе по умолчанию */
function paletteSupplier(fabric, fabricsCatalog, suppliers, colorSupplier) {
  const entry = (fabricsCatalog || []).find((f) => f.code === fabric);
  return (entry && supplierForFabric(entry, suppliers))
    || suppliers.find((s) => s.id === colorSupplier)
    || defaultSupplier(suppliers);
}

/** Цвета палитры по группам; цвета без группы — в конце */
function grouped(supplier, colors) {
  const groups = supplier?.palette.groups ?? [];
  const known = new Set(groups.map((g) => g.id));
  const out = groups
    .map((g) => ({ id: g.id, label: g.label, colors: colors.filter((c) => c.group === g.id) }))
    .filter((g) => g.colors.length > 0);
  const rest = colors.filter((c) => !known.has(c.group));
  if (rest.length) out.push({ id: '', label: 'Без группы', colors: rest });
  return out;
}

/** Свой цвет текстом: в буфер — по Enter или уходу с поля, без записи на каждую букву */
function OwnColorField({ initial, readOnly, onCommit, hint }) {
  const [text, setText] = useState(initial);
  // Цвет сменился снаружи (выбор образца, другая позиция) — поле за ним;
  // без перемонтирования, чтобы фокус оставался в поле после Enter
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setText(initial);
  }
  const commit = () => {
    const v = text.trim();
    if (v && v !== initial) onCommit(v);
  };
  return (
    <div className="color-own">
      <label className="color-own-label" htmlFor="color-own-input">Свой цвет</label>
      <input
        id="color-own-input"
        type="text"
        className="color-search-input"
        value={text}
        disabled={readOnly}
        placeholder="Как в накладной"
        aria-describedby={hint ? 'color-own-hint' : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      />
      {hint && <p id="color-own-hint" className="color-filter-hint">{hint}</p>}
    </div>
  );
}

/** Выбранный цвет, которого нет среди предлагаемых: снятый, из другой палитры */
function CurrentColor({ entry, note }) {
  return (
    <p className="color-selected-info" data-testid="color-current">
      <span className="swatch-mini" style={{ backgroundColor: sanitizeHex(entry.hex) }} aria-hidden="true" />
      {' '}Выбран: {entry.name} ({entry.code}) — {note}
    </p>
  );
}

/**
 * Цвет базы — палитра поставщика ткани из справочника «Поставщики и палитры»
 * (веха 4): привязка по имени поставщика ткани, иначе палитра по умолчанию.
 * Предлагаются только активные цвета; выбранный снятый или чужой показан
 * с пометкой и не стирается. Своего цвета нет в палитре — «Свой цвет» текстом.
 *
 * `readOnly` — образцы видны, но цвет не меняется (`aria-disabled`).
 */
export default function ColorPicker({ readOnly = false }) {
  const { type, color, selectColor, colorSupplier, fabric, fabricsCatalog, suppliers } = useStore(
    useShallow((s) => ({
      type: s.type, color: s.color, selectColor: s.selectColor, colorSupplier: s.colorSupplier,
      fabric: s.fabric, fabricsCatalog: s.fabricsCatalog, suppliers: s.suppliers,
    })),
  );
  const [colorSearch, setColorSearch] = useState('');
  const rules = useEffectiveRules();
  if (isAccessory(type)) return null;

  const supplier = paletteSupplier(fabric, fabricsCatalog, suppliers, colorSupplier);
  const allColors = offeredColors(supplier);
  const allowedSet = rules?.allowedColors ? new Set(rules.allowedColors) : null;
  const colors = allowedSet ? allColors.filter((c) => allowedSet.has(c.code)) : allColors;

  const q = colorSearch.trim().toLowerCase();
  const shown = q
    ? colors.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
    : colors;

  const entry = color ? findPaletteColor(color, suppliers, supplier) : null;
  const offered = !!entry && colors.some((c) => c.code === entry.code);
  const ownText = color && !entry ? color : '';
  let note = '';
  if (entry && !offered) {
    const owner = codeOwner(suppliers, entry.code);
    if (!entry.active) note = 'снят с продажи';
    else if (owner && owner.id !== supplier?.id) note = `из палитры «${owner.name}»`;
    else note = 'не входит в цвета этой модели';
  }
  const pick = (code) => { if (!readOnly) selectColor(code); };

  return (
    <div className="color-section">
      <div className="section-label">Цвет базы{supplier ? ` · ${supplier.name}` : ''}</div>
      {allColors.length > 0 && (
        <div className="color-search-wrap">
          <input
            type="text"
            className="color-search-input"
            placeholder="Поиск цвета..."
            aria-label="Поиск цвета"
            value={colorSearch}
            onChange={(e) => setColorSearch(e.target.value)}
          />
          {offered && <div className="color-selected-info">Выбран: {entry.name}</div>}
          {allowedSet && <div className="color-filter-hint">Показаны {colors.length} из {allColors.length} цветов для этой категории</div>}
        </div>
      )}
      {entry && !offered && <CurrentColor entry={entry} note={note} />}
      {colors.length > 0 && (
        <div className="swatches" role="group" aria-label={`Палитра ${supplier?.name ?? ''}`}>
          {grouped(supplier, shown).map((g) => [
            !q && <div key={`gl-${g.id || 'none'}`} className="swatch-group-label">{g.label}</div>,
            ...g.colors.map((c) => {
              const selected = color === c.code;
              return (
                <button
                  key={c.code}
                  type="button"
                  className={`swatch${selected ? ' selected' : ''}`}
                  title={`${c.name} (${c.code})`}
                  aria-pressed={selected}
                  aria-label={`${c.name} (${c.code})`}
                  aria-disabled={readOnly || undefined}
                  onClick={() => pick(c.code)}
                >
                  <span className="swatch-circle" style={{ backgroundColor: sanitizeHex(c.hex) }} aria-hidden="true">
                    {selected && (
                      <svg className="swatch-check" width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8l4 4 6-6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="swatch-code">{c.code}</span>
                  <span className="swatch-label">{c.name}</span>
                </button>
              );
            }),
          ])}
          {q && shown.length === 0 && <p className="color-filter-hint">Такого цвета в палитре нет — впишите свой ниже</p>}
        </div>
      )}
      <OwnColorField
        initial={ownText}
        readOnly={readOnly}
        onCommit={selectColor}
        hint={allColors.length === 0 ? OWN_COLOR_HINT : ''}
      />
    </div>
  );
}
