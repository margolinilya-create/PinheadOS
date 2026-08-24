import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { EmptyState } from '../../components/ErpStates';
import { SUBCONTRACT_PHASE_LABELS } from '../../types';
import { subcontractPhase } from '../../utils/subcontractPhase';
import { OrderLink } from '../../components/OrderLink';
import styles from '../../styles';

/**
 * Операции подряда БЕЗ МАРШРУТА — технический контур (правка 23.08, п. 5).
 *
 * ЧТО ЭТО. Заказы, заведённые до перехода на подрядные этапы (сессия 32):
 * связи с маршрутом у них нет, и следующий этап после возврата система
 * не откроет. Маршрут таким заказам задаётся вручную — в карточке заказа,
 * вкладка «Позиции» → «Изменить маршрут».
 *
 * ПОЧЕМУ ЗДЕСЬ, А НЕ В РАЗДЕЛЕ «ПОДРЯД». Заказчик: «Если такие записи нужны
 * для диагностики или миграции, оставить их только в админском/техническом
 * контуре, но не в рабочем интерфейсе подряда». В рабочем разделе блок был
 * шумом: он описывает не работу подрядчика, а состояние миграции.
 *
 * ПОЧЕМУ НЕ УДАЛИТЬ СОВСЕМ. Правило проекта: legacy снимается ПОСЛЕ того,
 * как опустеет блок совместимости. На 23.08 таких записей четыре, и у них
 * своя ветка возврата (`return_dept` → этап). Снять её, пока они живы, —
 * значит оставить эти заказы стоять после возврата от подрядчика.
 *
 * Вкладка показывается только когда записи ЕСТЬ (`hasLegacySubcontracts`
 * в `utils/outsourcing`) и исчезнет сама, когда их разберут, — ровно то,
 * что обещал прежний комментарий в разделе «Подряд».
 */

export function LegacySubcontractTab() {
  const { subcontracting } = useErpStore(
    useShallow((s) => ({ subcontracting: s.subcontracting })),
  );
  const rows = useMemo(
    () => (subcontracting ?? []).filter((s) => !s.stage_id),
    [subcontracting],
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="truck"
        title="Операций подряда без маршрута нет"
        text="Все подрядные операции связаны с этапами маршрута."
      />
    );
  }

  return (
    <>
      <p className={styles.subText}>
        Заказы, заведённые до перехода на подрядные этапы: связи с маршрутом
        у них нет, и следующий этап после возврата система не откроет. Маршрут
        задаётся в карточке заказа — вкладка «Позиции» → «Изменить маршрут».
        Когда список опустеет, вкладка исчезнет, а колонки <code>op_type</code>
        {' и '}<code>return_dept</code> можно будет убрать из схемы.
      </p>
      <ul className={styles.stackTight}>
        {rows.map((op) => (
          <li key={op.id} className={styles.subText}>
            {op.order_id
              ? <OrderLink orderId={op.order_id}>№{op.order?.bitrix_id || '—'}</OrderLink>
              : <>№{op.order?.bitrix_id || '—'}</>}
            {' · '}{op.order?.title || '—'} · {op.operation}
            {op.contractor ? ` · ${op.contractor}` : ''}
            {' · '}{SUBCONTRACT_PHASE_LABELS[subcontractPhase(op)]}
          </li>
        ))}
      </ul>
    </>
  );
}
