import { useMemo } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import {
  rollsForItem, cutTotals, rollTotal, cellKey,
} from '../../utils/cutRolls';
import {
  sizeChoicesFor, choiceKey, isSizeTaken, freeChoices, normalizeSize, hasPlannedSizes,
} from '../../utils/sizeChoices';
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
  order, item, entries, onChange, unit = 'кг', disabled = false,
}) {
  const options = useMemo(
    () => rollsForItem(order?.materials, item?.id, entries.map((e) => e.rollId)),
    [order, item, entries],
  );
  const choices = useMemo(() => sizeChoicesFor(item?.size_grid), [item]);
  const planned = useMemo(() => hasPlannedSizes(item?.size_grid), [item]);
  const totals = useMemo(() => cutTotals(entries), [entries]);

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
    return [...byKey.values()].map((r) => `${r.label} ${r.qty}`);
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

            <div className={styles.queueActions}>
              <span className={styles.queueReason}>
                Итого с рулона: <b>{rollTotal(entry)}</b> шт
              </span>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={Boolean(entry.finished)}
                  disabled={disabled}
                  onChange={(e) => patch(index, { finished: e.target.checked })}
                />
                {' '}
                Рулон израсходован
              </label>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => removeRoll(index)}>
                Убрать
              </Button>
            </div>
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

      {/* Автоматические итоги — документ просит их прямо: общее количество,
          итог по каждому размеру и общий фактический расход ткани */}
      {entries.length > 0 && (
        <p className={styles.queueReason} role="status">
          Всего скроено: <b>{totals.qty}</b> шт · расход: <b>{totals.used}</b> {unit}
          {sizeSummary.length > 0 && <>{' · '}{sizeSummary.join(' · ')}</>}
          {planned ? '' : ' · размеры выбраны из стандартной шкалы: у позиции нет размерной сетки'}
        </p>
      )}
    </div>
  );
}
