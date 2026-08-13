import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useFormGate } from '../../components/useFormGate';
import { FieldError, FormGateHint } from '../../components/FormGate';
import styles from '../../erp.module.css';

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
    () => order.items.reduce((sum, it) => sum + (it.qty || 0), 0),
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
   * До 13.08.2026 кнопка просто блокировалась при пустом количестве, и это
   * читалось как сломанный интерфейс: ни ошибки, ни подсказки, ни подсветки.
   * Теперь причина называется — тем же способом, что в форме «Новый заказ».
   */
  const gate = useFormGate([
    {
      key: 'good',
      label: 'Принято, шт',
      ok: goodN + defectN > 0,
      message: 'Укажите, сколько изделий приняли (или сколько из них брак)',
    },
    {
      key: 'comment',
      label: 'Комментарий',
      ok: !needsComment || Boolean(comment.trim()),
      message: 'Объясните расхождение с тем, что сдало производство',
    },
  ]);

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
    if (ok) { setGood(''); setDefect(''); setComment(''); gate.reset(); }
    setBusy(false);
  };

  return (
    <section className={styles.matSection}>
      {/*
        Заголовок карточки убран намеренно (H-17): дровер уже подписан
        «Приёмка готовой продукции · №… · Клиент» в своей шапке, и повтор
        внутри карточки занимал место, ничего не сообщая.
      */}
      {done && (
        <div className={styles.matSectionHead}>
          <span className={`${styles.chip} ${styles.chipReady}`}>Принято на склад</span>
        </div>
      )}

      <span className={styles.queueReason}>
        <span className={styles.cellWithIcon}>
          <Icon name="box" size={14} />
          Производство сдало: <b>{expected}</b> шт
        </span>
      </span>

      <div className={styles.planFormRow}>
        {/* `fieldQty` вместо `field`: подпись «Принято, шт *» шире поля 80px,
            и две подписи подряд смыкались друг с другом (H-17) */}
        <label className={`${styles.field} ${styles.fieldQty}`}>
          <span className={styles.fieldLabel}>Принято, шт *</span>
          <input
            type="number" min="0" className={gate.cls(`${styles.input} ${styles.qtySmallInput}`, 'good')}
            value={good} onChange={(e) => setGood(e.target.value)}
            aria-label="Принято на склад, шт"
            {...gate.field('good')}
          />
        </label>
        <label className={`${styles.field} ${styles.fieldQty}`}>
          <span className={styles.fieldLabel}>Брак, шт</span>
          <input
            type="number" min="0" className={`${styles.input} ${styles.qtySmallInput}`}
            value={defect} onChange={(e) => setDefect(e.target.value)}
            aria-label="Брак при приёмке, шт"
          />
        </label>
        <label className={`${styles.field} ${styles.fieldGrow}`}>
          <span className={styles.fieldLabel}>
            Комментарий{needsComment ? ' * (объясните расхождение)' : ''}
          </span>
          <input
            className={gate.cls(styles.input, 'comment')} value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={needsComment ? 'чего не хватает и почему' : 'необязательно'}
            aria-label="Комментарий приёмки готовой продукции"
            {...gate.field('comment')}
          />
        </label>
      </div>
      <FieldError id={gate.errId('good')} text={gate.error('good')} />
      <FieldError id={gate.errId('comment')} text={gate.error('comment')} />

      {goodN + defectN > 0 && shortfall > 0 && (
        <span className={styles.overdue}>
          в этом вводе не хватает {shortfall} шт — задача закроется,
          когда приёмки в сумме доберут тираж
        </span>
      )}

      <div className={styles.formActions}>
        <FormGateHint gate={gate} />
        <Button
          variant="primary"
          disabled={busy || (gate.submitted && !gate.ok)}
          onClick={gate.guard(submit)}
        >
          <Icon name="check" size={14} /> Записать приёмку
        </Button>
      </div>
    </section>
  );
}
