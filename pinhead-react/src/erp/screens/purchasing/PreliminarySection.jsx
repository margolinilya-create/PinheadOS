import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { MATERIAL_KIND_LABELS } from '../../types';
import { Button } from '../../components/Button';
import { DictionaryDatalist } from '../../components/DictionaryDatalist';
import { formatDateShort } from '../../utils/time';
import { confirm } from '../../../store/useConfirmStore';
import { toast } from '../../../store/useToastStore';
import styles from '../../erp.module.css';

/**
 * Предварительная закупка до запуска заказа (правки заказчика 16.08, п. 17).
 *
 * СЦЕНАРИЙ ДОКУМЕНТА ДОСЛОВНО: «Сделка ещё окончательно не запущена. Уже
 * известно, какая ткань потребуется. Чтобы не потерять несколько дней, ткань
 * закупается заранее. Позже заказ официально запускается». Раньше это было
 * невозможно в принципе: `erp_materials.order_id` объявлялся NOT NULL.
 *
 * ПРИВЯЗКА — UPDATE СУЩЕСТВУЮЩЕЙ СТРОКИ, а не копия. Документ (п. 17.1)
 * требует прямо: «система при этом не должна создавать вторую дублирующую
 * закупку». Скопировать строку было бы проще — и дало бы ровно ту двойную
 * закупку, от которой предостерегают.
 *
 * Блок свёрнут по умолчанию: предварительная закупка — исключение при сжатых
 * сроках, а не обычный порядок. Развёрнутым он спорил бы с очередью участка,
 * которая отвечает на вопрос «что делать сейчас».
 */

const EMPTY = { kind: 'fabric', name: '', color: '', qty_expected: '', unit: '', notes: '' };

export function PreliminarySection({ orders }) {
  const {
    preliminary, preliminaryLoaded, loadPreliminary,
    addPreliminaryMaterial, attachPreliminaryToOrder,
  } = useErpStore(useShallow((s) => ({
    preliminary: s.preliminary,
    preliminaryLoaded: s.preliminaryLoaded,
    loadPreliminary: s.loadPreliminary,
    addPreliminaryMaterial: s.addPreliminaryMaterial,
    attachPreliminaryToOrder: s.attachPreliminaryToOrder,
  })));
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!preliminaryLoaded) loadPreliminary(); }, [preliminaryLoaded, loadPreliminary]);

  const activeOrders = useMemo(
    () => orders.filter((o) => o.status === 'active'),
    [orders],
  );

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Укажите материал'); return; }
    setSaving(true);
    const row = await addPreliminaryMaterial({
      kind: form.kind,
      name: form.name.trim(),
      color: form.color.trim() || null,
      qty_expected: form.qty_expected === '' ? null : Number(form.qty_expected),
      unit: form.unit.trim() || null,
      notes: form.notes.trim() || null,
      status: 'pending',
    });
    setSaving(false);
    if (row) setForm(EMPTY);
  };

  const attach = async (material, orderId) => {
    const order = activeOrders.find((o) => o.id === orderId);
    if (!order) return;
    /**
     * Спрашиваем, потому что действие НЕОБРАТИМО в интерфейсе: строка уходит
     * из предварительных в заказ, и отвязать её обратно кнопкой нельзя.
     */
    const ok = await confirm({
      title: 'Привязать закупку к заказу?',
      message: `«${material.name}» станет позицией закупки заказа №${order.bitrix_id || '—'} `
        + `«${order.title}». Новая строка не создаётся — привязывается эта.`,
      confirmLabel: 'Привязать',
    });
    if (!ok) return;
    await attachPreliminaryToOrder(material.id, orderId);
  };

  return (
    <details className={styles.matSection}>
      <summary className={styles.labelCaps}>
        Предварительные закупки — {preliminary.length}
      </summary>
      <p className={styles.subText}>
        Материал, который заказывают до официального запуска сделки: при сжатых
        сроках ждать запуска — потерянные дни. Позже строка привязывается к заказу
        и появляется в его листе закупки; вторая строка при этом не создаётся.
      </p>

      <div className={styles.addMatRow}>
        <select
          className={styles.select}
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
          aria-label="Вид материала"
        >
          {Object.entries(MATERIAL_KIND_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <input
          className={styles.input}
          placeholder="Материал"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          aria-label="Материал"
        />
        <input
          className={styles.input}
          placeholder="Цвет"
          value={form.color}
          onChange={(e) => setForm({ ...form, color: e.target.value })}
          aria-label="Цвет"
          style={{ maxWidth: 140 }}
        />
        <input
          type="number"
          min="0"
          className={styles.input}
          placeholder="Кол-во"
          value={form.qty_expected}
          onChange={(e) => setForm({ ...form, qty_expected: e.target.value })}
          aria-label="Необходимое количество"
          style={{ maxWidth: 110 }}
        />
        <input
          className={styles.input}
          list="erp-units"
          placeholder="ед."
          value={form.unit}
          onChange={(e) => setForm({ ...form, unit: e.target.value })}
          aria-label="Единица измерения"
          style={{ maxWidth: 90 }}
        />
        <input
          className={styles.input}
          placeholder="Комментарий"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          aria-label="Комментарий"
        />
        <Button variant="secondary" loading={saving} onClick={submit}>
          + Предварительная закупка
        </Button>
      </div>

      {preliminary.length === 0 ? (
        <p className={styles.subText}>Предварительных закупок нет.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Материал</th><th>Цвет</th><th>Кол-во</th>
              <th>Заведена</th><th>Комментарий</th><th>Привязать к заказу</th>
            </tr>
          </thead>
          <tbody>
            {preliminary.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.name}</strong>
                  <div className={styles.subText}>
                    {MATERIAL_KIND_LABELS[m.kind] || m.kind}
                  </div>
                </td>
                <td>{m.color || '—'}</td>
                <td className={styles.progressCell}>
                  {m.qty_expected ?? '—'}{m.unit ? ` ${m.unit}` : ''}
                </td>
                <td className={styles.subText}>{formatDateShort(m.created_at) || '—'}</td>
                <td className={styles.subText}>{m.notes || '—'}</td>
                <td>
                  <select
                    className={styles.select}
                    value=""
                    onChange={(e) => attach(m, e.target.value)}
                    aria-label={`Привязать «${m.name}» к заказу`}
                  >
                    <option value="">Выберите заказ…</option>
                    {activeOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        №{o.bitrix_id || '—'} · {o.title}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DictionaryDatalist kind="unit" id="erp-units" />
    </details>
  );
}
