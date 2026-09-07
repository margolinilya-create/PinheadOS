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
        ТРИ СОСТОЯНИЯ ПОЛОСЫ ДЕРЖАТ ОДНУ И ТУ ЖЕ КОРОБКУ — «загружается»,
        «мощность не задана» и настоящий трек, — и держат её ОДНИМ классом
        (`capacityTrackGhost` повторяет высоту и поля `capacityTrack`).

        Раньше высот было три разных. Сначала «не задано» было нулём, и полоса,
        появляясь, увозила вниз всю страницу под собой; это починили заглушкой.
        Заглушка «загружается» при этом осталась своей — скелетон 8px с полями
        8/6, то есть 22px против 26px у трека, — и переход «загрузилось»
        по-прежнему двигал экран, только теперь на 4 пикселя. Замер под
        замедленным ЦП показал ровно их: y 262 → 266 у сноски и всё, что ниже.
        Величина мала, а едет под ней весь экран, и в сумме сдвигов это
        и выносило /plan за порог Web Vitals.

        Скелетон живёт ВНУТРИ той же коробки и своих полей не имеет: два места,
        задающие одну высоту, разъезжаются — этой правкой и разъехались.
      */}
      {loading || notSet ? (
        /* Полосы нет, пока мощность не задана: пустой трек читается как
           «загрузка ноль», а на деле знаменатель неизвестен — то же правило,
           по которому `percentOf` отдаёт null, а не 100. Место при этом занято. */
        <div className={styles.capacityTrackGhost} aria-hidden={notSet || undefined}>
          {loading && <Skeleton height={10} radius={2} />}
        </div>
      ) : (
        <div className={styles.capacityTrack}>
          <span
            className={`${styles.capacityFill} ${report.over > 0 ? styles.capacityFillOver : ''}`}
            style={{ width: `${fill}%` }}
          />
        </div>
      )}

      {/* Пояснение — СНОСКА, а не сообщение. До 06.09 оно рисовалось классом
          `queueReason`, то есть серой плашкой во всю ширину: тем же видом,
          каким в очереди цеха объясняют, ПОЧЕМУ задание стоит. На обзоре это
          читалось как предупреждение, хотя текст всего лишь объясняет способ
          подсчёта и никакого действия не требует. */}
      <p className={styles.capacityNote}>
        {hint ?? 'Считается по изделиям активных заказов со сроком сдачи в этом периоде — не по этапам: одно изделие проходит несколько цехов.'}
      </p>
    </section>
  );
}
