import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { SUBCONTRACT_SEND_STATUS_LABELS } from '../../types';
import { useErpStore } from '../../store/useErpStore';
import { SUBCONTRACT_ACTIONS } from '../../utils/subcontractFlow';
import { stageInputQty } from '../../utils/stageInput';
import { deptShortName } from '../../data/departments';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { factoryToday } from '../../../utils/date';
import styles from '../../styles';

/**
 * Задача склада «Передача подрядчику» (правка заказчика 24.08, п. 3).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «Каждый новый выход к подрядчику должен проходить
 * через складскую передачу… Система не должна переводить заказ из нашего цеха
 * напрямую в следующий этап "Подряд"… Заказ не может получить статус
 * "У подрядчика", пока склад не зафиксировал фактическую передачу».
 *
 * ЧТО БЫЛО. Фазу `at_contractor` ставил МЕНЕДЖЕР кнопкой «Передать в работу»
 * в разделе «Подряд». Заказ получал статус «У подрядчика» без единого касания
 * склада — ровно то, что документ запрещает прямым текстом.
 *
 * ПЕРЕДАЧА — ЭТО ТО ЖЕ ДЕЙСТВИЕ, что и раньше, только руками склада:
 * `applySubcontractAction` с действием `start` пишет журнал `send`, двигает
 * фазу и объём работы ОДНОЙ транзакцией. Второй реализации у передачи
 * не заводим — она разошлась бы с первой молча.
 *
 * «ПЕРЕДАВАТЬ НЕЧЕГО» — ОТДЕЛЬНАЯ КНОПКА, А НЕ ПУСТОЕ ПОЛЕ. На материалах
 * подрядчика физической передачи нет вовсе (п. 3.8 документа 20.08), но
 * задача склада заводится ВСЕГДА: иначе «У подрядчика» значило бы разное
 * в зависимости от того, чьи материалы, и склад не знал бы, ждут его или нет.
 * Кнопка закрывает задачу и двигает фазу, не записывая в журнал ноль.
 */
export function SendToContractorCard({ order, task, onAdvance }) {
  const { subcontracting, applySubcontractAction } = useErpStore(useShallow((s) => ({
    subcontracting: s.subcontracting,
    applySubcontractAction: s.applySubcontractAction,
  })));
  const departments = useErpStore(useShallow((s) => s.departments));

  const sent = task.status === 'sent';
  const [qty, setQty] = useState('');
  const [movedOn, setMovedOn] = useState(factoryToday());
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  /** Операция подряда этой задачи: у задачи есть этап, у этапа — спутник */
  const sub = useMemo(
    () => subcontracting.find((s) => s.stage_id && s.stage_id === task.stage_id) ?? null,
    [subcontracting, task.stage_id],
  );

  const item = (order.items ?? []).find(
    (it) => (it.stages ?? []).some((s) => s.id === task.stage_id),
  ) ?? null;
  const stage = (item?.stages ?? []).find((s) => s.id === task.stage_id) ?? null;
  const dept = departments.find((d) => d.id === stage?.department_id) ?? null;

  /**
   * Сколько ЕСТЬ что передать — тем же расчётом, что «принято в работу»
   * у обычного цеха: минимум по предшественникам, а не сумма. Параллельные
   * ветки нанесения обрабатывают одни и те же единицы, и сумма дала бы
   * двойной тираж.
   */
  const available = useMemo(
    () => (stage && item ? stageInputQty(stage, item) : 0), [stage, item]);

  const run = async (fn) => {
    setSaving(true);
    try { return await fn(); } finally { setSaving(false); }
  };

  /**
   * Порядок: сначала передача, потом закрытие задачи. Неудачная запись задачу
   * не закрывает — иначе склад увидел бы «передано» там, где журнал пуст
   * и фаза осталась прежней. Тот же порядок, что у приёмки.
   */
  const submit = (withQty) => run(async () => {
    if (!sub) return;
    const ok = await applySubcontractAction(sub.id, SUBCONTRACT_ACTIONS.start, {
      qty: withQty ? Number(qty) : 0,
      inWorkQty: available,
      movedOn,
      comment: comment.trim() || null,
    });
    if (ok) await onAdvance(task.id, 'sent');
  });

  if (!sub) {
    return (
      <div className={styles.tzBlock}>
        <p className={styles.subText}>
          У этапа нет карточки подрядчика — передавать некому. Заведите
          подрядчика в разделе «Подряд», и задача заработает.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.tzBlock}>
      <div className={styles.formGrid}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Подрядчик</span>
          <strong>{sub.contractor || 'не указан'}</strong>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Операция</span>
          <span>
            {stage?.operation?.trim()
              || (dept ? deptShortName(dept.code, dept.name) : 'Подряд')}
          </span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Изделие</span>
          <span>
            {item?.product_type}
            {item?.variant ? ` (${item.variant})` : ''}
          </span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Готово к передаче</span>
          <span>{available} шт</span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Материалы</span>
          <span>
            {sub.materials === 'contractor' ? 'подрядчика'
              : sub.materials === 'mixed' ? 'смешанные' : 'наши'}
          </span>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Статус</span>
          <span>{SUBCONTRACT_SEND_STATUS_LABELS[task.status] ?? task.status}</span>
        </div>
      </div>

      {sent ? (
        <p className={styles.subText}>
          Передача зафиксирована — заказ у подрядчика. Возврат придёт отдельной
          задачей «Приёмка подряда».
        </p>
      ) : (
        <>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Физически передано, шт</span>
              <input
                type="number"
                min="0"
                className={styles.input}
                value={qty}
                onChange={(e) => setQty(e.target.value.replace('-', ''))}
                placeholder={String(available)}
                aria-label="Физически передано подрядчику"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Дата передачи</span>
              <DateField value={movedOn} onChange={setMovedOn} aria-label="Дата передачи" />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span className={styles.fieldLabel}>Комментарий</span>
              <input
                className={styles.input}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                aria-label="Комментарий к передаче"
              />
            </label>
          </div>

          <div className={styles.queueActions}>
            <Button
              variant="primary"
              disabled={saving || !(Number(qty) > 0)}
              onClick={() => submit(true)}
            >
              Передано подрядчику
            </Button>
            {/*
              Материалы подрядчика: физической передачи нет, но заказ всё равно
              уходит к нему — и склад обязан это зафиксировать, иначе
              «У подрядчика» останется недостижимым.
            */}
            <Button variant="ghost" disabled={saving} onClick={() => submit(false)}>
              Передавать нечего — материалы подрядчика
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
