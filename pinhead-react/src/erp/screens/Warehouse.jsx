import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { useErpStore } from '../store/useErpStore';
import { formatDateShort } from '../utils/time';
import {
  MATERIAL_ACCEPT_LABELS,
  MATERIAL_STATUS_LABELS,
  WAREHOUSE_OP_LABELS,
} from '../types';
import styles from '../erp.module.css';

/**
 * Склад (правки 2, 3): приёмка материалов с числовой сверкой план/факт и статусом,
 * плюс история складских операций (упаковка, отгрузка, маркировки). Заказ попадает
 * сюда после закупки; закрой заблокирован до завершения приёмки (гейт в routes.ts).
 */

const KIND_LABELS = {
  fabric: 'Ткань', hardware: 'Фурнитура', labels: 'Бирки/этикетки', packaging: 'Упаковка', other: 'Прочее',
};

const ACCEPT_CHIP = {
  accepted_full: 'chipReady',
  accepted_partial: 'chipProgress',
  shortage: 'chipBlocked',
  mismatch: 'chipBlocked',
  rejected: 'chipBlocked',
};

/** Материал ждёт приёмки: пришёл, но склад ещё не провёл (или отклонил) приёмку */
function awaitsAcceptance(m) {
  if (m.status !== 'received') return false;
  return m.accept_status !== 'accepted_full' && m.accept_status !== 'accepted_partial';
}

/** Строка приёмки одного материала (числовая сверка план/факт + статус + комментарий) */
function AcceptRow({ material, onUpdateMaterial, onAccept }) {
  const done = !awaitsAcceptance(material) && material.accept_status;
  const [received, setReceived] = useState(material.qty_received ?? '');
  const [status, setStatus] = useState(material.accept_status ?? 'accepted_full');
  const [comment, setComment] = useState(material.accept_comment ?? '');
  const [saving, setSaving] = useState(false);

  const accept = async () => {
    setSaving(true);
    await onAccept(material.id, {
      qty_received: received === '' ? null : Number(received),
      accept_status: status,
      accept_comment: comment.trim() || null,
    });
    setSaving(false);
  };

  return (
    <tr>
      <td>
        <strong>{material.name}</strong>
        <div className={styles.subText}>{KIND_LABELS[material.kind]} · {MATERIAL_STATUS_LABELS[material.status]}</div>
      </td>
      <td>
        <input
          type="number" min="0" className={`${styles.input} ${styles.inputSm}`} style={{ maxWidth: 90 }}
          defaultValue={material.qty_expected ?? ''}
          placeholder="план"
          aria-label={`План поступления ${material.name}`}
          onBlur={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value);
            if (v !== (material.qty_expected ?? null)) onUpdateMaterial(material.id, { qty_expected: v });
          }}
        />
      </td>
      <td>
        <input
          type="number" min="0" className={`${styles.input} ${styles.inputSm}`} style={{ maxWidth: 90 }}
          value={received} placeholder="факт"
          aria-label={`Фактически поступило ${material.name}`}
          onChange={(e) => setReceived(e.target.value)}
        />
      </td>
      <td>
        <select
          className={styles.select} value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={`Статус приёмки ${material.name}`}
        >
          {Object.entries(MATERIAL_ACCEPT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </td>
      <td>
        <input
          className={styles.input} style={{ maxWidth: 160 }} placeholder="Комментарий"
          value={comment} onChange={(e) => setComment(e.target.value)}
          aria-label={`Комментарий приёмки ${material.name}`}
        />
      </td>
      <td>
        {done && (
          <span className={`${styles.chip} ${styles[ACCEPT_CHIP[material.accept_status]]}`}>
            {MATERIAL_ACCEPT_LABELS[material.accept_status]}
            {material.accepted_at ? ` · ${formatDateShort(material.accepted_at)}` : ''}
          </span>
        )}
        <button type="button" className="btn btn-primary" disabled={saving} onClick={accept}>
          {done ? 'Обновить приёмку' : 'Принять'}
        </button>
      </td>
    </tr>
  );
}

