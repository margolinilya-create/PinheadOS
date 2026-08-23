import { memo } from 'react';
import { Button } from '../../components/Button';
import styles from '../../erp.module.css';
import {
  DatesCell, ItemCell, LocationCell, NextStageCell, OperationCell,
  OrderCell, StateCell, WorkQtyCell,
} from './StageFields';
import { SUBCONTRACT_LABELS } from './subcontractLabels';

/**
 * Подрядный этап карточкой вместо строки таблицы — компактная раскладка
 * (планшет цеха и телефон).
 *
 * Зачем: таблица «Подряда» — ДЕСЯТЬ колонок, и колонка «Этап» (та самая кнопка,
 * которой раскрывают действия) стоит последней. Ниже 1024px она уезжала за край
 * экрана, то есть до действий было не добраться вовсе. Тот же приём уже
 * применён у склада, закупки, очереди цеха и списка заказов.
 *
 * Подписи полей ставятся ЯВНО: вместе с шапкой таблицы исчезают названия
 * колонок, и «150» без слова «В работе» ничего не значит. Берутся они из того
 * же `SUBCONTRACT_LABELS`, что и шапка, — иначе два написания одного столбца
 * разойдутся при первой же правке.
 *
 * Само содержимое — из `StageFields`, общего с таблицей: половина колонок это
 * инлайн-правки, и вторая их реализация писала бы по-другому молча.
 */
function StageRowCardBase({
  order, item, stage, sub, view, next, phase, delayed, phaseChipClass,
  deptName, nextDeptName, overdue, canManage, open, onToggle, onUpdate,
}) {
  return (
    <article
      className={styles.dataCard}
      aria-label={`Подряд: ${item.product_type} — заказ ${order.title || order.bitrix_id}`}
    >
      <div className={styles.dataCardHead}>
        <span><OrderCell order={order} /></span>
        <StateCell
          stage={stage}
          sub={sub}
          phase={phase}
          delayed={delayed}
          phaseChipClass={phaseChipClass}
          canManage={canManage}
          onUpdate={onUpdate}
        />
      </div>

      <div className={styles.dataCardTitle}>
        <ItemCell item={item} />
      </div>

      <div className={styles.dataCardFields}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>{SUBCONTRACT_LABELS.qty}</span>
          <span><WorkQtyCell item={item} view={view} /></span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>{SUBCONTRACT_LABELS.operation}</span>
          <span><OperationCell stage={stage} sub={sub} deptName={deptName} /></span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>{SUBCONTRACT_LABELS.contractor}</span>
          <span>{stage.contractor || '—'}</span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>{SUBCONTRACT_LABELS.location}</span>
          <span><LocationCell item={item} stage={stage} view={view} /></span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>{SUBCONTRACT_LABELS.dates}</span>
          <span>
            <DatesCell
              stage={stage}
              sub={sub}
              overdue={overdue}
              canManage={canManage}
              onUpdate={onUpdate}
            />
          </span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>{SUBCONTRACT_LABELS.next}</span>
          <span><NextStageCell next={next} deptName={nextDeptName} /></span>
        </span>
      </div>

      {/* Главное действие карточки — раскрыть этап: именно за ним на экран
          и приходят. `block` + собственный @media(pointer: coarse) примитива
          дают ширину и ≥44px */}
      {sub ? (
        <Button
          variant="secondary"
          block
          icon={open ? 'chevronUp' : 'chevronDown'}
          onClick={onToggle}
          aria-expanded={open}
        >
          Этап · принято {sub.qty_accepted ?? 0} из {item.qty ?? '?'}
        </Button>
      ) : (
        <span className={styles.subText}>карточка подряда ещё не заведена</span>
      )}
    </article>
  );
}

/** Элемент длинного списка: memo отсекает перерисовку при изменениях соседей */
export const StageRowCard = memo(StageRowCardBase);
