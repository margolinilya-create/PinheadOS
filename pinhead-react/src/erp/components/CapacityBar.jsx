import { Link } from 'react-router-dom';
import { percentLabel } from '../utils/format';
import styles from '../erp.module.css';

/**
 * Загрузка производства против общей мощности (правки заказчика 10.08).
 *
 * Одна полоса на трёх экранах — обзор, план и загрузка цехов, — чтобы число
 * «сколько мы вытягиваем и сколько набрали» везде читалось одинаково.
 *
 * Полоса заполняется максимум на 100 %, но ПОДПИСЬ потолка не знает: 130 %
 * пишется как 130 %, а перебор выносится отдельным числом в штуках. Заклампить
 * подпись значило бы спрятать ровно тот случай, ради которого показатель завели.
 */
export function CapacityBar({ report, periodLabel, hint, monthlyUnits = null }) {
  const notSet = report.capacity === null;
  const fill = notSet ? 0 : Math.min(100, report.percent ?? 0);

  return (
    <section className={styles.capacityBar} aria-label={`Загрузка производства, ${periodLabel}`}>
      <div className={styles.capacityHead}>
        <b>Загрузка производства · {periodLabel}</b>
        {notSet ? (
          <span className={styles.subText}>
            мощность не задана —{' '}
            <Link to="/admin?tab=capacity" className={styles.widgetLink}>настроить</Link>
          </span>
        ) : (
          <span className={report.over > 0 ? styles.overdue : styles.subText}>
            {report.used} из {report.capacity} шт · {percentLabel(report.percent)}
            {report.over > 0
              ? ` · сверх мощности ${report.over} шт`
              : ` · свободно ${report.left} шт`}
          </span>
        )}
      </div>

      {/* Полосы нет, пока мощность не задана: пустой трек читается как «загрузка
          ноль», а на деле знаменатель неизвестен — то же правило, по которому
          `percentOf` отдаёт null, а не 100 */}
      {!notSet && (
        <div className={styles.capacityTrack}>
          <span
            className={`${styles.capacityFill} ${report.over > 0 ? styles.capacityFillOver : ''}`}
            style={{ width: `${fill}%` }}
          />
        </div>
      )}

      <p className={styles.queueReason}>
        {hint ?? 'Считается по изделиям активных заказов со сроком сдачи в этом периоде — не по этапам: одно изделие проходит несколько цехов.'}
        {/*
          Откуда взялось число периода (M-11 отчёта QA 13.08.2026).
          На плане полоса показывала «2381 шт/нед», на загрузке и обзоре —
          «10000 шт/мес», и связь между ними нигде не называлась: два разных
          числа выглядели двумя разными мощностями. Мощность одна, месячная,
          а недельная доля считается из неё по рабочим дням.
        */}
        {monthlyUnits != null && (
          <>
            {' '}Общая мощность фабрики —{' '}
            <Link to="/admin?tab=capacity" className={styles.widgetLink}>
              {monthlyUnits} шт в месяц
            </Link>
            ; доля периода считается из неё по числу рабочих дней.
          </>
        )}
      </p>
    </section>
  );
}
