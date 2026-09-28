import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import {
  rollsForItem, cutTotals, rollTotal, cellKey, rollLeft, rollAvailable, rollHasMetres,
  rollsAwaitingFate, rollLeftText, metresText,
} from '../../utils/cutRolls';
import {
  fmtKg, kgFromLength, rollKgPerM, rollPricePerM, rollWorkingLength, sourceLabel, METRES_MISSING_TEXT,
} from '../../utils/fabricMetres';
import { sizeChoicesFor, freeChoices, hasPlannedSizes } from '../../utils/sizeChoices';
import { cutExtras, cutExtrasText } from '../../utils/cutExtras';
import { NO_COLOR } from '../../utils/sizeGrid';
import { CutSizeRows } from './CutSizeRows';
import { RollParamsForm } from '../../components/RollParamsForm';
import styles from '../../styles';

/**
 * РАСКРОЙ ПО РУЛОНАМ ВНУТРИ ФОРМЫ СДАЧИ (правка 16.09, п. 4; размерные
 * строки — 20.09, п. 7; расход В МЕТРАХ — 27.09, п. 4).
 *
 * «Не создавать отдельный экран аналитики на этапе ввода. Детализацию
 * встроить непосредственно в существующий блок сдачи результата закроя».
 * Поэтому это секция внутри `StageReportForm`, а не свой экран и не модалка.
 *
 * РУЛОНЫ НЕ ВВОДЯТСЯ ВРУЧНУЮ: селект перечисляет то, что склад принял по
 * материалам этой позиции (`utils/cutRolls.rollsForItem`). Закройщик выбирает
 * рулон и заполняет только расход и раскрой — ровно как просит документ.
 *
 * РАСХОД — В ПОГОННЫХ МЕТРАХ ПОЛНОЙ ШИРИНЫ (правка 27.09, п. 4): «в блоке
 * каждого рулона заменить поле „Фактический расход, кг" на „Фактический
 * расход, м". Рядом показывать доступный метраж и его источник, а также
 * расчётный эквивалент расхода в кг. Второй раз вводить расход
 * в килограммах не нужно». У рулона без метража — предупреждение
 * «Не заполнены данные для учёта в метрах» и форма параметров прямо здесь.
 *
 * ИТОГИ СЧИТАЮТСЯ, А НЕ ВВОДЯТСЯ: итог с рулона, общий выход, общий расход
 * и итог по каждому размеру — всё из `cutTotals`. Поле «итого», которое
 * человек заполняет сам, разошлось бы со строками на первой же правке.
 */
