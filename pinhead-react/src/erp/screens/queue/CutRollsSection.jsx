import { useMemo } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { SizeResultTable } from '../../components/SizeResultTable';
import {
  rollsForItem, cutTotals, rollTotal, cellKey, sizeCellsOf,
} from '../../utils/cutRolls';
import styles from '../../styles';

/**
 * РАСКРОЙ ПО РУЛОНАМ ВНУТРИ ФОРМЫ СДАЧИ (правка заказчика 16.09, п. 4).
 *
 * «Не создавать отдельный экран аналитики на этапе ввода. Детализацию
 * встроить непосредственно в существующий блок сдачи результата закроя».
 * Поэтому это секция внутри `StageReportForm`, а не свой экран и не модалка.
 *
 * РУЛОНЫ НЕ ВВОДЯТСЯ ВРУЧНУЮ: селект перечисляет то, что склад принял по
 * материалам этой позиции (`utils/cutRolls.rollsForItem`). Закройщик выбирает
 * рулон и заполняет только расход и раскрой — ровно как просит документ.
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
  const cells = useMemo(() => sizeCellsOf(item?.size_grid), [item]);
  const totals = useMemo(() => cutTotals(entries), [entries]);

  const used = new Set(entries.map((e) => e.rollId).filter(Boolean));
  const free = options.filter((o) => !used.has(o.roll.id));

  const patch = (index, next) => onChange(
    entries.map((entry, i) => (i === index ? { ...entry, ...next } : entry)),
  );
  const addRoll = () => onChange([
    ...entries,
    { rollId: free[0]?.roll.id ?? '', qtyUsed: '', sizes: {}, finished: false },
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
        const option = options.find((o) => o.roll.id === entry.rollId);
        const rows = cells.map((cell) => ({
          key: cellKey(cell),
          label: cell.color === '—' ? cell.size : `${cell.size} · ${cell.color}`,
          expected: cell.qty,
        }));
        const values = Object.fromEntries(rows.map((r) => [
          r.key, { qty: entry.sizes?.[r.key] ?? '' },
        ]));

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
              {option?.material && (
                <span className={styles.subText}>
                  передано в закрой: {option.material.qty_received ?? '—'}
                  {' '}
                  {option.material.unit || unit}
                </span>
              )}
            </div>

            {rows.length > 0 ? (
              <SizeResultTable
                rows={rows}
                columns={[{ code: 'qty', label: 'Скроено, шт' }]}
                values={values}
                onChange={(key, _code, value) => patch(index, {
                  sizes: { ...entry.sizes, [key]: value },
                })}
                expectedLabel="В заказе"
                caption={`Раскрой с рулона, строка ${index + 1}`}
                disabled={disabled}
              />
            ) : (
              /* Позиция без размерной сетки: с рулона всё равно нужен выход,
                 но размеров у неё нет — тогда одно число */
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Скроено, шт *</span>
                <input
                  type="number" min="0" step="1"
                  className={`${styles.input} ${styles.qtySmallInput}`}
                  value={entry.sizes?.total ?? ''}
                  disabled={disabled}
                  onChange={(e) => patch(index, { sizes: { total: e.target.value } })}
                  aria-label={`Скроено с рулона, строка ${index + 1}`}
                />
              </label>
            )}

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
          {cells.length > 0 && (
            <>
              {' · '}
              {cells
                .map((cell) => `${cell.size} ${totals.bySize[cellKey(cell)] ?? 0}`)
                .join(' · ')}
            </>
          )}
        </p>
      )}
    </div>
  );
}
