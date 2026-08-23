import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { Icon } from '../../components/Icon';
import { OrderLink } from '../../components/OrderLink';
import { pluralize } from '../../../utils/i18n';
import { formatDateShort, procurementSla } from '../../utils/time';
import { MATERIAL_STATUS_LABELS } from '../../types';
import { KIND_LABELS, SOURCE_LABELS, STATUS_VARIANT } from './purchaseLabels';
import styles from '../../styles';

/**
 * Содержимое колонок закупочной строки — ПО ОДНОЙ реализации на элемент.
 *
 * Зачем модуль. Строку закупки показывают две раскладки: таблица из четырнадцати
 * колонок (десктоп) и карточка (планшет, экран пилота). Поля здесь не подписи,
 * а инлайн-правки со своими условиями записи («пиши, только если значение
 * изменилось»), и вторая их копия под карточку разошлась бы с первой в первую же
 * правку — причём молча: обе «работают», просто пишут по-разному.
 *
 * Каждая функция отдаёт СОДЕРЖИМОЕ колонки без обёртки: таблица кладёт его
 * в `<td>`, карточка — в подписанное поле.
 */

/** Номер заказа ссылкой на карточку + название */
export function OrderCell({ order }) {
  return (
    <>
      <OrderLink orderId={order.id} title={`Открыть заказ №${order.bitrix_id || '—'}`}>
        №{order.bitrix_id || '—'}
      </OrderLink>
      <div className={styles.cellSub} title={order.title}>{order.title}</div>
    </>
  );
}

/** Материал: название и его вид/цвет/источник */
export function MaterialCell({ m }) {
  return (
    <>
      <strong>{m.name}</strong>
      <div className={styles.subText}>
        {KIND_LABELS[m.kind]}
        {m.color ? ` · ${m.color}` : ''}
        {m.source !== 'purchase' ? ` · ${SOURCE_LABELS[m.source]}` : ''}
      </div>
    </>
  );
}

/** Сколько нужно — план менеджера */
export function PlanField({ m, onUpdate }) {
  return (
    <input
      type="number" min="0" step="0.01" className={`${styles.input} ${styles.inputSm}`}
      defaultValue={m.qty_expected ?? ''} placeholder="—"
      onBlur={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value);
        if (v !== (m.qty_expected ?? null)) onUpdate(m.id, { qty_expected: v });
      }}
      aria-label={`План ${m.name}`} style={{ maxWidth: 80 }}
    />
  );
}

/**
 * Комментарий МЕНЕДЖЕРА — на чтение: это исходное задание, и правка его
 * закупщиком стёрла бы то, что просили. Свой комментарий закупщик пишет
 * в приёмке.
 */
export function ManagerNote({ m }) {
  return (
    <span className={m.manager_note ? undefined : styles.subText}>
      {m.manager_note || '—'}
    </span>
  );
}

/** Поставщик — не одно поле, а выбор из вариантов (правка 10) */
export function SupplierCell({ m, order, onOpenOptions }) {
  const count = (m.suppliers ?? []).length;
  return (
    <button
      type="button"
      className={styles.supplierCell}
      onClick={() => onOpenOptions({ material: m, order })}
      title={`Варианты поставщиков: ${m.name}`}
    >
      <span className={m.supplier ? undefined : styles.subText}>
        {m.supplier || 'не выбран'}
      </span>
      <span className={styles.subText}>
        {count > 0
          ? `${count} ${pluralize(count, 'вариант', 'варианта', 'вариантов')}`
          : 'добавить вариант'}
      </span>
    </button>
  );
}

export function ArticleField({ m, onUpdate }) {
  return (
    <input
      className={`${styles.input} ${styles.inputSm}`} defaultValue={m.article || ''} placeholder="—"
      onBlur={(e) => {
        const v = e.target.value.trim() || null;
        if (v !== (m.article || null)) onUpdate(m.id, { article: v });
      }}
      aria-label={`Артикул ${m.name}`} style={{ maxWidth: 110 }}
    />
  );
}

