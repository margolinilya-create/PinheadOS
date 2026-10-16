import { LABEL_TYPE_TO_ERP } from '../bridge/erpNames';
import { LABEL_CONFIG } from '../../data/extras';
import { salesLabelPrice } from '../pricing/priceOrder';
import { rub } from './labels';
import styles from './Sales.module.css';

/** Коды — как в справочнике ERP `label_type` (+ хэнгтег, стикер, патч из v4) */
const LABEL_TYPES = Object.entries(LABEL_TYPE_TO_ERP).map(([key, label]) => ({ key, label }));

/**
 * Варианты бирок со ставкой визарда (`salesLabelPrice`): от варианта
 * зависит цена за штуку. Основная бирка хранит `вариант:материал`.
 */
const VARIANTS = {
  composition: [
    { key: 'standard', label: 'Стандартный' },
    { key: 'my-logo', label: 'С логотипом' },
    { key: 'no-logo', label: 'Без логотипа' },
  ],
  brand: [
    { key: 'standard', label: 'Стандартная' },
    { key: 'custom', label: 'Своя (дизайн клиента)' },
    { key: 'send-own', label: 'Бирка клиента — пришлёт сам' },
  ],
  hangtag: [
    { key: 'standard', label: 'Стандартный' },
    { key: 'custom', label: 'Свой' },
  ],
};

/** Материалы основной бирки — те же, что в визарде (`LABEL_CONFIG`) */
const MATERIALS = LABEL_CONFIG.mainLabel.materials.map((m) => ({ key: m.key, label: m.name }));

/** Бирка позиции v4 (v4 §4.2 п. 5). Библиотека бирок — следующий срез */
export default function LabelRow({ label, index, onChange, onRemove }) {
  const variants = VARIANTS[label.label_type];
  const [variant, material] = (label.variant_id || '').split(':');
  const shownVariant = variant || 'standard';
  const setVariant = (v, m) => onChange({ variant_id: [v, m].filter(Boolean).join(':') });
  const price = salesLabelPrice(label);
  return (
    <div className={styles.subCard}>
      <div className={styles.subHead}>
        <span>Бирка {index + 1}{variants ? ` · ${rub(price)}/шт` : ''}</span>
        <button type="button" className={styles.remove} onClick={onRemove}>Удалить</button>
      </div>
      <div className={styles.grid2}>
        <label className={styles.field}>Тип
          <select className={styles.select} value={label.label_type} onChange={(e) => onChange({ label_type: e.target.value, variant_id: '' })}>
            <option value="">—</option>
            {LABEL_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        {variants && (
          <label className={styles.field}>Вариант
            <select className={styles.select} value={shownVariant} onChange={(e) => setVariant(e.target.value, material)}>
              {variants.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </label>
        )}
        {label.label_type === 'brand' && shownVariant !== 'send-own' && (
          <label className={styles.field}>Материал
            <select className={styles.select} value={material || 'woven'} onChange={(e) => setVariant(shownVariant, e.target.value)}>
              {MATERIALS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
        )}
        <label className={styles.field}>Где
          <input className={styles.input} value={label.place} onChange={(e) => onChange({ place: e.target.value })} placeholder="Левый боковой шов" />
        </label>
        <label className={styles.field}>Размер
          <input className={styles.input} value={label.size} onChange={(e) => onChange({ size: e.target.value })} placeholder="30×60 мм" />
        </label>
        <label className={styles.field}>Комментарий
          <input className={styles.input} value={label.comment} onChange={(e) => onChange({ comment: e.target.value })} />
        </label>
      </div>
    </div>
  );
}
