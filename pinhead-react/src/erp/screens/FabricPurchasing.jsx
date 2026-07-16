import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { useErpStore } from '../store/useErpStore';
import { toast } from '../../store/useToastStore';
import { MATERIAL_STATUS_LABELS } from '../types';
import styles from '../erp.module.css';

/**
 * Закупка: материалы по заказам (ткань, фурнитура, бирки).
 * Приход материалов (received) открывает закрой — см. materialsBlockCutting.
 */

const KIND_LABELS = {
  fabric: 'Ткань',
  hardware: 'Фурнитура',
  labels: 'Бирки/этикетки',
  packaging: 'Упаковка',
  other: 'Прочее',
};

const SOURCE_LABELS = {
  purchase: 'Закупка',
  stock: 'Со склада',
  client: 'Давальческое',
  none: 'Без закупки',
};

const STATUS_CHIP = {
  pending: 'chipWaiting',
  ordered: 'chipProgress',
  in_transit: 'chipProgress',
  partial: 'chipBlocked',
  received: 'chipReady',
  not_needed: 'chipSkipped',
};

function AddMaterialRow({ orderId, onAdd }) {
  const [form, setForm] = useState({ kind: 'fabric', name: '', source: 'purchase', qty: '', eta_date: '' });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Укажите название материала'); return; }
    setSaving(true);
    const row = await onAdd(orderId, {
      kind: form.kind,
      name: form.name.trim(),
      source: form.source,
      qty: form.qty.trim() || null,
      eta_date: form.eta_date || null,
      status: form.source === 'purchase' ? 'pending' : 'received',
    });
    setSaving(false);
    if (row) setForm({ kind: 'fabric', name: '', source: 'purchase', qty: '', eta_date: '' });
  };

  return (
    <div className={styles.addMatRow}>
      <select className={styles.select} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Тип материала">
        {Object.entries(KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input className={styles.input} placeholder="Кулирка 230гр чёрная" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Название материала" />
      <select className={styles.select} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} aria-label="Источник">
        {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input className={styles.input} placeholder="120 м / 40 кг" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} aria-label="Количество" style={{ maxWidth: 110 }} />
      <input type="date" className={styles.input} value={form.eta_date} onChange={(e) => setForm({ ...form, eta_date: e.target.value })} aria-label="План прихода" />
      <button type="button" className="btn btn-secondary" disabled={saving} onClick={submit}>+ Добавить</button>
    </div>
  );
}

export default function FabricPurchasing() {
  const { orders, loading, loaded, loadAll, addMaterial, updateMaterial } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      loading: s.loading,
      loaded: s.loaded,
      loadAll: s.loadAll,
      addMaterial: s.addMaterial,
      updateMaterial: s.updateMaterial,
    })),
  );
  const [onlyWaiting, setOnlyWaiting] = useState(false);

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  /** Активные заказы; при фильтре — только те, где материалы блокируют закрой */
  const rows = useMemo(() => {
    let list = orders.filter((o) => o.status === 'active');
    if (onlyWaiting) {
      list = list.filter((o) =>
        o.materials.some((m) => m.status !== 'received' && m.status !== 'not_needed'));
    }
    return list;
  }, [orders, onlyWaiting]);

  const setStatus = async (m, status) => {
    const patch = { status };
    if (status === 'received') patch.received_at = new Date().toISOString().slice(0, 10);
    await updateMaterial(m.id, patch);
  };

  return (
    <>
      <PageHead
        title="Закупка"
        sub="Материалы по заказам: ткань, фурнитура, бирки. Приход открывает закрой."
      />

      <div className={styles.toolbar}>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={onlyWaiting} onChange={(e) => setOnlyWaiting(e.target.checked)} />
          Только с непришедшими материалами
        </label>
        <div className={styles.spacer} />
        <span className={styles.subText}>{rows.length} заказов</span>
      </div>

      {loading && !loaded && <div className={styles.emptyState}>Загрузка…</div>}
      {loaded && rows.length === 0 && (
        <div className={styles.emptyState}>Нет активных заказов с материалами.</div>
      )}

      {rows.map((order) => {
        const blocking = order.materials.some(
          (m) => m.status !== 'received' && m.status !== 'not_needed');
        return (
          <section key={order.id} className={styles.matSection}>
            <div className={styles.matSectionHead}>
              <div>
                <strong>{order.title}</strong>
                <span className={styles.subText}> №{order.bitrix_id || '—'}</span>
                {order.due_date && (
                  <span className={styles.subText}>
                    {' '}· срок {new Date(order.due_date + 'T00:00:00').toLocaleDateString('ru-RU')}
                  </span>
                )}
              </div>
              <span className={`${styles.chip} ${blocking ? styles.chipBlocked : styles.chipReady}`}>
                {blocking ? 'Закрой заблокирован' : 'Материалы готовы'}
              </span>
            </div>

            {order.materials.length > 0 && (
              <div className={styles.tableWrap} style={{ marginBottom: 8 }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Тип</th><th>Материал</th><th>Источник</th><th>Кол-во</th>
                      <th>План прихода</th><th>Статус</th><th>Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.materials.map((m) => (
                      <tr key={m.id}>
                        <td>{KIND_LABELS[m.kind]}</td>
                        <td>{m.name}{m.notes && <div className={styles.subText}>{m.notes}</div>}</td>
                        <td>{SOURCE_LABELS[m.source]}</td>
                        <td>{m.qty || '—'}</td>
                        <td>
                          {m.eta_date ? new Date(m.eta_date + 'T00:00:00').toLocaleDateString('ru-RU') : '—'}
                          {m.received_at && (
                            <div className={styles.subText}>
                              факт {new Date(m.received_at + 'T00:00:00').toLocaleDateString('ru-RU')}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`${styles.chip} ${styles[STATUS_CHIP[m.status]]}`}>
                            {MATERIAL_STATUS_LABELS[m.status]}
                          </span>
                        </td>
                        <td>
                          <select
                            className={styles.select}
                            value={m.status}
                            onChange={(e) => setStatus(m, e.target.value)}
                            aria-label={`Статус материала ${m.name}`}
                          >
                            {Object.entries(MATERIAL_STATUS_LABELS).map(([v, l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <AddMaterialRow orderId={order.id} onAdd={addMaterial} />
          </section>
        );
      })}
    </>
  );
}
