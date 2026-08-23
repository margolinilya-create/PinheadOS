import { memo } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import styles from '../../styles';

/**
 * Задача склада карточкой вместо строки таблицы — компактная раскладка
 * (планшет цеха и телефон).
 *
 * Зачем: «Склад» — экран пилота, и работают с ним с планшета, а таблица здесь
 * из шести колонок. Ниже 1024px она уезжала за край, и колонка «Действие»
 * оказывалась за пределами экрана — то есть кнопки, ради которой на экран
 * и приходят, было не видно вовсе. Тот же приём уже применён у очереди цеха
 * (QueueCard), доски и списка заказов (OrderCardMobile); здесь его не было.
 *
 * Подписи полей ставятся ЯВНО: вместе с шапкой таблицы исчезают названия
 * колонок, и «28.07» без слова «Срок» ничего не значит.
 */
function WarehouseTaskCardBase({
  typeLabel, typeIcon, orderNo, orderTitle, summary, statusLabel, statusVariant, deadline, onOpen,
}) {
  return (
    <article className={styles.dataCard} aria-label={`${typeLabel} — заказ ${orderTitle}`}>
      <div className={styles.dataCardHead}>
        <span className={styles.cellWithIcon}>
          <Icon name={typeIcon} size={16} />
          <b>{typeLabel}</b>
        </span>
        <Badge variant={statusVariant}>{statusLabel}</Badge>
      </div>

      <div className={styles.dataCardTitle} title={orderTitle}>
        №{orderNo || '—'} · {orderTitle}
      </div>

      <div className={styles.dataCardFields}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Содержимое</span>
          <span>{summary}</span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Срок</span>
          <span>{deadline || '—'}</span>
        </span>
      </div>

      {/* `block` + собственный @media(pointer: coarse) примитива дают
          кнопку во всю ширину и ≥44px — на планшете это основная,
          а часто и единственная цель нажатия */}
      <Button variant="secondary" block onClick={onOpen}>
        Открыть
      </Button>
    </article>
  );
}

/** Элемент длинного списка: memo отсекает перерисовку при изменениях соседей */
export const WarehouseTaskCard = memo(WarehouseTaskCardBase);
