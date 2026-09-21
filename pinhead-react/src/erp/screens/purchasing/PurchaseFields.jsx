import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { Icon } from '../../components/Icon';
import { OrderLink } from '../../components/OrderLink';
import { pluralize } from '../../../utils/i18n';
import { formatDateShort, procurementSla } from '../../utils/time';
import { MATERIAL_STATUS_LABELS } from '../../types';
import { isPurchaserChoosableStatus } from '../../utils/materialStatus';
import { ACCEPTANCE_ISSUE_LABELS, materialAcceptanceIssue } from '../../utils/supply';
import {
  KIND_LABELS, PURCHASE_FIELD_LABELS, SOURCE_LABELS, STATUS_VARIANT,
  pricePerUnitLabel, priceRequiredFor,
} from './purchaseLabels';
import styles from '../../styles';
import { PurchaseSizeTable } from './PurchaseSizeTable';
import { gridCells } from '../../utils/sizeGrid';
import { useDictionary } from '../../store/useDictionary';

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
export function MaterialCell({ m, onUpdate }) {
  /**
   * РАЗБИВКА ГОТОВОГО ИЗДЕЛИЯ ВИДНА ПРЯМО В СТРОКЕ (правка 16.09, п. 2).
   *
   * Документ просит ОДНУ закупку «на 100 футболок с разбивкой внутри»
   * вместо строки на каждый размер. Значит строка обязана эту разбивку
   * показывать — иначе закупщик видит «100 шт» и не знает, каких именно,
   * а ради ответа открывает заказ.
   */
  const cells = gridCells(m.size_grid);
  const ordered = gridCells(m.size_grid_ordered);
  return (
    <>
      <strong>{m.name}</strong>
      <div className={styles.subText}>
        {KIND_LABELS[m.kind]}
        {m.color ? ` · ${m.color}` : ''}
        {m.source !== 'purchase' ? ` · ${SOURCE_LABELS[m.source]}` : ''}
      </div>
      {cells.length > 0 && (
        /*
          ФАКТ ПО РАЗМЕРАМ ПРАВИТСЯ ЗДЕСЬ ЖЕ (правка 20.09, п. 2). Сводка
          строкой остаётся на виду, а таблица разворачивается по требованию:
          в таблице закупки четырнадцать колонок, и развёрнутая матрица
          «цвет × размер» в каждой строке сделала бы экран нечитаемым.

          Без `onUpdate` (печатный лист, чтение) таблица не рисуется вовсе —
          поля ввода на печати бессмысленны.
        */
        <details className={styles.purchaseSizes}>
          <summary className={styles.subText}>
            {cells.map((c) => `${c.size} ${c.qty}`).join(' · ')}
            {ordered.length > 0 ? ' · заказано по размерам' : ''}
          </summary>
          {onUpdate ? (
            <PurchaseSizeTable
              plannedGrid={m.size_grid}
              orderedGrid={m.size_grid_ordered}
              onChange={(grid) => onUpdate(m.id, { size_grid_ordered: grid })}
              caption={`Размеры закупки: ${m.name}`}
            />
          ) : null}
        </details>
      )}
    </>
  );
}

/** Сколько нужно — план менеджера */
export function PlanField({ m, onUpdate }) {
  /**
   * У ЗАКУПКИ С РАЗМЕРНОЙ СЕТКОЙ ПОТРЕБНОСТЬ НЕ ПРАВИТСЯ РУКАМИ.
   *
   * Сумма по размерам и «общая потребность» — одно число, и его считает
   * триггер `erp_material_grid_qty`. Оставить поле редактируемым значило бы
   * завести второго писателя: закупщик вписал бы 90, сервер вернул бы 100,
   * и правка молча «не сохранилась» бы.
   */
  const byGrid = gridCells(m.size_grid).length > 0;
  if (byGrid) {
    return (
      <span className={styles.subText} title="Считается по размерной сетке позиции">
        {m.qty_expected ?? '—'}
      </span>
    );
  }
  return (
    <input
      type="number" min="0" step="0.01" className={`${styles.input} ${styles.inputSm} ${styles.wNum}`}
      defaultValue={m.qty_expected ?? ''} placeholder="—"
      onBlur={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value);
        if (v !== (m.qty_expected ?? null)) onUpdate(m.id, { qty_expected: v });
      }}
      aria-label={`${PURCHASE_FIELD_LABELS.qtyExpected}: ${m.name}`}
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
      className={`${styles.input} ${styles.inputSm} ${styles.wQty}`} defaultValue={m.article || ''} placeholder="—"
      onBlur={(e) => {
        const v = e.target.value.trim() || null;
        if (v !== (m.article || null)) onUpdate(m.id, { article: v });
      }}
      aria-label={`Артикул ${m.name}`}
    />
  );
}

export function QtyOrderedField({ m, onUpdate }) {
  return (
    <input
      type="number" min="0" step="any" className={`${styles.input} ${styles.inputSm} ${styles.wNum}`}
      defaultValue={m.qty_ordered ?? ''} placeholder="—"
      onBlur={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value);
        if (v !== (m.qty_ordered ?? null)) onUpdate(m.id, { qty_ordered: v });
      }}
      aria-label={`${PURCHASE_FIELD_LABELS.qtyOrdered}: ${m.name}`}
    />
  );
}

/**
 * Цена подписана ЕДИНИЦЕЙ материала (правка 21.09, п. 1): у ткани в килограммах
 * это «Цена за кг, ₽», у штучной позиции — «за шт». Пустая цена у ткани
 * названа прямо: по ней считается и себестоимость полотна, и стоимость
 * возвратного остатка, и прочерк там читается как «бесплатно».
 */
