import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useDictionary } from '../../store/useDictionary';
import { DateField } from '../../components/DateField';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { EmptyState } from '../../components/ErpStates';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { TableSkeleton } from '../../components/ErpSkeletons';
import { addDays, factoryToday } from '../../../utils/date';
import styles from '../../styles';

/**
 * РАЗДЕЛ «АНАЛИТИКА» (правка заказчика 16.09, п. 7), первая итерация.
 *
 * «Главный экран должен быстро отвечать на вопросы: сколько выпустили,
 * сколько было плюсов, сколько ткани использовали, какой фактический расход
 * ткани, сколько стоит сборка, где возникает брак».
 *
 * СЧИТАЕТ СЕРВЕР. Четыре агрегации уходят параллельно и каждая сама проверяет
 * право `analytics.view` — тем же, чем гейтится эта вкладка. Клиент только
 * рисует: тянуть историю фабрики ради пяти плиток нельзя.
 *
 * ПУСТОЕ СОСТОЯНИЕ ОБЯЗАТЕЛЬНО, и это не украшение. На боевой базе 16.09
 * семь отчётов, а размерных и рулонных данных нет вовсе — они начинают
 * копиться с этой правки. График, нарисованный плоским нулём, читается как
 * поломка системы; поэтому пустая сводка говорит словами, ЧЕГО именно нет.
 *
 * НОРМАТИВ НЕ ПОКАЗЫВАЕТСЯ (решение владельца 16.09): документ сам говорит
 * «норматив будет браться потом». Колонка «отклонение от норматива» не пустая,
 * а ОТСУТСТВУЮЩАЯ — пустая колонка обещает данные, которых нет.
 */

/**
 * Период по умолчанию — последние 30 дней, включая сегодня.
 *
 * Арифметика через `addDays`, а не через `Date` и `toISOString`: тот режет
 * дату из UTC, и у фабрики в UTC+3 «сегодня» до трёх часов ночи было бы
 * вчерашним. Это записанное правило раздела, и его сторожит `date.test.ts`.
 */
function defaultRange() {
  const today = factoryToday();
  return { from: addDays(today, -29), to: today };
}

function Kpi({ label, value, hint, tone }) {
  return (
    <div className={`${styles.kpiCard}${tone ? ` ${styles[tone]}` : ''}`}>
      <div className={styles.kpiBody}>
        <span className={styles.kpiCardLabel}>{label}</span>
        <span className={styles.kpiCardValue}>{value}</span>
        {hint && <span className={styles.subText}>{hint}</span>}
      </div>
    </div>
  );
}

/** «—» вместо нуля там, где ноль означает «нет данных», а не «ноль штук» */
const num = (v, suffix = '') => (v === null || v === undefined ? '—' : `${v}${suffix}`);

