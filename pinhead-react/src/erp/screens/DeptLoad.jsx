import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { Button } from '../components/Button';
import { EmptyState, LoadFailed } from '../components/ErpStates';
import { TableSkeleton } from '../components/ErpSkeletons';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { DeptLoadCard } from './DeptLoadCard';
import { useCompactLayout } from '../layout/useCompactLayout';
import { useErpStore } from '../store/useErpStore';
import { CapacityBar } from '../components/CapacityBar';
import { capacityReport, monthCapacityReport, monthLabel } from '../utils/capacity';
import { buildDeptLoad, loadDays, ordersWithoutPlan, weekStart } from '../utils/deptLoad';
import { weekdayShort } from '../utils/format';
import { addDays, factoryToday, parseIsoDate } from '../../utils/date';
import { deptShortName } from '../data/departments';
import styles from '../styles';
import { ProductionTabs } from '../components/ProductionTabs';
import { OrderLink } from '../components/OrderLink';

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
  /** Планшет цеха: сетка из десяти колонок не помещается — карточка на цех */
  const compact = useCompactLayout();
  const [start, setStart] = useState(() => weekStart(factoryToday()));

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  useEffect(() => { if (!capacityLoaded) loadSettings(); }, [capacityLoaded, loadSettings]);

  const days = useMemo(() => loadDays(start, 7), [start]);
  const { rows, maxCell, totals } = useMemo(
    () => buildDeptLoad(orders, departments, days, today),
    [orders, departments, days, today],
  );

  /**
   * Ни у одного открытого этапа нет плановой даты — считать здесь нечего,
   * и сказать это надо прямо.
   *
   * Без полосы экран выглядит рабочим и НЕПРАВДИВЫМ: строки цехов есть
   * (их держат этапы без плана), семь колонок стоят прочерками, и это
   * читается как «загрузка нулевая» — то есть как ответ, тогда как ответа
   * нет. Пустое состояние ниже в такой ситуации не показывается вовсе.
   *
   * На проде 22.08 так и было: 43 открытых этапа, плановой даты нет ни
   * у одного. Причина не в невнимательности — дату пишет только форма
   * «Взять в работу», то есть в момент запуска этапа, а `waiting` этапы
   * (будущее, ради которого экран и заведён) её не получают никогда.
   */
  const nothingPlanned = totals.planned === 0 && totals.unplanned > 0;

  /**
   * Куда идти проставлять. Полоса «загрузка не рассчитывается» без этого
   * списка оставляет человека с задачей «найди сам среди полутора десятков
   * заказов» — а срок ставится в карточке заказа, колонкой «План».
   * Показываем пять самых крупных: полный список это сам раздел «Заказы».
   */
  const unplannedOrders = useMemo(() => ordersWithoutPlan(orders), [orders]);

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
  const periodLabel = `${dayLabel(days[0]).day} — ${dayLabel(days[6]).day} ${
    parseIsoDate(days[6]).toLocaleDateString('ru-RU', { month: 'long' })}`;

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
      </div>

      {!loaded && !loadError && <TableSkeleton />}
      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="загрузку цехов" />}

      {loaded && nothingPlanned && (
        <div className={styles.warnBox} role="status">
          <strong>Загрузка не рассчитывается: плановых дат нет ни у одного открытого этапа</strong>
          {' '}({totals.unplanned} шт). Листать недели бессмысленно — там будет то же самое.
          Дату этапа проставляют в карточке заказа (колонка «План») или при взятии
          работы в цех; до этого сетка ниже показывает прочерки, а весь объём
          попадает в колонку «Без плана».
          {unplannedOrders.length > 0 && (
            <div className={styles.checkRow} style={{ marginTop: 8 }}>
              {unplannedOrders.slice(0, 5).map(({ order, unplanned }) => (
                <OrderLink key={order.id} orderId={order.id}>
                  №{order.bitrix_id} · {unplanned} без срока
                </OrderLink>
              ))}
              {unplannedOrders.length > 5 && (
                <Link to="/orders" className={styles.widgetLink}>
                  ещё {unplannedOrders.length - 5} →
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {loaded && rows.length === 0 && (
        <EmptyState
          icon="calendar"
          title="На эту неделю планов нет"
          text="Загрузка считается по плановым датам этапов — их проставляют, когда берут работу в цех."
          action={<Link to="/orders" className={styles.widgetLink}>Открыть заказы →</Link>}
        />
      )}

      {/*
        КОМПАКТНАЯ РАСКЛАДКА (планшет цеха). Сетка «цех × семь дней + две
        сводные колонки» на 768px не помещается: карточка на цех с лентой
        недели внутри укладывается даже в 375px.
      */}
      {loaded && rows.length > 0 && compact && (
        <div className={styles.dataCardList}>
          {rows.map((row) => (
            <DeptLoadCard
              key={row.dept.id}
              row={row}
              days={days}
              dayLabel={dayLabel}
              today={today}
              maxCell={maxCell}
            />
          ))}
        </div>
      )}

      {loaded && rows.length > 0 && !compact && (
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
