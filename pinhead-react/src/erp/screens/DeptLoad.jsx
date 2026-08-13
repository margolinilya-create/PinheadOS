import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { Button } from '../components/Button';
import { EmptyState, LoadFailed } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { useErpStore } from '../store/useErpStore';
import { CapacityBar } from '../components/CapacityBar';
import { capacityReport, monthCapacityReport, monthLabel } from '../utils/capacity';
import { buildDeptLoad, loadDays, weekStart } from '../utils/deptLoad';
import { weekdayShort } from '../utils/format';
import { addDays, factoryToday, parseIsoDate } from '../../utils/date';
import { deptShortName } from '../data/departments';
import styles from '../erp.module.css';
import { ProductionTabs } from '../components/ProductionTabs';

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

function dayLabel(iso) {
  return { dow: weekdayShort(iso), day: parseIsoDate(iso).getDate() };
}

export default function DeptLoad() {
  const {
    orders, departments, loaded, loadError, loadAll, capacity, capacityLoaded, loadSettings,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      capacity: s.capacity,
      capacityLoaded: s.capacityLoaded,
      loadSettings: s.loadSettings,
    })),
  );

  const today = factoryToday();
  const [start, setStart] = useState(() => weekStart(factoryToday()));
  /**
   * M-10 отчёта QA 13.08.2026: соседние вкладки одного раздела считали неделю
   * по-разному — «План» пн–пт с переключателем выходных, «Загрузка» всегда
   * пн–вс и без него. Цифры двух экранов нельзя было сопоставить, и человек
   * об этом не знал.
   *
   * Управление теперь ОДИНАКОВОЕ — тот же переключатель и та же подпись.
   * А вот УМОЛЧАНИЕ разное, и это осознанно: «План» — ручная раскладка,
   * её кладут на рабочие дни; «Загрузка» ОТЧИТЫВАЕТСЯ о плановых датах,
   * которые уже стоят у этапов. Спрятать субботу здесь значит молча потерять
   * работу, которую кто-то на неё поставил, — а это ровно тот класс дефектов,
   * из-за которого заказы не показывались в закупке.
   */
  const [withWeekend, setWithWeekend] = useState(true);

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  useEffect(() => { if (!capacityLoaded) loadSettings(); }, [capacityLoaded, loadSettings]);

  const days = useMemo(() => loadDays(start, withWeekend ? 7 : 5), [start, withWeekend]);
  const { rows, maxCell } = useMemo(
    () => buildDeptLoad(orders, departments, days, today),
    [orders, departments, days, today],
  );

  /**
   * Две РАЗНЫЕ величины на одном экране, и их нельзя складывать.
   *
   * Полоса сверху — изделия против общей мощности фабрики. Сетка ниже — сколько
   * штук каждый цех обязался сдать по дням: одно изделие проходит закрой,
   * нанесение, швейку и ВТО, поэтому сумма по цехам в разы больше выпуска.
   * Подписи у обеих сказаны прямым текстом, иначе их неизбежно сложат.
   */
  const monthReport = useMemo(
    () => monthCapacityReport(orders, today, capacity),
    [orders, today, capacity],
  );
  const weekReport = useMemo(
    () => capacityReport(orders, days, capacity),
    [orders, days, capacity],
  );

  const isCurrentWeek = start === weekStart(today);
  const lastDay = days[days.length - 1];
  const periodLabel = `${dayLabel(days[0]).day} — ${dayLabel(lastDay).day} ${
    parseIsoDate(lastDay).toLocaleDateString('ru-RU', { month: 'long' })}`;

  return (
    <>
      <PageHead
        title="Загрузка цехов"
        sub="Сколько штук каждый цех обязался сдать по дням — по плановым датам этапов."
      />
      <ProductionTabs />

      <CapacityBar
        report={isCurrentWeek ? monthReport : weekReport}
        periodLabel={isCurrentWeek ? monthLabel(today) : periodLabel}
        hint="Изделия активных заказов со сроком сдачи в периоде против общей мощности. Сетка ниже считает другое — обязательства цехов по дням, где одно изделие попадает в несколько строк."
        monthlyUnits={capacity.monthly_units}
      />

      <div className={styles.toolbar}>
        <Button variant="ghost" icon="chevronLeft" onClick={() => setStart((s) => addDays(s, -7))}>
          Неделя назад
        </Button>
        <span className={styles.loadPeriod}>
          {periodLabel}
          {isCurrentWeek && <span className={styles.subText}> · текущая</span>}
        </span>
        <Button variant="ghost" onClick={() => setStart((s) => addDays(s, 7))}>
          Неделя вперёд
        </Button>
        {!isCurrentWeek && (
          <Button variant="secondary" onClick={() => setStart(weekStart(today))}>Сегодня</Button>
        )}
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={withWeekend}
            onChange={(e) => setWithWeekend(e.target.checked)}
          />
          с выходными
        </label>
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
