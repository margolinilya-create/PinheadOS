import { useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { metresText, rollLeftText } from '../../utils/cutRolls';
import { rollFinishBlock, rollFinishPlan, rollMetresSummary } from '../../utils/rollFinish';
import { sourceLabel } from '../../utils/fabricMetres';
import styles from '../../styles';

/**
 * ЗАВЕРШИТЬ РУЛОН (правка заказчика 05.10, п. 5).
 *
 * «В форме смешаны выпуск, расход и завершение рулона». Завершение
 * вынесено сюда: остаток по записям, измеренный остаток, причина
 * расхождения и выбор судьбы БЕЗ предвыбора — «ничего не выбирать
 * за пользователя». Пригодный остаток остаётся доступным следующим
 * заказам, непригодный уходит в потери ткани записью списания.
 *
 * Окно — форма ввода: клик мимо не закрывает её (правка 01.10, п. 3).
 */
const FATES = [
  ['usable', 'Оставить пригодный остаток', 'останется на складе и будет доступен для следующего раскроя'],
  ['scrap', 'Списать непригодный', 'уйдёт в потери ткани по этой позиции'],
];

export function RollFinishModal({ option, itemId = null, onFinish, onClose }) {
  const { roll } = option;
  const summary = rollMetresSummary(option);
  const [measured, setMeasured] = useState('');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState(null);
  const [saving, setSaving] = useState(false);
  // Повторный тап до перерисовки видит прежний `saving` — держим и в ref
  const inFlight = useRef(false);

  const plan = rollFinishPlan(roll, measured);
  const block = rollFinishBlock(plan, kind);
  const hasLeft = plan.left > 0.0005;
  const differs = plan.refineLengthM !== null;

  const finish = async () => {
    if (inFlight.current || block) return;
    inFlight.current = true;
    setSaving(true);
    const ok = await onFinish(roll.id, {
      kind: hasLeft ? kind : null,
      itemId,
      refineLengthM: plan.refineLengthM,
      reason: differs ? (reason.trim() || null) : null,
    });
    inFlight.current = false;
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal title={`Завершить рулон — ${roll.label}`} onClose={onClose} closeOnOverlay={false}>
      <div className={styles.queueBlockForm}>
        <span className={styles.subText}>{option.label}</span>
        <p className={styles.queueReason}>
          {summary ? (
            <>
              Остаток по записям: <b>{metresText(summary.available)}</b>
              {' '}· исходный метраж {metresText(summary.initial)} ({sourceLabel(summary.source)})
              {' '}· записано расходом {metresText(summary.spent)}
            </>
          ) : <>Остаток по записям: <b>{rollLeftText(roll, option.material)}</b></>}
        </p>

        {summary && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Измеренный остаток, м</span>
            <input
              type="number" min="0" step="0.01" inputMode="decimal"
              className={`${styles.input} ${styles.qtySmallInput}`}
              value={measured}
              disabled={saving}
              placeholder="если мерили"
              aria-label="Измеренный остаток, м"
              onChange={(e) => setMeasured(e.target.value)}
            />
            <span className={styles.subText}>
              Расход не стирается: расхождение запишется уточнением метража с причиной.
            </span>
          </label>
        )}
        {differs && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Причина расхождения</span>
            <input
              className={styles.input}
              value={reason}
              disabled={saving}
              placeholder="например, перемерили после раскладки"
              aria-label="Причина расхождения"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}

        {hasLeft && (
          <fieldset className={styles.queueBlockForm}>
            <legend className={styles.fieldLabel}>Что с остатком {metresTextOr(plan.left, summary)}</legend>
            {FATES.map(([value, label, hint]) => (
              <label key={value} className={styles.checkLabel}>
                <input
                  type="radio" name={`roll-fate-${roll.id}`} value={value}
                  checked={kind === value} disabled={saving}
                  onChange={() => setKind(value)}
                />
                {' '}<b>{label}</b> <span className={styles.subText}>— {hint}</span>
              </label>
            ))}
          </fieldset>
        )}

        {block && (
          <p className={styles.queueReason} role="status">
            <Icon name="alert" size={13} /> {block}
          </p>
        )}
        <div className={styles.modalActions}>
          <Button variant="ghost" disabled={saving} onClick={onClose}>Отмена</Button>
          <Button variant="primary" loading={saving} disabled={saving || Boolean(block)} onClick={finish}>
            Завершить рулон
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Остаток в подписи выбора: метры, а у рулона без метража — как записано */
function metresTextOr(left, summary) {
  return summary ? `(${metresText(left)})` : '';
}
