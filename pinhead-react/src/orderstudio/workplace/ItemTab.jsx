import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { zonesForSku } from '../../utils/skuRules';
import { pluralize } from '../../utils/i18n';
import { useSalesStore } from '../store/useSalesStore';
import { newSalesLabel, newSalesPrint } from '../model/factory';
import PrintRow from '../screens/PrintRow';
import LabelRow from '../screens/LabelRow';
import BufferedInput from '../screens/BufferedInput';
import { formatMoney, parseMoney } from '../screens/fieldParse';
import { ISSUE_LABELS, usePackagingOptions, rub } from '../screens/labels';
import { bindBuffer, canLoadIntoBuffer, loadItemIntoBuffer } from './itemBuffer';
import GarmentPanel from './GarmentPanel';
import sales from '../screens/Sales.module.css';
import styles from './Workplace.module.css';

const toMm = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Позиция `key` из открытого заказа — свежая на каждую правку */
const itemByKey = (key) => useSalesStore.getState().current?.items.find((it) => it.key === key);

/**
 * Связь панелей визарда с позицией: при смене позиции — загрузка в буфер,
 * затем подписка; отписка — в cleanup (правка после ухода до позиции не дойдёт).
 * Загрузка идёт ДО подписки и ничего не пишет; для многоцветной позиции
 * загрузка только чистит буфер (поля позиции туда не попадают, экран
 * показывает плашку «Разнести по цветам»).
 */
function useItemBuffer(key, bufferable, readOnly) {
  const cat = useStore(useShallow((s) => ({
    skuCatalog: s.skuCatalog,
    fabricsCatalog: s.fabricsCatalog,
    zonesCatalog: s.zonesCatalog,
    suppliers: s.suppliers,
  })));
  useEffect(() => {
    const base = itemByKey(key);
    if (!base) return undefined;
    loadItemIntoBuffer(base, cat);
    if (!bufferable || readOnly) return undefined;
    return bindBuffer(() => itemByKey(key), cat, (next) => {
      useSalesStore.getState().edit((o) => ({
        ...o,
        items: o.items.map((it) => (it.key === next.key ? next : it)),
      }));
    });
  }, [key, bufferable, readOnly, cat]);
}

/**
 * Вкладка «Изделие» рабочего места: панели визарда для одежды позиции,
 * нанесения и бирки строками v4, доп. поля ТЗ, упаковка и цена позиции.
 * Все правки — по `item.key` (`onChange(patch)` родителя).
 */
