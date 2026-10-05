import { memo, useState } from 'react';
import styles from '../../styles';
import {
  EtaField, MaterialCell, PlanField, PriceField, QtyOrderedField,
  ReceivedQty, StatusCell, StatusControl, SupplierCell,
} from './PurchaseFields';
import { PURCHASE_FIELD_LABELS, PURCHASE_GROUPS, pricePerUnitLabel } from './purchaseLabels';
import { PurchaseRowDetails } from './PurchaseRowDetails';
import { ReceiptButton } from './ReceiptButton';
import { useDictionary } from '../../store/useDictionary';

/**
 * Строка закупки карточкой вместо строки таблицы — компактная раскладка
 * (планшет и телефон).
 *
 * Что сохранено буквально: разделение на две группы полей («Потребность —
 * задал менеджер» / «Факт — ведёт закупка»). Пока групп не было, обе роли
 * писали в общий список, и «нужно было 100 м → закупили 110» показать было
 * нечем.
 *
 * С ПРАВКИ 05.10 (п. 6) состав тот же, что у строки таблицы: материал и цвет,
 * поставщик, три количества («нужно по заказу / заказано поставщику /
 * принято складом»), цена, срок прихода, статус и действие — включая
 * переход к приёмке (п. 7). Артикул, источник, параметры ткани, сумма
 * и поставки — в «Подробностях», теми же `PurchaseRowDetails`, что
 * раскрывает таблица.
 *
 * Сами поля берутся из `PurchaseFields` — тех же, что рисует таблица.
 */
function PurchaseRowCardBase({ order, m, onUpdate, onOpenOptions, onConfirmStock, onSetStatus }) {
  const units = useDictionary('unit');
  /** Подробности монтируются только раскрытыми: внутри — чтение журнала поставок */
  const [more, setMore] = useState(false);
  const field = (label, content) => (
    <span className={styles.dataCardField}>
      <span className={styles.dataCardFieldLabel}>{label}</span>
      {content}
    </span>
  );
  return (
    <article className={styles.dataCard} aria-label={`Закупка: ${m.name} для заказа ${order.title}`}>
      <div className={styles.dataCardHead}>
        <span><MaterialCell m={m} /></span>
        <StatusCell m={m} />
      </div>

      <div className={styles.dataCardRow}>
        <span className={styles.dataCardGroup}>{PURCHASE_GROUPS[0].label}</span>
        <div className={styles.dataCardFields}>
          {field(PURCHASE_FIELD_LABELS.qtyExpected, <PlanField m={m} onUpdate={onUpdate} />)}
        </div>
      </div>

      <div className={styles.dataCardRow}>
        <span className={styles.dataCardGroup}>{PURCHASE_GROUPS[1].label}</span>
        <div className={styles.dataCardFields}>
          {field('Поставщик', <SupplierCell m={m} order={order} onOpenOptions={onOpenOptions} />)}
          {field(PURCHASE_FIELD_LABELS.qtyOrdered, <QtyOrderedField m={m} onUpdate={onUpdate} />)}
          {field(PURCHASE_FIELD_LABELS.qtyReceived, <span><ReceivedQty m={m} /></span>)}
          {/* Подпись цены — у ЕДИНИЦЫ материала той же функцией, что в таблице
              и в модалке (правка 21.09, п. 1) */}
          {field(pricePerUnitLabel(m.unit, units), <PriceField m={m} onUpdate={onUpdate} note />)}
          {field('Срок прихода', <EtaField m={m} onUpdate={onUpdate} />)}
        </div>
      </div>

      <div className={styles.purchaseActions}>
        <StatusControl m={m} onConfirmStock={onConfirmStock} onSetStatus={onSetStatus} />
        <ReceiptButton order={order} m={m} block />
      </div>

      <details className={styles.gridDetails} onToggle={(e) => setMore(e.currentTarget.open)}>
        <summary>Подробности</summary>
        {more && <PurchaseRowDetails m={m} onUpdate={onUpdate} />}
      </details>
    </article>
  );
}

/** Элемент длинного списка: memo отсекает перерисовку при изменениях соседей */
export const PurchaseRowCard = memo(PurchaseRowCardBase);
