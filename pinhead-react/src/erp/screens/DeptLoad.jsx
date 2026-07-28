import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { Button } from '../components/Button';
import { EmptyState, LoadFailed } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { useErpStore } from '../store/useErpStore';
import { buildDeptLoad, loadDays, weekStart } from '../utils/deptLoad';
import { deptShortName } from '../data/departments';
import styles from '../erp.module.css';

/**
 * Загрузка цехов по дням — сетка «цех × день» из плановых дат этапов.
 *
 * Мощностей (шт/день) в схеме нет: их удалили решением заказчика («план сроков
 * вписывается вручную»), поэтому заливка ячейки — доля от максимума по сетке,
 * а не от нормы. Экран отвечает на «где на неделе пик, что просрочено и что
 * вообще без плана», не возвращая отвергнутую идею нормирования.
 *
 * Только чтение: планы правятся в карточке заказа.
 */

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function dayLabel(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return { dow: WEEKDAYS[(d.getDay() + 6) % 7], day: d.getDate() };
}

/** Сдвиг недели в днях от текущей */
function shiftWeek(iso, weeks) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

export default function DeptLoad() {
  const { orders, departments, loaded, loadError, loadAll } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
    })),
  );

  const today = todayISO();
  const [start, setStart] = useState(() => weekStart(todayISO()));

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);

  const days = useMemo(() => loadDays(start, 7), [start]);
  const { rows, maxCell } = useMemo(
    () => buildDeptLoad(orders, departments, days, today),
    [orders, departments, days, today],
  );

  const isCurrentWeek = start === weekStart(today);
  const periodLabel = `${dayLabel(days[0]).day} — ${dayLabel(days[6]).day} ${
    new Date(`${days[6]}T00:00:00`).toLocaleDateString('ru-RU', { month: 'long' })}`;

  return (
    <>
      <PageHead
        title="Загрузка цехов"
        sub="Сколько штук каждый цех обязался сдать по дням — по плановым датам этапов."
      />

      <div className={styles.toolbar}>
        <Button variant="ghost" icon="chevronLeft" onClick={() => setStart((s) => shiftWeek(s, -1))}>
          Неделя назад
        </Button>
        <span className={styles.loadPeriod}>
          {periodLabel}
          {isCurrentWeek && <span className={styles.subText}> · текущая</span>}
        </span>
        <Button variant="ghost" onClick={() => setStart((s) => shiftWeek(s, 1))}>
          Неделя вперёд
        </Button>
        {!isCurrentWeek && (
          <Button variant="secondary" onClick={() => setStart(weekStart(today))}>Сегодня</Button>
        )}
      </div>

      {!loaded && !loadError && <TableSkeleton />}
      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="загрузку цехов" />}

      {loaded && rows.length === 0 && (
        <EmptyState
          icon="calendar"
          title="На эту неделю планов нет"
          text="Загрузка считается по плановым датам этапов — их проставляют, когда берут работу в цех."
          action={<Link to="/orders" className={styles.widgetLink}>Открыть заказы →</Link>}
        />
      )}

      {loaded && rows.length > 0 && (
        <ScrollHintBox className={styles.tableWrap} label="Загрузка цехов по дням">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Цех</th>
                {days.map((d) => {
                  const { dow, day } = dayLabel(d);
                  return (
                    <th key={d} className={d === today ? styles.loadToday : undefined}>
                      {dow} {day}
                    </th>
                  );
                })}
                <th>Просрочено</th>
                <th>Без плана</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.dept.id}>
                  <td><strong>{deptShortName(row.dept.code, row.dept.name)}</strong></td>
                  {row.cells.map((cell) => (
                    <td
                      key={cell.date}
                      className={styles.loadCell}
                      title={cell.qty > 0
                        ? `${cell.qty} шт · этапов: ${cell.stages}`
                        : 'Планов нет'}
                    >
                      {cell.qty > 0 && (
                        <span
                          className={styles.loadCellFill}
                          /* Доля от максимума по сетке — единственное динамическое значение */
                          style={{ opacity: 0.15 + 0.85 * (cell.qty / Math.max(maxCell, 1)) }}
                        />
                      )}
                      <span className={styles.loadCellValue}>{cell.qty > 0 ? cell.qty : '—'}</span>
                    </td>
                  ))}
                  <td className={row.overdue.qty > 0 ? styles.overdue : styles.subText}>
                    {row.overdue.qty > 0 ? `${row.overdue.qty} шт` : '—'}
                  </td>
                  <td className={row.unplanned.qty > 0 ? styles.dueSoon : styles.subText}>
                    {row.unplanned.qty > 0 ? `${row.unplanned.qty} шт` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollHintBox>
      )}
    </>
  );
}
