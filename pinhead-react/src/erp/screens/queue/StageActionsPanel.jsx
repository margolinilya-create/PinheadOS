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
  const [doneQty, setDoneQty] = useState(String(remaining || item.qty));
  const [blockMode, setBlockMode] = useState(false);
  const [blockText, setBlockText] = useState('');
  const [blockPhoto, setBlockPhoto] = useState(null);
  const [defectMode, setDefectMode] = useState(false);
  const [defectQty, setDefectQty] = useState('');
  const [defectText, setDefectText] = useState('');
  const [defectPhoto, setDefectPhoto] = useState(null);
  const [defectTarget, setDefectTarget] = useState('current');
  const [defectNeedsMaterial, setDefectNeedsMaterial] = useState(false);
  const [defectCause, setDefectCause] = useState('other');
  const [defectSupplier, setDefectSupplier] = useState('');
  const [defectPlanned, setDefectPlanned] = useState('');
  const [defectMaterial, setDefectMaterial] = useState('');
  const [defectContractor, setDefectContractor] = useState('');
  const [defectOperation, setDefectOperation] = useState('');
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

  const showProcurement = defectNeedsMaterial || defectTarget === 'procurement';
  const showSubcontract = defectTarget === 'subcontractor';
  const otherStages = item.stages.filter((s) => s.id !== stage.id && s.status !== 'skipped');

  const resetDefect = () => {
    setDefectMode(false); setDefectQty(''); setDefectText(''); setDefectPhoto(null);
    setDefectTarget('current'); setDefectNeedsMaterial(false); setDefectCause('other');
    setDefectSupplier(''); setDefectPlanned(''); setDefectMaterial('');
    setDefectContractor(''); setDefectOperation('');
  };

  return (
    <>
      {perms.any && needsAck && (
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
                  ▶ Взять в работу
                </button>
              )}
              {perms.block && !blockMode && (
                <button type="button" className="btn btn-ghost" onClick={() => setBlockMode(true)}>
                  🚫 Проблема
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
                    max={item.qty}
                    className={`${styles.input} ${styles.qtySmallInput}`}
                    value={doneQty}
                    onChange={(e) => setDoneQty(e.target.value)}
                    aria-label="Сколько сделано, шт"
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy || !(Number(doneQty) > 0)}
                    onClick={() => run(async () => {
                      await onProgress(entry, Math.max(1, Number(doneQty) || 0));
                      setDoneQty(String(Math.max(remaining - (Number(doneQty) || 0), 1)));
                    })}
                  >
                    ＋ Записать результат
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
                  ✓ Завершить этап
                </button>
              )}
              {!blockMode && !defectMode && (
                <>
                  {perms.defect && (
                    <button type="button" className="btn btn-ghost" onClick={() => setDefectMode(true)}>
                      ↩ Брак
                    </button>
                  )}
                  {perms.block && (
                    <button type="button" className="btn btn-ghost" onClick={() => setBlockMode(true)}>
                      🚫 Проблема
                    </button>
                  )}
                </>
              )}
            </>
          )}
          {group === 'done' && perms.defect && !defectMode && (
            <button type="button" className="btn btn-ghost" onClick={() => setDefectMode(true)}>
              ↩ Брак / переделка
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
            ▶ В работу
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
          <DictionaryChips
            items={problemTypes}
            label="Типы проблем"
            onPick={(v) => setDefectText((t) => (t.trim() ? `${t.trim()}, ${v}` : v))}
          />
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Причина брака *</span>
            <input
              className={styles.input}
              placeholder="кривая строчка, пятно…"
              value={defectText}
              onChange={(e) => setDefectText(e.target.value)}
            />
          </label>
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
              // При «На закупку» поля материала уже показаны — чекбокс обязан
              // это отражать, а не оставаться снятым и серым
              checked={showProcurement}
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
            disabled={busy || !defectText.trim() || !(Number(defectQty) > 0)
              || Number(defectQty) > item.qty}
            onClick={() => run(async () => {
              // Возврат переоткрывает и промежуточные этапы — рабочий видел только
              // «Вернуть: Швейка» и не знал, что откатятся ещё ВТО и Печать
              const ok = await confirmDefectRollback({
                stage,
                targetStage: item.stages.find((s2) => s2.id === defectTarget) ?? null,
                allStages: item.stages,
                deptNameById: deptShortById,
                qty: Number(defectQty),
              });
              if (!ok) return;
              await onDefect(entry, {
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
            })}
          >
            {showSubcontract ? 'Отправить подрядчику' : showProcurement ? 'В переделку + заявка' : 'В переделку'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={resetDefect}>
            Отмена
          </button>
        </div>
      )}
    </>
  );
}
