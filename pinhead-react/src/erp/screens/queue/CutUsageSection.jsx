import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { RollParamsForm } from '../../components/RollParamsForm';
import { fabricAcceptedWithoutRolls } from '../../utils/cutRolls';
import { rollUsedM } from '../../utils/cutUsage';
import { METRES_MISSING_TEXT, rollAvailableM, rollWorkingLength } from '../../utils/fabricMetres';
import { RollsInWork } from './RollsInWork';
import { useRollsInWork } from './useRollsInWork';
import { avgText, materialLabel, metres, rollName } from './useCutReport';
import css from './CutUsageSection.module.css';

const MODES = [
  { value: 'unused', label: 'Не использован' },
  { value: 'full', label: 'Полностью' },
  { value: 'partial', label: 'Частично' },
];
const NONE = [];

/** Рулоны по материалу в порядке формы; чужие остатки — своей группой */
function groupsOf(options) {
  const map = new Map();
  for (const option of options) {
    const key = `${option.material.id}${option.fromOrder ? ':foreign' : ''}`;
    let g = map.get(key);
    if (!g) {
      const label = materialLabel(option.material);
      g = { key, material: option.material, label: option.fromOrder ? `${label} — остатки других заказов` : label, options: [] };
      map.set(key, g);
    }
    g.options.push(option);
  }
  return [...map.values()];
}

const rub = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

/** Итоги группы: расход, списание, всего, остаток, стоимость, средний */
function GroupTotals({ total }) {
  if (!total) return null;
  return (
    <p className={css.totals}>
      Расход на крой {metres(total.cutM)} · Списание {metres(total.scrapM)} · Всего {metres(total.totalM)}
      {' '}· Пригодный остаток {metres(total.usableLeftM)} · Стоимость {rub(total.cutCost + total.scrapCost)}
      {' '}· {avgText(total)}
    </p>
  );
}

function RollRow({ option, cut, disabled, onRollParams }) {
  const { roll } = option;
  const id = useId();
  const [refining, setRefining] = useState(false);
  const row = cut.usageRows.find((r) => r.rollId === roll.id);
  const available = rollAvailableM(roll, option.material);
  const working = rollWorkingLength(roll, option.material);
  const errors = cut.visibleErrors(roll.id);
  const leftErrors = errors.filter((e) => e.startsWith('Введите остаток') || e.startsWith('Остаток '));
  const fateErrors = errors.filter((e) => e.startsWith('Выберите'));
  const useErrors = errors.filter((e) => e.startsWith(METRES_MISSING_TEXT));
  const first = cut.firstError?.rollId === roll.id ? cut.firstError.field : null;
  const name = rollName(option);
  const used = available === null ? 0 : rollUsedM(available, row);

  return (
    <div role="group" aria-label={roll.label} className={css.row}>
      <label className={css.check}>
        <input
          type="checkbox"
          checked={cut.selected.has(roll.id)}
          disabled={disabled}
          onChange={() => cut.toggleSelect(roll.id)}
          aria-label={`Выбрать ${name}`}
        />
        <span className={css.rollTitle}>
          № {roll.seq} · Доступно {available === null ? '—' : metres(available)}
          {working?.source === 'calc' && <span className={css.sub}> · расчётный метраж</span>}
          {option.fromOrder && <span className={css.sub}> · остаток заказа {option.fromOrder}</span>}
        </span>
      </label>

      <div
        role="radiogroup"
        aria-label={`${roll.label} — использование`}
        aria-invalid={useErrors.length > 0 || undefined}
        aria-describedby={useErrors.length > 0 ? `${id}-use` : undefined}
        className={css.modes}
      >
        {MODES.map((m) => (
          <label key={m.value} className={css.tile}>
            <input
              type="radio"
              name={`use-${roll.id}`}
              value={m.value}
              checked={row.use === m.value}
              disabled={disabled}
              ref={first === 'use' && row.use === m.value ? cut.firstErrorRef : undefined}
              onChange={() => cut.setUse(roll.id, m.value)}
            />
            <span>{m.label}</span>
          </label>
        ))}
      </div>

      <span className={css.used}>
        <span className={css.sub}>Расход, м</span>
        <b data-testid={`used-${roll.seq}`}>{metres(used)}</b>
      </span>

      {row.use === 'partial' && (
        <div className={css.partial}>
          <label className={css.field}>
            <span className={css.label}>Остаток, м</span>
            <input
              type="number" min="0" step="0.01" inputMode="decimal"
              className={css.input}
              value={cut.leftoverRaw(roll.id)}
              disabled={disabled}
              ref={first === 'leftover' ? cut.firstErrorRef : undefined}
              aria-label={`Остаток, м — ${name}`}
              aria-invalid={leftErrors.length > 0 || undefined}
              aria-describedby={leftErrors.length > 0 ? `${id}-left` : undefined}
              onChange={(e) => cut.setLeftover(roll.id, e.target.value)}
              onBlur={cut.commit}
            />
          </label>
          <div
            role="radiogroup"
            aria-label={`${roll.label} — остаток`}
            aria-required="true"
            aria-invalid={fateErrors.length > 0 || undefined}
            aria-describedby={fateErrors.length > 0 ? `${id}-fate` : undefined}
            className={css.modes}
          >
            <label className={css.tile}>
              <input
                type="radio" name={`fate-${roll.id}`} value="usable"
                checked={row.fate === 'usable'} disabled={disabled}
                ref={first === 'fate' ? cut.firstErrorRef : undefined}
                onChange={() => cut.setFate(roll.id, 'usable')}
              />
              <span>Остаток пригоден</span>
            </label>
            <label className={css.tile}>
              <input
                type="radio" name={`fate-${roll.id}`} value="scrap"
                checked={row.fate === 'scrap'} disabled={disabled}
                aria-describedby={`${id}-scrap`}
                onChange={() => cut.setFate(roll.id, 'scrap')}
              />
              <span>Малый остаток, не учитывать</span>
              <span id={`${id}-scrap`} className={css.sub}>спишется в отходы</span>
            </label>
          </div>
        </div>
      )}

      {useErrors.length > 0 && <p id={`${id}-use`} className={css.error}>{useErrors.join('. ')}</p>}
      {leftErrors.length > 0 && <p id={`${id}-left`} className={css.error}>{leftErrors.join('. ')}</p>}
      {fateErrors.length > 0 && <p id={`${id}-fate`} className={css.error}>{fateErrors.join('. ')}</p>}

      {working?.stored && onRollParams && (
        <Button variant="ghost" size="sm" disabled={disabled} aria-expanded={refining} onClick={() => setRefining((v) => !v)}>
          Уточнить метраж рулона
        </Button>
      )}
      {/* Рулон без метража: расход не записать, пока параметры не заполнены (27.09, п. 4) */}
      {!working?.stored && (
        <p className={css.sub}><Icon name="alert" size={13} /> {METRES_MISSING_TEXT}: у рулона нет ширины, плотности или метража.</p>
      )}
      {onRollParams && (refining || !working?.stored) && (
        <RollParamsForm roll={roll} material={option.material} onSave={onRollParams} disabled={disabled} />
      )}
    </div>
  );
}

