import { useMemo, useRef, useState } from 'react';
import { formatDateShort } from '../../utils/time';
import { isOrderReadyToShip, shipBlockReason } from '../../utils/stageUi';
import { shipmentTotals } from '../../utils/shipment';
import { createAttemptKeeper } from '../../utils/attemptKey';
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
 *
 * ── ЧАСТИЧНАЯ ОТГРУЗКА (правка заказчика 30.08, п. 6) ────────────────────────
 *
 * На шаге отгрузки склад вводит, сколько единиц каждой позиции фактически
 * передано. Поле предзаполнено ОСТАТКОМ: обычный случай — отдают всё, что
 * осталось, и заставлять перепечатывать это число значит собирать ошибки
 * на ровном месте. Отдали меньше — заказ остаётся на складе со статусом
 * «Отгружено частично» и видимым остатком, и отгрузку повторяют.
 *
 * Признака-галочки «Частичная отгрузка» здесь НЕТ, и это осознанно:
 * частичность — не решение человека, а СЛЕДСТВИЕ введённых чисел. Галочка
 * рядом с количествами была бы ровно тем «статусом, выражающим факт, который
 * выбирают вместо того, чтобы вывести», от которого проект уже уходил
 * в подряде и в закупке.
 */

/** Следующий статус и подпись действия, которое туда ведёт */
const NEXT = {
  packing: { to: 'ready_to_ship', label: 'Упаковано' },
  ready_to_ship: { to: 'shipped', label: 'Отгрузить' },
};

export function PackShipCard({ order, task, onAdvance, onShip }) {
  const next = NEXT[task.status];
  const isShipStep = task.status === 'ready_to_ship';
  const shipReady = isOrderReadyToShip(order);
  const blockReason = shipBlockReason(order);
  const ops = [...(order.warehouse_ops ?? [])]
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const totals = useMemo(() => shipmentTotals(order), [order]);
  /** Что вводит склад: ключ позиции → строка ввода (пусто = «не трогали») */
  const [qty, setQty] = useState({});
  const [busy, setBusy] = useState(false);
  /**
   * Ключ идемпотентности живёт в `ref`, а не в состоянии: перерисовка
   * от realtime сбросила бы его ровно в тот момент, когда он нужен, —
   * то же правило, что у приёмки материалов.
   */
  const attempt = useRef(createAttemptKeeper());

  /** Строки к отправке: введённое, иначе остаток */
  const lines = totals.lines
    .map((l) => ({
      item_id: l.item.id,
      qty: qty[l.item.id] === undefined || qty[l.item.id] === ''
        ? l.left
        : Math.min(Math.max(Number(qty[l.item.id]) || 0, 0), l.left),
    }))
    .filter((l) => l.qty > 0);
  const sending = lines.reduce((s, l) => s + l.qty, 0);

  const ship = async () => {
    if (busy || lines.length === 0) return;
    setBusy(true);
    const key = attempt.current.keyFor(JSON.stringify(lines));
    const ok = await onShip?.(order.id, lines, { clientKey: key });
    if (ok) {
      attempt.current.reset();
      setQty({});
    }
    setBusy(false);
  };

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

      {/*
        Сколько уже отдано и сколько осталось — ВСЕГДА на виду, а не только
        после первой частичной отгрузки: это тот самый «остаток», о котором
        просит документ, и склад сверяется с ним до ввода, а не после.
      */}
      {totals.qty > 0 && (
        <div className={styles.subText}>
          Отгружено {totals.shipped} из {totals.qty} шт
          {totals.left > 0 ? ` · осталось ${totals.left} шт` : ' · полностью'}
        </div>
      )}

      {isShipStep && shipReady && totals.left > 0 && (
        <div className={styles.stackTight}>
          {totals.lines.filter((l) => l.left > 0).map((l) => (
            <label key={l.item.id} className={styles.checkRow}>
              <span>
                {l.item.product_type || 'позиция'}
                {l.item.variant ? ` · ${l.item.variant}` : ''}
                <span className={styles.subText}>
                  {' — осталось '}{l.left}{' шт'}
                  {l.shipped > 0 ? ` (отдано ${l.shipped} из ${l.qty})` : ''}
                </span>
              </span>
              <input
                type="number"
                min="0"
                max={l.left}
                className={`${styles.input} ${styles.qtySmallInput}`}
                value={qty[l.item.id] ?? String(l.left)}
                onChange={(e) => setQty((q) => ({ ...q, [l.item.id]: e.target.value }))}
                aria-label={`Передано клиенту, шт — ${l.item.product_type || 'позиция'}`}
              />
            </label>
          ))}
        </div>
      )}

      {next && (
        <div className={styles.checkRow}>
          <Button
            variant="primary"
            disabled={busy || (isShipStep && (!shipReady || lines.length === 0))}
            title={isShipStep && !shipReady ? (blockReason ?? 'Заказ ещё не готов к отгрузке') : undefined}
            onClick={() => (isShipStep ? ship() : onAdvance(task.id, next.to))}
          >
            {/*
              Подпись называет, что именно произойдёт: «Отгрузить всё» и
              «Отгрузить 40 из 100» — разные действия, и кладовщик обязан
              видеть разницу ДО нажатия, а не в тосте после.
            */}
            {isShipStep && sending > 0 && sending < totals.left
              ? `Отгрузить ${sending} из ${totals.left} шт`
              : next.label}
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