export function QtyOrderedField({ m, onUpdate }) {
  return (
    <input
      type="number" min="0" step="any" className={`${styles.input} ${styles.inputSm}`}
      defaultValue={m.qty_ordered ?? ''} placeholder="—"
      onBlur={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value);
        if (v !== (m.qty_ordered ?? null)) onUpdate(m.id, { qty_ordered: v });
      }}
      aria-label={`Сколько заказано ${m.name}`} style={{ maxWidth: 90 }}
    />
  );
}

export function PriceField({ m, onUpdate }) {
  return (
    <input
      type="number" min="0" step="any" className={`${styles.input} ${styles.inputSm}`}
      defaultValue={m.price_per_unit ?? ''} placeholder="—"
      onBlur={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value);
        if (v !== (m.price_per_unit ?? null)) onUpdate(m.id, { price_per_unit: v });
      }}
      aria-label={`Цена за единицу ${m.name}`} style={{ maxWidth: 90 }}
    />
  );
}

/**
 * Стоимость СЧИТАЕТСЯ, а не хранится: производная от двух полей рядом с ними —
 * это второй писатель одного числа.
 */
export function CostValue({ m }) {
  if (m.qty_ordered == null || m.price_per_unit == null) return '—';
  return Math.round(m.qty_ordered * m.price_per_unit).toLocaleString('ru-RU');
}

export function OrderedOnField({ m, onUpdate }) {
  return (
    <DateField
      showFormatHint={false}
      value={m.ordered_on || ''}
      onChange={(v) => onUpdate(m.id, { ordered_on: v || null })}
      aria-label={`Дата заказа ${m.name}`}
    />
  );
}

export function EtaField({ m, onUpdate }) {
  return (
    <DateField
      showFormatHint={false}
      value={m.eta_date || ''}
      onChange={(v) => onUpdate(m.id, { eta_date: v || null })}
      aria-label={`План прихода ${m.name}`}
    />
  );
}

/** Приход ведёт журнал приёмок — здесь только чтение */
export function ReceivedValue({ m }) {
  if (m.qty_received != null) return `${m.qty_received}${m.unit ? ` ${m.unit}` : ''}`;
  return m.received_at ? formatDateShort(m.received_at) : '—';
}

/**
 * С кого спрашивать, пока материала нет. Показывается цеху в карточке
 * «Ожидают материалы» — `accepted_by` для этого не годится: он заполняется
 * уже после приёмки.
 */
export function ResponsibleField({ m, onUpdate }) {
  return (
    <input
      className={`${styles.input} ${styles.inputSm}`} defaultValue={m.responsible || ''} placeholder="—"
      onBlur={(e) => {
        const v = e.target.value.trim() || null;
        if (v !== (m.responsible || null)) onUpdate(m.id, { responsible: v });
      }}
      aria-label={`Ответственный за получение ${m.name}`} style={{ maxWidth: 120 }}
    />
  );
}

/** Статус подписью + отметка SLA закупки */
export function StatusCell({ m }) {
  const sla = m.source === 'purchase' ? procurementSla(m.created_at, m.status) : null;
  return (
    <>
      <Badge variant={STATUS_VARIANT[m.status] || 'neutral'}>{MATERIAL_STATUS_LABELS[m.status]}</Badge>
      {sla && (
        <div className={styles.subText}>
          {sla === 'overdue'
            ? <span className={styles.cellWithIcon}><Icon name="alert" size={13} /> просрочено</span>
            : 'на обработке'}
        </div>
      )}
    </>
  );
}

/** Действие: подтверждение наличия со склада либо смена статуса */
export function StatusControl({ m, onConfirmStock, onSetStatus }) {
  if (m.source === 'stock' && m.status === 'pending') {
    return <Button variant="secondary" onClick={() => onConfirmStock(m.id)}>Наличие</Button>;
  }
  return (
    <select
      className={styles.select} value={m.status}
      onChange={(e) => onSetStatus(m, e.target.value)}
      aria-label={`Статус ${m.name}`}
    >
      {Object.entries(MATERIAL_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
