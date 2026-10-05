import { useMemo } from 'react';
import { OrderLink } from '../../components/OrderLink';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { SortableTh } from '../../components/SortableTh';
import { sortRows, useTableSort } from '../../utils/tableSort';
import {
  PROCUREMENT_CAUSE_LABELS, PROCUREMENT_KIND_LABELS, PROCUREMENT_STATUS_LABELS,
} from '../../types';
import styles from '../../styles';

/**
 * Дозакупки и замены по браку — отдельной таблицей под рабочей областью.
 *
 * Вынесена из `FabricPurchasing.jsx` 05.10 (правка п. 6): экран стоял
 * на потолке ратчета размера, а таблица самостоятельна — своя сортировка,
 * свои строки (`procurement_tasks`), ни одного общего состояния с карточкой.
 */

function procurementSortValue({ order, t }, key) {
  switch (key) {
    case 'order': return order.bitrix_id || order.title;
    case 'material': return t.material_name;
    case 'kind': return PROCUREMENT_KIND_LABELS[t.kind];
    case 'cause': return PROCUREMENT_CAUSE_LABELS[t.cause_type];
    case 'supplier': return t.supplier;
    case 'status': return PROCUREMENT_STATUS_LABELS[t.status];
    default: return null;
  }
}

export function ProcurementTasksTable({ orders, onUpdate }) {
  const { sort, toggle } = useTableSort();
  const rows = useMemo(
    () => orders.flatMap((o) => (o.procurement_tasks ?? []).map((t) => ({ order: o, t }))),
    [orders],
  );
  const sorted = useMemo(() => sortRows(rows, sort, procurementSortValue), [rows, sort]);
  if (rows.length === 0) return null;

  return (
    <div className={styles.matSection}>
      <div className={styles.fieldLabel}>Дозакупки / замены ({rows.length})</div>
      <ScrollHintBox className={styles.tableWrap} label="Дозакупки и замены">
        <table className={styles.table}>
          <thead>
            <tr>
              <SortableTh sortKey="order" sort={sort} onSort={toggle} label="№ заказа">№</SortableTh>
              <SortableTh sortKey="material" sort={sort} onSort={toggle}>Материал</SortableTh>
              <SortableTh sortKey="kind" sort={sort} onSort={toggle}>Тип</SortableTh>
              <SortableTh sortKey="cause" sort={sort} onSort={toggle}>Причина</SortableTh>
              <SortableTh sortKey="supplier" sort={sort} onSort={toggle}>Поставщик</SortableTh>
              <SortableTh sortKey="status" sort={sort} onSort={toggle}>Статус</SortableTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ order, t }) => (
              <tr key={t.id}>
                <td>
                  <OrderLink orderId={order.id} title={`Открыть заказ №${order.bitrix_id || '—'}`}>
                    №{order.bitrix_id || '—'}
                  </OrderLink>
                </td>
                <td>{t.material_name}</td>
                <td>
                  {PROCUREMENT_KIND_LABELS[t.kind]}
                  {!t.counts_as_purchase && <div className={styles.subText}>не закупка компании</div>}
                </td>
                <td>{PROCUREMENT_CAUSE_LABELS[t.cause_type]}</td>
                <td>{t.supplier || '—'}</td>
                <td>
                  <select
                    className={styles.select} value={t.status}
                    onChange={(e) => onUpdate(t.id, { status: e.target.value })}
                    aria-label={`Статус задачи ${t.material_name}`}
                  >
                    {Object.entries(PROCUREMENT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollHintBox>
    </div>
  );
}