export function CutRollsSection({
  order, item, stage = null, entries, onChange, onRollFate = null, onRollParams = null,
  disabled = false, reported = {}, extraRolls = [],
}) {
  /**
   * Рулоны позиции и ОСТАТКИ ДРУГИХ ЗАКАЗОВ (правка 28.09): «каждый следующий
   * заказ получает только доступный остаток рулона». Чужие — в конце списка
   * и подписаны заказом-источником.
   */
  const options = useMemo(
    () => rollsForItem(order?.materials, item?.id, entries.map((e) => e.rollId), extraRolls),
    [order, item, entries, extraRolls],
  );
  /** Рулоны, у которых закройщик открыл уточнение метража (правка 28.09) */
  const [refining, setRefining] = useState(() => new Set());
  const toggleRefine = (rollId) => setRefining((cur) => {
    const next = new Set(cur);
    if (next.has(rollId)) next.delete(rollId); else next.add(rollId);
    return next;
  });
  /**
   * РУЛОНЫ БЕЗ СУДЬБЫ ОСТАТКА (правка 27.09, п. 2): оставлены «в работе»
   * прежней сдачей, остаток есть, вид не выбран. Пока они не закрыты,
   * последний этап участка в заказе не закроется — и решить это можно
   * прямо здесь, без новой строки расхода. Рулон, уже добавленный
   * в форму, решается его же галочкой ниже.
   */
  const inEntries = new Set(entries.map((e) => e.rollId).filter(Boolean));
  const awaitingFate = useMemo(
    () => (stage ? rollsAwaitingFate(order?.materials, item?.id, stage, order?.items, extraRolls) : []),
    [order, item, stage, extraRolls],
  ).filter((o) => !inEntries.has(o.roll.id));
  const choices = useMemo(() => sizeChoicesFor(item?.size_grid), [item]);
  const planned = useMemo(() => hasPlannedSizes(item?.size_grid), [item]);
  const totals = useMemo(() => cutTotals(entries), [entries]);
  /**
   * ПЛЮСЫ (правка 21.09, п. 3): «разрешать скроить по размеру больше
   * количества, указанного в заказе. Разница сверх заказа считается „плюсом"».
   * Считает чистая утилита с тестами — здесь только показ.
   */
  const extras = useMemo(() => cutExtras(entries, item?.size_grid, reported),
    [entries, item, reported]);

  /**
   * Сводка по размерам собирается ИЗ ВВЕДЁННЫХ СТРОК, а не из списка
   * вариантов: размер, написанный руками, в вариантах не значится, и итог
   * по нему иначе исчез бы с экрана, оставшись в данных.
   */
  const sizeSummary = useMemo(() => {
    const byKey = new Map();
    for (const entry of entries) {
      for (const row of entry.sizes ?? []) {
        const qty = Math.max(Number(row.qty) || 0, 0);
        if (qty <= 0 || !row.size) continue;
        const key = cellKey({ color: row.color || NO_COLOR, size: row.size });
        const label = row.color && row.color !== NO_COLOR
          ? `${row.size} · ${row.color}` : row.size;
        const hit = byKey.get(key);
        if (hit) hit.qty += qty;
        else byKey.set(key, { label, qty });
      }
    }
    return [...byKey.values()].map((r) => `${r.label} — ${r.qty} шт`);
  }, [entries]);

  const used = new Set(entries.map((e) => e.rollId).filter(Boolean));
  const free = options.filter((o) => !used.has(o.roll.id));

  const patch = (index, next) => onChange(
    entries.map((entry, i) => (i === index ? { ...entry, ...next } : entry)),
  );

  /**
   * Новый рулон приходит С ДВУМЯ СТРОКАМИ (прямое требование документа:
   * «при добавлении рулона сразу показывать две строки размеров, так как это
   * основной рабочий сценарий»). Лишнюю закройщик убирает одним нажатием —
   * это дешевле, чем добавлять вторую каждый раз.
   */
  const addRoll = () => onChange([
    ...entries,
    {
      rollId: free[0]?.roll.id ?? '',
      lengthUsedM: '',
      sizes: freeChoices(choices, [], 2).map((c) => ({ size: c.size, color: c.color, qty: '' })),
      finished: false,
    },
  ]);
  const removeRoll = (index) => onChange(entries.filter((_, i) => i !== index));

  if (options.length === 0 && entries.length === 0) {
    return (
      <p className={styles.queueReason} role="status">
        <Icon name="alert" size={13} />
        {' '}
        Склад ещё не принял рулоны по этой позиции — расход фиксировать не с чего.
        Результат можно сдать числом, а рулоны появятся после приёмки ткани.
      </p>
    );
  }

  return (
    <div className={styles.queueBlockForm}>
      {/*
        ОТСУТСТВИЕ СЕТКИ — ПРЕДУПРЕЖДЕНИЕ, А НЕ ЧАСТЬ ИТОГА (правка 21.09, п. 4):
        «если размерная сетка действительно отсутствует и это требует внимания,
        показывать отдельное предупреждение „Размерная сетка заказа не найдена",
        а не добавлять технический текст в итог».
      */}
      {!planned && (
        <p className={styles.queueReason} role="status">
          <Icon name="alert" size={13} />
          {' '}
          Размерная сетка заказа не найдена — размеры выбираются из стандартной шкалы.
        </p>
      )}
      {entries.map((entry, index) => {
        const rows = entry.sizes ?? [];
        const option = options.find((o) => o.roll.id === entry.rollId) ?? null;
        const hasMetres = rollHasMetres(option);
        const available = rollAvailable(option);
        const working = option ? rollWorkingLength(option.roll, option.material) : null;
        const kgPerM = option ? rollKgPerM(option.roll, option.material) : null;
        const left = rollLeft(option, entry.lengthUsedM);
        const measured = entry.leftoverMeasuredM;
        const leftShown = measured !== null && measured !== undefined && measured !== ''
          ? Number(measured) : left;
        const pricePerM = option ? rollPricePerM(option.roll, option.material) : null;
        /**
         * ПЕРЕРАСХОД (правка 28.09): «если измеренный расход превышает
         * расчётный запас, предложить уточнить метраж рулона и подтвердить
         * корректировку, затем сохранить расход». Прежде был только отказ.
         */
        const overdraw = hasMetres && available !== null
          && Number(entry.lengthUsedM) > available + 0.005;
        const showRefine = option && hasMetres && onRollParams
          && (overdraw || refining.has(option.roll.id));
        return (
          <div key={`${entry.rollId || 'new'}-${index}`} className={styles.dataCard}>
            <div className={styles.planFormRow}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Рулон</span>
                <select
                  className={styles.select}
                  value={entry.rollId}
                  disabled={disabled}
                  onChange={(e) => patch(index, { rollId: e.target.value })}
                  aria-label={`Рулон, строка ${index + 1}`}
                >
                  <option value="">Выберите рулон…</option>
                  {options
                    .filter((o) => o.roll.id === entry.rollId || !used.has(o.roll.id))
                    .map((o) => <option key={o.roll.id} value={o.roll.id}>{o.label}</option>)}
                </select>
              </label>

              {/* Расход остаётся ОБЩИМ для рулона: он у рулона один,
                  а размеров с него несколько. Повтори мы его в каждой
                  размерной строке — первый же `sum()` увеличил бы его втрое */}
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Фактический расход, м *</span>
                <input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  className={`${styles.input} ${styles.qtySmallInput}`}
                  value={entry.lengthUsedM ?? ''}
                  disabled={disabled || (option !== null && !hasMetres)}
                  onChange={(e) => patch(index, { lengthUsedM: e.target.value })}
                  aria-label={`Фактический расход, м, строка ${index + 1}`}
                />
              </label>

              {/*
                ДОСТУПНЫЙ МЕТРАЖ И ЕГО ИСТОЧНИК — рядом с полем (документ:
                «рядом показывать доступный метраж и его источник, а также
                расчётный эквивалент расхода в кг»). Расчётный вес подписан
                «расчёт»: это не результат взвешивания.
              */}
              {option && hasMetres && (
                <span className={styles.subText}>
                  доступно: {metresText(available ?? 0)}
                  {working ? ` (${sourceLabel(working.source)})` : ''}
                  {pricePerM !== null ? ` · ${pricePerM.toFixed(2).replace('.', ',')} ₽/м` : ''}
                  {Number(entry.lengthUsedM) > 0 && kgPerM !== null
                    ? ` · ≈ ${fmtKg(kgFromLength(entry.lengthUsedM, kgPerM))} (расчёт)` : ''}
                </span>
              )}
            </div>

            {/*
              РУЛОН БЕЗ РАБОЧЕГО МЕТРАЖА: расход не записать, пока параметры
              не заполнены. Форма прямо здесь — «недостающие параметры
              разрешить заполнить в закройке до записи расхода».
            */}
            {option && !hasMetres && (
              <>
                <p className={styles.queueReason} role="status">
                  <Icon name="alert" size={13} />
                  {' '}
                  {METRES_MISSING_TEXT}: у рулона нет ширины, плотности или метража.
                </p>
                {onRollParams && (
                  <RollParamsForm
                    roll={option.roll}
                    material={option.material}
                    onSave={onRollParams}
                    disabled={disabled}
                  />
                )}
              </>
            )}

            {option && hasMetres && onRollParams && !overdraw && (
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => toggleRefine(option.roll.id)}>
                {refining.has(option.roll.id) ? 'Скрыть уточнение метража' : 'Уточнить метраж рулона'}
              </Button>
            )}
            {showRefine && (
              <RollParamsForm
                roll={option.roll}
                material={option.material}
                onSave={onRollParams}
                disabled={disabled}
                note={overdraw
                  ? `Расход больше доступного (${metresText(available ?? 0)}). Уточните метраж рулона — `
                    + 'расхождение запишется корректировкой с причиной, затем сохраните расход.'
                  : null}
              />
            )}

            <CutSizeRows
              rows={rows}
              choices={choices}
              disabled={disabled}
              onRows={(next) => patch(index, { sizes: next })}
            />

            {/*
              ОСТАТОК И ЕГО СУДЬБА (правка 21.09, п. 5; в метрах — 27.09, п. 4).
              Остаток СЧИТАЕТСЯ из доступного метража и расхода — вводить его
              руками значило бы завести второго писателя той же величины;
              измеренный остаток при завершении — отдельное поле, и расхождение
              уезжает корректировкой. «Пока исходный метраж расчётный, остаток
              тоже обозначать как расчётный».
            */}
            <div className={styles.queueActions}>
              <span className={styles.queueReason}>
                Итого с рулона: <b>{rollTotal(entry)}</b> шт
                {entry.rollId && (left === null
                  ? <span className={styles.subText}> · остаток: — (метраж рулона не указан)</span>
                  : (
                    <span className={styles.subText}>
                      {' '}· остаток: {metresText(leftShown ?? 0)}
                      {measured !== null && measured !== undefined && measured !== ''
                        ? ' (замер)'
                        : working?.source === 'calc' ? ' (расчёт)' : ''}
                      {kgPerM !== null && leftShown !== null
                        ? ` · ≈ ${fmtKg(kgFromLength(leftShown, kgPerM))} (расчёт)` : ''}
                    </span>
                  ))}
              </span>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={Boolean(entry.finished)}
                  disabled={disabled}
                  onChange={(e) => patch(index, {
                    finished: e.target.checked,
                    // Сняли отметку — вид остатка и замер теряют смысл вместе с ней
                    ...(e.target.checked ? {} : { leftover: null, leftoverMeasuredM: null, leftoverReason: null }),
                  })}
                />
                {' '}
                Работа по рулону закончена
              </label>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => removeRoll(index)}>
                Убрать
              </Button>
            </div>

            {entry.finished && left !== null && (
              <div className={styles.queueActions} role="group" aria-label="Что с остатком рулона">
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Измеренный остаток, м</span>
                  <input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    className={`${styles.input} ${styles.qtySmallInput}`}
                    value={entry.leftoverMeasuredM ?? ''}
                    disabled={disabled}
                    placeholder="если мерили"
                    aria-label={`Измеренный остаток, м, строка ${index + 1}`}
                    onChange={(e) => patch(index, { leftoverMeasuredM: e.target.value })}
                  />
                </label>
                {measured !== null && measured !== undefined && measured !== '' && (
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Причина расхождения</span>
                    <input
                      className={styles.input}
                      value={entry.leftoverReason ?? ''}
                      disabled={disabled}
                      placeholder="например, перемерили после раскладки"
                      aria-label={`Причина расхождения замера, строка ${index + 1}`}
                      onChange={(e) => patch(index, { leftoverReason: e.target.value })}
                    />
                  </label>
                )}
                {leftShown !== null && leftShown > 0.0005 && (
                  <>
                    <span className={styles.fieldLabel}>
                      Остаток {metresText(leftShown)}:
                    </span>
                    {[
                      ['usable', 'Остаток пригоден'],
                      ['scrap', 'Малый остаток, не учитывать'],
                    ].map(([value, label]) => (
                      <label key={value} className={styles.checkLabel}>
                        <input
                          type="radio"
                          name={`leftover-${index}`}
                          value={value}
                          checked={entry.leftover === value}
                          disabled={disabled}
                          onChange={() => patch(index, { leftover: value })}
                        />
                        {' '}
                        {label}
                      </label>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {awaitingFate.length > 0 && onRollFate && (
        <div className={styles.queueBlockForm} role="group" aria-label="Рулоны без судьбы остатка">
          <span className={styles.queueReason}>
            <Icon name="alert" size={13} />
            {' '}
            Работа по этим рулонам не закончена, а остаток есть — без решения этап не закроется:
          </span>
          {awaitingFate.map(({ roll, material, label }) => (
            <div key={roll.id} className={styles.queueActions}>
              <span className={styles.subText}>
                {label} · остаток {rollLeftText(roll, material)}
              </span>
              <Button
                variant="secondary" size="sm" disabled={disabled}
                onClick={() => onRollFate(roll.id, 'usable', item?.id ?? null)}
              >
                Остаток пригоден
              </Button>
              <Button
                variant="ghost" size="sm" disabled={disabled}
                onClick={() => onRollFate(roll.id, 'scrap', item?.id ?? null)}
              >
                Малый остаток, не учитывать
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.queueActions}>
        <Button variant="secondary" size="sm" disabled={disabled || free.length === 0} onClick={addRoll}>
          <Icon name="plus" size={14} /> Добавить рулон
        </Button>
        {free.length === 0 && entries.length > 0 && (
          <span className={styles.subText}>Все принятые рулоны уже в списке</span>
        )}
      </div>

      {/*
        ИТОГ КОРОТКИЙ, РАЗБИВКА ОТДЕЛЬНО (правка 21.09, п. 4): итог — два числа,
        размеры — своей строкой, плюсы — своей, а техническая фраза ушла
        в отдельное предупреждение НАД таблицей.
      */}
      {entries.length > 0 && (
        <div className={styles.queueActions} role="status">
          <p className={styles.queueReason}>
            Скроено: <b>{totals.qty}</b> шт · Расход: <b>{metresText(totals.used)}</b>
          </p>
          {sizeSummary.length > 0 && (
            <p className={styles.queueReason}>
              По размерам: {sizeSummary.join(' · ')}
            </p>
          )}
          {extras.total > 0 && (
            <p className={styles.queueReason}>
              Плюс: {cutExtrasText(extras)}
              {extras.rows.length > 1 && <> · всего <b>{extras.total}</b> шт</>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
