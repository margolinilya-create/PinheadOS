import { useMemo, useState } from 'react';
import { orderQty } from '../../utils/shipment';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import styles from '../../styles';

/**
 * Приёмка готовой продукции с производства (правки заказчика 10.08, волна 3.4).
 *
 * Раньше этого шага не было вовсе: заказ переходил из последнего цеха сразу
 * в упаковку, и «сколько штук реально доехало до склада» нигде не фиксировалось.
 * Расхождение между «цех сдал» и «склад принял» всплывало на отгрузке.
 *
 * Считается в ШТУКАХ и пишет в тот же журнал `erp_stage_reports`, что и цеха:
 * граница между двумя журналами проведена по единице измерения, а не по
 * «складу вообще». Иначе «сколько изделий приняли» пришлось бы собирать
 * из двух мест с разными правилами.
 */
export function FgReceiptCard({ order, task, onSubmit }) {
  const expected = useMemo(
    () => orderQty(order),
    [order],
  );
  const [good, setGood] = useState('');
  const [defect, setDefect] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const goodN = Math.max(Number(good) || 0, 0);
  const defectN = Math.max(Number(defect) || 0, 0);
  const shortfall = expected > 0 ? Math.max(expected - goodN - defectN, 0) : 0;
  const needsComment = defectN > 0 || (goodN > 0 && shortfall > 0);
  const done = task.status === 'accepted';

  /**
   * Задачу закрывает СЕРВЕР по накопленной сумме журнала, а не эта форма.
   *
   * Здесь стояло `if (shortfall === 0 && defectN === 0) onAdvance(…)`, где
   * недостача считалась по ОДНОМУ вводу: приняли 60 из 100 — задача осталась
   * открытой (верно), назавтра приняли ещё 40 — недостача снова считалась
   * как 100 − 40, и задача не закрывалась никогда. Клиент журнал не читает,
   * а упаковка требует принятой приёмки — заказ становилось не упаковать.
   */
  const submit = async () => {
    setBusy(true);
    const ok = await onSubmit(task.id, {
      qtyIn: expected,
      qtyGood: goodN,
      qtyDefect: defectN,
      comment,
    });
    if (ok) { setGood(''); setDefect(''); setComment(''); }
    setBusy(false);
  };

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <span className={styles.subText}>Приёмка готовой продукции</span>
          <div><strong>№{order.bitrix_id || '—'} · {order.title}</strong></div>
        </div>
        {done && <span className={`${styles.chip} ${styles.chipReady}`}>Принято на склад</span>}
      </div>

      <span className={styles.queueReason}>
        <span className={styles.cellWithIcon}>
          <Icon name="box" size={14} />
          Производство сдало: <b>{expected}</b> шт
        </span>
      </span>

      <div className={styles.planFormRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Принято, шт *</span>
          <input
            type="number" min="0" className={`${styles.input} ${styles.qtySmallInput}`}
            value={good} onChange={(e) => setGood(e.target.value)}
            aria-label="Принято на склад, шт"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Брак, шт</span>
          <input
            type="number" min="0" className={`${styles.input} ${styles.qtySmallInput}`}
            value={defect} onChange={(e) => setDefect(e.target.value)}
            aria-label="Брак при приёмке, шт"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            Комментарий{needsComment ? ' * (объясните расхождение)' : ''}
          </span>
          <input
            className={styles.input} value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={needsComment ? 'чего не хватает и почему' : 'необязательно'}
            aria-label="Комментарий приёмки готовой продукции"
          />
        </label>
      </div>

      {goodN + defectN > 0 && shortfall > 0 && (
        <span className={styles.overdue}>
          в этом вводе не хватает {shortfall} шт — задача закроется,
          когда приёмки в сумме доберут тираж
        </span>
      )}

      <Button
        variant="primary"
        disabled={busy || goodN + defectN <= 0 || (needsComment && !comment.trim())}
        onClick={submit}
      >
        <Icon name="check" size={14} /> Записать приёмку
      </Button>
    </section>
  );
}