function Group({ group, cut, disabled, onRollParams, isFirst }) {
  const ids = group.options.map((o) => o.roll.id);
  const picked = ids.filter((rid) => cut.selected.has(rid)).length;
  const total = cut.totals.find((t) => t.materialId === group.material.id);
  const onMark = async (e) => {
    if (picked === 0 || disabled) return;
    const button = e.currentTarget;
    await cut.markSelectedFull(ids);
    button.focus();
  };
  return (
    <fieldset className={css.group}>
      <legend className={css.legend}>{group.label}</legend>
      <div className={css.groupBar}>
        <label className={css.check}>
          <input
            type="checkbox"
            ref={(el) => {
              if (el) el.indeterminate = picked > 0 && picked < ids.length;
              if (isFirst) cut.bindFirstGroup(el);
            }}
            checked={picked > 0 && picked === ids.length}
            disabled={disabled}
            onChange={() => cut.selectGroup(ids, picked < ids.length)}
            aria-label={`Выбрать все в группе ${group.label}`}
          />
          <span>Выбрать все</span>
        </label>
        <span className={css.sub}>Выбрано: {picked}</span>
        <Button
          variant="secondary"
          size="sm"
          ariaDisabledReason={picked === 0 ? 'Отметьте рулоны флажками' : ''}
          disabled={disabled}
          onClick={onMark}
        >
          Использованы полностью
        </Button>
      </div>
      {group.options.map((option) => (
        <RollRow key={option.roll.id} option={option} cut={cut} disabled={disabled} onRollParams={onRollParams} />
      ))}
      <GroupTotals total={total} />
    </fieldset>
  );
}

/**
 * «РАСХОД ТКАНИ» (правки 19.10, «Закрой»): рулоны группами «материал · цвет»,
 * у каждого три режима — «Не использован», «Полностью», «Частично».
 * Выпуск здесь НЕ вводится (он один раз в «Результате кроя»), поэтому два
 * материала одной позиции не удваивают годные.
 *
 * РУЛОНЫ НЕ ВВОДЯТСЯ ВРУЧНУЮ: список — то, что склад принял по материалам
 * позиции, и пригодные остатки других заказов (`rollsForItem`).
 */
export function CutUsageSection({
  cut, options, order = null, item = null, stage = null, extraRolls = NONE,
  onFinishRoll = null, onRollParams = null, disabled = false,
}) {
  const { awaitingFate, inWork } = useRollsInWork({ order, item, stage, options, extraRolls });
  const titleId = useId();
  const groups = groupsOf(options);
  return (
    <section className={css.section} aria-labelledby={titleId}>
      <h3 id={titleId} className={css.title}>Расход ткани</h3>
      {options.length === 0 && (
        <p className={css.sub}>
          <Icon name="alert" size={13} />
          {' '}
          {fabricAcceptedWithoutRolls(order?.materials, item?.id)
            ? 'Ткань принята без разбивки по рулонам. Склад добавляет рулоны в приёмке материала — '
              + 'после этого здесь можно отметить расход.'
            : 'Склад ещё не принял ткань по этой позиции — расход фиксировать не с чего. Рулоны появятся после приёмки.'}
        </p>
      )}
      {groups.map((g, i) => (
        <Group key={g.key} group={g} cut={cut} disabled={disabled} onRollParams={onRollParams} isFirst={i === 0} />
      ))}
      <RollsInWork
        inWork={inWork}
        awaitingCount={awaitingFate.length}
        itemId={item?.id ?? null}
        onFinishRoll={onFinishRoll}
        disabled={disabled}
      />
    </section>
  );
}
