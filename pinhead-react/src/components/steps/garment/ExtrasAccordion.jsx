import { useState } from 'react';
import { EXTRAS_DESCS, EXTRAS_GROUPS } from '../../../data';
import { calcExtrasCost } from '../../../utils/pricing';
import { Icon } from '../../../erp/components/Icon';
import panel from './panel.module.css';
import styles from './ExtrasAccordion.module.css';

function PriceBadge({ price }) {
  if (price === 0) return <span className={`${styles.price} ${styles.free}`}>бесплатно</span>;
  return <span className={styles.price}>+{price} ₽</span>;
}

/** Строка обработки: флажок (`role="checkbox"`), клавиатура — Enter и пробел */
function ExtraItem({ extra, selected, readOnly, onToggle }) {
  return (
    <div
      className={`${styles.item}${selected ? ` ${styles.selected}` : ''}`}
      role="checkbox"
      tabIndex={0}
      aria-checked={selected}
      aria-label={extra.name}
      aria-disabled={readOnly || undefined}
      onClick={() => onToggle(extra.code)}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onToggle(extra.code); } }}
      title={EXTRAS_DESCS[extra.code] || extra.name}
    >
      <div className={styles.check}>{selected && <Icon name="check" size={14} />}</div>
      <div className={styles.name}>{extra.name}</div>
      <PriceBadge price={extra.price} />
    </div>
  );
}

/** `readOnly` — обработки видны, отметка закрыта (`aria-disabled`) */
export default function ExtrasAccordion({ sku, extras, extrasCatalog, toggleExtra, readOnly = false }) {
  const toggle = (code) => { if (!readOnly) toggleExtra(code); };
  const [showExtras, setShowExtras] = useState(false);
  const totalExtrasCost = calcExtrasCost(extras, extrasCatalog);
  let availableExtras = extrasCatalog.filter(e => !e.forCategories?.length || e.forCategories.includes(sku.category));
  // Per-SKU extras restriction
  if (sku.allowedExtras?.length) {
    availableExtras = availableExtras.filter(e => sku.allowedExtras.includes(e.code));
  }
  const item = (e) => (
    <ExtraItem key={e.code} extra={e} selected={extras.includes(e.code)} readOnly={readOnly} onToggle={toggle} />
  );

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={showExtras}
        onClick={() => setShowExtras(v => !v)}
      >
        <Icon name={showExtras ? 'chevronUp' : 'chevronDown'} size={16} />
        Доп. обработки
        {extras.length > 0 && <span className={panel.badge}>+{totalExtrasCost} ₽/шт ({extras.length})</span>}
      </button>
      {showExtras && availableExtras.length > 0 && (
        <div className={styles.list}>
          {EXTRAS_GROUPS
            .map(g => ({ ...g, items: availableExtras.filter(e => e.group === g.id) }))
            .filter(g => g.items.length > 0)
            .map(group => (
              <div key={group.id}>
                <div className={styles.groupLabel}>{group.name}</div>
                {group.items.map(item)}
              </div>
            ))}
          {availableExtras.filter(e => !e.group).map(item)}
        </div>
      )}
      {showExtras && availableExtras.length === 0 && (
        <div className={styles.empty}>Для «{sku.name}» нет доступных обработок</div>
      )}
    </div>
  );
}
