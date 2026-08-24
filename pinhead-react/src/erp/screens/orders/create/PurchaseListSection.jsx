import { DictionaryDatalist } from '../../../components/DictionaryDatalist';
import { Icon } from '../../../components/Icon';
import { Button } from '../../../components/Button';
import { MATERIAL_KIND_LABELS, MATERIAL_ROLE_LABELS } from '../../../types';
import { AttachmentPicker } from '../../../components/AttachmentPicker';
import { FieldError } from './FormParts';
import { PURCHASE_FIELD_LABELS } from '../../purchasing/purchaseLabels';
import styles from '../../../styles';

/**
 * Лист закупки — ФАЙЛ менеджера (правки заказчика 20.08).
 *
 * ЧТО ИЗМЕНИЛОСЬ И ПОЧЕМУ. 16.08 менеджер заводил потребность СТРОКАМИ прямо
 * здесь. Документ 20.08 разворачивает роли: «лист закупки должен формироваться
 * менеджером сопровождения ДО создания заказа и загружаться готовым файлом…
 * менеджер сопровождения не заводит вручную материалы, количество,
 * поставщиков, цены и сроки прихода в ERP». Фактические строки создаёт
 * закупщик, «потому что уже он знает, у кого реально заказали, какое
 * количество купили, какую цену получили и когда материал должен приехать».
 *
 * Обязательно ОДНО ИЗ ДВУХ: файл или отметка «Закупка не требуется». Проверяет
 * это `validateOrderForm` — только оттуда работают рамка, автоскролл
 * и раскрытие секции.
 *
 * СТРОКИ ОСТАЛИСЬ, но стали НЕОБЯЗАТЕЛЬНОЙ подсказкой (решение заказчика при
 * планировании) и уехали в свёрнутый блок. Потребность задаёт файл; строки —
 * то, что менеджер хочет сказать закупщику словами, а не вместо него.
 */

/** Одна строка-подсказка. `item_index` = null — материал на весь заказ */
function PurchaseRow({ r, ri, items, attach, setRow, removeRow, err, inputCls }) {
  return (
    <div className={styles.itemBlock}>
      <div className={styles.itemBlockHead}>
        <span className={styles.itemBlockTitle}>
          Подсказка {ri + 1}{r.name.trim() ? ` · ${r.name.trim()}` : ''}
        </span>
        <Button
          variant="ghost"
          aria-label={`Убрать подсказку ${ri + 1}`}
          onClick={() => removeRow(r.key)}>
          <Icon name="x" size={14} />
        </Button>
      </div>

      <div className={styles.itemRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Материал *</span>
          <input
            className={inputCls(`purchase_${ri}_name`)}
            value={r.name}
            onChange={(e) => setRow(r.key, { name: e.target.value })}
            placeholder="Кулирка 230гр"
            aria-invalid={err(`purchase_${ri}_name`) ? true : undefined}
            aria-describedby={err(`purchase_${ri}_name`) ? `err-purchase-${ri}-name` : undefined}
            data-invalid={err(`purchase_${ri}_name`) ? true : undefined}
          />
          <FieldError id={`err-purchase-${ri}-name`} text={err(`purchase_${ri}_name`)} />
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
            aria-label={`Тип материала, подсказка ${ri + 1}`}
          >
            {Object.entries(MATERIAL_KIND_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Роль в изделии</span>
          <select
            className={styles.select}
            value={r.role}
            onChange={(e) => setRow(r.key, { role: e.target.value })}
            aria-label={`Роль материала, подсказка ${ri + 1}`}
          >
            {Object.entries(MATERIAL_ROLE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{PURCHASE_FIELD_LABELS.qtyExpected} *</span>
          <input
            type="number"
            min="0"
            step="any"
            className={inputCls(`purchase_${ri}_qty`)}
            value={r.qty_expected}
            onChange={(e) => setRow(r.key, { qty_expected: e.target.value.replace('-', '') })}
            placeholder="120"
            aria-invalid={err(`purchase_${ri}_qty`) ? true : undefined}
            aria-describedby={err(`purchase_${ri}_qty`) ? `err-purchase-${ri}-qty` : undefined}
            data-invalid={err(`purchase_${ri}_qty`) ? true : undefined}
          />
          <FieldError id={`err-purchase-${ri}-qty`} text={err(`purchase_${ri}_qty`)} />
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
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Для изделия</span>
          <select
            className={styles.select}
            value={r.item_index === null ? '' : String(r.item_index)}
            onChange={(e) => setRow(r.key, {
              item_index: e.target.value === '' ? null : Number(e.target.value),
            })}
            aria-label={`Для какого изделия, подсказка ${ri + 1}`}
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
      <AttachmentPicker
        label="+ Файлы подсказки"
        hint="фото материала, скрин позиции поставщика, референс"
        files={attach.files}
        kind="purchase"
        ownerKey={r.key}
        onAdd={attach.add}
        onRetry={attach.retry}
        onRemove={attach.remove}
      />
    </div>
  );
}

export function PurchaseListSection({
  rows, items, attach, addRow, setRow, removeRow,
  notRequired, onToggleNotRequired,
  err = () => undefined, inputCls = () => styles.input,
}) {
  return (
    <>
      <p className={styles.subText}>
        Потребность задаёт ФАЙЛ: менеджер сопровождения готовит лист закупки
        заранее и прикладывает его сюда. Фактические строки — сколько заказано,
        у кого, по какой цене и когда придёт — заводит закупщик: на момент
        запуска этого ещё никто не знает.
      </p>

      <div className={styles.checkRow}>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={Boolean(notRequired)}
            onChange={(e) => onToggleNotRequired(e.target.checked)}
            aria-label="Закупка не требуется"
          />
          <span>Закупка не требуется</span>
        </label>
        <span className={styles.subText}>
          {/* Документ: «клиент дал готовые изделия… закупка не нужна» */}
          заказ не появится у закупщика, и этап «Закупка» в маршрут не попадёт
        </span>
      </div>

      {!notRequired && (
        <div
          className={err('purchase_list') ? styles.invalidBlock : undefined}
          data-invalid={err('purchase_list') ? true : undefined}
        >
          <AttachmentPicker
            label="+ Лист закупки *"
            hint="файл, который вы готовили к запуску: xlsx, pdf, фото"
            files={attach.files}
            kind="purchase_list"
            multiple={false}
            accept="image/*,application/pdf,.xlsx,.xls,.csv,.numbers,.ods"
            onAdd={attach.add}
            onRetry={attach.retry}
            onRemove={attach.remove}
          />
          <FieldError id="err-purchase-list" text={err('purchase_list')} />
        </div>
      )}

      <details className={styles.matSection}>
        <summary>
          Подсказки закупщику строками — необязательно{rows.length ? ` (${rows.length})` : ''}
        </summary>
        <p className={styles.subText}>
          Не потребность, а пояснение: что именно искать, у кого брали прошлый
          раз, какие допуски. Закупщик всё равно заводит свои строки — эти
          он видит рядом с листом.
        </p>

        {rows.map((r, ri) => (
          <PurchaseRow
            key={r.key}
            r={r} ri={ri} items={items} attach={attach}
            setRow={setRow} removeRow={removeRow}
            err={err} inputCls={inputCls}
          />
        ))}

        <div className={styles.checkRow}>
          <Button variant="secondary" onClick={addRow}>
            + Подсказка ({rows.length})
          </Button>
        </div>
      </details>

      <DictionaryDatalist kind="unit" id="erp-units" />
    </>
  );
}
