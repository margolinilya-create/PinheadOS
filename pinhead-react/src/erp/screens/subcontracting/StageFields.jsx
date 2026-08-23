import { DateField } from '../../components/DateField';
import { OrderLink } from '../../components/OrderLink';
import {
  SUBCONTRACT_PHASE_LABELS,
  SUBCONTRACT_PAYMENT_LABELS,
  SUBCONTRACT_MATERIAL_SOURCE_LABELS,
  STAGE_STATUS_LABELS,
} from '../../types';
import { STAGE_CHIP_CLASS } from '../../utils/stageUi';
import { formatDateShort } from '../../utils/time';
import { stageLabel, stageLocation } from '../../utils/outsourcing';
import styles from '../../erp.module.css';

/**
 * Содержимое колонок подрядного этапа — ПО ОДНОЙ реализации на элемент.
 *
 * Зачем модуль. Строку показывают две раскладки: таблица из десяти колонок
 * (десктоп) и карточка (планшет). Половина колонок — не подписи, а инлайн-правки
 * со своими условиями записи (плановая дата возврата, статус оплаты), и вторая
 * их копия под карточку разошлась бы с первой в первую же правку, причём молча:
 * обе «работают», просто пишут по-разному. Тот же приём, что у закупки
 * (`purchasing/PurchaseFields`).
 *
 * Каждая функция отдаёт СОДЕРЖИМОЕ колонки без обёртки: таблица кладёт его
 * в `<td>`, карточка — в подписанное поле.
 */

/** Номер заказа ссылкой на карточку + название */
export function OrderCell({ order }) {
  return (
    <>
      <OrderLink orderId={order.id}>
        <strong>№{order.bitrix_id || '—'}</strong>
      </OrderLink>
      <div className={styles.cellSub} title={order.title || undefined}>
        {order.title || '—'}
      </div>
    </>
  );
}

/** Изделие и его вариант */
export function ItemCell({ item }) {
  return (
    <>
      {item.product_type}
      {item.variant && <div className={styles.subText}>{item.variant}</div>}
    </>
  );
}

/**
 * Количество В РАБОТЕ у подрядчика, а не тираж позиции: на материалах
 * подрядчика мы не передаём ничего, но работа у него есть (правка 22.08, п. 3.8).
 */
export function WorkQtyCell({ item, view }) {
  return (
    <>
      {view.inWorkQty || item.qty || '—'}
      {/* «Швейка закончила 150 → в подряде появляется Варка — Готово
          к передаче — 150 шт» (документ) */}
      {view.readyQty > 0 && (
        <div className={styles.subText}>к передаче: {view.readyQty}</div>
      )}
    </>
  );
}

/** Операция и участок ответственности */
export function OperationCell({ stage, sub, deptName }) {
  return (
    <>
      <strong>{stageLabel(stage, deptName || '—')}</strong>
      <div className={styles.subText}>
        {/* Цех у подрядного этапа означает «чей это участок ответственности» —
            куда работа вернётся */}
        участок: {deptName || '—'}
        {sub && ` · ${SUBCONTRACT_MATERIAL_SOURCE_LABELS[sub.material_source]}`}
      </div>
    </>
  );
}

/** Где заказ сейчас — по ФАКТУ передачи, а не по маршруту */
export function LocationCell({ item, stage, view }) {
  return <span className={styles.subText}>{stageLocation(item, stage, view.display)}</span>;
}

/** Дата передачи и правка плановой даты возврата */
export function DatesCell({ stage, sub, overdue, canManage, onUpdate }) {
  return (
    <>
      <div className={styles.subText}>
        передан: {formatDateShort(sub?.sent_date) || '—'}
      </div>
      <label className={overdue ? styles.overdue : styles.subText}>
        возврат план:{' '}
        <DateField
          showFormatHint={false}
          disabled={!canManage || !sub}
          value={sub?.planned_date || ''}
          onChange={(v) => sub && onUpdate(sub.id, { planned_date: v || null })}
          aria-label={`Плановая дата возврата ${stage.id}`}
          style={{ maxWidth: 130 }}
        />
      </label>
    </>
  );
}

/** Следующий этап маршрута — ответ на «что дальше», а не переход */
export function NextStageCell({ next, deptName }) {
  if (!next) {
    /* Последний этап маршрута: дальше упаковка и отгрузка, а не «заказ готов» —
       это решает склад */
    return <span className={styles.subText}>последний этап маршрута</span>;
  }
  return (
    <>
      <strong>{stageLabel(next, deptName || '—')}</strong>
      <div className={styles.subText}>{STAGE_STATUS_LABELS[next.status]}</div>
    </>
  );
}

/**
 * Состояние подряда, состояние этапа и оплата.
 *
 * Селекта ФАЗЫ здесь нет и быть не должно: им можно было поставить «Завершено»,
 * не передав и не приняв ни одной штуки — счётчики этапа приращает только
 * журнал. Движение — действия в раскрытой карточке.
 */
export function StateCell({
  stage, sub, phase, delayed, phaseChipClass, canManage, onUpdate,
}) {
  return (
    <>
      <span className={`${styles.chip} ${styles[delayed ? 'chipBlocked' : phaseChipClass]}`}>
        {delayed ? 'Задержка' : SUBCONTRACT_PHASE_LABELS[phase]}
      </span>
      <div className={`${styles.chip} ${styles[STAGE_CHIP_CLASS[stage.status]]}`}>
        этап: {STAGE_STATUS_LABELS[stage.status]}
      </div>
      {sub && (
        <select
          className={`${styles.select} ${styles.inputXs}`}
          value={sub.payment_status || 'unpaid'}
          disabled={!canManage}
          onChange={(e) => onUpdate(sub.id, { payment_status: e.target.value })}
          aria-label={`Оплата ${stage.id}`}
          style={{ marginTop: 4 }}
        >
          {Object.entries(SUBCONTRACT_PAYMENT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      )}
    </>
  );
}
