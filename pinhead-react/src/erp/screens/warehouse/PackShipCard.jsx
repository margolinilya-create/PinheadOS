import { formatDateShort } from '../../utils/time';
import { isOrderReadyToShip } from '../../utils/stageUi';
import { PACK_SHIP_STATUS_LABELS, WAREHOUSE_OP_LABELS } from '../../types';
import styles from '../../erp.module.css';

/**
 * Задача склада «Упаковка и отгрузка»: авто-создаётся, когда все этапы заказа завершены.
 * Ожидает приёмки → Принято → На упаковке → Упаковано → Готово к отгрузке → Отгружено.
 * Отгрузка — единственное место, откуда заказ уходит в архив (advanceWarehouseTask → shipOrder).
 */

const FLOW = ['awaiting_receipt', 'accepted', 'packing', 'packed', 'ready_to_ship', 'shipped'];
const NEXT_LABEL = {
  awaiting_receipt: 'Принять',
  accepted: 'На упаковку',
  packing: 'Упаковано',
  packed: 'Готово к отгрузке',
  ready_to_ship: 'Отгрузить',
};

export function PackShipCard({ order, task, onAdvance }) {
  const idx = FLOW.indexOf(task.status);
  const next = FLOW[idx + 1];
  const isShipStep = task.status === 'ready_to_ship';
  const shipReady = isOrderReadyToShip(order);
  const ops = [...(order.warehouse_ops ?? [])]
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <span className={styles.subText}>Упаковка и отгрузка</span>
          <div><strong>№{order.bitrix_id || '—'} · {order.title}</strong></div>
        </div>
        <span className={`${styles.chip} ${task.status === 'shipped' ? styles.chipDone : styles.chipProgress}`}>
          {PACK_SHIP_STATUS_LABELS[task.status]}
        </span>
      </div>

      {task.status !== 'shipped' && next && (
        <div className={styles.checkRow}>
          <button
            type="button"
            className={isShipStep ? 'btn btn-primary' : 'btn btn-secondary'}
            disabled={isShipStep && !shipReady}
            title={isShipStep && !shipReady ? 'Заказ ещё не готов к отгрузке' : undefined}
            onClick={() => onAdvance(task.id, next)}
          >
            {NEXT_LABEL[task.status]}
          </button>
          {isShipStep && !shipReady && (
            <span className={styles.subText}>Не все этапы/материалы готовы</span>
          )}
        </div>
      )}

      {ops.length > 0 && (
        <ul className={styles.tzMatList}>
          {ops.map((op) => (
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
    </section>
  );
}
