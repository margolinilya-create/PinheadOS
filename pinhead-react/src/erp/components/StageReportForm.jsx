import { useMemo, useState } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import { stageInputQty, stageRemainingQty } from '../utils/stageInput';
import styles from '../erp.module.css';

/**
 * Отчёт цеха о результате работы (правки заказчика 10.08, P2).
 *
 * Документ: «Каждый этап должен завершаться внесением количественного
 * результата: сколько принято, сколько сделано, сколько брака, сколько
 * передано дальше. Набор полей у разных участков разный».
 *
 * Поля берутся из `department.result_fields` — схема живёт в данных, а не
 * в коде. Пусто = участок отчёта не требует, и форма не рисуется вовсе:
 * fail-open, потому что новый участок, заведённый директором, не должен
 * оказаться без возможности отчитаться.
 *
 * «Принято в работу» — не хранимое поле, а выход предыдущего этапа
 * (`utils/stageInput`, минимум по параллельным веткам). Показываем его сверху
 * и уносим снимком в журнал: цех должен видеть, из какого числа он исходит.
 */
export function StageReportForm({ entry, dept, busy, onSubmit, onCancel }) {
  const { item, stage } = entry;

  const fields = useMemo(
    () => (Array.isArray(dept?.result_fields) ? dept.result_fields : []),
    [dept],
  );
  const qtyIn = useMemo(
    () => stageInputQty(stage, item.stages ?? [], item.qty),
    [stage, item],
  );
  const remaining = useMemo(
    () => stageRemainingQty(stage, item.stages ?? [], item.qty),
    [stage, item],
  );

  const [values, setValues] = useState({});
  const [comment, setComment] = useState('');

  const num = (code) => {
    const raw = values[code];
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };

  /** Суммируем по НАЗНАЧЕНИЮ: у участка может быть два поля в одну колонку */
  const totals = useMemo(() => {
    const acc = { qty_good: 0, qty_defect: 0, qty_rework: 0, qty_extra: 0 };
    const extra = {};
    for (const f of fields) {
      const n = num(f.code);
      if (f.target === 'extra') {
        if (values[f.code] !== undefined && values[f.code] !== '') extra[f.code] = n;
      } else if (acc[f.target] !== undefined) {
        acc[f.target] += n;
      }
    }
    return { ...acc, extra };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, values]);

  const anything = totals.qty_good + totals.qty_defect + totals.qty_rework + totals.qty_extra > 0;
  const needsComment = totals.qty_defect > 0 || totals.qty_rework > 0;
  const missingRequired = fields.some((f) => f.required && num(f.code) <= 0);

  const submit = () => onSubmit({
    qtyIn,
    qtyGood: totals.qty_good,
    qtyDefect: totals.qty_defect,
    qtyRework: totals.qty_rework,
    qtyExtra: totals.qty_extra,
    comment,
    extra: totals.extra,
  });

  return (
    <div className={styles.queueBlockForm}>
      <span className={styles.queueReason}>
        <span className={styles.cellWithIcon}>
          <Icon name="box" size={14} />
          Принято в работу: <b>{qtyIn}</b> шт
          {qtyIn !== item.qty && <span className={styles.subText}> (тираж {item.qty})</span>}
          {remaining > 0 && <span className={styles.subText}> · осталось сдать {remaining}</span>}
        </span>
      </span>

      <div className={styles.planFormRow}>
        {fields.map((f) => (
          <label key={f.code} className={styles.field}>
            <span className={styles.fieldLabel}>
              {f.label}{f.required ? ' *' : ''}{f.unit ? `, ${f.unit}` : ''}
            </span>
            <input
              type="number"
              min="0"
              className={`${styles.input} ${styles.qtySmallInput}`}
              value={values[f.code] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.code]: e.target.value }))}
              aria-label={`${f.label}${f.unit ? `, ${f.unit}` : ''}`}
            />
          </label>
        ))}
      </div>

      {/*
        Комментарий обязателен при отклонении — то же правило стоит CHECK-ом
        в базе. Здесь оно не дублируется «на всякий случай», а объясняется
        человеку до отправки: узнать о нём из отказа сервера хуже.
      */}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Комментарий{needsComment ? ' * (объясните отклонение)' : ''}
        </span>
        <input
          className={styles.input}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={needsComment ? 'что именно пошло не так' : 'необязательно'}
        />
      </label>

      <div className={styles.queueActions}>
        <Button
          variant="primary"
          disabled={busy || !anything || missingRequired || (needsComment && !comment.trim())}
          onClick={submit}
        >
          <Icon name="check" size={14} /> Сдать результат
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Отмена</Button>
      </div>
    </div>
  );
}
