import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { useErpStore, lastDefectPhotoUrl } from '../store/useErpStore';
import { toast } from '../../store/useToastStore';
import { materialsBlockStage } from '../utils/routes';
import { formatDateShort, procurementSla } from '../utils/time';
import {
  MATERIAL_STATUS_LABELS,
  PROCUREMENT_CAUSE_LABELS,
  PROCUREMENT_KIND_LABELS,
  PROCUREMENT_STATUS_LABELS,
} from '../types';
import styles from '../erp.module.css';

/**
 * Закупка: материалы по заказам (ткань, фурнитура, бирки).
 * Приход ткани открывает закрой — см. materialsBlockStage.
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
  reserved: 'chipReady',
  not_needed: 'chipSkipped',
};

const EMPTY_MAT = { kind: 'fabric', name: '', source: 'purchase', supplier: '', qty: '', eta_date: '' };

function AddMaterialRow({ orderId, onAdd }) {
  const [form, setForm] = useState(EMPTY_MAT);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Укажите название материала'); return; }
    // План прихода обязателен для закупаемых материалов
    if (form.source === 'purchase' && !form.eta_date) { toast.error('Укажите план прихода'); return; }
    setSaving(true);
    const row = await onAdd(orderId, {
      kind: form.kind,
      name: form.name.trim(),
      source: form.source,
      supplier: form.supplier.trim() || null,
      qty: form.qty.trim() || null,
      eta_date: form.eta_date || null,
      // purchase/stock ждут действия (закупка / подтверждение наличия), остальное — сразу готово
      status: form.source === 'purchase' || form.source === 'stock' ? 'pending' : 'received',
    });
    setSaving(false);
    if (row) setForm(EMPTY_MAT);
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
      <input className={styles.input} placeholder="Поставщик" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} aria-label="Поставщик" style={{ maxWidth: 140 }} />
      <input className={styles.input} placeholder="120 м / 40 кг" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} aria-label="Количество" style={{ maxWidth: 110 }} />
      <input type="date" className={styles.input} value={form.eta_date} onChange={(e) => setForm({ ...form, eta_date: e.target.value })} aria-label="План прихода" />
      <button type="button" className="btn btn-secondary" disabled={saving} onClick={submit}>+ Добавить</button>
    </div>
  );
}

/** Задачи на дозакупку/замену по заказу (возврат из закроя). Исходную закупку не трогают. */
function ProcurementTasksBlock({ order, onUpdate }) {
  const tasks = order.procurement_tasks ?? [];
  if (tasks.length === 0) return null;
  const photo = lastDefectPhotoUrl(order);
  return (
    <div className={styles.tableWrap} style={{ marginTop: 8, marginBottom: 8 }}>
      <div className={styles.fieldLabel}>Задачи на дозакупку / замену</div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Материал</th><th>Тип</th><th>Причина</th><th>Изделий</th>
            <th>Поставщик</th><th>План</th><th>Ответственный</th><th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td>
                {t.material_name}
                {photo && (
                  <>
                    {' '}
                    <a href={photo} target="_blank" rel="noreferrer">📷</a>
                  </>
                )}
              </td>
              <td>
                {PROCUREMENT_KIND_LABELS[t.kind]}
                {!t.counts_as_purchase && (
                  <div className={styles.subText}>не закупка компании</div>
                )}
              </td>
              <td>
                {PROCUREMENT_CAUSE_LABELS[t.cause_type]}
                {t.reason && <div className={styles.subText}>{t.reason}</div>}
              </td>
              <td>{t.rework_qty ?? '—'}</td>
              <td>{t.supplier || '—'}</td>
              <td>{formatDateShort(t.planned_date) || '—'}</td>
              <td>{t.responsible || '—'}</td>
              <td>
                <select
                  className={styles.select}
                  value={t.status}
                  onChange={(e) => onUpdate(t.id, { status: e.target.value })}
                  aria-label={`Статус задачи ${t.material_name}`}
                >
                  {Object.entries(PROCUREMENT_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FabricPurchasing() {
  const {
    orders, loading, loaded, loadAll, addMaterial, updateMaterial,
    confirmStockMaterial, updateProcurementTask,
  } = useErpStore(
      useShallow((s) => ({
        orders: s.orders,
        loading: s.loading,
        loaded: s.loaded,
        loadAll: s.loadAll,
        addMaterial: s.addMaterial,
        updateMaterial: s.updateMaterial,
        confirmStockMaterial: s.confirmStockMaterial,
        updateProcurementTask: s.updateProcurementTask,
      })),
    );
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  /** Активные заказы (для счётчика «N из M») */
  const active = useMemo(() => orders.filter((o) => o.status === 'active'), [orders]);

  /** Отфильтрованные заказы: чекбокс непришедших + поиск по заказу/№/материалу */
  const rows = useMemo(() => {
    let list = active;
    if (onlyWaiting) {
      list = list.filter((o) =>
        o.materials.some(
          (m) => m.status !== 'received' && m.status !== 'not_needed' && m.status !== 'reserved'));
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((o) =>
        o.title.toLowerCase().includes(q) ||
        (o.bitrix_id || '').includes(q) ||
        o.materials.some((m) => m.name.toLowerCase().includes(q)));
    }
    return list;
  }, [active, onlyWaiting, query]);

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
        <input
          type="search"
          className={`${styles.input} ${styles.searchInput}`}
          placeholder="Поиск: заказ, № сделки, материал"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск по закупке"
        />
        <div className={styles.spacer} />
        <span className={styles.subText}>{rows.length} из {active.length}</span>
      </div>

      {loading && !loaded && <div className={styles.emptyState}>Загрузка…</div>}
      {loaded && rows.length === 0 && (
        <div className={styles.emptyState}>Нет активных заказов с материалами.</div>
      )}

      {rows.map((order) => {
        const blocking = materialsBlockStage(order.materials, 'cutting');
        return (
          <section
            key={order.id}
            className={`${styles.matSection} ${blocking ? styles.matSectionBlocked : ''}`}
          >
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
                      <th>Тип</th><th>Материал</th><th>Источник</th><th>Поставщик</th><th>Кол-во</th>
                      <th>План прихода</th><th>Статус</th><th>Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.materials.map((m) => (
                      <tr key={m.id}>
                        <td>{KIND_LABELS[m.kind]}</td>
                        <td>{m.name}{m.notes && <div className={styles.subText}>{m.notes}</div>}</td>
                        <td>{SOURCE_LABELS[m.source]}</td>
                        <td>{m.supplier || '—'}</td>
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
                          {(() => {
                            // SLA первичной обработки (правка 6): только для закупаемых
                            const sla = m.source === 'purchase'
                              ? procurementSla(m.created_at, m.status)
                              : null;
                            if (!sla) return null;
                            return (
                              <div className={`${styles.chip} ${sla === 'overdue' ? styles.chipBlocked : styles.chipWaiting}`}>
                                {sla === 'overdue' ? 'Просрочено' : 'На обработке'}
                              </div>
                            );
                          })()}
                        </td>
                        <td>
                          {m.source === 'stock' && m.status === 'pending' ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => confirmStockMaterial(m.id)}
                            >
                              Подтвердить наличие
                            </button>
                          ) : (
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
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <AddMaterialRow orderId={order.id} onAdd={addMaterial} />

            <ProcurementTasksBlock order={order} onUpdate={updateProcurementTask} />
          </section>
        );
      })}
    </>
  );
}
