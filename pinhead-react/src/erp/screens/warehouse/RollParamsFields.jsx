import { useState } from 'react';
import { Button } from '../../components/Button';
import { RollParamsForm } from '../../components/RollParamsForm';
import { fmtM, lengthFromWeight, rollWorkingLength } from '../../utils/fabricMetres';
import { weightsFilled, weightsSum } from '../../utils/rollParams';
import styles from '../../styles';

/**
 * ПАРАМЕТРЫ КАЖДОГО РУЛОНА В ФОРМЕ ПРИЁМКИ (правка 27.09, п. 4).
 *
 * Строки раскрываются от введённого количества рулонов (правка 21.09, п. 2:
 * «после ввода количества рулонов создавать отдельные сущности „Рулон 1",
 * „Рулон 2"… каждый рулон хранит свой первоначальный вес»). Теперь у строки
 * кроме веса — ширина и плотность (подставлены из материала, уточняются
 * для партии) и метраж поставщика, если он на бирке.
 *
 * Расчётный метраж показывается сразу: кладовщик видит «46,30 м» до нажатия
 * и может сверить с биркой. Номера ПРЕДВАРИТЕЛЬНЫЕ: настоящие даёт сервер
 * сквозной нумерацией внутри материала.
 *
 * Вынесено из `MaterialReceiptCard` (потолок размера): там остаётся
 * решение «что обязательно», здесь — только поля.
 */
export function RollParamsFields({
  count, params, onChange, material, unitLabel, arriving, disabled = false, required = false,
}) {
  const setField = (i, key, value) => onChange((prev) => {
    const next = [...prev];
    next[i] = { ...(next[i] ?? {}), [key]: value };
    return next;
  });
  const sum = weightsSum(params, count);
  const filled = weightsFilled(params, count);
  const width = (i) => params[i]?.width ?? material.width_cm ?? '';
  const density = (i) => params[i]?.density ?? material.density_gsm ?? '';

  return (
    <div className={`${styles.field} ${styles.fieldWide}`}>
      <span className={styles.fieldLabel}>
        Рулоны: вес{unitLabel ? `, ${unitLabel}` : ''}, ширина, плотность, метраж{required ? ' *' : ''}
      </span>
      <div className={styles.cutSizes}>
        {Array.from({ length: count }, (_, i) => {
          const calc = lengthFromWeight(params[i]?.weight, width(i), density(i));
          const length = Number(params[i]?.length) > 0 ? Number(params[i].length) : null;
          return (
            <div key={i} className={styles.cutSizeRow}>
              <span className={styles.dataCardFieldLabel}>Рулон {i + 1}</span>
              <input
                type="number" min="0" step="0.01" inputMode="decimal"
                className={`${styles.input} ${styles.qtySmallInput}`}
                value={params[i]?.weight ?? ''}
                disabled={disabled}
                placeholder="кг"
                aria-label={`Вес рулона ${i + 1}, ${material.name}`}
                onChange={(e) => setField(i, 'weight', e.target.value)}
              />
              <input
                type="number" min="0" step="1" inputMode="decimal"
                className={`${styles.input} ${styles.qtySmallInput}`}
                value={width(i)}
                disabled={disabled}
                placeholder="см"
                aria-label={`Ширина рулона ${i + 1}, ${material.name}`}
                onChange={(e) => setField(i, 'width', e.target.value)}
              />
              <input
                type="number" min="0" step="1" inputMode="decimal"
                className={`${styles.input} ${styles.qtySmallInput}`}
                value={density(i)}
                disabled={disabled}
                placeholder="г/м²"
                aria-label={`Плотность рулона ${i + 1}, ${material.name}`}
                onChange={(e) => setField(i, 'density', e.target.value)}
              />
              <input
                type="number" min="0" step="0.01" inputMode="decimal"
                className={`${styles.input} ${styles.qtySmallInput}`}
                value={params[i]?.length ?? ''}
                disabled={disabled}
                placeholder="м (по бирке)"
                aria-label={`Метраж рулона ${i + 1}, ${material.name}`}
                onChange={(e) => setField(i, 'length', e.target.value)}
              />
              <span className={styles.subText}>
                {length !== null
                  ? `${fmtM(length)} (по данным поставщика)`
                  : calc !== null ? `${fmtM(calc)} (расчёт)` : 'метраж: — (нужны вес, ширина и плотность)'}
              </span>
            </div>
          );
        })}
      </div>
      <span className={styles.subText} role="status">
        Сумма весов: <b>{sum}</b>
        {unitLabel ? ` ${unitLabel}` : ''}
        {arriving > 0 && ` из ${arriving}`}
        {!filled && ' · вес каждого рулона обязателен'}
      </span>
    </div>
  );
}

/**
 * ДОЗАПОЛНЕНИЕ ПАРАМЕТРОВ У ПРИНЯТЫХ РУЛОНОВ (правка 27.09, п. 4).
 *
 * Сорок один рулон на бою принят с весом, но без ширины и плотности —
 * метража у них нет, и закрой не запишет по ним расход в метрах. Склад
 * дозаполняет параметры здесь, тем же RPC, что и закрой в своей форме
 * (`erp_material_roll_set_params`); рулоны без веса сначала получают вес
 * в `LegacyRollWeights` — без него расчёт невозможен, а метраж по замеру
 * оставит рулон без связи с закупкой в кг.
 */
export function LegacyRollParams({ material: m, onSave }) {
  const pending = (m.rolls ?? []).filter((r) => r.qty != null && !rollWorkingLength(r, m)?.stored);
  const [open, setOpen] = useState(null);
  if (pending.length === 0) return null;
  return (
    <div className={styles.tzBlock}>
      <span className={styles.fieldLabel}>Метраж принятых рулонов</span>
      <span className={styles.subText}>
        У этих рулонов нет ширины, плотности или метража — закрой не сможет
        записать по ним расход в метрах, пока параметры не заполнены.
      </span>
      <div className={styles.cutSizes}>
        {pending.map((r) => (
          <div key={r.id} className={styles.cutSizeRow}>
            <span className={styles.dataCardFieldLabel}>{r.label}</span>
            <span className={styles.subText}>вес {r.qty} {r.unit ?? m.unit ?? ''}</span>
            <Button
              variant="ghost" size="sm"
              onClick={() => setOpen(open === r.id ? null : r.id)}
            >
              {open === r.id ? 'Свернуть' : 'Заполнить параметры'}
            </Button>
            {open === r.id && (
              <RollParamsForm roll={r} material={m} onSave={onSave} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
