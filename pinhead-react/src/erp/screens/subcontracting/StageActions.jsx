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
 * ПЕРВОЕ ДЕЙСТВИЕ — ГЛАВНОЕ (правка 22.08, п. 3.3). Порядок задаёт
 * `availableActions`, здесь он только рисуется: первая кнопка `primary`,
 * остальные `secondary`. «На одном состоянии этапа не должно быть нескольких
 * одинаково заметных кнопок» — а держать приоритет в разметке нельзя,
 * компонент монтируется в двух местах.
 *
 * ДВА КОЛИЧЕСТВА, А НЕ ОДНО (п. 3.8). «Сколько подрядчик должен сделать»
 * и «сколько мы ему физически отдали» — разные величины: на материалах
 * подрядчика вторая равна нулю при первой в 200 штук. Поэтому у запуска
 * работы поле передачи НЕОБЯЗАТЕЛЬНОЕ, а на материалах подрядчика его нет
 * вовсе — передавать нечего.
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
  const [inWork, setInWork] = useState('');
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

  /** Нужна ли форма: у действия есть хоть одно поле количества */
  const needsForm = (spec) => spec.asksInWork || Boolean(spec.qtyLabel);

  const start = (spec) => {
    setOpen(spec);
    /**
     * Предзаполняем доступным остатком: документ требует частичных партий,
     * и «сколько можно» человек не должен считать в уме. Физическую передачу
     * НЕ предзаполняем — она необязательна, и подставленное число прочиталось
     * бы как «столько и отдали».
     */
    setQty(spec.key === 'return' ? String(view.inWorkQty || '') : '');
    setInWork(spec.asksInWork ? String(view.readyQty || '') : '');
    setComment('');
    setMovedOn(factoryToday());
  };

  const run = async (spec) => {
    setSaving(true);
    /**
     * Догрузка партии присылает СУММУ: объём работы — величина менеджера,
     * а не журнал приращений, и сервер пишет её абсолютом.
     */
    const inWorkTotal = spec.key === 'send'
      ? Number(view.inWorkQty || 0) + Number(inWork || 0)
      : Number(inWork || 0);
    const ok = await applySubcontractAction(op.id, spec, {
      qty,
      inWorkQty: spec.asksInWork ? inWorkTotal : undefined,
      movedOn,
      comment,
    });
    setSaving(false);
    if (ok) setOpen(null);
  };

  /** Можно ли отправить: у действия должно быть названо хоть одно число */
  const canSubmit = open
    ? (open.asksInWork ? Number(inWork) > 0 : Number(qty) > 0)
    : false;

  return (
    <div className={styles.stackTight}>
      <div className={styles.checkRow}>
        {actions.map((spec, i) => (
          <Button
            key={spec.key}
            variant={i === 0 ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => (needsForm(spec) ? start(spec) : run(spec))}
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

      {open && needsForm(open) && (
        <div className={styles.addMatRow}>
          {open.asksInWork && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {open.key === 'send' ? 'Добавить в работу, шт' : 'Количество в работе, шт'}
              </span>
              <input
                type="number"
                min="1"
                className={styles.input}
                value={inWork}
                onChange={(e) => setInWork(e.target.value.replace('-', ''))}
                aria-label="Количество в работе у подрядчика"
                style={{ maxWidth: 130 }}
              />
              <span className={styles.subText}>сколько подрядчик должен сделать</span>
            </label>
          )}
          {open.qtyLabel && !(open.asksInWork && view.contractorMaterials) && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{open.qtyLabel}</span>
              <input
                type="number"
                min="0"
                className={styles.input}
                value={qty}
                onChange={(e) => setQty(e.target.value.replace('-', ''))}
                aria-label={open.qtyLabel}
                style={{ maxWidth: 130 }}
              />
              {open.asksInWork && (
                <span className={styles.subText}>
                  необязательно — на материалах подрядчика передавать нечего
                </span>
              )}
            </label>
          )}
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
            disabled={!canSubmit}
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
