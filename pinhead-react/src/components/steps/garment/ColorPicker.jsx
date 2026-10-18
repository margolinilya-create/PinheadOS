import { useState } from 'react';
import { useStore } from '../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { isAccessory } from '../../../utils/pricing';
import { useEffectiveRules } from '../../../hooks/useEffectiveRules';
import { sanitizeHex } from '../../../utils/sanitizeHex';
import {
  codeOwner, defaultSupplier, findPaletteColor, offeredColors, supplierForFabric,
} from '../../../orderstudio/catalog/suppliers';
import { allowedFor } from '../../../orderstudio/catalog/allowedColors';
import { Icon } from '../../../erp/components/Icon';
import panel from './panel.module.css';
import styles from './ColorPicker.module.css';

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

/** Цвет образца — вычисляемым `--swatch-color`; hex только через sanitizeHex */
const swatchColor = (hex) => ({ '--swatch-color': sanitizeHex(hex) });

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
    <div className={styles.own}>
      <label className={styles.ownLabel} htmlFor="color-own-input">Свой цвет</label>
      <input
        id="color-own-input"
        type="text"
        className={panel.search}
        value={text}
        disabled={readOnly}
        placeholder="Как в накладной"
        aria-describedby={hint ? 'color-own-hint' : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      />
      {hint && <p id="color-own-hint" className={panel.hint}>{hint}</p>}
    </div>
  );
}

/** Выбранный цвет, которого нет среди предлагаемых: снятый, из другой палитры */
function CurrentColor({ entry, note }) {
  return (
    <p className={`${styles.selectedInfo} ${styles.current}`} data-testid="color-current">
      <span className={styles.mini} style={swatchColor(entry.hex)} aria-hidden="true" />
      Выбран: {entry.name} ({entry.code}) — {note}
    </p>
  );
}

/** Образец палитры: кнопка с `aria-pressed`, галочка выбранного — одна, в кружке */
function Swatch({ color, selected, readOnly, onPick }) {
  return (
    <button
      type="button"
      className={`${styles.swatch}${selected ? ` ${styles.selected}` : ''}`}
      title={`${color.name} (${color.code})`}
      aria-pressed={selected}
      aria-label={`${color.name} (${color.code})`}
      aria-disabled={readOnly || undefined}
      onClick={() => onPick(color.code)}
    >
      <span className={styles.circle} style={swatchColor(color.hex)} data-swatch-circle="" aria-hidden="true">
        {selected && <span className={styles.check}><Icon name="check" size={12} /></span>}
      </span>
      <span className={styles.code}>{color.code}</span>
      <span className={styles.label}>{color.name}</span>
    </button>
  );
}

/** Пометка у выбранного цвета, которого среди предлагаемых нет */
function offNote(entry, suppliers, supplier) {
  const owner = codeOwner(suppliers, entry.code);
  if (!entry.active) return 'снят с продажи';
  if (owner && owner.id !== supplier?.id) return `из палитры «${owner.name}»`;
  return 'не входит в цвета этой модели';
}

/**
 * Цвет базы — палитра поставщика ткани из справочника «Поставщики и палитры»
 * (веха 4): привязка по имени поставщика ткани, иначе палитра по умолчанию.
 * Предлагаются только активные цвета; выбранный снятый или чужой показан
 * с пометкой и не стирается. Своего цвета нет в палитре — «Свой цвет» текстом.
 * Ограничение цветов модели (`allowedColors`) пересекается с палитрой ткани:
 * пустое пересечение — палитра целиком (К10 вехи 8).
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
  const allowed = allowedFor(rules, allColors);
  const colors = allowed ?? allColors;

  const q = colorSearch.trim().toLowerCase();
  const shown = q
    ? colors.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
    : colors;

  const entry = color ? findPaletteColor(color, suppliers, supplier) : null;
  const offered = !!entry && colors.some((c) => c.code === entry.code);
  const ownText = color && !entry ? color : '';
  const pick = (code) => { if (!readOnly) selectColor(code); };

  return (
    <section className={panel.section} aria-labelledby="garment-color-title">
      <div className={panel.sectionLabel} id="garment-color-title">Цвет базы{supplier ? ` · ${supplier.name}` : ''}</div>
      {allColors.length > 0 && (
        <div className={styles.searchRow}>
          <input
            type="text"
            className={panel.search}
            placeholder="Поиск цвета..."
            aria-label="Поиск цвета"
            value={colorSearch}
            onChange={(e) => setColorSearch(e.target.value)}
          />
          {offered && <p className={styles.selectedInfo}>Выбран: {entry.name}</p>}
          {allowed && (
            <p className={panel.hint}>
              Для этой модели доступно {colors.length} из {allColors.length} цветов «{supplier.name}»
            </p>
          )}
        </div>
      )}
      {entry && !offered && <CurrentColor entry={entry} note={offNote(entry, suppliers, supplier)} />}
      {colors.length > 0 && (
        <div className={styles.swatches} role="group" aria-label={`Палитра ${supplier?.name ?? ''}`}>
          {grouped(supplier, shown).map((g) => [
            !q && <div key={`gl-${g.id || 'none'}`} className={styles.groupLabel}>{g.label}</div>,
            ...g.colors.map((c) => (
              <Swatch key={c.code} color={c} selected={color === c.code} readOnly={readOnly} onPick={pick} />
            )),
          ])}
          {q && shown.length === 0 && (
            <p className={`${panel.hint} ${styles.empty}`}>Такого цвета в палитре нет — впишите свой ниже</p>
          )}
        </div>
      )}
      <OwnColorField
        initial={ownText}
        readOnly={readOnly}
        onCommit={selectColor}
        hint={allColors.length === 0 ? OWN_COLOR_HINT : ''}
      />
    </section>
  );
}
