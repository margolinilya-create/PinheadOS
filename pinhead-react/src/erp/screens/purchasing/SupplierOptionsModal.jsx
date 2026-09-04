import { useState } from 'react';
import { DictionaryDatalist } from '../../components/DictionaryDatalist';
import InlineEdit from '../../components/InlineEdit';
import { confirm } from '../../../store/useConfirmStore';
import { SUPPLIER_OPTION_LABELS } from '../../types';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import styles from '../../styles';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { Button } from '../../components/Button';

/**
 * Сравнение вариантов поставщиков на одну позицию закупки (правка 10).
 *
 * Заказчик просил хранить несколько предложений и выбирать итоговое. Поля сравнения —
 * утверждённый базовый набор: поставщик, цена, наличие, срок поставки, минимальная партия
 * (+ примечание). Наличие и минимальная партия — свободный текст: поставщики отвечают
 * формулировками, а не числами.
 *
 * Выбранный вариант дублируется в материал (erp_materials.supplier), поэтому в таблице
 * закупки, плане приёмки и карточке заказа он появляется сам.
 *
 * Модалка, а не боковой ящик: таблица сравнения из шести колонок в 560px не помещается,
 * а модалка тянется до 900px и уже используется здесь же для «Новой закупки».
 */

const EMPTY = { supplier: '', price: '', availability: '', lead_days: '', min_batch: '', note: '' };

