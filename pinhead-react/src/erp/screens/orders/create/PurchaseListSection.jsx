import { DictionaryDatalist } from '../../../components/DictionaryDatalist';
import { Icon } from '../../../components/Icon';
import { Button } from '../../../components/Button';
import { MATERIAL_KIND_LABELS, MATERIAL_ROLE_LABELS } from '../../../types';
import styles from '../../../erp.module.css';

/**
 * Лист закупки — часть СОЗДАНИЯ заказа (правки заказчика 16.08, пп. 6–8, 11–14).
 *
 * ЧТО БЫЛО НЕ ТАК. Потребность в материалах формировал закупщик: он открывал
 * «Закупку», нажимал «Новая закупка» и вбивал руками то, что менеджер уже знал,
 * когда заводил заказ. Документ называет это прямо: «закупщик не должен повторно
 * создавать эту закупку или вручную переносить информацию».
 *
 * ЧТО СТАЛО. Менеджер заполняет лист здесь, вместе с ТЗ и упаковкой, и строки
 * уезжают в заказ ТОЙ ЖЕ транзакцией (секция `materials` в `erp_create_order`).
 * Раздел «Закупка» перестаёт быть местом, где потребность придумывают, и
 * становится местом, где её исполняют.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Плана прихода (`eta_date`) менеджер не указывает —
 * прямое требование п. 13: «менеджер зачастую не знает эту информацию на момент
 * запуска, поле должен заполнять закупщик после взаимодействия с поставщиком».
 * Поставщика, цены и дат заказа тоже нет: это фактическая часть закупщика,
 * и смешивать её с потребностью значит вернуть ту самую единственную строку,
 * в которую писали обе роли.
 */

/** Одна строка потребности. `item_index` = null — материал на весь заказ */
export function PurchaseListSection({ rows, items, addRow, setRow, removeRow }) {
  return (
    <>
      <p className={styles.subText}>
        Что нужно закупить для этого заказа. Строки уедут закупщику вместе с заказом —
        повторно заводить их не придётся. План прихода, поставщика и цену заполняет
        закупщик: на момент запуска они обычно неизвестны.
      </p>

      {rows.length === 0 && (
        <div className={styles.subText}>
          Закупка не требуется — оставьте лист пустым.
        </div>
      )}

      {rows.map((r, ri) => (
        <div key={r.key} className={styles.itemBlock}>
          <div className={styles.itemBlockHead}>
            <span className={styles.itemBlockTitle}>
              Позиция закупки {ri + 1}{r.name.trim() ? ` · ${r.name.trim()}` : ''}
            </span>
            <Button
              variant="ghost"
              aria-label={`Убрать позицию закупки ${ri + 1}`}
              onClick={() => removeRow(r.key)}>
              <Icon name="x" size={14} />
            </Button>
          </div>

          <div className={styles.itemRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Материал *</span>
              <input
                className={styles.input}
                value={r.name}
                onChange={(e) => setRow(r.key, { name: e.target.value })}
                placeholder="Кулирка 230гр"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Цвет</span>
              <input
                className={styles.input}
                value={r.color}
                onChange={(e) => setRow(r.key, { color: e.target.value })}
                placeholder="чёрный"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Тип</span>
              <select
                className={styles.select}
                value={r.kind}
                onChange={(e) => setRow(r.key, { kind: e.target.value })}
                aria-label={`Тип материала, позиция закупки ${ri + 1}`}
              >
                {Object.entries(MATERIAL_KIND_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </label>
            {/* «Отделочный материал» из документа — это роль `trim`, а не
                отдельная колонка: роли материала уже есть и уже показываются */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Роль в изделии</span>
              <select
                className={styles.select}
                value={r.role}
                onChange={(e) => setRow(r.key, { role: e.target.value })}
                aria-label={`Роль материала, позиция закупки ${ri + 1}`}
              >
                {Object.entries(MATERIAL_ROLE_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Нужно количество *</span>
              <input
                type="number"
                min="0"
                step="any"
                className={styles.input}
                value={r.qty_expected}
                onChange={(e) => setRow(r.key, { qty_expected: e.target.value.replace('-', '') })}
                placeholder="120"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Единица</span>
              <input
                className={styles.input}
                value={r.unit}
                onChange={(e) => setRow(r.key, { unit: e.target.value })}
                placeholder="м"
                list="erp-units"
              />
            </label>
            {/* Материал может относиться ко всему заказу (упаковка, бирки одного
                дизайна) или к конкретной позиции — так же, как erp_materials.item_id */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Для изделия</span>
              <select
                className={styles.select}
                value={r.item_index === null ? '' : String(r.item_index)}
                onChange={(e) => setRow(r.key, {
                  item_index: e.target.value === '' ? null : Number(e.target.value),
                })}
                aria-label={`Для какого изделия, позиция закупки ${ri + 1}`}
              >
                <option value="">на весь заказ</option>
                {items.map((it, ii) => (
                  <option key={ii} value={ii}>
                    {it.product_type.trim() || `Позиция ${ii + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span className={styles.fieldLabel}>Комментарий закупщику</span>
              <input
                className={styles.input}
                value={r.manager_note}
                onChange={(e) => setRow(r.key, { manager_note: e.target.value })}
                placeholder="референс в сделке, поставщик прошлого раза, допуски по плотности"
              />
            </label>
          </div>
        </div>
      ))}

      <div className={styles.checkRow}>
        <Button variant="secondary" onClick={addRow}>
          + Позиция закупки ({rows.length})
        </Button>
      </div>

      <DictionaryDatalist kind="unit" id="erp-units" />
    </>
  );
}
