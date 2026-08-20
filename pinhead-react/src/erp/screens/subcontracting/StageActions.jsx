import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { availableActions } from '../../utils/subcontractFlow';
import { factoryToday } from '../../../utils/date';
import styles from '../../erp.module.css';

/**
 * Движение подрядной операции — ДЕЙСТВИЯ, а не выбор состояния.
 *
 * Здесь стоял `<select>` со всеми фазами: им можно было поставить «Завершено»,
 * не передав и не приняв ни одной штуки. Счётчики этапа при этом не двигались
 * (их приращает только журнал), заказ стоял, и понять почему было нечем —
 * на экране ведь «завершено».
 *
 * Действие называет ФАКТ («передал 200»), а фазу выводит из него. То, что
 * меняет количества, пишет журнал той же транзакцией (`erp_subcontract_apply`).
 *
 * Приёмки среди действий НЕТ: её оформляет склад задачей «Приёмка подряда» —
 * там же фиксируются брак и недостача. Кнопка «принято» здесь была бы вторым
 * путём к тому же переходу, мимо складского гейта.
 */
export function StageActions({ op, view, canManage }) {
  const applySubcontractAction = useErpStore(
    useShallow((s) => s.applySubcontractAction),
  );
  const [open, setOpen] = useState(null);
  const [qty, setQty] = useState('');
  const [movedOn, setMovedOn] = useState(factoryToday());
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const actions = availableActions(view);
  if (!canManage) {
    return (
      <p className={styles.subText}>
        Только просмотр: движением подряда управляет менеджер заказа.
      </p>
    );
  }
  if (actions.length === 0) {
    return <p className={styles.subText}>Действий нет: операция закрыта или ждёт склад.</p>;
  }

  const start = (spec) => {
    setOpen(spec);
    // Предзаполняем доступным остатком: документ требует частичных партий,
    // и «сколько можно» человек не должен считать в уме
    setQty(spec.qtyLabel && spec.key === 'send' ? String(view.readyQty) : '');
    setComment('');
    setMovedOn(factoryToday());
  };

  const run = async (spec) => {
    setSaving(true);
    const ok = await applySubcontractAction(op.id, spec, { qty, movedOn, comment });
    setSaving(false);
    if (ok) setOpen(null);
  };

  return (
    <div className={styles.stackTight}>
      <div className={styles.checkRow}>
        {actions.map((spec) => (
          <Button
            key={spec.key}
            variant={spec.key === 'send' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => (spec.qtyLabel ? start(spec) : run(spec))}
            loading={saving && open?.key === spec.key}
          >
            {spec.label}
          </Button>
        ))}
        {view.readyQty > 0 && (
          <span className={`${styles.chip} ${styles.chipReady}`}>
            готово к передаче: {view.readyQty} шт
          </span>
        )}
      </div>

      {open?.qtyLabel && (
        <div className={styles.addMatRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{open.qtyLabel}</span>
            <input
              type="number"
              min="1"
              className={styles.input}
              value={qty}
              onChange={(e) => setQty(e.target.value.replace('-', ''))}
              aria-label={open.qtyLabel}
              style={{ maxWidth: 110 }}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Дата</span>
            <DateField
              showFormatHint={false}
              value={movedOn}
              onChange={setMovedOn}
              aria-label="Дата перемещения"
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>Комментарий</span>
            <input
              className={styles.input}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="расхождение, условия, кто принимал"
              aria-label="Комментарий к перемещению"
            />
          </label>
          <Button
            variant="primary"
            size="sm"
            disabled={!(Number(qty) > 0)}
            loading={saving}
            onClick={() => run(open)}
          >
            {open.label}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
            Отмена
          </Button>
        </div>
      )}
    </div>
  );
}
