import { Link } from 'react-router-dom';
import { Skeleton } from '../../components/shared/Skeleton';
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
export function CapacityBar({ report, periodLabel, hint, loading = false }) {
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

      {/*
        Пока настройки не приехали, на месте трека стоит заглушка ЕГО высоты:
        «мощность загружается» и «мощность не задана» давали одинаковый нуль,
        и появление полосы сдвигало вниз всю страницу под собой. Величина мала,
        зато под ней едет весь экран.
      */}
      {loading && <Skeleton height={8} radius={4} style={{ margin: '8px 0 6px' }} />}

      {/* Полосы нет, пока мощность не задана: пустой трек читается как «загрузка
          ноль», а на деле знаменатель неизвестен — то же правило, по которому
          `percentOf` отдаёт null, а не 100 */}
      {!loading && !notSet && (
        <div className={styles.capacityTrack}>
          <span
            className={`${styles.capacityFill} ${report.over > 0 ? styles.capacityFillOver : ''}`}
            style={{ width: `${fill}%` }}
          />
        </div>
      )}

      <p className={styles.queueReason}>
        {hint ?? 'Считается по изделиям активных заказов со сроком сдачи в этом периоде — не по этапам: одно изделие проходит несколько цехов.'}
      </p>
    </section>
  );
}
