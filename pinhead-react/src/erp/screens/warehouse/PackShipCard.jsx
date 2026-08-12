import { formatDateShort } from '../../utils/time';
import { shipGateState } from '../../utils/stageUi';
import { useErpStore } from '../../store/useErpStore';
import { PACK_SHIP_STATUS_LABELS, WAREHOUSE_OP_LABELS } from '../../types';
import styles from '../../erp.module.css';
import { Button } from '../../components/Button';

/**
 * Задача склада «Упаковка и отгрузка»: авто-создаётся, когда все этапы заказа завершены.
 * Ожидает приёмки → Принято → На упаковке → Упаковано → Готово к отгрузке → Отгружено.
 * Отгрузка — единственное место, откуда заказ уходит в архив (advanceWarehouseTask → shipOrder).
 */

const FLOW = ['awaiting_receipt', 'accepted', 'packing', 'packed', 'ready_to_ship', 'shipped'];
const NEXT_LABEL = {
  awaiting_receipt: 'Принять на упаковку',
  accepted: 'На упаковку',
  packing: 'Упаковано',
  packed: 'Готово к отгрузке',
  ready_to_ship: 'Отгрузить',
};

export function PackShipCard({ order, task, onAdvance }) {
  const idx = FLOW.indexOf(task.status);
  const next = FLOW[idx + 1];
  const isShipStep = task.status === 'ready_to_ship';
  // Снятие проверки отгрузки (аварийный режим) обязано доходить до КНОПКИ,
  // а не только до `shipOrder`: иначе директор снял блокировку, а кладовщик
  // по-прежнему видит `disabled` и «Не все этапы/материалы готовы».
  const bypasses = useErpStore((s) => s.bypasses);
  const { canShip: shipReady, blockReason, bypassed } = shipGateState(order, bypasses);
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
          <Button
            variant={isShipStep ? 'primary' : 'secondary'}
            disabled={isShipStep && !shipReady}
            title={isShipStep && !shipReady ? (blockReason ?? 'Заказ ещё не готов к отгрузке') : undefined}
            onClick={() => onAdvance(task.id, next)}
          >
            {NEXT_LABEL[task.status]}
          </Button>
          {/* Кладовщику видна конкретная причина, а не просто отсутствие кнопки */}
          {isShipStep && !shipReady && (
            <span className={styles.subText}>{blockReason ?? 'Не все этапы/материалы готовы'}</span>
          )}
          {/* Снятая блокировка объясняется прямо здесь: молча снятая проверка —
              тот же дефект, только необъяснимый */}
          {isShipStep && bypassed && (
            <span className={styles.subText}>Проверка готовности снята вручную</span>
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