export default function ItemTab({ item, price, readOnly, onChange, onSplit }) {
  const bufferable = canLoadIntoBuffer(item);
  const packOptions = usePackagingOptions();
  useItemBuffer(item.key, bufferable, readOnly);

  const { skuCatalog, zonesCatalog, extrasCatalog } = useStore(useShallow((s) => ({
    skuCatalog: s.skuCatalog,
    zonesCatalog: s.zonesCatalog,
    extrasCatalog: s.extrasCatalog,
  })));
  const sku = skuCatalog.find((s) => s.code === item.sku_code);
  // Зоны модели (категория, капюшон, карман); без модели — все
  const zones = useMemo(() => {
    const list = sku ? zonesForSku(zonesCatalog ?? [], sku, item.extras, extrasCatalog) : (zonesCatalog ?? []);
    return list.map((z) => z.name).filter(Boolean);
  }, [zonesCatalog, sku, item.extras, extrasCatalog]);

  const setClientFabric = (checked) => {
    onChange({ client_fabric: checked });
    // Буфер знает признак: garmentPatch не перепишет ткань позиции клиента
    useStore.setState({ clientFabric: checked });
  };
  const setPrint = (i, patch) => onChange({ prints: item.prints.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setLabel = (i, patch) => onChange({ labels: item.labels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const colors = item.size_grid.rows.length;

  return (
    <div className={styles.itemTab}>
      {bufferable ? (
        <GarmentPanel clientFabric={item.client_fabric} onClientFabric={setClientFabric} readOnly={readOnly} />
      ) : (
        <div className={styles.splitNotice} role="note">
          <p className={styles.splitText}>
            В позиции {colors} {pluralize(colors, 'цвет', 'цвета', 'цветов')} — разнесите по цветам, чтобы править изделие
          </p>
          {!readOnly && (
            <button type="button" className="btn btn-primary" onClick={() => onSplit(item.key)}>
              Разнести по цветам
            </button>
          )}
        </div>
      )}

      {/* Строки v4 сами про «только чтение» не знают — их закрывает fieldset */}
      <fieldset className={styles.fieldset} disabled={readOnly}>
        <h3 className={sales.sectionTitle}>Нанесения</h3>
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
        {!readOnly && (
          <button type="button" className={sales.add} onClick={() => onChange({ prints: [...item.prints, newSalesPrint({ on: item.kind === 'sku' ? 'cut' : 'finished' })] })}>
            + Нанесение
          </button>
        )}

        <h3 className={sales.sectionTitle}>Бирки</h3>
        {item.labels.map((l, i) => (
          <LabelRow
            key={l.key}
            label={l}
            index={i}
            onChange={(patch) => setLabel(i, patch)}
            onRemove={() => onChange({ labels: item.labels.filter((_, j) => j !== i) })}
          />
        ))}
        {!readOnly && (
          <button type="button" className={sales.add} onClick={() => onChange({ labels: [...item.labels, newSalesLabel()] })}>
            + Бирка
          </button>
        )}

        <details className={sales.details}>
          <summary>Доп. поля ТЗ</summary>
          <div className={sales.grid2}>
            <label className={sales.field}>Полотно для ТЗ
              <input className={sales.input} value={item.main_fabric} onChange={(e) => onChange({ main_fabric: e.target.value })} placeholder="Кулирка, 100% хлопок, 180 г/м²" />
            </label>
            <label className={sales.field}>Цвет полотна / поставщик
              <input className={sales.input} value={item.color_supplier} onChange={(e) => onChange({ color_supplier: e.target.value })} placeholder="Чёрный / Медас" />
            </label>
            <label className={sales.field}>Отделка
              <input className={sales.input} value={item.trim_material} onChange={(e) => onChange({ trim_material: e.target.value })} placeholder="Рибана 1×1" />
            </label>
            <label className={sales.field}>Крой
              <input className={sales.input} value={item.fit} onChange={(e) => onChange({ fit: e.target.value })} />
            </label>
          </div>
          <label className={sales.field}>Заметки кроя
            <textarea className={sales.textarea} value={item.cutting_note} onChange={(e) => onChange({ cutting_note: e.target.value })} />
          </label>
          <label className={sales.field}>Заметки пошива
            <textarea className={sales.textarea} value={item.sewing_note} onChange={(e) => onChange({ sewing_note: e.target.value })} />
          </label>
          <label className={sales.field}>Бирки — общий комментарий
            <input className={sales.input} value={item.labels_note} onChange={(e) => onChange({ labels_note: e.target.value })} />
          </label>
        </details>

        <details className={sales.details}>
          <summary>Упаковка позиции</summary>
          <div className={sales.grid2}>
            <label className={sales.field}>Упаковка
              <select className={sales.select} value={item.packaging} onChange={(e) => onChange({ packaging: e.target.value })}>
                <option value="inherit">Как в заказе</option>
                {packOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
            <label className={sales.field}>Ширина, мм
              <input className={sales.input} type="number" min="1" value={item.packaging_width_mm ?? ''} onChange={(e) => onChange({ packaging_width_mm: toMm(e.target.value) })} />
            </label>
            <label className={sales.field}>Высота, мм
              <input className={sales.input} type="number" min="1" value={item.packaging_height_mm ?? ''} onChange={(e) => onChange({ packaging_height_mm: toMm(e.target.value) })} />
            </label>
            <label className={sales.field}>Место стикера
              <input className={sales.input} value={item.sticker_place} onChange={(e) => onChange({ sticker_place: e.target.value })} />
            </label>
          </div>
          <label className={sales.field}>Требования к упаковке
            <input className={sales.input} value={item.packaging_note} onChange={(e) => onChange({ packaging_note: e.target.value })} />
          </label>
        </details>

        <h3 className={sales.sectionTitle}>Цена позиции</h3>
        <div className={sales.grid2}>
          <div className={sales.field}>Расчётная за штуку
            <span className={sales.num} data-testid="calc-unit">{rub(price?.calc_unit)}</span>
          </div>
          <label className={sales.field}>Ручная цена за штуку
            <BufferedInput
              className={sales.input}
              inputMode="decimal"
              value={item.manual_unit_price}
              format={formatMoney}
              parse={parseMoney}
              onCommit={(v) => onChange({ manual_unit_price: v })}
              placeholder="пусто — расчётная"
            />
          </label>
        </div>
        {(price?.issues ?? []).map((iss) => <div key={iss} className={sales.issue}>{ISSUE_LABELS[iss]}</div>)}
      </fieldset>
    </div>
  );
}
