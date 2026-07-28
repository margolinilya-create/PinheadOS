import { useState, memo } from 'react';
import { Link } from 'react-router-dom';
import { orderPreviewUrl, lastDefectPhotoUrl } from '../../store/useErpStore';
import { orderLinkClick } from '../../store/useOrderDrawer';
import { daysLeft, formatDateShort, stageOverdue } from '../../utils/time';
import styles from '../../erp.module.css';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Lightbox } from './Lightbox';
import { PhotoAttach } from './PhotoAttach';
import { TzBlock } from './TzBlock';
import { DefectWizard } from './DefectWizard';

function QueueCardBase({ entry, canAct, rework, deptShortById, onStart, onDone, onProgress, onBlock, onUnblock, onDefect, onAckOverdue }) {
  const { order, item, stage, reason, group } = entry;
  const [ackText, setAckText] = useState('');
  const overdue = stageOverdue(stage.planned_end, stage.status);
  const needsAck = overdue && !stage.overdue_ack_at;
  const reworkPhoto = rework ? lastDefectPhotoUrl(order) : null;
  const [startMode, setStartMode] = useState(false);
  // План завершения по умолчанию — срок клиента (не «сегодня»): иначе этап с дальним сроком
  // мгновенно становился «просрочен» на след. день (ERP-04).
  const [startDate, setStartDate] = useState(
    stage.planned_end || order.due_date || new Date().toISOString().slice(0, 10),
  );
  const [blockMode, setBlockMode] = useState(false);
  const [blockText, setBlockText] = useState('');
  const [blockPhoto, setBlockPhoto] = useState(null);
  // Брак/переделка — отдельный мастер в боковой панели (DefectWizard):
  // до 12 полей внутри карточки превращали очередь цеха в простыню.
  const [defectMode, setDefectMode] = useState(false);
  const qtyDone = stage.qty_done ?? 0;
  const remaining = Math.max(item.qty - qtyDone, 0);
  const [doneQty, setDoneQty] = useState(String(remaining || item.qty));
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
          <div className={styles.queueThumbStub}><Icon name="image" size={18} /></div>
        )}
        <div className={styles.queueCardHeadText}>
          <Link
            to={`/orders/${order.id}`}
            onClick={(e) => orderLinkClick(order.id, e)}
            className={`${styles.queueCardTitle} ${styles.queueCardTitleLink}`}
            title={order.title}
          >
            {order.title}
          </Link>
          <div className={styles.subText}>
            №{order.bitrix_id || '—'} · {item.product_type}
            {item.variant ? ` · ${item.variant}` : ''}
          </div>
        </div>
        <div className={styles.queueDue}>
          <div className={styles.queueQty}>{item.qty} шт</div>
          {order.due_date && (
            <div className={d < 0 ? styles.overdue : d <= 3 ? styles.dueSoon : styles.subText}>
              до {formatDateShort(order.due_date)}
              {d !== null && ` · ${d >= 0 ? `${d} дн.` : `−${-d} дн.`}`}
            </div>
          )}
        </div>
      </div>

      {zoom && preview && !imgError && (
        <Lightbox src={preview} alt={`Макет: ${order.title}`} onClose={() => setZoom(false)} />
      )}

      {reason && (
        <div className={styles.queueReason}><Icon name="clock" size={14} /> {reason}</div>
      )}
      {stage.status === 'blocked' && stage.block_reason && (
        <div className={styles.queueReason}><Icon name="ban" size={14} /> {stage.block_reason}</div>
      )}
      {overdue && stage.overdue_ack_at && stage.overdue_comment && (
        <div className={`${styles.subText} ${styles.cellWithIcon}`}>
          <Icon name="clock" size={13} />Просрочка: {stage.overdue_comment}
        </div>
      )}
      {canAct && needsAck && (
        <div className={styles.queueBlockForm}>
          <span className={`${styles.overdue} ${styles.cellWithIcon}`}>
            <Icon name="alert" size={14} />Этап просрочен — требуется комментарий
          </span>
          <Field
            label="Причина задержки"
            value={ackText}
            onChange={(e) => setAckText(e.target.value)}
            fieldClassName={styles.queueFormField}
          />
          <Button
            variant="secondary"
            size="lg"
            disabled={!ackText.trim()}
            onClick={() => { onAckOverdue(stage.id, ackText.trim()); setAckText(''); }}
          >
            Сохранить
          </Button>
        </div>
      )}
      {rework && (
        <div className={styles.queueReason}>
          <Icon name="undo" size={14} /> На переделку: {rework.qty_rework} шт · {(rework.comment || '').replace(' (фото во вложениях)', '')}
          {reworkPhoto && (
            <>
              {' · '}
              <a href={reworkPhoto} target="_blank" rel="noreferrer" className={styles.cellWithIcon}>
                <Icon name="image" size={13} />фото
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

      <TzBlock order={order} item={item} />

      {canAct && (
        <div className={styles.queueActions}>
          {group === 'ready' && !startMode && (
            <>
              <Button variant="primary" size="lg" icon="play" onClick={() => setStartMode(true)}>
                Взять в работу
              </Button>
              {!blockMode && (
                <Button variant="ghost" size="lg" icon="ban" onClick={() => setBlockMode(true)}>
                  Проблема
                </Button>
              )}
            </>
          )}
          {group === 'in_progress' && (
            <>
              <input
                type="number"
                min="1"
                max={item.qty}
                className={`${styles.input} ${styles.qtySmallInput}`}
                value={doneQty}
                onChange={(e) => setDoneQty(e.target.value)}
                aria-label="Сколько сделано, шт"
              />
              <Button
                variant="secondary"
                size="lg"
                icon="plus"
                disabled={!(Number(doneQty) > 0)}
                onClick={() => {
                  onProgress(entry, Math.max(1, Number(doneQty) || 0));
                  setDoneQty(String(Math.max(remaining - (Number(doneQty) || 0), 1)));
                }}
              >
                Частично
              </Button>
              <Button variant="primary" size="lg" icon="check" onClick={() => onDone(entry)}>
                Готово
              </Button>
              {!blockMode && !defectMode && (
                <>
                  <Button variant="ghost" size="lg" icon="undo" onClick={() => setDefectMode(true)}>
                    Брак
                  </Button>
                  <Button variant="ghost" size="lg" icon="ban" onClick={() => setBlockMode(true)}>
                    Проблема
                  </Button>
                </>
              )}
            </>
          )}
          {group === 'done' && !defectMode && (
            <Button variant="ghost" size="lg" icon="undo" onClick={() => setDefectMode(true)}>
              Брак / переделка
            </Button>
          )}
          {group === 'blocked' && (
            <Button variant="secondary" size="lg" onClick={() => onUnblock(entry)}>
              Снять блокировку
            </Button>
          )}
        </div>
      )}

      {canAct && group === 'ready' && startMode && (
        <div className={styles.queueBlockForm}>
          <Field
            label="План завершения"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            fieldClassName={styles.queueFormField}
            autoFocus
          />
          <Button
            variant="primary"
            size="lg"
            icon="play"
            disabled={!startDate}
            onClick={() => { onStart(entry, startDate); setStartMode(false); }}
          >
            В работу
          </Button>
          <Button variant="ghost" size="lg" onClick={() => setStartMode(false)}>Отмена</Button>
        </div>
      )}

      {canAct && blockMode && (
        <div className={styles.queueBlockForm}>
          <Field
            label="Что мешает?"
            placeholder="Брак кроя, нет ниток…"
            value={blockText}
            onChange={(e) => setBlockText(e.target.value)}
            fieldClassName={styles.queueFormField}
            autoFocus
          />
          <PhotoAttach file={blockPhoto} onFile={setBlockPhoto} label="Фото (необязательно)" />
          <Button
            variant="danger"
            size="lg"
            disabled={!blockText.trim()}
            onClick={() => {
              onBlock(entry, blockText.trim(), blockPhoto);
              setBlockMode(false); setBlockText(''); setBlockPhoto(null);
            }}
          >
            Заблокировать
          </Button>
          <Button variant="ghost" size="lg" onClick={() => { setBlockMode(false); setBlockPhoto(null); }}>
            Отмена
          </Button>
        </div>
      )}

      {canAct && defectMode && (
        <DefectWizard
          entry={entry}
          deptShortById={deptShortById}
          onSubmit={(payload, photo) => onDefect(entry, payload, photo)}
          onClose={() => setDefectMode(false)}
        />
      )}
    </div>
  );
}

/** Элемент длинного списка: memo отсекает перерисовку при изменениях соседей
    (канбан во время DnD, очередь цеха, таблица заказов). */
export const QueueCard = memo(QueueCardBase);
