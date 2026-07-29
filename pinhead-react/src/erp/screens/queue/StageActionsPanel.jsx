import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useDictionary } from '../../store/useDictionary';
import { shiftIsoDate, stageOverdue } from '../../utils/time';
import { PROCUREMENT_CAUSE_LABELS } from '../../types';
import { TzViewer } from '../../components/TzViewer';
import { stageTzDocument, tzUpdatedAfterStart } from '../../utils/tz';
import { confirmDefectRollback } from '../../utils/stageDefect';
import styles from '../../erp.module.css';
import { DateField } from '../../components/DateField';
import { PhotoAttach } from './PhotoAttach';
import { TzBlock } from './TzBlock';
import { DefectWizard } from './DefectWizard';
import { Icon } from '../../components/Icon';

/**
 * Быстрый выбор значения справочника: чипы над полем ввода (правка 12).
 * Значение ДОПИСЫВАЕТСЯ к уже набранному, а не затирает его: рабочий мог
 * напечатать половину причины, нажать чип и потерять текст.
 */
function DictionaryChips({ items, onPick, label }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.checkRow} role="group" aria-label={label}>
      {items.map((d) => (
        <button
          key={d.id}
          type="button"
          className={`${styles.chip} ${styles.chipBtn} ${styles.chipNeutral}`}
          onClick={() => onPick(d.name)}
        >
          {d.name}
        </button>
      ))}
    </div>
  );
}

/**
 * Действия цеха над заданием: «Взять в работу», «Записать результат», «Проблема»,
 * «Завершить этап», брак/переделка и комментарий просрочки.
 *
 * Вынесено из QueueCard, чтобы одинаково работало в развёрнутой строке очереди
 * (правка 2) и на странице производственного задания (правка 5). Логику вызовов
 * держит useStageActions — сюда приходит готовый набор обработчиков.
 *
 * `perms` — набор из useStagePermissions: каждая кнопка гейтится своим правом
 * матрицы, а не общим «этот ли мой цех». Снятая в админке галочка «Оформлять брак»
 * должна убирать кнопку «Брак», а не оставаться украшением.
 */
