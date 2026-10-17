import { useStore } from '../../store/useStore';
import {
  findLabelKind, parseLabelVariant, joinLabelVariant, shownVariantId, shownMaterialKey,
  variantTakesMaterial, labelKindOptions, labelVariantOptions, labelMaterialOptions, attachSchemeOptions,
} from '../catalog/labels';
import { salesLabelPrice } from '../pricing/priceOrder';
import { rub } from './labels';
import styles from './Sales.module.css';

/**
 * Бирка позиции v4 по библиотеке бирок (`app_config.labelLibrary`, веха 4):
 * вид, вариант и материал — из библиотеки, флажок «Бланк», схема притачивания.
 * Основная бирка хранит `вариант:материал` в `variant_id`, схема — id схемы
 * в `attach_scheme`. Снятое с продажи, уже стоящее в бирке, показывается
 * как есть с пометкой и не стирается; строка сама ничего не пишет при показе.
 * Превью бирок — веха 5.
 */
export default function LabelRow({ label, index, onChange, onRemove }) {
  const lib = useStore((s) => s.labelLibrary);
  const kind = findLabelKind(lib, label.label_type);
  const { variant, material } = parseLabelVariant(label.variant_id);
  const shownVariant = shownVariantId(kind, variant);
  const hasVariants = (kind?.variants.length ?? 0) > 0;
  const takesMaterial = variantTakesMaterial(kind, shownVariant);
  const shownMaterial = shownMaterialKey(kind, material);
  const price = salesLabelPrice(label, lib);

  const setVariant = (v, m) => {
    onChange({ variant_id: joinLabelVariant(v, variantTakesMaterial(kind, v) ? m : '') });
  };

  return (
    <div className={styles.subCard}>
      <div className={styles.subHead}>
        <span>Бирка {index + 1}{hasVariants ? ` · ${rub(price)}/шт` : ''}</span>
        <button type="button" className={styles.remove} onClick={onRemove}>Удалить</button>
      </div>
      <div className={styles.grid2}>
        <label className={styles.field}>Тип
          <select className={styles.select} value={label.label_type} onChange={(e) => onChange({ label_type: e.target.value, variant_id: '' })}>
            <option value="">—</option>
            {labelKindOptions(lib, label.label_type).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {hasVariants && (
          <label className={styles.field}>Вариант
            <select className={styles.select} value={shownVariant} onChange={(e) => setVariant(e.target.value, material)}>
              {labelVariantOptions(kind, shownVariant).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
        {takesMaterial && (
          <label className={styles.field}>Материал
            <select className={styles.select} value={shownMaterial} onChange={(e) => setVariant(shownVariant, e.target.value)}>
              {!shownMaterial && <option value="">Не выбран</option>}
              {labelMaterialOptions(kind, shownMaterial).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
        <label className={styles.field}>Схема притачивания
          <select className={styles.select} value={label.attach_scheme} onChange={(e) => onChange({ attach_scheme: e.target.value })}>
            <option value="">—</option>
            {attachSchemeOptions(lib, label.attach_scheme).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>Где
          <input className={styles.input} value={label.place} onChange={(e) => onChange({ place: e.target.value })} placeholder="Левый боковой шов" />
        </label>
        <label className={styles.field}>Размер
          <input className={styles.input} value={label.size} onChange={(e) => onChange({ size: e.target.value })} placeholder="30×60 мм" />
        </label>
        <label className={styles.field}>Комментарий
          <input className={styles.input} value={label.comment} onChange={(e) => onChange({ comment: e.target.value })} />
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={!!label.blank} onChange={(e) => onChange({ blank: e.target.checked })} />
          Бланк — без печати
        </label>
      </div>
    </div>
  );
}
