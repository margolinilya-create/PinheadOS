import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { formatDateShort } from '../../utils/time';
import { weekdayName } from '../../utils/format';
import styles from '../../styles';

/**
 * Перенос задачи плана на ЛЮБОЙ день — два действия вместо N.
 *
 * ЗАЧЕМ ОНО, ЕСЛИ КНОПКИ «‹ ›» УЖЕ ЕСТЬ. Они ходят по СОСЕДЯМ, и записанное
 * правило проекта говорит прямо: «Клавиатурная альтернатива перетаскиванию
 * ходит по СОСЕДЯМ, и требование „перенести сразу через шаг“ ею не
 * исполняется. Пока перетаскивание — единственный способ перешагнуть,
 * требование выполнено только мышью». На цеховом планшете мыши нет вовсе,
 * то есть понедельник → пятница не исполнялся никак: четыре тапа по цели,
 * которая после каждого уезжает из-под пальца (тот же дефект, что чинили
 * в очереди цеха кнопкой «В начало очереди»).
 *
 * ПОЧЕМУ НЕ ТАЧ-ПОЛИФИЛЛ ВМЕСТО ЭТОГО. Он подключён рядом (`PlanScreen`),
 * но проблему не решает: зоны сброса — колонки дня по 300px в горизонтально
 * прокручиваемой доске, на 768px видно две с половиной, а автопрокрутки
 * доски при перетаскивании у плана нет (она есть только у `ErpKanban`).
 * Жест дотянется до соседней колонки — ровно то же, что «‹ ›».
 *
 * Дни недели — кнопками: это и есть «через шаг» одним касанием. Поле даты
 * рядом, потому что переносят и за пределы видимой недели, а подменять им
 * кнопки нельзя — ввод даты руками на планшете дороже тапа.
 */
export function PlanMoveModal({
  slot, dates, today, busy, onMove, onClose,
}) {
  const [custom, setCustom] = useState('');

  const move = (date) => {
    if (!date || date === slot.work_date) return;
    onMove(date);
  };

  return (
    <Modal title={`Перенести с ${formatDateShort(slot.work_date)}`} onClose={onClose}>
      {/*
        Порядок внутри дня НЕ сохраняется: `movePlanSlot` кладёт задачу
        в конец дня (`tailSortOrder`). Это поведение существующее, менять его
        здесь нельзя — но человек, который расставлял очерёдность руками,
        должен знать об этом ДО переноса, а не после.
      */}
      <p className={styles.subText}>
        Задача встанет в конец выбранного дня. План и факт сохраняются.
      </p>

      <div className={styles.planMoveDays}>
        {dates.map((date) => {
          const isCurrent = date === slot.work_date;
          return (
            <Button
              key={date}
              variant={isCurrent ? 'ghost' : 'secondary'}
              disabled={busy || isCurrent}
              onClick={() => move(date)}
              aria-label={`Перенести на ${weekdayName(date)}, ${formatDateShort(date)}`}
            >
              <span className={styles.planMoveDay}>
                <b>{weekdayName(date)}</b>
                <span className={styles.subText}>
                  {formatDateShort(date)}
                  {date === today ? ' · сегодня' : ''}
                  {isCurrent ? ' · сейчас здесь' : ''}
                </span>
              </span>
            </Button>
          );
        })}
      </div>

      <label className={styles.planMoveCustom}>
        <span className={styles.dataCardFieldLabel}>Другая дата</span>
        <DateField value={custom} onChange={setCustom} disabled={busy} />
      </label>
      <div className={styles.modalActions}>
        <Button
          variant="primary"
          disabled={busy || !custom || custom === slot.work_date}
          onClick={() => move(custom)}
        >
          Перенести на выбранную дату
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onClose}>Отмена</Button>
      </div>
    </Modal>
  );
}
