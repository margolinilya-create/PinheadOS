import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { orderPreviewUrl, lastDefectPhotoUrl } from '../../store/useErpStore';
import { OrderLink } from '../../components/OrderLink';
import { daysLeft, formatDateShort, stageOverdue } from '../../utils/time';
import styles from '../../styles';
import { Icon } from '../../components/Icon';
import { Lightbox } from './Lightbox';
import { StageActionsPanel } from './StageActionsPanel';
import { MaterialWait } from './MaterialWait';
import { dueLabelCompact } from '../../utils/format';
import { Button, ButtonLink } from '../../components/Button';
import { Badge } from '../../components/Badge';

/**
 * Карточка задания — мобильный вид очереди цеха (<760px), где строка не помещается.
 * Действия и формы общие со строкой и страницей задания (StageActionsPanel).
 */
export function QueueCard({
  entry, perms, rework, deptShortById, actions,
  index = 0, canReorder = false, canMoveUp = false, canMoveDown = false, onMove, onMoveTop, onPlan,
}) {
  const location = useLocation();
  const { order, item, stage, reason, group, missingMaterials } = entry;
  const overdue = stageOverdue(stage.planned_end, stage.status);
  const reworkPhoto = rework ? lastDefectPhotoUrl(order) : null;
  const qtyDone = stage.qty_done ?? 0;
  const [zoom, setZoom] = useState(false);
  const [imgError, setImgError] = useState(false);
  const d = daysLeft(order.due_date);
  const preview = orderPreviewUrl(order);
  const cardCls = [
    styles.queueCard,
    group === 'ready' && styles.queueCardReady,
    group === 'in_progress' && styles.queueCardProgress,
    group === 'blocked' && styles.queueCardBlocked,
    ((d !== null && d < 0) || overdue) && styles.queueCardUrgent,
  ].filter(Boolean).join(' ');

  return (
    <div className={cardCls}>
      <div className={styles.queueCardHead}>
        {preview && !imgError && (
          <button
            type="button"
            className={styles.queueThumbBtn}
            aria-label={`Открыть превью макета: ${order.title}`}
            onClick={() => setZoom(true)}
          >
            <img
              src={preview}
              alt=""
              className={styles.queueThumb}
              onError={() => setImgError(true)}
            />
          </button>
        )}
        {preview && imgError && (
          <div className={styles.queueThumbStub} aria-hidden="true"><Icon name="image" size={20} /></div>
        )}
        <div className={styles.queueCardHeadText}>
          <OrderLink
            orderId={order.id}
            className={`${styles.queueCardTitle} ${styles.queueCardTitleLink}`}
            title={`№${order.bitrix_id || '—'} · ${order.title}`}
          >
            №{order.bitrix_id || '—'} · {order.title}
          </OrderLink>
          <div
            className={styles.subText}
            title={[item.product_type, item.variant, order.customer].filter(Boolean).join(' · ')}
          >
            {item.product_type}
            {item.variant ? ` · ${item.variant}` : ''}
            {order.customer ? ` · ${order.customer}` : ''}
          </div>
        </div>
        <div className={styles.queueDue}>
          {/*
            СТАТУС СЛОВОМ, А НЕ ТОЛЬКО ЦВЕТОМ РАМКИ (обход 04.09).
            Строка очереди рисует чип с подписью (`QueueRow`), а карточка —
            ту же информацию одной лишь заливкой левого края. Цвет как
            единственный носитель смысла в разделе уже признан дефектом,
            и на планшете, где живёт именно эта раскладка, он ещё и попадает
            под цеховой свет. `display` считается так же, как в строке:
            готовность к запуску — вывод очереди, а не колонка этапа.
          */}
          <Badge entity="stage" status={group === 'ready' ? 'ready' : stage.status} />
          <div className={styles.queueQty}>{item.qty} шт</div>
          {order.due_date && (
            <div className={d < 0 ? styles.overdue : d <= 3 ? styles.dueSoon : styles.subText}>
              до {formatDateShort(order.due_date)}
              {d !== null && ` · ${dueLabelCompact(d)}`}
            </div>
          )}
        </div>
      </div>

      {zoom && preview && !imgError && (
        <Lightbox src={preview} alt={`Макет: ${order.title}`} onClose={() => setZoom(false)} />
      )}

      {/*
        Образец экс-цеха. Пометка была ТОЛЬКО в строке очереди (`QueueRow`),
        а карточку видит тот же цех на планшете и на канбане: документ 20.08
        требует «заметную пометку ЭКС / ОБРАЗЕЦ», чтобы цех понимал — тираж
        один-два, и спрос другой. В маршрутную логику признак не входит.
      */}
      {stage.origin === 'experimental' && (
        <span
          className={`${styles.chip} ${styles.chipWaiting}`}
          title="Образец из экспериментального цеха — разработка, а не серия"
        >
          <Icon name="flask" size={13} /> ЭКС / ОБРАЗЕЦ
        </span>
      )}

      {/*
        Причина ожидания — КОМПАКТНЫЙ МАРКЕР, и он есть у обеих групп ожидания
        (правка 23.08, п. 2.4). Раньше в «Ожидают материалы» вместо строки
        причины разворачивался блок разбора на всю ширину: у задания, которое
        всё равно нельзя начать, он занимал основную часть экрана. Теперь
        сначала причина одной строкой, разбор — свёрнут внутри `MaterialWait`.
      */}
      {reason && (
        <div className={styles.queueReason}>
          <span className={styles.cellWithIcon}><Icon name="clock" size={14} />{reason}</span>
        </div>
      )}
      {group === 'awaiting_materials' && <MaterialWait materials={missingMaterials} />}
      {stage.status === 'blocked' && stage.block_reason && (
        <div className={styles.queueReason}>
          <span className={styles.cellWithIcon}><Icon name="ban" size={14} />{stage.block_reason}</span>
        </div>
      )}
      {overdue && stage.overdue_ack_at && stage.overdue_comment && (
        <div className={styles.subText}>
          <span className={styles.cellWithIcon}>
            <Icon name="clock" size={13} />Просрочка: {stage.overdue_comment}
          </span>
        </div>
      )}
      {stage.assignee && (
        <div className={styles.subText}>
          <span className={styles.cellWithIcon}><Icon name="user" size={13} />{stage.assignee}</span>
        </div>
      )}
      {rework && (
        <div className={styles.queueReason}>
          <span className={styles.cellWithIcon}>
            <Icon name="undo" size={14} />
            На переделку: {rework.qty_rework} шт · {(rework.comment || '').replace(' (фото во вложениях)', '')}
          </span>
          {reworkPhoto && (
            <>
              {' · '}
              <a href={reworkPhoto} target="_blank" rel="noreferrer">
                <span className={styles.cellWithIcon}><Icon name="image" size={13} />фото</span>
              </a>
            </>
          )}
        </div>
      )}

      {group === 'in_progress' && qtyDone > 0 && (
        <div className={styles.progressLine} aria-label={`Сделано ${qtyDone} из ${item.qty}`}>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${Math.min(Math.round((qtyDone / item.qty) * 100), 100)}%` }}
            />
          </div>
          <span className={styles.progressCell}>{qtyDone}/{item.qty}</span>
        </div>
      )}

      {/*
        ПРИОРИТЕТ ОЧЕРЕДИ И ПОСТАНОВКА В ПЛАН — И НА ПЛАНШЕТЕ (правка 03.09).
        Обе возможности жили ТОЛЬКО в `QueueRow`, то есть в десктопной
        раскладке. А `useCompactLayout` — это `max-width: 1024px` ИЛИ
        `pointer: coarse`, значит на любом цеховом планшете рисуется эта
        карточка, и ни перетащить (карточки не draggable), ни нажать ↑/↓
        (кнопок не было) было нельзя. Право `stage.priority` оказалось
        недостижимо на ОСНОВНОМ рабочем устройстве, а комментарий в `QueueRow`
        при этом называл эти же кнопки «клавиатурной и ТАЧ-альтернативой»
        перетаскиванию — альтернатива жила в раскладке, которой на тач-экране
        не бывает.
      */}
      {(canReorder || (perms.plan && group === 'ready' && onPlan)) && (
        <div className={styles.queueCardOrder}>
          {canReorder && (
            <>
              <span className={styles.subText}>Приоритет {index + 1}</span>
              {/*
                  «В НАЧАЛО» ОДНИМ ДЕЙСТВИЕМ (§3.1 обхода 04.09). Один тап ↑ —
                  одна позиция и один запрос, и после каждого карточка меняет
                  место: поднять шестое задание на первое стоило пять тапов
                  по уезжающей из-под пальца цели. А просят обычно именно это —
                  «сделай следующим», а не «сдвинь на одну».
                */}
                <button
                  type="button"
                  className={styles.moveBtn}
                  disabled={!canMoveUp}
                  aria-label={`В начало очереди: ${order.title}`}
                  title="В начало очереди"
                  onClick={() => onMoveTop?.()}
                >
                  <Icon name="chevronUp" size={14} />
                  <Icon name="chevronUp" size={14} style={{ marginLeft: -9 }} />
                </button>
              <button
                type="button"
                className={styles.moveBtn}
                disabled={!canMoveUp}
                aria-label={`Поднять приоритет: ${order.title}`}
                title="Поднять приоритет"
                onClick={() => onMove?.(-1)}
              >
                <Icon name="arrowUp" size={16} />
              </button>
              <button
                type="button"
                className={styles.moveBtn}
                disabled={!canMoveDown}
                aria-label={`Опустить приоритет: ${order.title}`}
                title="Опустить приоритет"
                onClick={() => onMove?.(1)}
              >
                <Icon name="arrowDown" size={16} />
              </button>
            </>
          )}
          {perms.plan && group === 'ready' && onPlan && (
            <Button
              variant="secondary"
              aria-label="Поставить в план"
              title="Поставить задание в план на день"
              onClick={() => onPlan(entry)}
            >
              <span className={styles.cellWithIcon}>
                <Icon name="calendar" size={15} />В план
              </span>
            </Button>
          )}
        </div>
      )}

      <StageActionsPanel
        entry={entry}
        perms={perms}
        deptShortById={deptShortById}
        actions={actions}
      />

      {/*
        Переход на страницу задания стоит ПОСЛЕ действий, а не между ними
        (обход 04.09). Раньше эта ссылка разрывала карточку посередине —
        между приоритетом и ТЗ, — и читалась как ещё одно действие цеха,
        хотя она про навигацию. Внизу она замыкает карточку и не спорит
        с главной кнопкой за внимание.
      */}
      <ButtonLink
        to={`/task/${stage.id}`}
        state={{ from: `${location.pathname}${location.search}` }}
        variant="ghost"
      >
        Открыть задание ↗
      </ButtonLink>
    </div>
  );
}
