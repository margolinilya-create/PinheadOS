import { memo } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { DEV_OUTCOME_LABELS } from '../../types';
import {
  DEV_STATE_LABELS, currentBlocker, devReadiness, nextAction, taskLabel,
} from '../../utils/experimentalTasks';
import { formatDateShort } from '../../utils/time';
import styles from '../../styles';

/**
 * Разработка карточкой вместо строки таблицы — компактная раскладка
 * (планшет и телефон).
 *
 * Зачем: список ЭКС — шесть колонок, из которых две («Текущий блокер»
 * и «Состояние») несут по две строки текста каждая. Ниже 1024px это уезжало
 * за край, а именно блокер отвечает на вопрос, с которым на экран и приходят:
 * «почему разработка стоит».
 *
 * Подписи полей ставятся ЯВНО: вместе с шапкой таблицы исчезают названия
 * колонок, и «2 / 5» без слова «Готовность» ничего не значит.
 *
 * Открытие — ОТДЕЛЬНАЯ КНОПКА, а не клик по всей карточке. На планшете палец
 * задевает карточку при прокрутке, и «переход по касанию» уводил бы с экрана
 * без спроса; у строки таблицы этой беды нет — там курсор.
 */
function DevRowCardBase({ dev, tasks, state, stateVariant, typeNames, today, onOpen }) {
  const readiness = devReadiness(tasks);
  const blocker = currentBlocker(tasks, typeNames, today);
  const due = dev.due_date || dev.order?.due_date || null;
  const title = dev.tech_name || 'Без названия';

  return (
    <article className={styles.dataCard} aria-label={`Разработка: ${title}`}>
      <div className={styles.dataCardHead}>
        <strong>{title}</strong>
        <Badge variant={stateVariant}>{DEV_STATE_LABELS[state]}</Badge>
      </div>

      <div className={styles.cellSub}>
        №{dev.order?.bitrix_id || '—'} · {dev.order?.title || ''}
      </div>

      <div className={styles.dataCardFields}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Кто ведёт</span>
          <span>
            {dev.technologist || dev.constructor
              || <span className={styles.subText}>не назначен</span>}
          </span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Готовность</span>
          {/* Ноль задач — «—», а не «0 %»: это «неизвестно», а не «готово» */}
          <span>
            {readiness.total > 0
              ? `${readiness.done} / ${readiness.total}`
              : <span className={styles.subText}>—</span>}
          </span>
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Срок</span>
          <span className={state === 'attention' ? styles.overdue : undefined}>
            {due ? formatDateShort(due) : '—'}
          </span>
        </span>
      </div>

      {/* Блокер — во всю ширину: это ответ на «почему стоит», и он длиннее
          остальных полей */}
      <div className={styles.dataCardField}>
        <span className={styles.dataCardFieldLabel}>Текущий блокер</span>
        <span>
          {dev.outcome
            ? <span className={styles.subText}>{DEV_OUTCOME_LABELS[dev.outcome]}</span>
            : (blocker
              ? <>
                {taskLabel(blocker, typeNames)}
                <div className={styles.subText}>{nextAction(dev, tasks, typeNames, today)}</div>
              </>
              : <span className={styles.subText}>нет</span>)}
        </span>
      </div>

      <Button variant="secondary" block onClick={() => onOpen(dev.id)}>
        Открыть разработку
      </Button>
    </article>
  );
}

export const DevRowCard = memo(DevRowCardBase);
