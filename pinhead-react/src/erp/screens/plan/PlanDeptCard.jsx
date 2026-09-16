import { memo } from 'react';
import { Button } from '../../components/Button';
import { deptShortName } from '../../data/departments';
import { percentLabel } from '../../utils/format';
import styles from '../../styles';

/**
 * Сводка по ОДНОМУ цеху карточкой — компактная раскладка вкладки «Все цеха».
 *
 * Зачем: таблица сводки несёт ДВЕНАДЦАТЬ колонок, а «Все цеха» — вкладка
 * по умолчанию (`deptCode = params.get('dept') || 'all'`). То есть руководитель,
 * открывший `/plan` с планшета, первым кадром получал таблицу, у которой
 * «Ждут материалы» и «Брак» за правым краем. Горизонтальной прокрутки мало:
 * без шапки «10» и «3» несравнимы — тот же довод, по которому заведён
 * `DeptLoadCard`, и карточка сделана по его образцу.
 *
 * Переход — ЯВНАЯ КНОПКА, а не `onClick` на контейнере: у десктопной строки
 * есть курсор, у карточки на планшете — палец, который задевает её при
 * прокрутке. Правило проекта: «Открытие карточки на планшете — отдельная
 * КНОПКА, а не касание карточки».
 *
 * Величины подписаны явно: вместе с шапкой таблицы исчезают названия колонок.
 */
function PlanDeptCardBase({ dept, week, day, onPick }) {
  const name = deptShortName(dept.code, dept.name);
  return (
    <article className={styles.dataCard} aria-label={`План цеха ${name}`}>
      <div className={styles.dataCardHead}>
        <strong>{name}</strong>
        <span className={styles.subText}>
          день {day.planned}/{day.fact} · {percentLabel(day.percent)}
        </span>
      </div>

      <div className={styles.dataCardFields}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>План на неделю</span>
          <span>{week.planned}</span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Факт за неделю</span>
          <span>{week.fact}</span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Выполнение</span>
          <span>{percentLabel(week.percent)}</span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Незавершённых</span>
          <span>{week.active}</span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Просрочено</span>
          <span className={week.overdue > 0 ? styles.overdue : styles.subText}>
            {week.overdue > 0 ? week.overdue : '—'}
          </span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Проблем</span>
          <span className={week.problems > 0 ? styles.overdue : styles.subText}>
            {week.problems > 0 ? week.problems : '—'}
          </span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Ждут материалы</span>
          <span className={week.awaitingMaterials > 0 ? styles.dueSoon : styles.subText}>
            {week.awaitingMaterials > 0 ? week.awaitingMaterials : '—'}
          </span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Брак</span>
          <span className={week.defect > 0 ? styles.overdue : styles.subText}>
            {week.defect > 0 ? week.defect : '—'}
          </span>
        </span>
      </div>

      <Button variant="secondary" block onClick={() => onPick(dept.code)}>
        Открыть цех
      </Button>
    </article>
  );
}

export const PlanDeptCard = memo(PlanDeptCardBase);
