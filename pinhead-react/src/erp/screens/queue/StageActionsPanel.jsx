import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useDictionary } from '../../store/useDictionary';
import { stageOverdue } from '../../utils/time';
import { PROCUREMENT_CAUSE_LABELS } from '../../types';
import { TzViewer } from '../../components/TzViewer';
import { stageTzDocument, tzUpdatedAfterStart } from '../../utils/tz';
import styles from '../../erp.module.css';
import { PhotoAttach } from './PhotoAttach';
import { TzBlock } from './TzBlock';

/** Дата через N дней от сегодня в формате YYYY-MM-DD */
function inDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Быстрый выбор значения справочника: чипы над полем ввода (правка 12) */
function DictionaryChips({ items, onPick, label }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.checkRow} role="group" aria-label={label}>
      {items.map((d) => (
        <button
          key={d.id}
          type="button"
          className={`${styles.chip} ${styles.chipNeutral}`}
          style={{ cursor: 'pointer', font: 'inherit' }}
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
 */
export function StageActionsPanel({ entry, canAct, deptShortById, actions, showTz = true }) {
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
      || (normDays > 0 ? inDays(normDays) : null)
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
                ＋ Записать результат
              </button>
              <button type="button" className="btn btn-primary" onClick={() => onDone(entry)}>
                ✓ Завершить этап
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
            {normDays > 0 && <span> · норматив участка {normDays} дн.</span>}
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
          <DictionaryChips
            items={blockReasons}
            label="Частые причины блокировки"
            onPick={setBlockText}
          />
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
          <DictionaryChips
            items={problemTypes}
            label="Типы проблем"
            onPick={setDefectText}
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
    </>
  );
}
