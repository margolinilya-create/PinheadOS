import { memo } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { OrderLink } from '../../components/OrderLink';
import styles from '../../styles';

/**
 * Задача склада карточкой вместо строки таблицы — компактная раскладка
 * (планшет цеха и телефон).
 *
 * Зачем: «Склад» — экран пилота, и работают с ним с планшета. Ниже 1024px
 * таблица уезжала за край, и колонка «Действие» оказывалась за пределами
 * экрана. Подписи полей ставятся ЯВНО: вместе с шапкой таблицы исчезают
 * названия колонок, и «28.07» без слова «Срок» ничего не значит.
 *
 * ПОЛЯ И ДЕЙСТВИЕ — ОТ ЗАДАЧИ (правка 05.10, п. 8). Кнопка называет свою
 * операцию («Принять ткань», «Отгрузить»), а не «Открыть» у всех подряд;
 * поля приходят списком `fields`: у приёмки материала это поставщик,
 * сколько принять и срок ПОСТАВКИ, у остальных — содержимое и срок.
 * Кнопка открывает форму, операцию сразу не проводит.
 *
 * @param fields  `[{ label, value, note? }]` — подписанные поля карточки
 */
function WarehouseTaskCardBase({
  typeLabel, typeIcon, orderId, orderNo, orderTitle, statusLabel, statusVariant,
  fields, actionLabel = 'Открыть', onOpen,
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

      {/* Заголовок — ССЫЛКА на заказ (правка владельца, п. 2). Без id заказа
          остаётся текстом — подсветку CSS даёт только `a.dataCardTitle`. */}
      {orderId ? (
        <OrderLink orderId={orderId} className={styles.dataCardTitle} title={orderTitle}>
          №{orderNo || '—'} · {orderTitle}
        </OrderLink>
      ) : (
        <div className={styles.dataCardTitle} title={orderTitle}>
          №{orderNo || '—'} · {orderTitle}
        </div>
      )}

      <div className={styles.dataCardFields}>
        {fields.map((f) => (
          <span key={f.label} className={styles.dataCardField}>
            <span className={styles.dataCardFieldLabel}>{f.label}</span>
            <span>{f.value || '—'}</span>
            {f.note && <span className={styles.subText}>{f.note}</span>}
          </span>
        ))}
      </div>

      {/* `block` + собственный @media(pointer: coarse) примитива дают
          кнопку во всю ширину и ≥44px — на планшете это основная цель */}
      <Button variant="secondary" block onClick={onOpen}>
        {actionLabel}
      </Button>
    </article>
  );
}

/** Элемент длинного списка: memo отсекает перерисовку при изменениях соседей */
export const WarehouseTaskCard = memo(WarehouseTaskCardBase);
