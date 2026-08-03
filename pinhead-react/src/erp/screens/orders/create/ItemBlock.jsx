import { DictionaryDatalist } from '../../../components/DictionaryDatalist';
import { SizeGridEditor } from './SizeGridEditor';
import { FieldError } from './FormParts';
import { Icon } from '../../../components/Icon';
import { deptShortName } from '../../../data/departments';
import { EMPTY_PRINT, gridTotal } from '../../../utils/orderForm';
import {
  PRODUCTION_TYPE_LABELS,
  BRANDING_METHOD_LABELS,
  SUBCONTRACT_OP_TYPE_LABELS,
  SUBCONTRACT_MATERIAL_SOURCE_LABELS,
} from '../../../types';
import styles from '../../../erp.module.css';
import { Button } from '../../../components/Button';

/**
 * Одна позиция заказа в форме создания: изделие, вариант, тираж (или размерная
 * сетка), тип производства, подряд, нанесения и заметка.
 *
 * Вынесено из CreateOrderModal — это была самая крупная часть файла (278 строк
 * JSX внутри `items.map`). Состояния не держит: всё приходит пропсами, чтобы
 * валидация и черновик остались в одном месте — в самой модалке.
 */
export function ItemBlock({
  it, i, itemsCount, err, inputCls, queueDepts,
  setItem, setBranding, setPrint, removeItem, removePrint,
}) {
  const gTotal = gridTotal(it.size_grid);

  return (
    <div className={styles.itemBlock}>
      <div className={styles.itemBlockHead}>
        <span className={styles.itemBlockTitle} title={it.product_type || undefined}>
          Позиция {i + 1}{it.product_type ? ` · ${it.product_type}` : ''}
        </span>
        <Button
          variant="ghost"
          aria-label={`Убрать позицию ${i + 1}`}
          disabled={itemsCount === 1}
          onClick={() => removeItem(i)}>
          <Icon name="x" size={14} />
        </Button>
      </div>
    <div className={styles.itemRow}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Изделие *</span>
        {/* Подсказки из справочника типов изделий (правка 12), ввод остаётся свободным */}
        <input
          className={inputCls(`item_${i}_product_type`)}
          value={it.product_type}
          onChange={(e) => setItem(i, { product_type: e.target.value })}
          placeholder="футболка"
          list="erp-product-types"
          aria-required="true"
          aria-invalid={err(`item_${i}_product_type`) ? true : undefined}
          aria-describedby={err(`item_${i}_product_type`) ? `err-item-${i}-product` : undefined}
          data-invalid={err(`item_${i}_product_type`) ? true : undefined}
        />
        <FieldError id={`err-item-${i}-product`} text={err(`item_${i}_product_type`)} />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Вариант / цвет</span>
        <input
          className={styles.input}
          value={it.variant}
          onChange={(e) => setItem(i, { variant: e.target.value })}
          placeholder="голубые"
        />
      </label>
      {gTotal > 0 ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Кол-во</span>
          <input
            className={styles.input}
            value={gTotal}
            readOnly
            aria-label={`Количество позиции ${i + 1} — из размерной сетки`}
          />
          <span className={styles.subText}>из размерной сетки</span>
        </label>
      ) : (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Кол-во *</span>
          <input
            type="number"
            min="1"
            className={inputCls(`item_${i}_qty`)}
            value={it.qty}
            onChange={(e) => setItem(i, { qty: e.target.value.replace('-', '') })}
            aria-required="true"
            aria-invalid={err(`item_${i}_qty`) ? true : undefined}
            aria-describedby={err(`item_${i}_qty`) ? `err-item-${i}-qty` : undefined}
            data-invalid={err(`item_${i}_qty`) ? true : undefined}
          />
          <FieldError id={`err-item-${i}-qty`} text={err(`item_${i}_qty`)} />
        </label>
      )}
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Тип производства</span>
        <div className={styles.tileRow} role="radiogroup" aria-label="Тип производства">
          {Object.entries(PRODUCTION_TYPE_LABELS).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={it.production_type === v}
              className={`${styles.tile} ${it.production_type === v ? styles.tileActive : ''}`}
              onClick={() => setItem(i, { production_type: v })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {it.production_type === 'outsource' && (
        <>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Тип подряда</span>
            <select
              className={styles.select}
              value={it.subcontract_kind ?? 'finished_product'}
              onChange={(e) => setItem(i, { subcontract_kind: e.target.value })}
              aria-label="Тип подряда"
            >
              {Object.entries(SUBCONTRACT_OP_TYPE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Материалы</span>
            <select
              className={styles.select}
              value={it.material_source ?? 'pinhead'}
              onChange={(e) => setItem(i, { material_source: e.target.value })}
              aria-label="Источник материалов"
            >
              {Object.entries(SUBCONTRACT_MATERIAL_SOURCE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </label>
          {(it.subcontract_kind ?? 'finished_product') === 'operation' && (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Операция подрядчика</span>
                <input
                  className={styles.input}
                  value={it.subcontract_operation ?? ''}
                  onChange={(e) => setItem(i, { subcontract_operation: e.target.value })}
                  placeholder="печать по полотну / варка / вышивка…"
                  aria-label="Какая операция выполняется подрядчиком"
                />
              </label>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Требуется доработка в Pinhead?</span>
                <div className={styles.tileRow} role="radiogroup" aria-label="Требуется доработка в Pinhead">
                  {[['no', 'Нет'], ['yes', 'Да']].map(([v, label]) => {
                    const on = (v === 'yes') === Boolean(it.needs_further);
                        return (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`${styles.tile} ${on ? styles.tileActive : ''}`}
                        onClick={() => setItem(i, {
                          needs_further: v === 'yes',
                          return_dept: v === 'yes' ? it.return_dept : '',
                        })}
                      >
                        {label}
                      </button>
                        );
                      })}
                    </div>
                  </div>
                  {it.needs_further && (
                    <label
                      className={styles.field}
                      data-invalid={err(`item_${i}_return_dept`) ? true : undefined}
                    >
                      <span className={styles.fieldLabel}>Следующий участок *</span>
                      <select
                        className={err(`item_${i}_return_dept`)
                          ? `${styles.select} ${styles.inputError}` : styles.select}
                        value={it.return_dept ?? ''}
                        onChange={(e) => setItem(i, { return_dept: e.target.value })}
                        aria-label="Следующий участок после операции подряда"
                        aria-invalid={err(`item_${i}_return_dept`) ? true : undefined}
                        aria-describedby={err(`item_${i}_return_dept`)
                          ? `err-item-${i}-return-dept` : undefined}
                      >
                        <option value="">Выберите участок…</option>
                        {queueDepts.map((d) => (
                          <option key={d.code} value={d.code}>{deptShortName(d.code, d.name)}</option>
                        ))}
                      </select>
                      <FieldError
                        id={`err-item-${i}-return-dept`}
                        text={err(`item_${i}_return_dept`)}
                      />
                    </label>
                  )}
                </>
              )}
            </>
          )}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Брендирование</span>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={Boolean(it.has_branding)}
                onChange={(e) => setBranding(i, e.target.checked)}
              />
              С нанесением
            </label>
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Нанесение на</span>
            <select
              className={styles.select}
              value={it.branding_on}
              disabled={!it.has_branding}
              onChange={(e) => setItem(i, { branding_on: e.target.value })}
            >
              <option value="cut">на крое</option>
              <option value="finished">на готовом</option>
            </select>
          </label>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Контроль качества</span>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={it.needs_qc ?? true}
                onChange={(e) => setItem(i, { needs_qc: e.target.checked })}
              />
              Финальный ОТК
            </label>
          </div>
        </div>

        {it.has_branding && it.prints.map((p, pi) => (
          <div key={pi} className={styles.printBlock}>
            <div className={`${styles.checkRow} ${styles.printRow}`}>
              <strong className={styles.fieldLabel}>Нанесение №{pi + 1}</strong>
              <select
                className={`${styles.select} ${styles.inputSm}`}
                value={p.method}
                aria-label="Техника нанесения"
                onChange={(e) => setPrint(i, pi, { method: e.target.value })}
              >
                {Object.entries(BRANDING_METHOD_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <input
                className={`${styles.input} ${styles.inputSm} ${styles.printZoneInput}`}
                placeholder="Расположение (спина справа по втачке)"
                aria-label="Расположение нанесения"
                value={p.zone}
                onChange={(e) => setPrint(i, pi, { zone: e.target.value })}
              />
              <label className={`${styles.checkLabel} ${styles.mmLabel}`} style={{ gap: 3 }}>
                <span className={styles.subText}>В, мм</span>
                <input type="number" min="1"
                  className={`${styles.input} ${styles.inputSm} ${styles.mmInput}`}
                  value={p.height_mm}
                  onChange={(e) => setPrint(i, pi, { height_mm: e.target.value })} />
              </label>
              <label className={`${styles.checkLabel} ${styles.mmLabel}`} style={{ gap: 3 }}>
                <span className={styles.subText}>Ш, мм</span>
                <input type="number" min="1"
                  className={`${styles.input} ${styles.inputSm} ${styles.mmInput}`}
                  value={p.width_mm}
                  onChange={(e) => setPrint(i, pi, { width_mm: e.target.value })} />
              </label>
              <Button
                variant="ghost"
                aria-label={`Убрать нанесение ${pi + 1}`}
                onClick={() => removePrint(i, pi)}>
                <Icon name="x" size={14} />
              </Button>
            </div>
            <div className={`${styles.checkRow} ${styles.printRow}`}>
              <input
                className={`${styles.input} ${styles.inputSm} ${styles.printNoteInput}`}
                placeholder="Отступ (10см от шва горловины)"
                aria-label="Отступ нанесения"
                value={p.offset_note}
                onChange={(e) => setPrint(i, pi, { offset_note: e.target.value })}
              />
              <input
                className={`${styles.input} ${styles.inputSm} ${styles.pantoneInput}`}
                placeholder="Pantone (1163, 1181)"
                aria-label="Pantone нанесения"
                value={p.pantone}
                onChange={(e) => setPrint(i, pi, { pantone: e.target.value })}
              />
              <input
                className={`${styles.input} ${styles.inputSm} ${styles.printNoteInput}`}
                placeholder="Комментарий (макет как в сделке…)"
                aria-label="Комментарий нанесения"
                value={p.comment}
                onChange={(e) => setPrint(i, pi, { comment: e.target.value })}
              />
            </div>
          </div>
        ))}

        {it.has_branding && (
          <div
            className={styles.checkRow}
            data-invalid={err(`item_${i}_prints`) ? true : undefined}
          >
            <Button
              variant="secondary"
              aria-describedby={err(`item_${i}_prints`) ? `err-item-${i}-prints` : undefined}
              onClick={() => setItem(i, { prints: [...it.prints, { ...EMPTY_PRINT }] })}>
              + Нанесение ({it.prints.length})
            </Button>
            <FieldError id={`err-item-${i}-prints`} text={err(`item_${i}_prints`)} />
          </div>
        )}

        <details className={styles.gridDetails}>
          <summary className={styles.subText}>
            Размерная сетка (цвет × размер){gTotal > 0 ? ` — ${gTotal} шт` : ''}
          </summary>
          <SizeGridEditor
            grid={it.size_grid}
            onChange={(g) => setItem(i, { size_grid: g })}
          />
        </details>
        </div>
  );
}
