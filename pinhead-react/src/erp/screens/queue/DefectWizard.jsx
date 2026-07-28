import { useState } from 'react';
import { Drawer } from '../../components/Drawer';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { PROCUREMENT_CAUSE_LABELS } from '../../types';
import styles from '../../erp.module.css';
import { PhotoAttach } from './PhotoAttach';

/**
 * Мастер брака/переделки — два шага в боковой панели.
 *
 * Раньше все эти поля (до 12 штук) разворачивались прямо в карточке очереди:
 * на планшете цеха карточка превращалась в простыню, а соседние работы
 * уезжали с экрана. Логика и состав payload не изменились — форма один в один,
 * только разнесена на шаги: «сколько и почему» → «куда вернуть».
 *
 * onSubmit(payload, photo) — тот же контракт, что был у onDefect в QueueCard.
 */
export function DefectWizard({ entry, deptShortById, onSubmit, onClose }) {
  const { order, item, stage } = entry;

  const [step, setStep] = useState(1);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState(null);

  const [target, setTarget] = useState('current');
  const [needsMaterial, setNeedsMaterial] = useState(false);
  const [cause, setCause] = useState('other');
  const [supplier, setSupplier] = useState('');
  const [planned, setPlanned] = useState('');
  const [material, setMaterial] = useState('');
  const [contractor, setContractor] = useState('');
  const [operation, setOperation] = useState('');

  const showProcurement = needsMaterial || target === 'procurement';
  const showSubcontract = target === 'subcontractor';
  const otherStages = item.stages.filter((s) => s.id !== stage.id && s.status !== 'skipped');

  const qtyNum = Number(qty);
  const qtyError = qty !== '' && !(qtyNum > 0)
    ? 'Укажите положительное число'
    : qtyNum > item.qty
      ? `В позиции всего ${item.qty} шт`
      : null;
  const step1Valid = reason.trim() !== '' && qtyNum > 0 && qtyNum <= item.qty;

  const submit = () => {
    onSubmit({
      qty: qtyNum,
      reason: reason.trim(),
      target,
      needsMaterial: showProcurement,
      cause,
      supplier: supplier.trim() || null,
      plannedDate: planned || null,
      materialName: material.trim() || null,
      subcontractOperation: operation.trim() || null,
      contractor: contractor.trim() || null,
    }, photo);
    onClose();
  };

  const submitLabel = showSubcontract
    ? 'Отправить подрядчику'
    : showProcurement ? 'В переделку + заявка' : 'В переделку';

  return (
    <Drawer
      onClose={onClose}
      title="Брак / переделка"
      subtitle={`${order.title} · ${item.product_type} · ${item.qty} шт`}
    >
      <ol className={styles.wizSteps} aria-label="Шаги">
        <li className={step === 1 ? styles.wizStepActive : styles.wizStep}>1. Сколько и почему</li>
        <li className={step === 2 ? styles.wizStepActive : styles.wizStep}>2. Куда вернуть</li>
      </ol>

      {step === 1 && (
        <div className={styles.stack}>
          <Field
            label="Сколько штук в брак"
            type="number"
            min="1"
            max={item.qty}
            inputMode="numeric"
            value={qty}
            error={qtyError}
            hint={`В позиции ${item.qty} шт`}
            onChange={(e) => setQty(e.target.value)}
            autoFocus
          />
          <Field
            label="Причина брака"
            as="textarea"
            placeholder="Кривая строчка, пятно…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <PhotoAttach file={photo} onFile={setPhoto} label="Фото (необязательно)" />
        </div>
      )}

      {step === 2 && (
        <div className={styles.stack}>
          <Field
            label="Где устранять"
            as="select"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="current">Устранить на текущем этапе</option>
            {otherStages.map((s) => (
              <option key={s.id} value={s.id}>
                Вернуть: {deptShortById?.get(s.department_id) || 'этап'}
              </option>
            ))}
            <option value="procurement">На закупку (материал испорчен)</option>
            <option value="subcontractor">Отправить подрядчику</option>
          </Field>

          {showSubcontract && (
            <>
              <Field
                label="Операция подряда"
                placeholder="Что сделать"
                value={operation}
                onChange={(e) => setOperation(e.target.value)}
              />
              <Field
                label="Контрагент"
                hint="Необязательно"
                value={contractor}
                onChange={(e) => setContractor(e.target.value)}
              />
            </>
          )}

          <label className={styles.checkLabel}>
            {/* При возврате «на закупку» материал нужен по определению: галка
                форсится и блокируется, чтобы не противоречить полям ниже. */}
            <input
              type="checkbox"
              checked={showProcurement}
              disabled={target === 'procurement'}
              onChange={(e) => setNeedsMaterial(e.target.checked)}
            />
            Нужен новый материал
          </label>

          {showProcurement && (
            <>
              <Field
                label="Материал"
                placeholder="Что закупить"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
              />
              <Field
                label="Причина закупки"
                as="select"
                value={cause}
                onChange={(e) => setCause(e.target.value)}
              >
                {Object.entries(PROCUREMENT_CAUSE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Field>
              <Field
                label="Поставщик"
                hint="Необязательно"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
              <Field
                label="Плановая дата замены"
                type="date"
                value={planned}
                onChange={(e) => setPlanned(e.target.value)}
              />
            </>
          )}
        </div>
      )}

      <div className={styles.wizActions}>
        {step === 1 ? (
          <>
            <Button variant="primary" size="lg" disabled={!step1Valid} onClick={() => setStep(2)}>
              Далее
            </Button>
            <Button variant="ghost" size="lg" onClick={onClose}>Отмена</Button>
          </>
        ) : (
          <>
            <Button variant="danger" size="lg" disabled={!step1Valid} onClick={submit}>
              {submitLabel}
            </Button>
            <Button variant="ghost" size="lg" icon="chevronLeft" onClick={() => setStep(1)}>
              Назад
            </Button>
          </>
        )}
      </div>
    </Drawer>
  );
}
