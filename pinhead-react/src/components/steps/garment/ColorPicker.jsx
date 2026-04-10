import { useState } from 'react';
import { useStore } from '../../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { MEDASTEX_COLORS, COLOR_GROUPS, COTTONPROM_COLORS, COTTONPROM_GROUPS } from '../../../data';
import { isAccessory } from '../../../utils/pricing';

export default function ColorPicker() {
  const { type, color, selectColor, colorSupplier, setColorSupplier } = useStore(
    useShallow(s => ({ type: s.type, color: s.color, selectColor: s.selectColor,
      colorSupplier: s.colorSupplier, setColorSupplier: s.setColorSupplier }))
  );
  const [colorSearch, setColorSearch] = useState('');
  if (isAccessory(type)) return null;

  const colors = colorSupplier === 'medastex' ? MEDASTEX_COLORS : COTTONPROM_COLORS;
  const groups = colorSupplier === 'medastex' ? COLOR_GROUPS : COTTONPROM_GROUPS;

  const searchLower = colorSearch.toLowerCase();

  return (
    <div className="color-section">
      <div className="section-label">Цвет базы</div>
      <div className="supplier-tabs">
        <button className={`supplier-tab${colorSupplier === 'medastex' ? ' active' : ''}`} onClick={() => setColorSupplier('medastex')}>
          Medastex <span className="supplier-tab-count">{MEDASTEX_COLORS.length}</span>
        </button>
        <button className={`supplier-tab${colorSupplier === 'cottonprom' ? ' active' : ''}`} onClick={() => setColorSupplier('cottonprom')}>
          CottonProm <span className="supplier-tab-count">{COTTONPROM_COLORS.length}</span>
        </button>
      </div>
      <div className="color-search-wrap">
        <input
          type="text"
          className="color-search-input"
          placeholder="Поиск цвета..."
          value={colorSearch}
          onChange={e => setColorSearch(e.target.value)}
        />
        {color && <div className="color-selected-info">Выбран: {colors.find(c => c.code === color)?.name || color}</div>}
      </div>
      <div className="swatches">
        {groups.map(g => {
          const groupColors = g.codes.map(code => colors.find(c => c.code === code)).filter(Boolean);
          if (!groupColors.length) return null;
          return [
            !searchLower && <div key={'gl-' + g.label} className="swatch-group-label">{g.label}</div>,
            ...groupColors.map(entry => {
              const hidden = searchLower && !entry.name.toLowerCase().includes(searchLower) && !entry.code.toLowerCase().includes(searchLower);
              return (
                <div
                  key={entry.code}
                  className={`swatch${color === entry.code ? ' selected' : ''}${hidden ? ' hidden' : ''}`}
                  title={`${entry.name} (${entry.code})`}
                  role="button"
                  tabIndex={hidden ? -1 : 0}
                  aria-pressed={color === entry.code}
                  aria-label={`${entry.name} (${entry.code})`}
                  onClick={() => selectColor(entry.code)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectColor(entry.code); } }}
                >
                  <div className="swatch-circle" style={{ backgroundColor: entry.hex }} />
                  <div className="swatch-code">{entry.code}</div>
                  <div className="swatch-label">{entry.name}</div>
                </div>
              );
            })
          ];
        })}
      </div>
    </div>
  );
}
