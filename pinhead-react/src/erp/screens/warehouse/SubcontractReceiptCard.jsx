import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { SUBCONTRACT_RECEIPT_STATUS_LABELS, STAGE_STATUS_LABELS } from '../../types';
import { useErpStore } from '../../store/useErpStore';
import { nextRouteStage, stageLabel, subcontractShortfall } from '../../utils/outsourcing';
import { deptShortName } from '../../data/departments';
import styles from '../../erp.module.css';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { AttachmentPicker } from '../../components/AttachmentPicker';
import { factoryToday } from '../../../utils/date';

/**
 * Задача склада «Приёмка подряда» (правки заказчика 20.08).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «Склад видит: заказ · позицию · подрядчика · какую
 * операцию выполняли · сколько было передано · сколько вернулось · следующий
 * этап маршрута. Склад фиксирует: принято · брак · недостача · комментарий ·
 * фото».
 *
 * ЧТО БЫЛО. Три чекбокса («комплектация», «количество», «соответствие») и
 * кнопка. Ни одного ЧИСЛА: сколько принято и сколько бракованных — нигде,
 * хотя именно приёмка приращает `qty_done` подрядного этапа и открывает
 * следующий. Брак при этом документ требует уметь вернуть подрядчику,
 * а вернуть можно только то, что посчитано.
 *
 * ПРИНЯТО — ЭТО ЗАПИСЬ ЖУРНАЛА. `erp_subcontract_moves` с видом `accept`:
 * триггер `erp_subcontract_moves_rollup` приращает ей `qty_done` этапа и
 * закрывает его при полном тираже. Фазу операции двигает второй триггер,
 * когда задача склада переходит в `accepted`. Клиент не пишет ни счётчики,
 * ни фазу — у обеих величин ровно один писатель.
 *
 * НЕДОСТАЧА НЕ ХРАНИТСЯ: «передано − вернулось» и «вернулось − принято»
 * выводятся из журнала (`subcontractShortfall`). Вторая пара счётчиков рядом
 * с журналом означала бы двух писателей одного числа.
 */
