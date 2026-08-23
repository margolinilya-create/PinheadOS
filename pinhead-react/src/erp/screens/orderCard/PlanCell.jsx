import { useState } from 'react';
import styles from '../../styles';
import { Icon } from '../../components/Icon';
import { useErpAccess } from '../../store/useErpAccess';
import { fmt } from './format';
import { Button } from '../../components/Button';
import { factoryToday } from '../../../utils/date';

/**
 * Ячейка плановых дат этапа: кнопка «задать план…» → два date-инпута.
 *
 * Гейт — `order.manage`: плановые даты это расписание заказа, которое ведёт
 * менеджер, а не дневная раскладка цеха (та живёт в `/plan` под `plan.manage`).
 * Без права даты показываются, но не правятся: цеху важно ВИДЕТЬ срок.
 *
 * Право появилось здесь позже самих дат. Пока гейта не было, серверный страж
 * `erp_stage_guard` намеренно не охранял `planned_*` — проверка на сервере
 * отобрала бы у менеджера то, что интерфейс разрешал всем. Теперь охраняет,
 * и обе стороны совпадают.
 */
export function PlanCell({ stage, onSave }) {
  const access = useErpAccess();
  const canPlan = access.can('order.manage');
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(stage.planned_start || '');
  const [end, setEnd] = useState(stage.planned_end || '');

  if (!canPlan) {
    const hasPlan = stage.planned_start || stage.planned_end;
    return hasPlan ? (
      <span>{fmt(stage.planned_start)} → {fmt(stage.planned_end)}</span>
    ) : (
      <span className={styles.subText}>—</span>
    );
  }

  if (!editing) {
    const overdueEnd =
      stage.planned_end && stage.status !== 'done' &&
      stage.planned_end < factoryToday();
    return (
      <button
        type="button"
        className={styles.planBtn}
        title="Задать плановые даты"
        onClick={() => setEditing(true)}
      >
        {stage.planned_start || stage.planned_end ? (
          <span className={overdueEnd ? styles.overdue : undefined}>
            {fmt(stage.planned_start)} → {fmt(stage.planned_end)}
          </span>
        ) : (
          <span className={styles.subText}>задать план…</span>
        )}
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="date" className={`${styles.input} ${styles.inputXs} ${styles.inputXsDate}`}
        value={start} onChange={(e) => setStart(e.target.value)} aria-label="План: начало" />
      <input type="date" className={`${styles.input} ${styles.inputXs} ${styles.inputXsDate}`}
        value={end} onChange={(e) => setEnd(e.target.value)} aria-label="План: конец" />
      <Button
        variant="primary"
        size="sm"
        iconOnly
        icon="check"
        aria-label="Сохранить плановые даты"
        title="Сохранить"
        onClick={async () => {
          const ok = await onSave({ planned_start: start || null, planned_end: end || null });
          // Закрываем только при успехе — иначе правка исчезала вместе с ошибкой
          if (ok !== false) setEditing(false);
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon="x"
        aria-label="Отменить правку плана"
        title="Отмена"
        onClick={() => setEditing(false)}
      />
    </span>
  );
}
