import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { OrderLink } from '../../components/OrderLink';
import { daysLeft, formatDateShort, stageOverdue } from '../../utils/time';
import { stageQtyProgress } from '../../utils/progress';
import { STAGE_STATUS_LABELS } from '../../types';
import { STAGE_CHIP_CLASS } from '../../utils/stageUi';
import { itemTzDocument, tzUpdatedAfterStart } from '../../utils/tz';
import styles from '../../styles';
import { Icon } from '../../components/Icon';
import { StageActionsPanel } from './StageActionsPanel';
import { MaterialWait } from './MaterialWait';
import { dueLabelCompact } from '../../utils/format';
import { Button, ButtonLink } from '../../components/Button';

/**
 * Компактная строка рабочей очереди цеха (правка 2) — вместо крупной карточки.
 * Показывает приоритет, № и название заказа, изделие/вариант, количество, срок
 * и просрочку, статус, причину блокировки, исполнителя и процент готовности.
 *
 * Красным выделяется только просрочка/проблема (чип и колонка срока), а не вся
 * строка — правило docs/DESIGN.md. Развёрнутая строка показывает ТЗ и действия.
 */
export function QueueRow({
  entry, index, perms, canReorder, rework, deptShortById, actions,
  dragging, dropBefore, dropAfter,
  onDragStart, onDragEnd, onDragOverRow,
  canMoveUp, canMoveDown, onMove, onPlan,
}) {
  const { order, item, stage, reason, group, missingMaterials, bypass } = entry;
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const d = daysLeft(order.due_date);
  const overdue = stageOverdue(stage.planned_end, stage.status);
  const needsAck = overdue && !stage.overdue_ack_at;
  /**
   * «Не запланирован» — у открытого этапа нет своей плановой даты (правки 10.08).
   *
   * Это НЕ просрочка: сорвать несуществующий план нельзя, и чип нейтральный.
   * Но и не пустое место: такой этап не попадёт ни в загрузку цехов, ни в отбор
   * «сорван план этапа» — он выпадает из контроля сроков молча. На проде так
   * живут 305 открытых этапов из 311, поэтому чип и заведён: до него понять,
   * почему у задания «всё хорошо со сроками», было нечем.
   */
  const unplanned = !stage.planned_end && group !== 'done' && stage.status !== 'skipped';
  const progress = stageQtyProgress(stage, item.qty);
  const display = group === 'ready' ? 'ready' : stage.status;
  // Индикатор ТЗ: сначала реальный PDF цеха (волна 4), иначе структурное ТЗ позиции
  const tzDoc = itemTzDocument(order, item.id);
  // ТЗ заменили уже после того, как цех взял задание: без бейджа исполнитель
  // доделает по старому файлу. В панели действий он был, в строке очереди — нет
  const tzUpdated = tzUpdatedAfterStart(tzDoc, stage);
  const hasTz = (item.prints ?? []).length > 0 || (item.size_grid ?? []).length > 0;

  return (
    <div
      className={[
        styles.queueRow,
        dragging && styles.queueRowDragging,
        dropBefore && styles.queueRowDropBefore,
        dropAfter && styles.queueRowDropAfter,
      ].filter(Boolean).join(' ')}
      draggable={canReorder}
      onDragStart={(e) => canReorder && onDragStart(e, entry)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => canReorder && onDragOverRow(e, entry)}
    >
      <div className={styles.queueRowMain}>
        <span
          className={styles.queueRowPriority}
          title={canReorder ? 'Перетащите, чтобы изменить приоритет' : 'Приоритет в очереди'}
          aria-label={`Приоритет ${index + 1}`}
        >
          {canReorder && <span className={styles.dragHandle}><Icon name="grip" size={14} /></span>}
          {index + 1}
          {/* Клавиатурная и тач-альтернатива перетаскиванию. Внутри ячейки приоритета,
              а не рядом с ней: .queueRowMain — сетка на 8 колонок, и девятый ребёнок
              создавал неявную колонку, из-за которой строка выезжала за край. */}
          {canReorder && (
          <span className={styles.queueRowMoveBtns}>
            <button
              type="button"
              className={styles.moveBtn}
              disabled={!canMoveUp}
              aria-label={`Поднять приоритет: ${order.title}`}
              title="Поднять приоритет"
              onClick={() => onMove?.(-1)}
            >
              <Icon name="arrowUp" size={14} />
            </button>
            <button
              type="button"
              className={styles.moveBtn}
              disabled={!canMoveDown}
              aria-label={`Опустить приоритет: ${order.title}`}
              title="Опустить приоритет"
              onClick={() => onMove?.(1)}
            >
              <Icon name="arrowDown" size={14} />
            </button>
          </span>
          )}
        </span>

        <span className={styles.queueRowTitle}>
          <OrderLink
            orderId={order.id}
            className={styles.queueCardTitleLink}
            title={`№${order.bitrix_id || '—'} · ${order.title}`}
            draggable={false}
          >
            №{order.bitrix_id || '—'} · {order.title}
          </OrderLink>
          <span
            className={styles.subText}
            title={[item.product_type, item.variant, order.customer].filter(Boolean).join(' · ')}
          >
            {item.product_type}{item.variant ? ` · ${item.variant}` : ''}
            {order.customer ? ` · ${order.customer}` : ''}
          </span>
        </span>

        <span className={styles.queueRowQty}>{item.qty} шт</span>

        {/* Дата и просрочка — отдельными строками: вместе они не помещались в колонку
            и рисовались поверх статусов (grid содержимое ячейки не обрезает) */}
        <span className={styles.queueRowDue}>
          <span>{order.due_date ? formatDateShort(order.due_date) : '—'}</span>
          {d !== null && (
            <span className={d < 0 ? styles.overdue : d <= 3 ? styles.dueSoon : styles.subText}>
              {dueLabelCompact(d)}
            </span>
          )}
        </span>

        <span className={styles.queueRowStatus}>
          <span className={`${styles.chip} ${styles[STAGE_CHIP_CLASS[display]]}`}>
            {STAGE_STATUS_LABELS[display]}
          </span>
          {overdue && (
            <span className={`${styles.chip} ${styles.chipBlocked}`}>
              <Icon name="clock" size={13} /> сорван план этапа
            </span>
          )}
          {/*
            Образец из экспериментального цеха (волна 3.6). Это НАСТОЯЩИЙ этап
            в очереди — те же права, тот же страж, тот же план, — и бейдж нужен
            только чтобы цех понимал: тираж один-два, а не сто, и спрос другой.
            В маршрутную логику признак не входит.
          */}
          {stage.origin === 'experimental' && (
            <span
              className={`${styles.chip} ${styles.chipWaiting}`}
              title="Образец из экспериментального цеха — разработка, а не серия"
            >
              {/* Формулировка из документа 20.08: «в общем производственном
                  цехе задача должна иметь заметную пометку ЭКС / ОБРАЗЕЦ,
                  чтобы сотрудники понимали, что это разработка образца» */}
              <Icon name="flask" size={13} /> ЭКС / ОБРАЗЕЦ
            </span>
          )}
          {!overdue && unplanned && (
            <span
              className={`${styles.chip} ${styles.chipNeutral}`}
              title="У этапа нет плановой даты завершения: он не виден в загрузке цехов и не может быть просрочен"
            >
              <Icon name="calendar" size={13} /> не запланирован
            </span>
          )}
          {tzUpdated && (
            <span className={`${styles.chip} ${styles.chipWaiting}`} title="ТЗ заменили после начала работы — сверьтесь с актуальной версией">
              <Icon name="file" size={13} /> ТЗ обновлено
            </span>
          )}
          {tzDoc ? (
            <span
              className={styles.subText}
              title={`ТЗ: ${tzDoc.file_name || 'файл'}${tzDoc.version > 1 ? `, версия ${tzDoc.version}` : ''}`}
            >
              <Icon name="file" size={14} />
            </span>
          ) : hasTz && (
            <span className={styles.subText} title="Есть ТЗ позиции"><Icon name="orders" size={15} /></span>
          )}
        </span>

        <span className={styles.queueRowAssignee} title="Исполнитель">
          {stage.assignee || <span className={styles.subText}>не закреплено</span>}
        </span>

        <span className={styles.queueRowProgress} title={`Сделано ${progress.done} из ${progress.total} шт`}>
          <span className={styles.progressTrack} aria-hidden="true">
            <span className={styles.progressFill} style={{ width: `${progress.pct}%` }} />
          </span>
          <span className={styles.progressCell}>{progress.pct}%</span>
        </span>

        <span className={styles.queueRowActions}>
          {/*
            Локальная постановка в план (правки 10.08). Раньше единственный путь
            вёл на общий экран плана, в нужный цех и нужный день, — то есть
            руководитель уходил со списка, где он и видит, что запускать.
            Кнопка только у готовых к запуску: планировать «ждёт материалы»
            можно, но это решение с оговоркой, и оно живёт на общем экране.
          */}
          {perms.plan && group === 'ready' && onPlan && (
            <Button
              variant="ghost"
              aria-label="Поставить в план"
              title="Поставить задание в план на день"
              onClick={() => onPlan(entry)}
            >
              <Icon name="calendar" size={15} />
            </Button>
          )}
          <ButtonLink
            to={`/task/${stage.id}`}
            state={{ from: `${location.pathname}${location.search}` }}
            variant="ghost"
            draggable={false}
          >
            Открыть
          </ButtonLink>
          <Button
            variant="secondary"
            aria-expanded={open}
            aria-label={open ? 'Свернуть задание' : 'Развернуть задание'}
            onClick={() => setOpen((v) => !v)}>
            <Icon name="chevronDown" size={15} className={open ? styles.chevronUp : undefined} />
          </Button>
        </span>
      </div>

      {(reason || bypass || (group === 'blocked' && stage.block_reason) || rework || needsAck) && (
        <div className={styles.queueRowNotes}>
          {/*
            Причина — компактный маркер у ОБЕИХ групп ожидания (правка 23.08,
            п. 2.4). Прежде в «Ожидают материалы» её заменял развёрнутый разбор
            на всю ширину; теперь разбор свёрнут внутри `MaterialWait` и стоит
            ПОСЛЕ причины, а не вместо неё.
          */}
          {reason && (
            <span className={styles.queueReason}>
              <span className={styles.cellWithIcon}><Icon name="clock" size={14} />{reason}</span>
            </span>
          )}
          {/*
            Задание запустилось со снятой проверкой — цех должен понимать, почему
            оно вообще в работе, и кто это решил
          */}
          {bypass && (
            <span className={`${styles.queueReason} ${styles.overdue}`}>
              <span className={styles.cellWithIcon}>
                <Icon name="shield" size={14} />
                Проверка снята вручную: {bypass.reason}
              </span>
            </span>
          )}
          {group === 'blocked' && stage.block_reason && (
            <span className={`${styles.queueReason} ${styles.overdue}`}>
              <span className={styles.cellWithIcon}><Icon name="ban" size={14} />{stage.block_reason}</span>
            </span>
          )}
          {rework && (
            <span className={styles.queueReason}>
              <span className={styles.cellWithIcon}>
                <Icon name="undo" size={14} />
                На переделку: {rework.qty_rework} шт · {(rework.comment || '').replace(' (фото во вложениях)', '')}
              </span>
            </span>
          )}
          {needsAck && perms.any && (
            <span className={styles.overdue}>
              <span className={styles.cellWithIcon}>
                <Icon name="clock" size={14} />
                Этап просрочен — нужен комментарий (разверните строку)
              </span>
            </span>
          )}
        </div>
      )}

      {group === 'awaiting_materials' && <MaterialWait materials={missingMaterials} compact />}

      {open && (
        <div className={styles.queueRowPanel}>
          <StageActionsPanel
            entry={entry}
            perms={perms}
            deptShortById={deptShortById}
            actions={actions}
          />
        </div>
      )}
    </div>
  );
}
