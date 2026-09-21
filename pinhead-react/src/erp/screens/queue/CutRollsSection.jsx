import { useMemo } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import {
  rollsForItem, cutTotals, rollTotal, cellKey, rollLeft,
} from '../../utils/cutRolls';
import {
  sizeChoicesFor, choiceKey, isSizeTaken, freeChoices, normalizeSize, hasPlannedSizes,
} from '../../utils/sizeChoices';
import { cutExtras, cutExtrasText } from '../../utils/cutExtras';
import { NO_COLOR } from '../../utils/sizeGrid';
import styles from '../../styles';

/** Значение селекта, включающее ручной ввод размера */
const OTHER = '__other__';

/**
 * РАСКРОЙ ПО РУЛОНАМ ВНУТРИ ФОРМЫ СДАЧИ (правка 16.09, п. 4;
 * размерные строки переработаны правкой 20.09, п. 7).
 *
 * «Не создавать отдельный экран аналитики на этапе ввода. Детализацию
 * встроить непосредственно в существующий блок сдачи результата закроя».
 * Поэтому это секция внутри `StageReportForm`, а не свой экран и не модалка.
 *
 * РУЛОНЫ НЕ ВВОДЯТСЯ ВРУЧНУЮ: селект перечисляет то, что склад принял по
 * материалам этой позиции (`utils/cutRolls.rollsForItem`). Закройщик выбирает
 * рулон и заполняет только расход и раскрой — ровно как просит документ.
 *
 * РАЗМЕРЫ — СТРОКИ, А НЕ КОЛОНКИ ТАБЛИЦЫ (правка 20.09, п. 7). Раньше здесь
 * рисовалась таблица по ВСЕМ ячейкам размерной сетки позиции, и у позиции
 * без сетки не оставалось ничего, кроме одного поля «Скроено, шт» — именно
 * это заказчик и описал как «не фиксируется, какие размеры выкроены».
 * Теперь строку добавляют и удаляют, две появляются сразу («с одного рулона
 * обычно кроят сразу два размера»), а список размеров берётся из сетки,
 * когда она есть, и из стандартной шкалы, когда её нет.
 *
 * ИТОГИ СЧИТАЮТСЯ, А НЕ ВВОДЯТСЯ: итог с рулона, общий выход, общий расход
 * и итог по каждому размеру — всё из `cutTotals`. Поле «итого», которое
 * человек заполняет сам, разошлось бы со строками на первой же правке.
 */