export function AnalyticsTab() {
  const [range, setRange] = useState(defaultRange);
  const [product, setProduct] = useState('');
  const [dept, setDept] = useState('');
  const [bucket, setBucket] = useState('day');

  const { departments, analytics, analyticsLoading, loadAnalytics } = useErpStore(
    useShallow((s) => ({
      departments: s.departments,
      analytics: s.analytics,
      analyticsLoading: s.analyticsLoading,
      loadAnalytics: s.loadAnalytics,
    })),
  );
  const productTypes = useDictionary('product_type');

  useEffect(() => {
    loadAnalytics({
      from: range.from, to: range.to, bucket, product: product || null, dept: dept || null,
    });
  }, [loadAnalytics, range.from, range.to, bucket, product, dept]);

  const overview = analytics?.overview ?? null;
  const deptName = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
  );

  const released = overview?.released ?? 0;
  const prev = overview?.released_prev ?? 0;
  const delta = released - prev;

  const hasAnything = released > 0
    || (analytics?.byDept ?? []).some((r) => r.done_qty > 0 || r.defect > 0);

  return (
    <div className={styles.matSection}>
      {/* ФИЛЬТРЫ. Период обязателен — он же задаёт сопоставимый предыдущий */}
      <div className={styles.planFormRow}>
        <label className={styles.planDateRow}>
          Период с
          <DateField
            value={range.from}
            onChange={(v) => setRange((r) => ({ ...r, from: v }))}
            aria-label="Начало периода"
          />
        </label>
        <label className={styles.planDateRow}>
          по
          <DateField
            value={range.to}
            onChange={(v) => setRange((r) => ({ ...r, to: v }))}
            aria-label="Конец периода"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Изделие</span>
          <select
            className={styles.select}
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            aria-label="Изделие"
          >
            <option value="">Все изделия</option>
            {productTypes.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Цех</span>
          <select
            className={styles.select}
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            aria-label="Цех"
          >
            <option value="">Все цеха</option>
            {departments.filter((d) => d.active).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Детализация</span>
          <select
            className={styles.select}
            value={bucket}
            onChange={(e) => setBucket(e.target.value)}
            aria-label="Детализация"
          >
            <option value="day">По дням</option>
            <option value="week">По неделям</option>
          </select>
        </label>
      </div>

      {analyticsLoading && !analytics && <TableSkeleton rows={4} />}

      {overview && (
        <>
          <div className={styles.dashKpis}>
            <Kpi
              label="Выпущено изделий, шт"
              value={released}
              hint={prev > 0
                ? `${delta >= 0 ? '+' : ''}${delta} к прошлому периоду (${prev})`
                : 'сравнить не с чем: в прошлом периоде выпуска не было'}
            />
            {/*
              «Плюс» — изделие сверх тиража (решение владельца 16.09).
              Величина не хранится, а выводится: `max(факт − тираж, 0)`,
              и сервер считает её той же формулой, что `utils/stageQty`.
            */}
            <Kpi
              label="Количество плюсов, шт"
              value={overview.extra}
              hint="изделия сверх тиража — появляются на закрое"
            />
            <Kpi
              label="Средняя себестоимость сборки, ₽/шт"
              value={num(overview.assembly_avg)}
              hint={overview.assembly_avg === null
                ? 'стоимость сборки ещё не вносили'
                : `покрыто ${overview.assembly_covered_qty} шт из ${released}`}
            />
            <Kpi
              label="Использовано ткани, кг"
              value={overview.fabric_kg || '—'}
              hint={overview.fabric_rolls > 0
                ? `рулонов в работе: ${overview.fabric_rolls}`
                : 'расход считается по рулонам закроя'}
            />
            <Kpi
              label="Средний расход ткани, кг/изделие"
              value={num(overview.fabric_per_item)}
              hint="норматив будет добавлен позже"
            />
          </div>

          {/* Брак и переделка по цехам — блок, который уже наполняется:
              он считается по ВСЕМ этапам, а не только терминальным */}
          {(analytics.byDept ?? []).length > 0 && (
            <ScrollHintBox className={styles.tableWrap} label="Брак и переделка по цехам">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Цех</th>
                    <th scope="col">Сдано, шт</th>
                    <th scope="col">Брак, шт</th>
                    <th scope="col">В переделку, шт</th>
                    <th scope="col">Брак, %</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.byDept.map((row) => (
                    <tr key={row.department_id}>
                      <th scope="row">{deptName.get(row.department_id) ?? '—'}</th>
                      <td>{row.done_qty}</td>
                      <td>{row.defect}</td>
                      <td>{row.rework}</td>
                      <td>{num(row.defect_pct, '%')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollHintBox>
          )}

          {/* Производство по моделям. Колонки «отклонение от норматива» нет
              вовсе — норматива пока не существует, и пустая колонка обещала бы
              данные, которых нет */}
          {(analytics.bySku ?? []).length > 0 && (
            <ScrollHintBox className={styles.tableWrap} label="Производство по моделям">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Изделие</th>
                    <th scope="col">Выпущено, шт</th>
                    <th scope="col">Брак, шт</th>
                    <th scope="col">Брак, %</th>
                    <th scope="col">Сборка, ₽/шт</th>
                    <th scope="col">Заказов</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.bySku.map((row) => (
                    <tr key={`${row.sku_card_id ?? 'none'}-${row.product_type}`}>
                      <th scope="row">{row.product_type}</th>
                      <td>{row.released}</td>
                      <td>{row.defect}</td>
                      <td>{num(row.defect_pct, '%')}</td>
                      <td>{num(row.assembly_avg)}</td>
                      <td>{row.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollHintBox>
          )}

          {(analytics.series ?? []).length > 0 && (
            <ScrollHintBox className={styles.tableWrap} label="Динамика выпуска">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{bucket === 'week' ? 'Неделя' : 'День'}</th>
                    <th scope="col">Выпущено</th>
                    <th scope="col">Брак</th>
                    <th scope="col">Переделка</th>
                    <th scope="col">Плюсы</th>
                    <th scope="col">Ткань, кг</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.series.map((row) => (
                    <tr key={row.bucket}>
                      <th scope="row">{row.bucket}</th>
                      <td>{row.released}</td>
                      <td>{row.defect}</td>
                      <td>{row.rework}</td>
                      <td>{row.extra}</td>
                      <td>{row.fabric || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollHintBox>
          )}

          {!hasAnything && !analyticsLoading && (
            <EmptyState
              icon="overview"
              title="За выбранный период данных нет"
              text={'Выпуск считается по отчётам последнего производственного этапа позиции, '
                + 'расход ткани — по рулонам закроя, а себестоимость — по стоимости сборки, '
                + 'которую вносит швейный цех. Эти данные начинают копиться с правок 16.09: '
                + 'по уже закрытым заказам их нет.'}
            />
          )}

          <p className={styles.subText}>
            <Icon name="eye" size={13} />
            {' '}
            Период: {overview.from} — {overview.to}. Сравнение идёт с {overview.prev_from} — {overview.prev_to}.
          </p>
        </>
      )}

      {!overview && !analyticsLoading && (
        <div className={styles.queueActions}>
          <Button variant="secondary" onClick={() => loadAnalytics({
            from: range.from, to: range.to, bucket, product: product || null, dept: dept || null,
          })}
          >
            <Icon name="refresh" size={14} /> Повторить загрузку
          </Button>
        </div>
      )}
    </div>
  );
}