/** История склада + действия упаковки/отгрузки/маркировки */
function WarehouseOpsBlock({ order, onLogOp }) {
  const ops = order.warehouse_ops ?? [];
  const log = (op_type) => onLogOp(order.id, { op_type });
  return (
    <div className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <strong>История склада</strong>
        <span className={styles.checkRow}>
          <button type="button" className="btn btn-secondary" onClick={() => log('packaging')}>📦 Упаковка</button>
          <button type="button" className="btn btn-secondary" onClick={() => log('shipment')}>🚚 Отгрузка</button>
          <button type="button" className="btn btn-secondary" onClick={() => log('marking')}>🏷 Маркировка</button>
        </span>
      </div>
      {ops.length === 0 ? (
        <div className={styles.subText}>Складских операций пока нет.</div>
      ) : (
        <ul className={styles.tzMatList}>
          {[...ops].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map((op) => (
            <li key={op.id}>
              {WAREHOUSE_OP_LABELS[op.op_type] || op.op_type}
              {op.qty != null ? ` · ${op.qty}` : ''}
              <span className={styles.subText}>
                {' — '}{formatDateShort(op.created_at)}{op.actor ? ` · ${op.actor}` : ''}
                {op.note ? ` · ${op.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Warehouse() {
  const {
    orders, loaded, loadError, loadAll, updateMaterial, acceptMaterial, logWarehouseOp,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      updateMaterial: s.updateMaterial,
      acceptMaterial: s.acceptMaterial,
      logWarehouseOp: s.logWarehouseOp,
    })),
  );
  const [query, setQuery] = useState('');
  const [onlyPending, setOnlyPending] = useState(true);

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (o.status !== 'active') return false;
      if (o.materials.length === 0) return false;
      if (onlyPending && !o.materials.some(awaitsAcceptance)) return false;
      if (q) {
        const match =
          o.title.toLowerCase().includes(q) ||
          (o.bitrix_id || '').includes(q) ||
          o.materials.some((m) => m.name.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [orders, query, onlyPending]);

  return (
    <>
      <PageHead
        title="Склад"
        sub="Приёмка материалов (план/факт), история складских операций, упаковка и отгрузка."
      />

      <div className={styles.toolbar}>
        <input
          type="search"
          className={`${styles.input} ${styles.searchInput}`}
          placeholder="Поиск: заказ, № сделки, материал"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск заказов на складе"
        />
        <label className={styles.checkRow}>
          <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
          <span className={styles.subText}>Только ожидающие приёмки</span>
        </label>
        <div className={styles.spacer} />
        <span className={styles.subText}>{rows.length} заказов</span>
      </div>

      {loadError && !loaded && (
        <div className={styles.emptyState}>
          Не удалось загрузить данные.{' '}
          <button type="button" className="btn btn-secondary" onClick={() => loadAll()}>Повторить</button>
        </div>
      )}
      {loaded && rows.length === 0 && (
        <div className={styles.emptyState}>
          {onlyPending ? 'Нет заказов, ожидающих приёмки.' : 'Нет активных заказов с материалами.'}
        </div>
      )}

      {rows.map((order) => (
        <section key={order.id} className={styles.matSection}>
          <div className={styles.matSectionHead}>
            <div>
              <strong>№{order.bitrix_id || '—'} · {order.title}</strong>
              {order.manager && <span className={styles.subText}> · {order.manager}</span>}
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Материал</th><th>План</th><th>Факт</th><th>Статус приёмки</th><th>Комментарий</th><th>Действие</th></tr>
              </thead>
              <tbody>
                {order.materials.map((m) => (
                  <AcceptRow
                    key={m.id}
                    material={m}
                    onUpdateMaterial={updateMaterial}
                    onAccept={acceptMaterial}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <WarehouseOpsBlock order={order} onLogOp={logWarehouseOp} />
        </section>
      ))}
    </>
  );
}
