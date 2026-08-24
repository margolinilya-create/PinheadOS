import { formatDateShort } from '../../utils/time';
import { isOrderReadyToShip, shipBlockReason } from '../../utils/stageUi';
import { PACK_SHIP_STATUS_LABELS, WAREHOUSE_OP_LABELS } from '../../types';
import styles from '../../styles';
import { Button } from '../../components/Button';

/**
 * Задача склада «Упаковка и отгрузка» — ОДНА карточка на весь остаток пути
 * заказа (правка заказчика 23.08, п. 4).
 *
 * ЦЕПОЧКА: На упаковке → [Упаковано] → Готово к отгрузке → [Отгрузить]
 *          → Отгружено. Два статуса и два действия, больше здесь ничего нет.
 *
 * ЧТО СНЯТО И ПОЧЕМУ. Было шесть статусов и пять кнопок, из них две первые —
 * «Принять на упаковку» и «На упаковку» — повторяли отдельную задачу
 * «Приёмка ГП»: задача заводится под условием `erp_can_pack_ship`, а та
 * требует принятой приёмки, то есть карточка рождается уже принятой. Заказчик
 * прямо запретил промежуточные кнопки вроде «Начать упаковку» и «отдельные
 * карточки на каждый переход». Стейт-машина снята миграцией 20260823170000
 * ВМЕСТЕ с обоими серверными писателями.
 *
 * ИСТОРИЯ СВЁРНУТА (п. 4.6): предыдущие операции не должны конкурировать
 * с текущим рабочим действием. `<details>` — нативный: клавиатура
 * и скринридер работают без строчки JS (то же решение, что у уведомлений).
 *
 * СТАТУС НАЗЫВАЕТСЯ ОДИН РАЗ (п. 4.7). Раньше он стоял и чипом в шапке,
 * и словами в подписи следующей кнопки («Готово к отгрузке» как ДЕЙСТВИЕ),
 * из-за чего одно и то же состояние называлось двумя способами подряд.
 */

/** Следующий статус и подпись действия, которое туда ведёт */
const NEXT = {
  packing: { to: 'ready_to_ship', label: 'Упаковано' },
  ready_to_ship: { to: 'shipped', label: 'Отгрузить' },
};

export function PackShipCard({ order, task, onAdvance }) {
  const next = NEXT[task.status];
  const isShipStep = task.status === 'ready_to_ship';
  const shipReady = isOrderReadyToShip(order);
  const blockReason = shipBlockReason(order);
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

      {next && (
        <div className={styles.checkRow}>
          <Button
            variant="primary"
            disabled={isShipStep && !shipReady}
            title={isShipStep && !shipReady ? (blockReason ?? 'Заказ ещё не готов к отгрузке') : undefined}
            onClick={() => onAdvance(task.id, next.to)}
          >
            {next.label}
          </Button>
          {/* Кладовщику видна конкретная причина, а не просто отсутствие кнопки */}
          {isShipStep && !shipReady && (
            <span className={styles.subText}>{blockReason ?? 'Не все этапы/материалы готовы'}</span>
          )}
        </div>
      )}

      {ops.length > 0 && (
        <details className={styles.matSection}>
          <summary>История операций — {ops.length}</summary>
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
        </details>
      )}
    </section>
  );
}