export function PriceField({ m, onUpdate }) {
  const units = useDictionary('unit');
  const label = pricePerUnitLabel(m.unit, units);
  const missing = priceRequiredFor(m.kind) && m.price_per_unit == null;
  return (
    <input
      type="number" min="0" step="any"
      className={`${styles.input} ${styles.inputSm} ${styles.wNum}`
        + `${missing ? ` ${styles.inputError}` : ''}`}
      defaultValue={m.price_per_unit ?? ''} placeholder={missing ? 'нужна' : '—'}
      aria-invalid={missing || undefined}
      onBlur={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value);
        if (v !== (m.price_per_unit ?? null)) onUpdate(m.id, { price_per_unit: v });
      }}
      aria-label={`${label}: ${m.name}`}
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
  /**
   * ПРИНЯТО ПОКАЗЫВАЕТСЯ ПРОТИВ ПЛАНА (обход 04.09). Одно «40» не отвечает
   * на вопрос закупщика — довезли или нет; «40 из 42» отвечает. План здесь
   * уже есть в соседней колонке, но в компактной карточке колонок нет,
   * а именно с планшета с закупкой и работают.
   */
  if (m.qty_received != null) {
    const unit = m.unit ? ` ${m.unit}` : '';
    const need = Number(m.qty_expected ?? 0);
    return need > 0
      ? `${m.qty_received} из ${m.qty_expected}${unit}`
      : `${m.qty_received}${unit}`;
  }
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
      className={`${styles.input} ${styles.inputSm} ${styles.wQty}`} defaultValue={m.responsible || ''} placeholder="—"
      onBlur={(e) => {
        const v = e.target.value.trim() || null;
        if (v !== (m.responsible || null)) onUpdate(m.id, { responsible: v });
      }}
      aria-label={`Ответственный за получение ${m.name}`}
    />
  );
}

/**
 * Статус подписью + вердикт склада + отметка SLA закупки.
 *
 * ВЕРДИКТ СКЛАДА ЖИВЁТ ЗДЕСЬ, ПОТОМУ ЧТО ЗДЕСЬ ЕГО ЖДУТ (обход 04.09).
 * Приёмка ставит `status = 'received'` при ЛЮБОМ исходе — и при недостаче,
 * и при пересорте, и при отказе, — поэтому строка закупки показывала
 * «Пришло» одинаково во всех случаях. Кладовщик записывал расхождение
 * и комментарий, а закупщик не видел ни того, ни другого: обратной связи
 * склад → закупка не было вовсе.
 *
 * Компонент один на таблицу и на карточку планшета — второй экземпляр
 * вердикта разошёлся бы с первым молча.
 */
export function StatusCell({ m }) {
  const sla = m.source === 'purchase' ? procurementSla(m.created_at, m.status) : null;
  const issue = materialAcceptanceIssue(m);
  /** Что фактически привезли — спрашивается только при пересорте */
  const fact = [m.fact_name, m.fact_article, m.fact_color].filter(Boolean).join(' · ');
  return (
    <>
      <Badge variant={STATUS_VARIANT[m.status] || 'neutral'}>{MATERIAL_STATUS_LABELS[m.status]}</Badge>
      {issue && (
        <div className={styles.subText}>
          <span className={styles.cellWithIcon}>
            <Icon name="alert" size={13} /> {ACCEPTANCE_ISSUE_LABELS[issue]}
          </span>
          {issue === 'mismatch' && fact && <div>привезли: {fact}</div>}
          {m.accept_comment && <div>«{m.accept_comment}»</div>}
        </div>
      )}
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

/**
 * Действие: подтверждение наличия со склада либо смена статуса.
 *
 * ОСНОВНОЙ СЦЕНАРИЙ ЗАКУПКИ (правка заказчика 12.09, п. 8):
 * «Не заказано» → «Заказано» → «В пути».
 *
 * «ЗАКАЗАНО» СНОВА ВЫБИРАЕТСЯ РУКАМИ. С 24.08 пункт был погашен: статус
 * ставился по факту оформления — заполненными «Количество к заказу» и «Дата
 * заказа». Заказчик это решение отменил, и подстановка (`autoOrderedStatus`)
 * ОСТАЛАСЬ: она по-прежнему переводит материал в «Заказано», когда оба поля
 * заполнены, но теперь это подсказка, а не единственный путь. Одно другому
 * не мешает — подстановка работает только из «Не заказано».
 *
 * «ПРИШЛО» И «ЧАСТИЧНО» ГАСЯТСЯ ВМЕСТО НЕГО: приход фиксирует склад приёмкой,
 * а не закупщик выбором. Правило — `utils/materialStatus`, там же объяснено,
 * почему убирается ВВОД, а не само значение.
 *
 * Погашенный пункт остаётся видимым и подписанным, а не исчезает: пропавшая
 * строка читается как поломка списка, и человек ищет её вместо того, чтобы
 * понять, кто теперь ставит статус. Уже принятый материал показывает своё
 * значение — иначе селект открылся бы пустым.
 */
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
      {Object.entries(MATERIAL_STATUS_LABELS).map(([v, l]) => {
        const byWarehouse = !isPurchaserChoosableStatus(v) && m.status !== v;
        return (
          <option key={v} value={v} disabled={byWarehouse}>
            {byWarehouse ? `${l} — по приёмке склада` : l}
          </option>
        );
      })}
    </select>
  );
}
