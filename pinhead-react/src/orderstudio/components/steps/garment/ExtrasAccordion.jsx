import { useState } from 'react';
import { EXTRAS_DESCS, EXTRAS_GROUPS } from '../../../../data';
import { calcExtrasCost } from '../../../utils/pricing';

function PriceBadge({ price }) {
  if (price === 0) return <span className="extra-price extra-price-free">бесплатно</span>;
  return <span className="extra-price">+{price} ₽</span>;
}

export default function ExtrasAccordion({ sku, extras, extrasCatalog, toggleExtra }) {
  const [showExtras, setShowExtras] = useState(false);
  const totalExtrasCost = calcExtrasCost(extras, extrasCatalog);
  let availableExtras = extrasCatalog.filter(e => !e.forCategories?.length || e.forCategories.includes(sku.category));
  // Per-SKU extras restriction
  if (sku.allowedExtras?.length) {
    availableExtras = availableExtras.filter(e => sku.allowedExtras.includes(e.code));
  }

  return (
    <div className="extras-accordion">
      <button
        className="extras-accordion-toggle"
        onClick={() => setShowExtras(v => !v)}
      >
        {showExtras ? '\u25B2' : '\u25BC'} Доп. обработки
        {extras.length > 0 && <span className="section-badge">+{totalExtrasCost} ₽/шт ({extras.length})</span>}
      </button>
      {showExtras && availableExtras.length > 0 && (
        <div className="extras-list extras-list-spaced">
          {EXTRAS_GROUPS
            .map(g => ({ ...g, items: availableExtras.filter(e => e.group === g.id) }))
            .filter(g => g.items.length > 0)
            .map(group => (
              <div key={group.id} className="extras-group">
                <div className="extras-group-label">{group.name}</div>
                {group.items.map(e => {
                  const sel = extras.includes(e.code);
                  const desc = EXTRAS_DESCS[e.code];
                  return (
                    <div
                      key={e.code}
                      className={`extras-list-item${sel ? ' selected' : ''}`}
                      role="checkbox"
                      tabIndex={0}
                      aria-checked={sel}
                      aria-label={e.name}
                      onClick={() => toggleExtra(e.code)}
                      onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleExtra(e.code); } }}
                      title={desc || e.name}
                    >
                      <div className="extra-check">{sel && <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}</div>
                      <div className="extras-list-name">{e.name}</div>
                      <PriceBadge price={e.price} />
                    </div>
                  );
                })}
              </div>
            ))}
          {availableExtras.filter(e => !e.group).map(e => {
            const sel = extras.includes(e.code);
            return (
              <div
                key={e.code}
                className={`extras-list-item${sel ? ' selected' : ''}`}
                role="checkbox"
                tabIndex={0}
                aria-checked={sel}
                aria-label={e.name}
                onClick={() => toggleExtra(e.code)}
                onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleExtra(e.code); } }}
                title={EXTRAS_DESCS[e.code] || e.name}
              >
                <div className="extra-check">{sel && <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}</div>
                <div className="extras-list-name">{e.name}</div>
                <PriceBadge price={e.price} />
              </div>
            );
          })}
        </div>
      )}
      {showExtras && availableExtras.length === 0 && (
        <div className="empty-state">Для «{sku.name}» нет доступных обработок</div>
      )}
    </div>
  );
}