export function StageActionsPanel({ entry, perms, deptShortById, actions, showTz = true }) {
  const { order, item, stage, group } = entry;
  const {
    onStart, onDone, onProgress, onBlock, onUnblock, onDefect, onAckOverdue,
  } = actions;

  const overdue = stageOverdue(stage.planned_end, stage.status);
  const needsAck = overdue && !stage.overdue_ack_at;
  const qtyDone = stage.qty_done ?? 0;
  const remaining = Math.max(item.qty - qtyDone, 0);

  // Норматив участка (правка 12) и справочники быстрых причин (правка 12)
  const normDays = useErpStore(
    useShallow((s) => s.departments.find((d) => d.id === stage.department_id)?.norm_days ?? null),
  );
  const blockReasons = useDictionary('block_reason');
  const problemTypes = useDictionary('problem_type');

  // Актуальная версия PDF-ТЗ этого цеха: назначение → группа → is_current (волна 4)
  const tzDoc = stageTzDocument(order, item.id, stage.department_id);

  const [ackText, setAckText] = useState('');
  const [startMode, setStartMode] = useState(false);
  // План завершения по умолчанию: норматив участка, иначе срок клиента (не «сегодня» —
  // иначе этап с дальним сроком мгновенно становился «просрочен» на следующий день, ERP-04).
  const [startDate, setStartDate] = useState(
    stage.planned_end
      || (normDays > 0 ? shiftIsoDate(null, normDays) : null)
      || order.due_date
      || new Date().toISOString().slice(0, 10),
  );
  /**
   * Пустое поле, а НЕ преднабранный остаток. Раньше здесь стоял
   * `String(remaining || item.qty)`: в поле уже лежал весь остаток, и один тап по
   * «Записать результат» уводил `qty_done` в полный тираж — `reportProgress`
   * при `newDone >= total` закрывает этап и открывает следующий цех. То есть
   * кнопка молча делала то же, что «Завершить этап» делает через `confirmStageDone`.
   * На планшете в перчатках это соседняя кнопка.
   *
   * Диалога здесь намеренно нет: когда цех САМ вписал число, ничего не
   * приписывается — подтверждение по `stageDone` нужно ровно для обратного случая,
   * когда система дописывает несданное за цех.
   */
  const [doneQty, setDoneQty] = useState('');
  const [blockMode, setBlockMode] = useState(false);
  const [blockText, setBlockText] = useState('');
  const [blockPhoto, setBlockPhoto] = useState(null);
  // Поля брака живут в DefectWizard: 12 полей внутри строки очереди превращали
  // экран цеха в простыню — здесь остаётся только признак открытого мастера.
  const [defectMode, setDefectMode] = useState(false);
  /**
   * Ни одно действие не блокировалось на время запроса: `withPending` в сторе
   * защищает от гонки с realtime, но не от повторного тапа. На медленном цеховом
   * Wi-Fi рабочий не получал обратной связи, что тап засчитан, и жал ещё раз.
   */
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    if (busy) return false;
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); }
  };

  /**
   * Отправка брака: подтверждение отката промежуточных этапов и защита от
   * повторного тапа остаются здесь — мастер только собирает данные.
   * Возвращает false, если человек отказался в подтверждении: тогда мастер
   * не закрывается и введённое не теряется.
   */
  const submitDefect = (payload, photo) => run(async () => {
    // Возврат переоткрывает и промежуточные этапы — рабочий видел только
    // «Вернуть: Швейка» и не знал, что откатятся ещё ВТО и Печать
    const ok = await confirmDefectRollback({
      stage,
      targetStage: item.stages.find((s2) => s2.id === payload.target) ?? null,
      allStages: item.stages,
      deptNameById: deptShortById,
      qty: payload.qty,
    });
    if (!ok) return false;
    await onDefect(entry, payload, photo);
    return true;
  });

  return (
    <>
      {perms.any && needsAck && (
        <div className={styles.queueBlockForm}>
          <span className={`${styles.overdue} ${styles.cellWithIcon}`}>
            <Icon name="alert" size={14} />Этап просрочен — требуется комментарий
          </span>
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

      {showTz && tzDoc && (
        <TzViewer
          doc={tzDoc}
          compact
          badge={tzUpdatedAfterStart(tzDoc, stage)
            ? <span className={`${styles.chip} ${styles.chipBlocked}`}>ТЗ обновлено</span>
            : null}
        />
      )}
      {showTz && <TzBlock order={order} item={item} />}

      {perms.any && (
        <div className={styles.queueActions}>
          {group === 'ready' && !startMode && (
            <>
              {perms.take && (
                <button type="button" className="btn btn-primary" onClick={() => setStartMode(true)}>
                  <Icon name="play" size={14} /> Взять в работу
                </button>
              )}
              {perms.block && !blockMode && (
                <button type="button" className="btn btn-ghost" onClick={() => setBlockMode(true)}>
                  <Icon name="ban" size={14} /> Проблема
                </button>
              )}
            </>
          )}
          {group === 'in_progress' && (
            <>
              {perms.progress && (
                <>
                  <input
                    type="number"
                    min="1"
                    max={remaining}
                    className={`${styles.input} ${styles.qtySmallInput}`}
                    value={doneQty}
                    onChange={(e) => setDoneQty(e.target.value)}
                    placeholder={`из ${remaining}`}
                    aria-label={`Сколько сделано, шт (осталось ${remaining} из ${item.qty})`}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy || !(Number(doneQty) > 0)}
                    onClick={() => run(async () => {
                      await onProgress(entry, Math.max(1, Number(doneQty) || 0));
                      setDoneQty('');
                    })}
                  >
                    <Icon name="plus" size={14} /> Записать результат
                  </button>
                </>
              )}
              {perms.complete && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => run(() => onDone(entry))}
                >
                  <Icon name="check" size={14} /> Завершить этап
                </button>
              )}
              {!blockMode && !defectMode && (
                <>
                  {perms.defect && (
                    <button type="button" className="btn btn-ghost" onClick={() => setDefectMode(true)}>
                      <Icon name="undo" size={14} /> Брак
                    </button>
                  )}
                  {perms.block && (
                    <button type="button" className="btn btn-ghost" onClick={() => setBlockMode(true)}>
                      <Icon name="ban" size={14} /> Проблема
                    </button>
                  )}
                </>
              )}
            </>
          )}
          {group === 'done' && perms.defect && !defectMode && (
            <button type="button" className="btn btn-ghost" onClick={() => setDefectMode(true)}>
              <Icon name="undo" size={14} /> Брак / переделка
            </button>
          )}
          {group === 'blocked' && perms.block && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => run(() => onUnblock(entry))}
            >
              Снять блокировку
            </button>
          )}
        </div>
      )}

      {perms.take && group === 'ready' && startMode && (
        <div className={styles.queueBlockForm}>
          <label className={styles.subText}>
            План завершения
            {normDays > 0 && <span> · норматив участка {normDays} дн.</span>}
            <DateField
              presets
              value={startDate}
              onChange={setStartDate}
              aria-label="Плановая дата завершения"
              autoFocus
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !startDate}
            onClick={() => run(async () => {
              await onStart(entry, startDate);
              setStartMode(false);
            })}
          >
            <Icon name="play" size={14} /> В работу
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setStartMode(false)}>
            Отмена
          </button>
        </div>
      )}

      {perms.block && blockMode && (
        <div className={styles.queueBlockForm}>
          <DictionaryChips
            items={blockReasons}
            label="Частые причины блокировки"
            onPick={(v) => setBlockText((t) => (t.trim() ? `${t.trim()}, ${v}` : v))}
          />
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Что мешает *</span>
            <input
              className={styles.input}
              placeholder="брак кроя, нет ниток…"
              value={blockText}
              onChange={(e) => setBlockText(e.target.value)}
              autoFocus
            />
          </label>
          <PhotoAttach file={blockPhoto} onFile={setBlockPhoto} label="Фото (необязательно)" />
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || !blockText.trim()}
            onClick={() => run(async () => {
              await onBlock(entry, blockText.trim(), blockPhoto);
              setBlockMode(false); setBlockText(''); setBlockPhoto(null);
            })}
          >
            Заблокировать
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => { setBlockMode(false); setBlockPhoto(null); }}>
            Отмена
          </button>
        </div>
      )}

      {perms.defect && defectMode && (
        <DefectWizard
          entry={entry}
          deptShortById={deptShortById}
          problemTypes={problemTypes}
          busy={busy}
          onSubmit={submitDefect}
          onClose={() => setDefectMode(false)}
        />
      )}
    </>
  );
}
