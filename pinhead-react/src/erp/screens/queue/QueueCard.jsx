import { useState } from 'react';
import { Link } from 'react-router-dom';
import { orderPreviewUrl, lastDefectPhotoUrl } from '../../store/useErpStore';
import { orderLinkClick } from '../../store/useOrderDrawer';
import { daysLeft, formatDateShort, stageOverdue } from '../../utils/time';
import { PROCUREMENT_CAUSE_LABELS } from '../../types';
import styles from '../../erp.module.css';
import { Lightbox } from './Lightbox';
import { PhotoAttach } from './PhotoAttach';
import { TzBlock } from './TzBlock';

export function QueueCard({ entry, canAct, rework, deptShortById, onStart, onDone, onProgress, onBlock, onUnblock, onDefect, onAckOverdue }) {
  const { order, item, stage, reason, group } = entry;
  const [ackText, setAckText] = useState('');
  const overdue = stageOverdue(stage.planned_end, stage.status);
  const needsAck = overdue && !stage.overdue_ack_at;
  const reworkPhoto = rework ? lastDefectPhotoUrl(order) : null;
  const [startMode, setStartMode] = useState(false);
  const [startDate, setStartDate] = useState(
    stage.planned_end || new Date().toISOString().slice(0, 10),
  );
  const [blockMode, setBlockMode] = useState(false);
  const [blockText, setBlockText] = useState('');
  const [blockPhoto, setBlockPhoto] = useState(null);
  const [defectMode, setDefectMode] = useState(false);
  const [defectQty, setDefectQty] = useState('');
  const [defectText, setDefectText] = useState('');
  const [defectPhoto, setDefectPhoto] = useState(null);
  // Правка 3: выбор этапа устранения + правки 1-2: задача закупки
  const [defectTarget, setDefectTarget] = useState('current');
  const [defectNeedsMaterial, setDefectNeedsMaterial] = useState(false);
  const [defectCause, setDefectCause] = useState('other');
  const [defectSupplier, setDefectSupplier] = useState('');
  const [defectPlanned, setDefectPlanned] = useState('');
  const [defectMaterial, setDefectMaterial] = useState('');
  // Правка 4: возврат брака подрядчику
  const [defectContractor, setDefectContractor] = useState('');
  const [defectOperation, setDefectOperation] = useState('');
  const showProcurement = defectNeedsMaterial || defectTarget === 'procurement';
  const showSubcontract = defectTarget === 'subcontractor';
  const otherStages = item.stages.filter((s) => s.id !== stage.id && s.status !== 'skipped');
  const resetDefect = () => {
    setDefectMode(false); setDefectQty(''); setDefectText(''); setDefectPhoto(null);
    setDefectTarget('current'); setDefectNeedsMaterial(false); setDefectCause('other');
    setDefectSupplier(''); setDefectPlanned(''); setDefectMaterial('');
    setDefectContractor(''); setDefectOperation('');
  };
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
          <div className={styles.queueThumbStub} aria-hidden="true">🖼</div>
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

      {reason && <div className={styles.queueReason}>⏳ {reason}</div>}
      {stage.status === 'blocked' && stage.block_reason && (
        <div className={styles.queueReason}>🚫 {stage.block_reason}</div>
      )}
      {overdue && stage.overdue_ack_at && stage.overdue_comment && (
        <div className={styles.subText}>⏰ Просрочка: {stage.overdue_comment}</div>
      )}
      {canAct && needsAck && (
        <div className={styles.queueBlockForm}>
          <span className={styles.overdue}>⏰ Этап просрочен — требуется комментарий</span>
          <input
            className={styles.input}
            placeholder="Причина задержки"
            value={ackText}
            onChange={(e) => setAckText(e.target.value)}
            aria-label="Причина задержки этапа"
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!ackText.trim()}
            onClick={() => { onAckOverdue(stage.id, ackText.trim()); setAckText(''); }}
          >
            Сохранить
          </button>
        </div>
      )}
      {rework && (
        <div className={styles.queueReason}>
          ↩ На переделку: {rework.qty_rework} шт · {(rework.comment || '').replace(' (фото во вложениях)', '')}
          {reworkPhoto && (
            <>
              {' · '}
              <a href={reworkPhoto} target="_blank" rel="noreferrer">📷 фото</a>
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
              <button type="button" className="btn btn-primary" onClick={() => setStartMode(true)}>
                ▶ Взять в работу
              </button>
              {!blockMode && (
                <button type="button" className="btn btn-ghost" onClick={() => setBlockMode(true)}>
                  🚫 Проблема
                </button>
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
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!(Number(doneQty) > 0)}
                onClick={() => {
                  onProgress(entry, Math.max(1, Number(doneQty) || 0));
                  setDoneQty(String(Math.max(remaining - (Number(doneQty) || 0), 1)));
                }}
              >
                ＋ Частично
              </button>
              <button type="button" className="btn btn-primary" onClick={() => onDone(entry)}>
                ✓ Готово
              </button>
              {!blockMode && !defectMode && (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => setDefectMode(true)}>
                    ↩ Брак
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setBlockMode(true)}>
                    🚫 Проблема
                  </button>
                </>
              )}
            </>
          )}
          {group === 'done' && !defectMode && (
            <button type="button" className="btn btn-ghost" onClick={() => setDefectMode(true)}>
              ↩ Брак / переделка
            </button>
          )}
          {group === 'blocked' && (
            <button type="button" className="btn btn-secondary" onClick={() => onUnblock(entry)}>
              Снять блокировку
            </button>
          )}
        </div>
      )}

      {canAct && group === 'ready' && startMode && (
        <div className={styles.queueBlockForm}>
          <label className={styles.subText}>
            План завершения
            <input
              type="date"
              className={styles.input}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="Плановая дата завершения"
              autoFocus
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!startDate}
            onClick={() => { onStart(entry, startDate); setStartMode(false); }}
          >
            ▶ В работу
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setStartMode(false)}>
            Отмена
          </button>
        </div>
      )}

      {canAct && blockMode && (
        <div className={styles.queueBlockForm}>
          <input
            className={styles.input}
            placeholder="Что мешает? (брак кроя, нет ниток…)"
            value={blockText}
            onChange={(e) => setBlockText(e.target.value)}
            autoFocus
          />
          <PhotoAttach file={blockPhoto} onFile={setBlockPhoto} label="Фото (необязательно)" />
          <button
            type="button"
            className="btn btn-danger"
            disabled={!blockText.trim()}
            onClick={() => {
              onBlock(entry, blockText.trim(), blockPhoto);
              setBlockMode(false); setBlockText(''); setBlockPhoto(null);
            }}
          >
            Заблокировать
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => { setBlockMode(false); setBlockPhoto(null); }}>
            Отмена
          </button>
        </div>
      )}

      {canAct && defectMode && (
        <div className={styles.queueBlockForm}>
          <input
            type="number"
            min="1"
            max={item.qty}
            className={`${styles.input} ${styles.qtySmallInput}`}
            placeholder="шт"
            value={defectQty}
            onChange={(e) => setDefectQty(e.target.value)}
            aria-label="Сколько штук в брак"
            autoFocus
          />
          <input
            className={styles.input}
            placeholder="Причина брака (кривая строчка, пятно…)"
            value={defectText}
            onChange={(e) => setDefectText(e.target.value)}
          />
          <select
            className={styles.select}
            value={defectTarget}
            onChange={(e) => setDefectTarget(e.target.value)}
            aria-label="Этап устранения"
          >
            <option value="current">Устранить на текущем этапе</option>
            {otherStages.map((s) => (
              <option key={s.id} value={s.id}>
                Вернуть: {deptShortById?.get(s.department_id) || 'этап'}
              </option>
            ))}
            <option value="procurement">На закупку (материал испорчен)</option>
            <option value="subcontractor">Отправить подрядчику</option>
          </select>
          {showSubcontract && (
            <>
              <input
                className={styles.input}
                placeholder="Операция подряда (что сделать)"
                value={defectOperation}
                onChange={(e) => setDefectOperation(e.target.value)}
                aria-label="Операция подряда"
              />
              <input
                className={styles.input}
                placeholder="Контрагент (необязательно)"
                value={defectContractor}
                onChange={(e) => setDefectContractor(e.target.value)}
                aria-label="Контрагент подряда"
              />
            </>
          )}
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={defectNeedsMaterial}
              disabled={defectTarget === 'procurement'}
              onChange={(e) => setDefectNeedsMaterial(e.target.checked)}
            />
            Нужен новый материал
          </label>
          {showProcurement && (
            <>
              <input
                className={styles.input}
                placeholder="Материал (что закупить)"
                value={defectMaterial}
                onChange={(e) => setDefectMaterial(e.target.value)}
                aria-label="Название материала"
              />
              <select
                className={styles.select}
                value={defectCause}
                onChange={(e) => setDefectCause(e.target.value)}
                aria-label="Причина закупки"
              >
                {Object.entries(PROCUREMENT_CAUSE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <input
                className={styles.input}
                placeholder="Поставщик (необязательно)"
                value={defectSupplier}
                onChange={(e) => setDefectSupplier(e.target.value)}
                aria-label="Поставщик"
              />
              <input
                type="date"
                className={styles.input}
                value={defectPlanned}
                onChange={(e) => setDefectPlanned(e.target.value)}
                aria-label="Плановая дата замены/поставки"
              />
            </>
          )}
          <PhotoAttach file={defectPhoto} onFile={setDefectPhoto} label="Фото (необязательно)" />
          <button
            type="button"
            className="btn btn-danger"
            disabled={!defectText.trim() || !(Number(defectQty) > 0) || Number(defectQty) > item.qty}
            onClick={() => {
              onDefect(entry, {
                qty: Number(defectQty),
                reason: defectText.trim(),
                target: defectTarget,
                needsMaterial: showProcurement,
                cause: defectCause,
                supplier: defectSupplier.trim() || null,
                plannedDate: defectPlanned || null,
                materialName: defectMaterial.trim() || null,
                subcontractOperation: defectOperation.trim() || null,
                contractor: defectContractor.trim() || null,
              }, defectPhoto);
              resetDefect();
            }}
          >
            {showSubcontract ? 'Отправить подрядчику' : showProcurement ? 'В переделку + заявка' : 'В переделку'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={resetDefect}>
            Отмена
          </button>
        </div>
      )}
    </div>
  );
}