export function SupplierOptionsModal({ material, order, actions, onClose }) {
  // aria-modal обещает скринридеру, что фон скрыт, но Tab уводил фокус в таблицу
  const { addSupplierOption, updateSupplierOption, selectSupplierOption, deleteSupplierOption } = actions;
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const options = [...(material.suppliers ?? [])].sort(
    (a, b) => Number(b.is_selected) - Number(a.is_selected)
      || (a.price ?? Infinity) - (b.price ?? Infinity)
      || a.supplier.localeCompare(b.supplier),
  );

  const add = async () => {
    if (!form.supplier.trim()) return;
    setSaving(true);
    const created = await addSupplierOption(material.id, {
      supplier: form.supplier.trim(),
      price: form.price === '' ? null : Number(form.price),
      availability: form.availability.trim() || null,
      lead_days: form.lead_days === '' ? null : Number(form.lead_days),
      min_batch: form.min_batch.trim() || null,
      note: form.note.trim() || null,
      // Первый заведённый вариант сразу становится итоговым — иначе позиция
      // остаётся без поставщика, хотя предложение уже есть
      is_selected: (material.suppliers ?? []).length === 0,
    });
    setSaving(false);
    if (created) {
      setForm(EMPTY);
      if (created.is_selected) await selectSupplierOption(material.id, created.id);
    }
  };

  const remove = async (option) => {
    const ok = await confirm({
      title: `Удалить вариант «${option.supplier}»?`,
      message: option.is_selected
        ? 'Это выбранный поставщик — после удаления поставщик у позиции будет очищен.'
        : 'Вариант исчезнет из сравнения.',
      confirmLabel: 'Удалить',
      variant: 'danger',
    });
    if (ok) await deleteSupplierOption(material.id, option.id);
  };

  const num = (id, field) => (v) => updateSupplierOption(material.id, id, {
    [field]: v === '' || v == null ? null : Number(v),
  });
  const text = (id, field) => (v) => updateSupplierOption(material.id, id, {
    [field]: (v || '').trim() || null,
  });

  return (
    <Modal title={`Поставщики: ${material.name}`} onClose={onClose}>
      <div className={styles.subText}>
        Заказ №{order?.bitrix_id || '—'}{material.article ? ` · артикул ${material.article}` : ''}
      </div>
      <DictionaryDatalist kind="supplier" id="erp-suppliers-options" />

      <div className={styles.queueReason} style={{ marginBottom: 12 }}>
        Выбранный вариант подставляется в строку закупки, план приёмки на складе и карточку
        заказа. Остальные остаются историей запроса — их видно при следующей закупке.
      </div>

      {options.length === 0 ? (
        <div className={styles.emptyState}>Вариантов пока нет — добавьте первое предложение.</div>
      ) : (
        <ScrollHintBox className={styles.tableWrap} label="Варианты поставщиков">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{SUPPLIER_OPTION_LABELS.supplier}</th>
                <th>{SUPPLIER_OPTION_LABELS.price}</th>
                <th>{SUPPLIER_OPTION_LABELS.availability}</th>
                <th>{SUPPLIER_OPTION_LABELS.lead_days}</th>
                <th>{SUPPLIER_OPTION_LABELS.min_batch}</th>
                <th>{SUPPLIER_OPTION_LABELS.note}</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {options.map((o) => (
                <tr key={o.id} className={o.is_selected ? styles.supplierRowSelected : undefined}>
                  <td>
                    <strong>{o.supplier}</strong>
                    {o.is_selected && (
                      <div>
                        <span className={`${styles.chip} ${styles.chipReady}`}>выбран</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <InlineEdit
                      type="number"
                      value={o.price == null ? '' : String(o.price)}
                      ariaLabel={`Цена ${o.supplier}`}
                      onSave={num(o.id, 'price')}
                    />
                  </td>
                  <td>
                    <InlineEdit
                      value={o.availability}
                      ariaLabel={`Наличие ${o.supplier}`}
                      onSave={text(o.id, 'availability')}
                    />
                  </td>
                  <td>
                    <InlineEdit
                      type="number"
                      value={o.lead_days == null ? '' : String(o.lead_days)}
                      ariaLabel={`Срок поставки ${o.supplier}`}
                      onSave={num(o.id, 'lead_days')}
                    />
                  </td>
                  <td>
                    <InlineEdit
                      value={o.min_batch}
                      ariaLabel={`Минимальная партия ${o.supplier}`}
                      onSave={text(o.id, 'min_batch')}
                    />
                  </td>
                  <td>
                    <InlineEdit
                      value={o.note}
                      ariaLabel={`Примечание ${o.supplier}`}
                      onSave={text(o.id, 'note')}
                    />
                  </td>
                  <td>
                    {!o.is_selected && (
                      <Button variant="secondary" onClick={() => selectSupplierOption(material.id, o.id)}>
                        Выбрать
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      aria-label={`Удалить вариант ${o.supplier || 'поставщика'}`}
                      title="Удалить вариант"
                      onClick={() => remove(o)}>
                      <Icon name="x" size={15} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollHintBox>
      )}

      <section className={styles.matSection} style={{ marginTop: 14 }}>
        <div className={styles.matSectionHead}><strong>Новый вариант</strong></div>
        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>{SUPPLIER_OPTION_LABELS.supplier} *</span>
            <input
              className={styles.input}
              value={form.supplier}
              list="erp-suppliers-options"
              placeholder="напр. Астра Текстиль"
              aria-label="Поставщик"
              onChange={(e) => set({ supplier: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{SUPPLIER_OPTION_LABELS.price}</span>
            <input
              type="number" min="0" step="0.01" className={styles.input}
              value={form.price} aria-label="Цена"
              onChange={(e) => set({ price: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{SUPPLIER_OPTION_LABELS.availability}</span>
            <input
              className={styles.input} value={form.availability}
              placeholder="напр. 200 кг на складе" aria-label="Наличие"
              onChange={(e) => set({ availability: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{SUPPLIER_OPTION_LABELS.lead_days}</span>
            <input
              type="number" min="0" className={styles.input}
              value={form.lead_days} aria-label="Срок поставки, дней"
              onChange={(e) => set({ lead_days: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{SUPPLIER_OPTION_LABELS.min_batch}</span>
            <input
              className={styles.input} value={form.min_batch}
              placeholder="напр. от 50 кг" aria-label="Минимальная партия"
              onChange={(e) => set({ min_batch: e.target.value })}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>{SUPPLIER_OPTION_LABELS.note}</span>
            <input
              className={styles.input} value={form.note} aria-label="Примечание"
              onChange={(e) => set({ note: e.target.value })}
            />
          </label>
        </div>
        <div className={styles.modalActions}>
          <Button variant="primary" disabled={saving || !form.supplier.trim()} onClick={add}>
            + Добавить вариант
          </Button>
        </div>
      </section>

      <div className={styles.modalActions}>
        <Button variant="ghost" onClick={onClose}>Закрыть</Button>
      </div>
    </Modal>
  );
}
