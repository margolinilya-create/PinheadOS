import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { SUBCONTRACT_RECEIPT_STATUS_LABELS, STAGE_STATUS_LABELS } from '../../types';
import { useErpStore } from '../../store/useErpStore';
import { nextRouteStage, stageLabel, subcontractShortfall } from '../../utils/outsourcing';
import { deptShortName } from '../../data/departments';
import styles from '../../styles';
import { useErpAccess } from '../../store/useErpAccess';
import { canOpenScreen } from '../../utils/screenAccess';
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
 * НЕДОСТАЧА НЕ ХРАНИТСЯ: «передано − вернулось» выводится из журнала
 * (`subcontractShortfall`). Вторая пара счётчиков рядом с журналом означала бы
 * двух писателей одного числа.
 *
 * А ВОТ БРАК ТЕПЕРЬ ВВОДИТСЯ ЯВНО (правка 22.08, п. 3.9). Раньше он
 * ВЫЧИТАЛСЯ — «всё, что вернулось и не принято». Пока приёмка не проведена,
 * это ноль принятых и весь тираж «браком»: экран объявлял браком партию,
 * которую ещё никто не смотрел. Теперь склад распределяет вернувшееся сам,
 * и обе величины уезжают ОДНОЙ транзакцией (`erp_subcontract_receive`):
 * между двумя отдельными записями была бы минута, в которую принято уже
 * посчитано, а брак ещё нет.
 */
export function SubcontractReceiptCard({ order, task, onAdvance, attach }) {
  const { can } = useErpAccess();
  const canOpenSubcontracting = canOpenScreen(can, '/subcontracting');
  const { subcontracting, receiveSubcontract } = useErpStore(useShallow((s) => ({
    subcontracting: s.subcontracting,
    receiveSubcontract: s.receiveSubcontract,
  })));
  const departments = useErpStore(useShallow((s) => s.departments));

  const accepted = task.status === 'accepted';
  const [qty, setQty] = useState('');
  const [defectQty, setDefectQty] = useState('');
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
  /** Сколько ещё нужно разобрать: вернулось минус принятое и брак */
  const acceptable = shortfall.awaitingAccept;
  const next = stage && item ? nextRouteStage(item, stage) : null;
  const left = acceptable - Number(qty || 0) - Number(defectQty || 0);

  const confirm = async () => {
    setSaving(true);
    /**
     * Порядок важен: сначала журнал (он приращает `qty_done` этапа), потом
     * закрытие задачи. Обратный порядок закрыл бы приёмку, не посчитав
     * принятое, — и следующий этап открылся бы на пустом месте.
     *
     * Принято и брак идут ОДНИМ вызовом: две отдельные записи оставили бы
     * окно, в котором `qty_done` этапа уже вырос, а брак ещё не отмечен.
     */
    if (sub && (Number(qty) > 0 || Number(defectQty) > 0)) {
      const ok = await receiveSubcontract(sub.id, {
        accepted: Number(qty) || 0,
        defect: Number(defectQty) || 0,
        movedOn,
        comment,
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
          {/* «Количество в работе» и «физически передано» — разные величины:
              на материалах подрядчика мы не передаём ничего (п. 3.8) */}
          В работе: <strong>{sub?.qty_in_work ?? item?.qty ?? '—'}</strong>
          {sent > 0 ? ` · физически передано: ${sent}` : ''}
          {' · '}вернулось: <strong>{returned}</strong>
          {already > 0 ? ` · уже принято: ${already}` : ''}
          {shortfall.defect > 0 ? ` · брак: ${shortfall.defect}` : ''}
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
            {/* Брак вводится ЯВНО и здесь же: только приёмка знает, что
                из вернувшегося годно, а что нет (п. 3.9) */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Брак, шт</span>
              <input
                type="number"
                min="0"
                className={styles.input}
                value={defectQty}
                onChange={(e) => setDefectQty(e.target.value.replace('-', ''))}
                placeholder="0"
                aria-label="Сколько брака"
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

          {/*
            Остаток НЕ объявляется браком сам — это и было главной претензией
            документа. Он просто остаётся неразобранным: приёмку можно провести
            частями, а брак отметить, когда его посчитают.
          */}
          {left > 0 && (
            <div className={styles.subText}>
              Останется неразобранным: {left} шт — их можно принять или
              отметить браком позже, приёмка закроется по факту.
            </div>
          )}
          {left < 0 && (
            <div className={styles.subText} data-invalid="true">
              Принято и брак вместе больше, чем вернулось ({acceptable} шт).
            </div>
          )}
          {/* Совет ведёт туда, куда пустят: раздел «Подряд» открыт под
              `order.manage`, которого у кладовщика нет (обход 04.09) */}
          {shortfall.defect > 0 && (
            <div className={styles.subText}>
              Отмечено браком: {shortfall.defect} шт — их
              {canOpenSubcontracting
                ? ' можно вернуть подрядчику на переделку в разделе «Подряд».'
                : ' возвращает подрядчику на переделку менеджер заказа, в разделе «Подряд».'}
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
            disabled={saving || !(Number(qty) > 0 || Number(defectQty) > 0) || left < 0}
            loading={saving}
            onClick={confirm}
          >
            Подтвердить приёмку
          </Button>
          {!(Number(qty) > 0 || Number(defectQty) > 0) && (
            <div className={styles.subText} style={{ marginTop: 4 }}>
              Укажите, сколько изделий принято: это число открывает следующий этап.
            </div>
          )}
        </>
      )}
    </section>
  );
}
