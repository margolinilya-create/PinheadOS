import { useState } from 'react';
import { Button } from './Button';
import {
  fmtM, fmtKg, kgPerMFromParams, lengthFromWeight, sourceLabel,
} from '../utils/fabricMetres';
import styles from '../styles';

/**
 * ПАРАМЕТРЫ РУЛОНА ДЛЯ УЧЁТА В МЕТРАХ (правка заказчика 27.09, п. 4).
 *
 * «Недостающие параметры разрешить заполнить в закройке до записи расхода…
 * Недостающие поля подсвечивать красным». Форма одна и для закроя (рулон
 * без метража прямо в блоке сдачи), и для склада (дозаполнение у принятых
 * до правки): пишет её `erp_material_roll_set_params`, который сам решает,
 * пересчёт это (до первого расхода) или корректировка (после).
 *
 * РАСЧЁТ ПОКАЗЫВАЕТСЯ ДО НАЖАТИЯ: «20 кг × 180 см × 240 г/м² → 46,30 м»
 * закройщик видит сразу и может сверить с биркой поставщика. Метраж
 * поставщика или замер, если указан, побеждает расчёт — и тогда плотность
 * не обязательна («если есть метраж поставщика или замер, отсутствие
 * плотности не должно мешать учёту в метрах»).
 */
export function RollParamsForm({ roll, material, onSave, disabled = false, note = null }) {
  const [width, setWidth] = useState(roll.width_cm ?? material?.width_cm ?? '');
  const [density, setDensity] = useState(roll.density_gsm ?? material?.density_gsm ?? '');
  const [lengthM, setLengthM] = useState('');
  const [source, setSource] = useState('supplier');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  /**
   * ЧИСТЫЙ ВЕС — у рулона, принятого до правки 21.09 без веса (правка 28.09):
   * «для связи с закупкой в кг при этом нужен чистый вес рулона». Записанный
   * вес здесь не правится — это делает склад.
   */
  const noWeight = !(Number(roll.qty) > 0);
  const [weightInput, setWeightInput] = useState('');

  const weight = noWeight ? weightInput : roll.qty;
  const calc = lengthFromWeight(weight, width, density);
  const kgPerM = kgPerMFromParams(width, density);
  const hasLength = Number(lengthM) > 0;
  // Уточнение уже размеченного рулона — корректировка, ей нужна причина
  const refining = roll.length_m !== null && roll.length_m !== undefined;
  const missing = {
    width: !(Number(width) > 0) && !hasLength,
    density: !(Number(density) > 0) && !hasLength,
    // Вес нужен всегда: для расчёта по весу и для связи метража с закупкой в кг
    weight: !(Number(weight) > 0),
  };
  const canSave = !saving && !missing.weight && (hasLength || calc !== null);

  const save = async () => {
    setSaving(true);
    const ok = await onSave(roll.id, {
      width_cm: Number(width) > 0 ? Number(width) : null,
      density_gsm: Number(density) > 0 ? Number(density) : null,
      length_m: hasLength ? Number(lengthM) : null,
      length_source: hasLength ? source : null,
      reason: reason.trim() || null,
      weight_kg: noWeight && Number(weightInput) > 0 ? Number(weightInput) : null,
    });
    setSaving(false);
    if (ok) setLengthM('');
  };

  return (
    <div className={styles.queueBlockForm} role="group" aria-label={`Параметры рулона ${roll.label}`}>
      {note && <p className={styles.queueReason}>{note}</p>}
      <div className={styles.planFormRow}>
        {noWeight && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Чистый вес рулона, кг *</span>
            <input
              type="number" min="0" step="0.001" inputMode="decimal"
              className={`${styles.input} ${styles.qtySmallInput}${missing.weight ? ` ${styles.inputError}` : ''}`}
              value={weightInput}
              disabled={disabled || saving}
              aria-invalid={missing.weight || undefined}
              aria-label={`Чистый вес рулона, ${roll.label}`}
              onChange={(e) => setWeightInput(e.target.value)}
            />
          </label>
        )}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Ширина полотна, см{missing.width ? ' *' : ''}</span>
          <input
            type="number" min="0" step="1" inputMode="decimal"
            className={`${styles.input} ${styles.qtySmallInput}${missing.width ? ` ${styles.inputError}` : ''}`}
            value={width}
            disabled={disabled || saving}
            aria-invalid={missing.width || undefined}
            aria-label={`Ширина полотна, ${roll.label}`}
            onChange={(e) => setWidth(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Плотность, г/м²{missing.density ? ' *' : ''}</span>
          <input
            type="number" min="0" step="1" inputMode="decimal"
            className={`${styles.input} ${styles.qtySmallInput}${missing.density ? ` ${styles.inputError}` : ''}`}
            value={density}
            disabled={disabled || saving}
            aria-invalid={missing.density || undefined}
            aria-label={`Плотность, ${roll.label}`}
            onChange={(e) => setDensity(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Метраж, м</span>
          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            className={`${styles.input} ${styles.qtySmallInput}`}
            value={lengthM}
            disabled={disabled || saving}
            placeholder="если известен"
            aria-label={`Метраж рулона, ${roll.label}`}
            onChange={(e) => setLengthM(e.target.value)}
          />
        </label>
        {hasLength && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Откуда метраж</span>
            <select
              className={styles.select}
              value={source}
              disabled={disabled || saving}
              aria-label={`Источник метража, ${roll.label}`}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="supplier">по данным поставщика</option>
              <option value="measured">замер</option>
            </select>
          </label>
        )}
        {refining && (
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>Причина уточнения</span>
            <input
              className={styles.input}
              value={reason}
              disabled={disabled || saving}
              placeholder="например, сверка после раскладки"
              aria-label={`Причина уточнения, ${roll.label}`}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
      </div>
      <span className={styles.subText} role="status">
        {missing.weight && 'Укажите чистый вес рулона без втулки и упаковки — без него метраж не связать с закупкой в кг. '}
        {hasLength
          ? `Рабочий метраж: ${fmtM(lengthM)} (${sourceLabel(source)})`
          : calc !== null
            ? `Расчётный метраж: ${fmtM(calc)} (расчёт) · коэффициент ${kgPerM?.toFixed(3)} кг/м · вес ${fmtKg(weight)}`
            : 'Для расчёта нужны вес, ширина и плотность — либо метраж поставщика или замер.'}
      </span>
      <Button variant="secondary" size="sm" disabled={disabled || !canSave} onClick={save}>
        Записать параметры рулона
      </Button>
    </div>
  );
}
