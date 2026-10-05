import { useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { RollParamsForm } from '../../components/RollParamsForm';
import {
  fmtM, kgPerMFromMeasure, kgPerMFromParams, pricePerM, rollWorkingLength,
} from '../../utils/fabricMetres';
import {
  newRollRow, rollParamsPayload, rollRowMetres, weightsFilled, weightsSum,
} from '../../utils/rollParams';
import { createAttemptKeeper } from '../../utils/attemptKey';
import styles from '../../styles';

/**
 * РУЛОНЫ ПОСТАВКИ — ОДИН РУЛОН, ОДНА СТРОКА (правка 27.09, п. 4; таблицей —
 * правка заказчика 05.10, п. 4).
 *
 * «Параметры рулона разбиты на две строки, у полей нет отдельных подписей…
 * Один рулон – одна строка: номер, вес в кг, ширина в см, плотность в г/м²,
 * фактический метраж и расчётный метраж в м. У каждого поля должна быть
 * подпись с единицей измерения. Ширину и плотность подставлять из закупки,
 * но давать менять по рулонам». Число рулонов = число строк: строку
 * добавляет «+ Рулон», убирает ✕ у строки.
 *
 * На широкой панели — таблица (подписи с единицами в шапке), на компактной
 * раскладке — карточки с подписью у каждого поля: та же строка, развёрнутая
 * вертикально, а не вторая копия с другими правилами.
 *
 * Номера ПРЕДВАРИТЕЛЬНЫЕ: настоящие даёт сервер сквозной нумерацией внутри
 * материала, и у каждого рулона он сохраняется.
 *
 * `noun` различает подписи двух таблиц одной панели: приёмки новой
 * поставки и добавления рулонов к принятому («добавляемого рулона»).
 */
const COLUMNS = [
  { key: 'weight', label: 'Вес, кг', aria: 'Вес', step: '0.01' },
  { key: 'width', label: 'Ширина, см', aria: 'Ширина', step: '1' },
  { key: 'density', label: 'Плотность, г/м²', aria: 'Плотность', step: '1' },
  { key: 'length', label: 'Фактический метраж, м', aria: 'Фактический метраж', step: '0.01' },
];

export function RollParamsFields({
  rows, onChange, material, disabled = false, noun = 'рулона', compact = false,
}) {
  const setField = (i, key, value) => onChange((prev) => prev.map(
    (row, j) => (j === i ? { ...row, [key]: value } : row)));
  const add = () => onChange((prev) => [...prev, newRollRow(material)]);
  const remove = (i) => onChange((prev) => prev.filter((_, j) => j !== i));

  const cells = (row, i) => {
    const metres = rollRowMetres(row, material);
    /**
     * ПОДСВЕТКА НЕДОСТАЮЩЕГО (правка 28.09): ширина и плотность нужны, пока
     * нет фактического метража; это подсказка, а не запрет.
     */
    const needParams = metres.actual === null && Number(row.weight) > 0;
    const missing = {
      width: needParams && !(Number(row.width ?? material?.width_cm) > 0),
      density: needParams && !(Number(row.density ?? material?.density_gsm) > 0),
    };
    const perM = pricePerM(material?.price_per_unit, metres.actual !== null
      ? kgPerMFromMeasure(row.weight, metres.actual)
      : kgPerMFromParams(row.width || material?.width_cm, row.density || material?.density_gsm));
    const inputs = COLUMNS.map((c) => (
      <input
        key={c.key}
        type="number" min="0" step={c.step} inputMode="decimal"
        className={`${styles.input} ${styles.qtySmallInput}${missing[c.key] ? ` ${styles.inputError}` : ''}`}
        aria-invalid={missing[c.key] || undefined}
        value={row[c.key] ?? ''}
        disabled={disabled}
        aria-label={`${c.aria} ${noun} ${i + 1}, ${material?.name ?? ''}`}
        onChange={(e) => setField(i, c.key, e.target.value)}
      />
    ));
    /** «Если фактический метраж указан, использовать его. Если нет – расчётный, с пометкой „расчёт"» */
    const calc = (
      <span className={styles.subText}>
        {metres.calc === null ? '—' : fmtM(metres.calc)}
        {metres.calc !== null && (metres.actual === null ? ' · расчёт' : ' · для справки')}
        {perM !== null ? ` · ≈ ${perM.toFixed(2).replace('.', ',')} ₽/м` : ''}
      </span>
    );
    const drop = (
      <Button
        variant="ghost" size="sm" disabled={disabled}
        aria-label={`Убрать строку ${noun} ${i + 1}`}
        onClick={() => remove(i)}
      >
        ✕
      </Button>
    );
    return { inputs, calc, drop };
  };

  return (
    <div className={`${styles.field} ${styles.fieldWide}`}>
      {compact ? (
        <div className={styles.cutSizes}>
          {rows.map((row, i) => {
            const { inputs, calc, drop } = cells(row, i);
            return (
              <div key={i} className={styles.dataCard}>
                <div className={styles.matSectionHead}>
                  <strong>Рулон {i + 1}</strong>
                  {drop}
                </div>
                {COLUMNS.map((c, k) => (
                  /* Подпись видима, имя поля — его aria-label с номером рулона */
                  <div key={c.key} className={styles.field}>
                    <span className={styles.fieldLabel} aria-hidden="true">{c.label}</span>
                    {inputs[k]}
                  </div>
                ))}
                <span className={styles.fieldLabel}>Расчётный метраж, м</span>
                {calc}
              </div>
            );
          })}
        </div>
      ) : (
        <ScrollHintBox className={styles.tableWrap} label="Рулоны поставки">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>№</th>
                {COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}
                <th>Расчётный метраж, м</th>
                <th><span className={styles.visuallyHidden}>Убрать</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const { inputs, calc, drop } = cells(row, i);
                return (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    {inputs.map((input, k) => <td key={COLUMNS[k].key}>{input}</td>)}
                    <td>{calc}</td>
                    <td>{drop}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollHintBox>
      )}
      <Button variant="secondary" size="sm" disabled={disabled} onClick={add} aria-label={`Добавить строку ${noun}`}>
        <Icon name="plus" size={14} /> Рулон
      </Button>
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

/**
 * РУЛОНЫ К УЖЕ ПРИНЯТОЙ ТКАНИ (правка 01.10, п. 1).
 *
 * «К уже закрытому приходу нужно разрешить добавить рулоны без повторного
 * поступления и удвоения остатка. После этого рулоны должны появиться
 * в закройке». Повторная приёмка тут не годится: она пишет второй приход.
 * Поэтому отдельное действие (`erp_material_rolls_add`) раскладывает уже
 * принятые килограммы — блок виден, пока часть принятого не разбита.
 */
export function AddRollsBlock({ material: m, unitLabel, onAdd, compact = false }) {
  const rolls = m.rolls ?? [];
  const received = Number(m.qty_received ?? 0);
  const covered = rolls.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
  const left = Math.round((received - covered) * 100) / 100;
  // Строки — как в приёмке (правка 05.10, п. 4): число рулонов = число строк
  const [rows, setRows] = useState(() => [newRollRow(m)]);
  const [saving, setSaving] = useState(false);
  const attempt = useRef(null);
  if (attempt.current == null) { attempt.current = createAttemptKeeper(); }

  // Рулоны без веса дозаполняются своим блоком: без веса сумму не сверить
  if (received <= 0 || left <= 0.01 || rolls.some((r) => r.qty == null)) return null;

  const n = rows.length;
  const filled = weightsFilled(rows, n);
  const sum = weightsSum(rows, n);
  const mismatch = n > 0 && filled && Math.abs(sum - left) > 0.01;

  const save = async () => {
    setSaving(true);
    const payload = rollParamsPayload(rows, n);
    const ok = await onAdd(m.id, payload, attempt.current.keyFor(JSON.stringify([m.id, payload])));
    setSaving(false);
    if (ok) { attempt.current.reset(); setRows([newRollRow(m)]); }
  };

  const u = unitLabel ? ` ${unitLabel}` : '';
  return (
    <div className={styles.tzBlock}>
      <span className={styles.fieldLabel}>
        {rolls.length === 0 ? 'Ткань принята без разбивки по рулонам' : 'Часть принятой ткани не разбита по рулонам'}
      </span>
      <span className={styles.subText}>
        Не разбито: <b>{left}</b>{u} из принятых {received}{u}. Закрой записывает расход
        только по рулонам — добавьте их. Приход при этом не повторяется.
      </span>
      <RollParamsFields
        rows={rows} onChange={setRows} material={m} disabled={saving}
        noun="добавляемого рулона" compact={compact}
      />
      <span className={styles.subText} role="status">
        Рулонов: {n} · сумма весов {sum}{u} из {left}{u}
        {mismatch && ` — ${sum > left ? 'лишние' : 'не хватает'} ${Math.round(Math.abs(sum - left) * 100) / 100}${u}`}
      </span>
      <Button variant="secondary" size="sm" disabled={saving || n === 0 || !filled || mismatch} onClick={save}>
        Добавить рулоны
      </Button>
    </div>
  );
}
