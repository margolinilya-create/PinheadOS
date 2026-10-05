import { Fragment, useState } from 'react';
import { SortableTh } from '../../components/SortableTh';
import { Icon } from '../../components/Icon';
import { useDictionary } from '../../store/useDictionary';
import {
  EtaField, MaterialCell, PriceField, QtyTriple, StatusCell, StatusControl, SupplierCell,
} from './PurchaseFields';
import { PurchaseRowDetails } from './PurchaseRowDetails';
import { ReceiptButton } from './ReceiptButton';
import { pricePerUnitLabel } from './purchaseLabels';
import styles from '../../styles';

/**
 * ТАБЛИЦА МАТЕРИАЛОВ ЗАКУПКИ — БЕЗ ГОРИЗОНТАЛЬНОЙ ПРОКРУТКИ (правка 05.10, п. 6).
 *
 * «Чтобы добраться до статуса и действий, нужно двигать таблицу
 * по горизонтали… В таблице: материал и цвет, поставщик, количества,
 * цена, срок прихода, статус и действие. Убрать горизонтальный скролл».
 *
 * Было четырнадцать колонок в две группы; стало восемь, и статус с переходом
 * к приёмке видны без открытия деталей. Три количества стоят в ОДНОЙ ячейке
 * подписанным столбиком — «нужно / заказано / принято», — а артикул,
 * источник, параметры ткани, сумма, поставки и прочее раскрываются строкой
 * ниже (`PurchaseRowDetails`). Обёртки `ScrollHintBox` здесь нет намеренно:
 * она нужна таблице, которая шире экрана, а эта обязана в него помещаться.
 *
 * Разметка ячеек — те же `PurchaseFields`, что у карточки планшета: две
 * реализации инлайн-правки разошлись бы молча.
 */
export function PurchaseMaterialsTable({
  rows, sort, onSort, onUpdate, onOpenOptions, onConfirmStock, onSetStatus,
}) {
  const units = useDictionary('unit');
  /** Раскрытые строки — по id материала: смена страницы их не путает */
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className={styles.purchaseTableWrap}>
      <table className={`${styles.table} ${styles.purchaseTable}`}>
        <thead>
          <tr>
            <th aria-label="Подробности" />
            <SortableTh sortKey="material" sort={sort} onSort={onSort}>Материал и цвет</SortableTh>
            <SortableTh sortKey="supplier" sort={sort} onSort={onSort}>Поставщик</SortableTh>
            <SortableTh sortKey="plan" sort={sort} onSort={onSort} label="Количество">Количество</SortableTh>
            <th>Цена</th>
            <th>Срок прихода</th>
            <SortableTh sortKey="status" sort={sort} onSort={onSort}>Статус</SortableTh>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ order, m }) => {
            const open = expanded.has(m.id);
            return (
              <Fragment key={m.id}>
                <tr className={open ? styles.rowSelected : undefined}>
                  <td>
                    <button
                      type="button"
                      className={styles.expandBtn}
                      aria-expanded={open}
                      aria-label={`Подробности: ${m.name}`}
                      onClick={() => toggle(m.id)}
                    >
                      <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
                    </button>
                  </td>
                  <td><MaterialCell m={m} /></td>
                  <td><SupplierCell m={m} order={order} onOpenOptions={onOpenOptions} /></td>
                  <td><QtyTriple m={m} onUpdate={onUpdate} /></td>
                  <td>
                    <PriceField m={m} onUpdate={onUpdate} />
                    <div className={styles.subText}>{pricePerUnitLabel(m.unit, units)}</div>
                  </td>
                  <td><EtaField m={m} onUpdate={onUpdate} /></td>
                  <td><StatusCell m={m} /></td>
                  <td>
                    <span className={styles.purchaseActions}>
                      <StatusControl m={m} onConfirmStock={onConfirmStock} onSetStatus={onSetStatus} />
                      <ReceiptButton order={order} m={m} />
                    </span>
                  </td>
                </tr>
                {open && (
                  <tr className={styles.purchaseDetailsRow}>
                    <td colSpan={8}>
                      <PurchaseRowDetails m={m} onUpdate={onUpdate} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
