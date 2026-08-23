import { memo } from 'react';
import styles from '../../styles';
import {
  ArticleField, CostValue, EtaField, ManagerNote, MaterialCell, OrderCell,
  OrderedOnField, PlanField, PriceField, QtyOrderedField,
  ReceivedValue, ResponsibleField, StatusCell, StatusControl, SupplierCell,
} from './PurchaseFields';
import { PURCHASE_GROUPS } from './purchaseLabels';

/**
 * Строка закупки карточкой вместо строки таблицы — компактная раскладка
 * (планшет и телефон).
 *
 * Зачем: таблица закупки — ЧЕТЫРНАДЦАТЬ колонок, и на 768px это горизонтальная
 * прокрутка на три экрана. «Закупка» при этом входит в пилот наравне со складом,
 * то есть с планшета с ней и работают.
 *
 * Что сохранено буквально: разделение на две группы полей. В таблице это
 * заголовки групп колонок («Потребность — задал менеджер» / «Факт — ведёт
 * закупка»), здесь — два подписанных блока. Пока групп не было, обе роли писали
 * в общую строку, и «нужно было 100 м → закупили 110» показать было нечем.
 *
 * Сами поля берутся из `PurchaseFields` — тех же, что рисует таблица.
 */
function PurchaseRowCardBase({ order, m, onUpdate, onOpenOptions, onConfirmStock, onSetStatus }) {
  return (
    <article className={styles.dataCard} aria-label={`Закупка: ${m.name} для заказа ${order.title}`}>
      <div className={styles.dataCardHead}>
        <span><OrderCell order={order} /></span>
        <StatusCell m={m} />
      </div>

      <div className={styles.dataCardRow}>
        <span className={styles.dataCardGroup}>{PURCHASE_GROUPS[0].label}</span>
        <div className={styles.dataCardFields}>
          <span className={styles.dataCardField}>
            <span className={styles.dataCardFieldLabel}>Материал</span>
            <span><MaterialCell m={m} /></span>
          </span>
          <span className={styles.dataCardField}>
            <span className={styles.dataCardFieldLabel}>Нужно</span>
            <PlanField m={m} onUpdate={onUpdate} />
          </span>
          <span className={styles.dataCardField}>
            <span className={styles.dataCardFieldLabel}>Комментарий менеджера</span>
            <ManagerNote m={m} />
          </span>
        </div>
      </div>

      <div className={styles.dataCardRow}>
        <span className={styles.dataCardGroup}>{PURCHASE_GROUPS[1].label}</span>
        <div className={styles.dataCardFields}>
          <span className={styles.dataCardField}>
            <span className={styles.dataCardFieldLabel}>Поставщик</span>
            <SupplierCell m={m} order={order} onOpenOptions={onOpenOptions} />
          </span>
          <span className={styles.dataCardField}>
            <span className={styles.dataCardFieldLabel}>Артикул</span>
            <ArticleField m={m} onUpdate={onUpdate} />
          </span>
          <span className={styles.dataCardField}>
            <span className={styles.dataCardFieldLabel}>Заказано</span>
            <QtyOrderedField m={m} onUpdate={onUpdate} />
          </span>
          <span className={styles.dataCardField}>
            <span className={styles.dataCardFieldLabel}>Цена за ед.</span>
            <PriceField m={m} onUpdate={onUpdate} />
          </span>
          <span className={styles.dataCardField}>
            <span className={styles.dataCardFieldLabel}>Стоимость</span>
            <span className={styles.progressCell}><CostValue m={m} /></span>
          </span>
          <span className={styles.dataCardField}>
            <span className={styles.dataCardFieldLabel}>Дата заказа</span>
            <OrderedOnField m={m} onUpdate={onUpdate} />
          </span>
          <span className={styles.dataCardField}>
            <span className={styles.dataCardFieldLabel}>План прихода</span>
            <EtaField m={m} onUpdate={onUpdate} />
          </span>
          <span className={styles.dataCardField}>
            <span className={styles.dataCardFieldLabel}>Приход</span>
            <span><ReceivedValue m={m} /></span>
          </span>
          <span className={styles.dataCardField}>
            <span className={styles.dataCardFieldLabel}>Ответственный</span>
            <ResponsibleField m={m} onUpdate={onUpdate} />
          </span>
        </div>
      </div>

      <StatusControl m={m} onConfirmStock={onConfirmStock} onSetStatus={onSetStatus} />
    </article>
  );
}

/** Элемент длинного списка: memo отсекает перерисовку при изменениях соседей */
export const PurchaseRowCard = memo(PurchaseRowCardBase);
