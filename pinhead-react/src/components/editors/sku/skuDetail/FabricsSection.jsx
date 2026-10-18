import { useState } from 'react';
import { toast } from '../../../../store/useToastStore';
import { Icon } from '../../../../erp/components/Icon';
import t from '../skuTable.module.css';
import m from '../SkuModal.module.css';

/** Список «допустимых» значений модели (ткани, обработки): чипы с `aria-pressed` */
function AllowedList({ label, items, allowed, onUpdate, onClear }) {
  const [open, setOpen] = useState(false);
  const hasOverride = Array.isArray(allowed);
  if (!items.length) return null;

  const toggle = (code) => {
    if (!hasOverride) { onUpdate(items.map((i) => i.code).filter((c) => c !== code)); return; }
    const removing = allowed.includes(code);
    if (removing && allowed.length <= 1) {
      toast.warning('Нельзя убрать последний элемент — сбросьте ограничение');
      return;
    }
    onUpdate(removing ? allowed.filter((c) => c !== code) : [...allowed, code]);
  };

  return (
    <div className={m.swatchGroup}>
      <div className={m.row}>
        <span className={m.rowLabel}>{label}</span>
        <button type="button" className={t.chip} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {hasOverride ? `${allowed.length} из ${items.length}` : `все (${items.length})`}{' '}
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
        </button>
        {hasOverride && (
          <button type="button" className={t.chip} onClick={() => { onClear(); setOpen(false); }}>Сбросить</button>
        )}
      </div>
      {open && (
        <div className={m.chips} role="group" aria-label={label}>
          {items.map((item) => (
            <button key={item.code} type="button" className={t.chip}
              aria-pressed={!hasOverride || allowed.includes(item.code)} onClick={() => toggle(item.code)}>
              {item.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Допустимые ткани и обработки модели (поверх правил категории) */
export default function FabricsSection({ sku, skuIndex, onUpdate, fabricsCatalog, extrasCatalog }) {
  const fabrics = (fabricsCatalog || []).filter((f) => (f.forCategories || []).includes(sku.category));
  const extras = (extrasCatalog || []).filter((e) => !e.forCategories?.length || e.forCategories.includes(sku.category));
  return (
    <>
      <AllowedList label="Допустимые ткани" items={fabrics} allowed={sku.allowedFabrics}
        onUpdate={(codes) => onUpdate(skuIndex, 'allowedFabrics', codes)}
        onClear={() => onUpdate(skuIndex, 'allowedFabrics', undefined)} />
      <AllowedList label="Допустимые обработки" items={extras} allowed={sku.allowedExtras}
        onUpdate={(codes) => onUpdate(skuIndex, 'allowedExtras', codes)}
        onClear={() => onUpdate(skuIndex, 'allowedExtras', undefined)} />
    </>
  );
}
