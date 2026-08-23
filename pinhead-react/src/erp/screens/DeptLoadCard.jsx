import { memo } from 'react';
import { deptShortName } from '../data/departments';
import styles from '../styles';

/**
 * Загрузка ОДНОГО цеха карточкой — компактная раскладка (планшет и телефон).
 *
 * Зачем не «строка карточкой», как у склада и закупки: здесь не список, а
 * МАТРИЦА «цех × семь дней + две сводные колонки». Десять колонок на 768px
 * не помещаются, и сетка уезжала за край — а «Загрузка» это ровно тот экран,
 * на который руководитель смотрит между делом, стоя в цеху.
 *
 * Поэтому карточка на ЦЕХ, а внутри — лента недели: семь ячеек по ~44px
 * укладываются даже в 375px, так что горизонтальной прокрутки не остаётся
 * вовсе. Числа и заливка «тепла» те же и считаются тем же кодом (`utils/deptLoad`),
 * меняется только обёртка.
 *
 * Подписи «Просрочено» и «Без плана» ставятся ЯВНО: вместе с шапкой таблицы
 * исчезают названия колонок, и «12 шт» без подписи ничего не значит.
 */
function DeptLoadCardBase({ row, days, dayLabel, today, maxCell }) {
  const name = deptShortName(row.dept.code, row.dept.name);
  return (
    <article className={styles.dataCard} aria-label={`Загрузка цеха ${name}`}>
      <div className={styles.dataCardHead}>
        <strong>{name}</strong>
      </div>

      <div className={styles.loadWeek}>
        {row.cells.map((cell, i) => {
          const { dow, day } = dayLabel(days[i]);
          const isToday = days[i] === today;
          return (
            <div
              key={cell.date}
              className={`${styles.loadDay} ${styles.loadCell}`}
              title={cell.qty > 0 ? `${cell.qty} шт · этапов: ${cell.stages}` : 'Планов нет'}
            >
              {cell.qty > 0 && (
                <span
                  className={styles.loadCellFill}
                  /* Доля от максимума по сетке — единственное динамическое значение */
                  style={{ opacity: 0.15 + 0.85 * (cell.qty / Math.max(maxCell, 1)) }}
                />
              )}
              <span className={`${styles.loadDayLabel} ${isToday ? styles.loadToday : ''}`}>
                {dow} {day}
              </span>
              <span className={styles.loadCellValue}>{cell.qty > 0 ? cell.qty : '—'}</span>
            </div>
          );
        })}
      </div>

      <div className={styles.dataCardFields}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Просрочено</span>
          <span className={row.overdue.qty > 0 ? styles.overdue : styles.subText}>
            {row.overdue.qty > 0 ? `${row.overdue.qty} шт` : '—'}
          </span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Без плана</span>
          <span className={row.unplanned.qty > 0 ? styles.dueSoon : styles.subText}>
            {row.unplanned.qty > 0 ? `${row.unplanned.qty} шт` : '—'}
          </span>
        </span>
      </div>
    </article>
  );
}

export const DeptLoadCard = memo(DeptLoadCardBase);
