import { Skeleton } from '../../../components/shared/Skeleton';
import { TableSkeleton } from '../../components/ErpSkeletons';
import styles from '../../styles';

/**
 * Скелетон недельной доски плана.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ СТРОКА В `ErpSkeletons`. Тот импортирует
 * `erp.module.css` напрямую и едет в чанке ОБОЛОЧКИ, а `.planBoard`/`.planDay`
 * объявлены в `screens.module.css` — импорт агрегатора вернул бы доску плана
 * в критический путь. Здесь агрегатор допустим: файл грузится вместе с экраном.
 *
 * ПОЧЕМУ НЕ `KanbanSkeleton`, который стоял здесь раньше. Он рисует колонки
 * канбана (`.kanbanCol`, 290px), а экран показывает недельную доску либо
 * таблицу сводки — ни одного общего класса. По записанному правилу проекта
 * скелетон повторяет финальный лейаут БУКВАЛЬНО, теми же классами; разошёлся —
 * это не скелетон, а мигание чужой разметкой, то есть лишний скачок вёрстки
 * вместо обещанной плавности.
 */
export function PlanBoardSkeleton({ days = 5, deptCode = 'all' }) {
  // Сводка «Все цеха» — таблица, и скелетон у неё табличный
  if (deptCode === 'all') {
    return <TableSkeleton rows={7} label="Загрузка сводки по цехам" />;
  }

  return (
    <div className={styles.planBoardWrap} role="status" aria-label="Загрузка недельного плана">
      <div className={styles.planBoard}>
        {Array.from({ length: days }).map((_, i) => (
          <div key={i} className={styles.planDay}>
            <div className={styles.planDayHead}>
              <Skeleton width="52%" height={13} />
              <Skeleton width="30%" height={11} style={{ marginTop: 4 }} />
            </div>
            <div className={styles.planDayStats}>
              <Skeleton width="100%" height={11} />
            </div>
            <Skeleton height={54} radius={6} style={{ marginTop: 8 }} />
            <Skeleton height={54} radius={6} style={{ marginTop: 6 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