export function CutRollsSection({
  order, item, entries, onChange, unit = 'кг', disabled = false, reported = {},
}) {
  const options = useMemo(
    () => rollsForItem(order?.materials, item?.id, entries.map((e) => e.rollId)),
    [order, item, entries],
  );
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
  const patchRows = (index, rows) => patch(index, { sizes: rows });

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
      qtyUsed: '',
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
                <span className={styles.fieldLabel}>Фактический расход, {unit} *</span>
                <input
                  type="number" min="0" step="0.01"
                  className={`${styles.input} ${styles.qtySmallInput}`}
                  value={entry.qtyUsed}
                  disabled={disabled}
                  onChange={(e) => patch(index, { qtyUsed: e.target.value })}
                  aria-label={`Фактический расход материала, строка ${index + 1}`}
                />
              </label>

              {/* Сколько ткани склад передал — справочно: это знаменатель,
                  по которому потом считают выход изделий с рулона */}
              {options.find((o) => o.roll.id === entry.rollId)?.material && (
                <span className={styles.subText}>
                  передано в закрой:
                  {' '}
                  {options.find((o) => o.roll.id === entry.rollId).material.qty_received ?? '—'}
                  {' '}
                  {options.find((o) => o.roll.id === entry.rollId).material.unit || unit}
                </span>
              )}
            </div>

            <div className={styles.cutSizes}>
              <span className={styles.fieldLabel}>Размеры с этого рулона</span>
              {rows.map((row, ri) => {
                const isOther = Boolean(row.size)
                  && !choices.some((c) => c.size === row.size && c.color === row.color);
                const current = choices.find(
                  (c) => c.size === row.size && c.color === row.color,
                );
                return (
                  <div key={ri} className={styles.cutSizeRow}>
                    <label className={styles.field}>
                      <span className={styles.visuallyHidden}>Размер, строка {ri + 1}</span>
                      <select
                        className={styles.select}
                        value={isOther ? OTHER : (current ? choiceKey(current) : '')}
                        disabled={disabled}
                        aria-label={`Размер, строка ${ri + 1}`}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === OTHER) {
                            patchRows(index, rows.map((r, i) => (
                              i === ri ? { ...r, size: '', color: NO_COLOR } : r)));
                            return;
                          }
                          const pick = choices.find((c) => choiceKey(c) === v);
                          patchRows(index, rows.map((r, i) => (i === ri
                            ? { ...r, size: pick?.size ?? '', color: pick?.color ?? NO_COLOR }
                            : r)));
                        }}
                      >
                        <option value="">Выберите размер…</option>
                        {choices.map((c) => (
                          <option
                            key={choiceKey(c)}
                            value={choiceKey(c)}
                            /* Занятый в ЭТОМ рулоне размер не выбирается повторно:
                               документ просит менять количество в существующей
                               строке, а не заводить вторую */
                            disabled={isSizeTaken(rows, c, ri)}
                          >
                            {c.label}
                            {c.planned !== null ? ` (в заказе ${c.planned})` : ''}
                            {isSizeTaken(rows, c, ri) ? ' — уже в этом рулоне' : ''}
                          </option>
                        ))}
                        <option value={OTHER}>Другой размер…</option>
                      </select>
                    </label>

                    {/* Ручной ввод — для позиций, заведённых без размерной сетки,
                        и для нестандартных обозначений старых заказов */}
                    {isOther || (!row.size && !current) ? (
                      <label className={styles.field}>
                        <span className={styles.visuallyHidden}>Свой размер, строка {ri + 1}</span>
                        <input
                          type="text"
                          className={`${styles.input} ${styles.qtySmallInput}`}
                          value={row.size}
                          disabled={disabled}
                          placeholder="свой"
                          aria-label={`Свой размер, строка ${ri + 1}`}
                          onChange={(e) => patchRows(index, rows.map((r, i) => (i === ri
                            ? { ...r, size: normalizeSize(e.target.value) } : r)))}
                        />
                      </label>
                    ) : null}

                    <label className={styles.field}>
                      <span className={styles.visuallyHidden}>Скроено, строка {ri + 1}</span>
                      <input
                        type="number" min="0" step="1" inputMode="numeric"
                        className={`${styles.input} ${styles.qtySmallInput}`}
                        value={row.qty}
                        disabled={disabled}
                        placeholder="шт"
                        aria-label={`Скроено, шт${row.size ? `, размер ${row.size}` : ''}, строка ${ri + 1}`}
                        onChange={(e) => patchRows(index, rows.map((r, i) => (i === ri
                          ? { ...r, qty: e.target.value } : r)))}
                      />
                    </label>

                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      aria-label={`Убрать строку размера ${ri + 1}`}
                      onClick={() => patchRows(index, rows.filter((_, i) => i !== ri))}
                    >
                      ✕
                    </Button>
                  </div>
                );
              })}

              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => patchRows(index, [
                  ...rows,
                  ...freeChoices(choices, rows, 1).map(
                    (c) => ({ size: c.size, color: c.color, qty: '' }),
                  ),
                  // Свободных вариантов не осталось — строка заводится пустой:
                  // размер в ней человек напишет руками
                  ...(freeChoices(choices, rows, 1).length === 0
                    ? [{ size: '', color: NO_COLOR, qty: '' }] : []),
                ])}
              >
                <Icon name="plus" size={14} /> Добавить размер
              </Button>
            </div>

            {/*
              ОСТАТОК И ЕГО СУДЬБА (правка 21.09, п. 5). Остаток СЧИТАЕТСЯ
              из веса рулона и расхода — вводить его руками значило бы завести
              второго писателя той же величины. У рулона, принятого до правки,
              веса нет, и остаток честно показывается прочерком.

              Выбор появляется только когда работа по рулону закончена И остаток
              есть: при нулевом остатке решать нечего, а до конца работы остаток
              промежуточный. Автоматического порога в килограммах НЕТ —
              «автоматический порог в килограммах пока не задавать».
            */}
            <div className={styles.queueActions}>
              <span className={styles.queueReason}>
                Итого с рулона: <b>{rollTotal(entry)}</b> шт
                {(() => {
                  const roll = options.find((o) => o.roll.id === entry.rollId)?.roll;
                  const left = rollLeft(roll, entry.qtyUsed);
                  if (!entry.rollId) return null;
                  return left === null
                    ? <span className={styles.subText}> · остаток: — (вес рулона не указан)</span>
                    : <span className={styles.subText}> · остаток: {left} {unit}</span>;
                })()}
              </span>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={Boolean(entry.finished)}
                  disabled={disabled}
                  onChange={(e) => patch(index, {
                    finished: e.target.checked,
                    // Сняли отметку — вид остатка теряет смысл вместе с ней
                    ...(e.target.checked ? {} : { leftover: null }),
                  })}
                />
                {' '}
                Работа по рулону закончена
              </label>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => removeRoll(index)}>
                Убрать
              </Button>
            </div>

            {entry.finished && (() => {
              const roll = options.find((o) => o.roll.id === entry.rollId)?.roll;
              const left = rollLeft(roll, entry.qtyUsed);
              if (left === null || left <= 0) return null;
              return (
                <div className={styles.queueActions} role="group" aria-label="Что с остатком рулона">
                  <span className={styles.fieldLabel}>
                    Остаток {left} {unit}:
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
                </div>
              );
            })()}
          </div>
        );
      })}

      <div className={styles.queueActions}>
        <Button variant="secondary" size="sm" disabled={disabled || free.length === 0} onClick={addRoll}>
          <Icon name="plus" size={14} /> Добавить рулон
        </Button>
        {free.length === 0 && entries.length > 0 && (
          <span className={styles.subText}>Все принятые рулоны уже в списке</span>
        )}
      </div>

      {/*
        ИТОГ КОРОТКИЙ, РАЗБИВКА ОТДЕЛЬНО (правка 21.09, п. 4).

        Было одной строкой: «Всего скроено: 50 шт · расход: 20 кг · XS 50 ·
        размеры выбраны из стандартной шкалы: у позиции нет размерной сетки».
        Заказчик: «перегружена и непонятна. Техническое сообщение смешано
        с производственным итогом». Поэтому итог — два числа, размеры —
        своей строкой, плюсы — своей, а техническая фраза ушла в отдельное
        предупреждение НАД таблицей (см. выше): это не итог работы, а сообщение
        о недостающих данных заказа.
      */}
      {entries.length > 0 && (
        <div className={styles.queueActions} role="status">
          <p className={styles.queueReason}>
            Скроено: <b>{totals.qty}</b> шт · Расход: <b>{totals.used}</b> {unit}
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