export function SubcontractReceiptCard({ order, task, onAdvance, attach }) {
  const { subcontracting, addSubcontractMove } = useErpStore(useShallow((s) => ({
    subcontracting: s.subcontracting,
    addSubcontractMove: s.addSubcontractMove,
  })));
  const departments = useErpStore(useShallow((s) => s.departments));

  const accepted = task.status === 'accepted';
  const [qty, setQty] = useState('');
  const [movedOn, setMovedOn] = useState(factoryToday());
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  /** Операция подряда этой задачи: у задачи есть этап, у этапа — спутник */
  const sub = useMemo(
    () => subcontracting.find((s) => s.stage_id && s.stage_id === task.stage_id) ?? null,
    [subcontracting, task.stage_id],
  );

  /** Позиция и этап задачи. Без useMemo: обход двух коротких массивов */
  const item = (order.items ?? []).find(
    (it) => (it.stages ?? []).some((s) => s.id === task.stage_id),
  ) ?? null;
  const stage = (item?.stages ?? []).find((s) => s.id === task.stage_id) ?? null;

  const deptName = (id) => {
    const d = departments.find((x) => x.id === id);
    return d ? deptShortName(d.code, d.name) : '—';
  };

  const sent = Number(sub?.qty_sent ?? 0);
  const returned = Number(sub?.qty_returned ?? 0);
  const already = Number(sub?.qty_accepted ?? 0);
  const shortfall = subcontractShortfall(sub);
  /** Сколько ещё можно принять: вернулось минус уже принятое */
  const acceptable = Math.max(0, returned - already);
  const next = stage && item ? nextRouteStage(item, stage) : null;

  const confirm = async () => {
    setSaving(true);
    /**
     * Порядок важен: сначала журнал (он приращает `qty_done` этапа), потом
     * закрытие задачи. Обратный порядок закрыл бы приёмку, не посчитав
     * принятое, — и следующий этап открылся бы на пустом месте.
     */
    if (sub && Number(qty) > 0) {
      const ok = await addSubcontractMove(sub.id, {
        kind: 'accept', qty: Number(qty), movedOn, comment,
      });
      if (!ok) { setSaving(false); return; }
    }
    await onAdvance(task.id, 'accepted');
    setSaving(false);
  };

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <span className={styles.subText}>Приёмка продукции от подрядчика</span>
          <div><strong>№{order.bitrix_id || '—'} · {order.title}</strong></div>
        </div>
        <span className={`${styles.chip} ${accepted ? styles.chipDone : styles.chipWaiting}`}>
          {SUBCONTRACT_RECEIPT_STATUS_LABELS[task.status] ?? task.status}
        </span>
      </div>

      {/* Что именно принимаем — документ перечисляет это первым */}
      <div className={styles.stackTight}>
        <div className={styles.subText}>
          Изделие: <strong>{item?.product_type || '—'}</strong>
          {item?.variant ? ` · ${item.variant}` : ''}
          {item?.qty ? ` · тираж ${item.qty}` : ''}
        </div>
        <div className={styles.subText}>
          Операция: <strong>{stage ? stageLabel(stage, deptName(stage.department_id)) : '—'}</strong>
          {' · '}подрядчик: <strong>{stage?.contractor || sub?.contractor || '—'}</strong>
        </div>
        <div className={styles.subText}>
          Передано: <strong>{sent}</strong> · вернулось: <strong>{returned}</strong>
          {already > 0 ? ` · уже принято: ${already}` : ''}
          {shortfall.lost > 0 && (
            <span className={`${styles.chip} ${styles.chipBlocked}`}>
              не вернулось: {shortfall.lost}
            </span>
          )}
        </div>
        <div className={styles.subText}>
          {/* «Приёмка не должна быть конечной точкой»: склад видит, что дальше */}
          Следующий этап:{' '}
          <strong>{next ? stageLabel(next, deptName(next.department_id)) : 'упаковка и отгрузка'}</strong>
          {next && ` · ${STAGE_STATUS_LABELS[next.status]}`}
        </div>
      </div>

      {accepted ? (
        <div className={styles.subText}>
          Продукция принята — следующий этап маршрута открыт.
        </div>
      ) : (
        <>
          <div className={styles.addMatRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Принято, шт</span>
              <input
                type="number"
                min="0"
                className={styles.input}
                value={qty}
                onChange={(e) => setQty(e.target.value.replace('-', ''))}
                placeholder={String(acceptable)}
                aria-label="Сколько принято"
                style={{ maxWidth: 110 }}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Дата приёмки</span>
              <DateField
                showFormatHint={false}
                value={movedOn}
                onChange={setMovedOn}
                aria-label="Дата приёмки"
              />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span className={styles.fieldLabel}>Комментарий</span>
              <input
                className={styles.input}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="брак, расхождение, кто сдавал"
                aria-label="Комментарий к приёмке"
              />
            </label>
          </div>

          {/* Брак и недостача не вводятся руками: они СЧИТАЮТСЯ из журнала —
              вернулось минус принято и передано минус вернулось */}
          {Number(qty) > 0 && Number(qty) < returned - already && (
            <div className={styles.subText}>
              В брак уйдёт: {returned - already - Number(qty)} шт —
              их можно вернуть подрядчику на переделку в разделе «Подряд».
            </div>
          )}

          {attach && (
            <AttachmentPicker
              label="+ Фото приёмки"
              hint="что пришло, расхождения, брак"
              files={attach.files}
              kind="attachment"
              ownerKey={`sub-receipt-${task.id}`}
              onAdd={attach.add}
              onRetry={attach.retry}
              onRemove={attach.remove}
            />
          )}

          <Button
            variant="primary"
            disabled={saving || !(Number(qty) > 0)}
            loading={saving}
            onClick={confirm}
          >
            Подтвердить приёмку
          </Button>
          {!(Number(qty) > 0) && (
            <div className={styles.subText} style={{ marginTop: 4 }}>
              Укажите, сколько изделий принято: это число открывает следующий этап.
            </div>
          )}
        </>
      )}
    </section>
  );
}
