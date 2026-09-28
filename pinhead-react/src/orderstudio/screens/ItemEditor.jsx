import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { newSalesLabel, newSalesPrint } from '../model/factory';
import GridEditor from './GridEditor';
import PrintRow from './PrintRow';
import LabelRow from './LabelRow';
import { ISSUE_LABELS, rub } from './labels';
import styles from './Sales.module.css';

const toMoney = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const toMm = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Позиция заказа v4 — срез 1: пошив по модели каталога. Бланк, давальческое
 * и разработка есть в модели и в цене, их шаги визарда — срез 3.
 */
export default function ItemEditor({ item, index, price, onChange, onRemove, onWizard }) {
  const { skuCatalog, fabricsCatalog, zonesCatalog } = useStore(useShallow((s) => ({
    skuCatalog: s.skuCatalog,
    fabricsCatalog: s.fabricsCatalog,
    zonesCatalog: s.zonesCatalog,
  })));
  const [query, setQuery] = useState('');

  const skus = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? skuCatalog.filter((s) => `${s.code} ${s.name}`.toLowerCase().includes(q)) : skuCatalog;
  }, [skuCatalog, query]);
  const sku = skuCatalog.find((s) => s.code === item.sku_code);
  const fabricsBySupplier = useMemo(() => {
    const out = new Map();
    for (const f of fabricsCatalog) {
      const key = f.supplier || 'Без поставщика';
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(f);
    }
    return [...out.entries()];
  }, [fabricsCatalog]);
  const zones = useMemo(() => (zonesCatalog ?? []).map((z) => z.name).filter(Boolean), [zonesCatalog]);

  const pickSku = (code) => {
    const s = skuCatalog.find((x) => x.code === code);
    onChange({ sku_code: code, product_type: s?.name ?? '', fit: s?.fit ?? '' });
  };
  const pickFabric = (code) => {
    const f = fabricsCatalog.find((x) => x.code === code);
    onChange({
      fabric_code: code,
      main_fabric: f ? [f.name, f.composition, f.density ? `${f.density} г/м²` : ''].filter(Boolean).join(', ') : '',
      color_supplier: f ? f.supplier : item.color_supplier,
    });
  };

  const setPrint = (i, patch) => onChange({ prints: item.prints.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setLabel = (i, patch) => onChange({ labels: item.labels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  return (
    <section className={styles.panel} aria-label={`Позиция ${index + 1}`}>
      <div className={styles.panelTitle}>
        <span>Позиция {index + 1}{item.product_type ? ` · ${item.product_type}` : ''}</span>
        <span className={styles.row}>
          {onWizard && <button type="button" className="btn" onClick={onWizard}>Изменить в визарде</button>}
          <button type="button" className={styles.remove} onClick={onRemove}>Удалить позицию</button>
        </span>
      </div>

      <div className={styles.grid2}>
        <label className={styles.field}>Поиск модели
          <input className={styles.input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Код или название" />
        </label>
        <label className={styles.field}>Модель
          <select className={styles.select} value={item.sku_code} onChange={(e) => pickSku(e.target.value)}>
            <option value="">— выберите —</option>
            {sku && !skus.includes(sku) && <option value={sku.code}>{sku.code} · {sku.name}</option>}
            {skus.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
          </select>
        </label>
        <label className={styles.field}>Ткань
          <select className={styles.select} value={item.fabric_code} onChange={(e) => pickFabric(e.target.value)} disabled={item.client_fabric}>
            <option value="">По умолчанию для модели</option>
            {fabricsBySupplier.map(([supplier, list]) => (
              <optgroup key={supplier} label={supplier}>
                {list.map((f) => <option key={f.code} value={f.code}>{f.name}{f.density ? ` · ${f.density} г/м²` : ''}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={item.client_fabric} onChange={(e) => onChange({ client_fabric: e.target.checked })} />
          Ткань клиента (в цену не входит)
        </label>
        <label className={styles.field}>Полотно для ТЗ
          <input className={styles.input} value={item.main_fabric} onChange={(e) => onChange({ main_fabric: e.target.value })} placeholder="Кулирка, 100% хлопок, 180 г/м²" />
        </label>
        <label className={styles.field}>Цвет полотна / поставщик
          <input className={styles.input} value={item.color_supplier} onChange={(e) => onChange({ color_supplier: e.target.value })} placeholder="Чёрный / Медас" />
        </label>
      </div>

      <h3 className={styles.sectionTitle}>Сетка цвет × размер</h3>
      <GridEditor grid={item.size_grid} onChange={(size_grid) => onChange({ size_grid })} />

      <h3 className={styles.sectionTitle}>Нанесения</h3>
      {item.prints.map((p, i) => (
        <PrintRow
          key={p.key}
          print={p}
          index={i}
          itemSizes={item.size_grid.sizes}
          zones={zones}
          unitPrice={price?.prints.find((x) => x.key === p.key)?.unit ?? null}
          qty={price?.prints.find((x) => x.key === p.key)?.qty ?? 0}
          onChange={(patch) => setPrint(i, patch)}
          onRemove={() => onChange({ prints: item.prints.filter((_, j) => j !== i) })}
        />
      ))}
      <button type="button" className={styles.add} onClick={() => onChange({ prints: [...item.prints, newSalesPrint()] })}>+ Нанесение</button>

      <h3 className={styles.sectionTitle}>Бирки</h3>
      {item.labels.map((l, i) => (
        <LabelRow
          key={l.key}
          label={l}
          index={i}
          onChange={(patch) => setLabel(i, patch)}
          onRemove={() => onChange({ labels: item.labels.filter((_, j) => j !== i) })}
        />
      ))}
      <button type="button" className={styles.add} onClick={() => onChange({ labels: [...item.labels, newSalesLabel()] })}>+ Бирка</button>

      <details className={styles.details}>
        <summary>ТЗ пошива</summary>
        <div className={styles.grid2}>
          <label className={styles.field}>Отделка
            <input className={styles.input} value={item.trim_material} onChange={(e) => onChange({ trim_material: e.target.value })} placeholder="Рибана 1×1" />
          </label>
          <label className={styles.field}>Крой
            <input className={styles.input} value={item.fit} onChange={(e) => onChange({ fit: e.target.value })} />
          </label>
        </div>
        <label className={styles.field}>Заметки кроя
          <textarea className={styles.textarea} value={item.cutting_note} onChange={(e) => onChange({ cutting_note: e.target.value })} />
        </label>
        <label className={styles.field}>Заметки пошива
          <textarea className={styles.textarea} value={item.sewing_note} onChange={(e) => onChange({ sewing_note: e.target.value })} />
        </label>
        <label className={styles.field}>Бирки — общий комментарий
          <input className={styles.input} value={item.labels_note} onChange={(e) => onChange({ labels_note: e.target.value })} />
        </label>
      </details>

      <details className={styles.details}>
        <summary>Упаковка позиции</summary>
        <div className={styles.grid2}>
          <label className={styles.field}>Упаковка
            <select className={styles.select} value={item.packaging} onChange={(e) => onChange({ packaging: e.target.value })}>
              <option value="inherit">Как в заказе</option>
              <option value="individual">Индивидуальная</option>
              <option value="bulk">Навалом</option>
              <option value="none">Без упаковки</option>
            </select>
          </label>
          <label className={styles.field}>Ширина, мм
            <input className={styles.input} type="number" min="1" value={item.packaging_width_mm ?? ''} onChange={(e) => onChange({ packaging_width_mm: toMm(e.target.value) })} />
          </label>
          <label className={styles.field}>Высота, мм
            <input className={styles.input} type="number" min="1" value={item.packaging_height_mm ?? ''} onChange={(e) => onChange({ packaging_height_mm: toMm(e.target.value) })} />
          </label>
          <label className={styles.field}>Место стикера
            <input className={styles.input} value={item.sticker_place} onChange={(e) => onChange({ sticker_place: e.target.value })} />
          </label>
        </div>
        <label className={styles.field}>Требования к упаковке
          <input className={styles.input} value={item.packaging_note} onChange={(e) => onChange({ packaging_note: e.target.value })} />
        </label>
      </details>

      <h3 className={styles.sectionTitle}>Цена позиции</h3>
      <div className={styles.grid2}>
        <div className={styles.field}>Расчётная за штуку
          <span className={styles.num} data-testid={`calc-unit-${index}`}>{rub(price?.calc_unit)}</span>
        </div>
        <label className={styles.field}>Ручная цена за штуку
          <input
            className={styles.input}
            inputMode="decimal"
            value={item.manual_unit_price ?? ''}
            onChange={(e) => onChange({ manual_unit_price: toMoney(e.target.value) })}
            placeholder="пусто — расчётная"
          />
        </label>
      </div>
      {(price?.issues ?? []).map((iss) => <div key={iss} className={styles.issue}>{ISSUE_LABELS[iss]}</div>)}
    </section>
  );
}
