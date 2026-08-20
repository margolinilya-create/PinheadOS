import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { SUBCONTRACT_MOVE_LABELS } from '../../types';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { AttachmentList } from '../../components/AttachmentList';
import { confirm } from '../../../store/useConfirmStore';
import { formatDateShort } from '../../utils/time';
import { subcontractShortfall } from '../../utils/outsourcing';
import styles from '../../erp.module.css';

/**
 * Журнал перемещений подряда: передали / вернулось / приняли.
 *
 * ЭТО НЕ ЖУРНАЛ «ДЛЯ ИСТОРИИ», А ЕДИНСТВЕННЫЙ МЕХАНИЗМ ДВИЖЕНИЯ.
 * `addSubcontractMove` существовал с волны 3.5 и не имел НИ ОДНОЙ точки вызова:
 * количества `qty_sent`/`qty_returned`/`qty_accepted` не двигал никто, а
 * приёмка — единственное, что приращает `qty_done` подрядного этапа
 * (`erp_subcontract_moves_rollup`) и закрывает его при полном тираже.
 * Без этой формы «вернулось от подрядчика» не открывало следующий этап
 * маршрута, потому что предыдущий никогда не закрывался.
 *
 * Количества — ПРИРАЩЕНИЯ, как и все счётчики производства: подрядчик отдаёт
 * партию частями, и абсолют с клиента здесь означал бы потерянное обновление
 * ровно так же, как у этапов цеха.
 */

export function MoveJournal({ op, canManage, order = null, itemId = null }) {
  const { updateSubcontractOp, uploadStageFile, deleteStageFile } = useErpStore(
    useShallow((s) => ({
      updateSubcontractOp: s.updateSubcontractOp,
      uploadStageFile: s.uploadStageFile,
      deleteStageFile: s.deleteStageFile,
    })),
  );
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  /** ТЗ и файлы ЭТОГО подрядного этапа: чужая схема узла хуже никакой */
  const files = (order?.attachments ?? []).filter(
    (a) => a.kind === 'subcontract' && a.stage_id === op.stage_id,
  );

  const pickFiles = async (e) => {
    const chosen = [...(e.target.files ?? [])];
    e.target.value = '';
    if (chosen.length === 0 || !op.stage_id || !order) return;
    setUploading(true);
    for (const file of chosen) {
      await uploadStageFile({
        stageId: op.stage_id, orderId: order.id, itemId, file,
      });
    }
    setUploading(false);
  };

  const removeFile = async (att) => {
    const ok = await confirm({
      title: 'Снять файл?',
      message: `«${att.file_name || 'файл'}» будет удалён вместе с самим файлом.`,
      confirmLabel: 'Снять',
      variant: 'danger',
    });
    if (ok) await deleteStageFile(order.id, att.id);
  };

  const moves = [...(op.moves ?? [])].sort((a, b) => b.moved_on.localeCompare(a.moved_on));
  const shortfall = subcontractShortfall(op);

  /** Правка поля по blur: пишем только при реальном изменении, иначе каждый
   *  уход фокуса отправлял бы запрос с тем же значением */
  const saveField = (field, value) => {
    if (value === (op[field] ?? null)) return;
    updateSubcontractOp(op.id, { [field]: value });
  };

  return (
    <div className={styles.stackTight}>
      <div className={styles.checkRow}>
        <span className={styles.subText}>
          передано {op.qty_sent ?? 0} · вернулось {op.qty_returned ?? 0}
          {' · '}принято {op.qty_accepted ?? 0}
          {op.qty ? ` из ${op.qty}` : ''}
        </span>
        {/* Документ (п. 12) просит «количество брака» и «количество потерянных
            изделий». Обе величины ВЫВОДЯТСЯ из журнала — держать под них
            колонки значило бы завести второго писателя тех же чисел */}
        {shortfall.lost > 0 && (
          <span className={`${styles.chip} ${styles.chipBlocked}`}>
            не вернулось: {shortfall.lost}
          </span>
        )}
        {shortfall.defect > 0 && (
          <span className={`${styles.chip} ${styles.chipBlocked}`}>
            брак: {shortfall.defect}
          </span>
        )}
      </div>

      {/*
        Поля, которые менеджер задал В МАРШРУТЕ (правки 20.08): ответственный
        Pinhead, план передачи и комментарий. Они заполняются один раз при
        сборке маршрута — и до сих пор нигде не показывались: карточка
        подрядной операции перечисляет их в документе прямо, а раздел «Подряд»
        и есть то место, где по ним работают. Заполнять и не показывать —
        та же ошибка, что показывать и не сохранять.
      */}
      <div className={styles.checkRow}>
        <span className={styles.subText}>
          Ответственный Pinhead: <strong>{op.responsible || '—'}</strong>
        </span>
        <span className={styles.subText}>
          Передача план: <strong>{op.send_plan_date ? formatDateShort(op.send_plan_date) : '—'}</strong>
          {op.sent_date ? ` · факт ${formatDateShort(op.sent_date)}` : ''}
        </span>
        <span className={styles.subText}>
          Возврат план: <strong>{op.planned_date ? formatDateShort(op.planned_date) : '—'}</strong>
          {op.returned_date ? ` · факт ${formatDateShort(op.returned_date)}` : ''}
        </span>
      </div>
      {op.comment && (
        <div className={styles.subText}>Комментарий: {op.comment}</div>
      )}

      {/*
        ТЗ и файлы подрядного этапа — девятое поле подрядного шага из документа.
        Они уезжают наружу вместе с партией, поэтому привязаны к ЭТАПУ:
        подрядных этапов в позиции бывает несколько (сублимация полотна
        и варка готового), и общая куча отдала бы подрядчику чужую схему.
      */}
      {op.stage_id && order && (
        <div className={styles.attachBlock}>
          <div className={styles.checkRow}>
            <span className={styles.fieldLabel}>ТЗ и файлы для подрядчика</span>
            {canManage && (
              <Button
                variant="ghost"
                size="sm"
                icon="paperclip"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? 'Загрузка…' : 'Приложить'}
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            onChange={pickFiles}
            aria-label="ТЗ и файлы для подрядчика"
            style={{ display: 'none' }}
          />
          {files.length === 0 ? (
            <span className={styles.subText}>файлов нет</span>
          ) : (
            <>
              <AttachmentList files={files} />
              {canManage && (
                <div className={styles.checkRow}>
                  {files.map((f) => (
                    <Button key={f.id} variant="ghost" size="sm" onClick={() => removeFile(f)}>
                      ✕ {f.file_name || 'файл'}
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Материалы Pinhead: «что передано, количество, дату передачи» —
          прямое требование п. 13. При материалах подрядчика передавать нечего,
          и блок не показывается вовсе */}
      {op.material_source !== 'contractor' && (
        <div className={styles.addMatRow}>
          <span className={styles.subText}>Передано подрядчику:</span>
          <input
            className={styles.input}
            placeholder="что передано (ткань, фурнитура, крой)"
            defaultValue={op.materials_note || ''}
            disabled={!canManage}
            onBlur={(e) => saveField('materials_note', e.target.value.trim() || null)}
            aria-label="Что передано подрядчику"
          />
          <input
            className={styles.input}
            placeholder="сколько"
            defaultValue={op.materials_qty || ''}
            disabled={!canManage}
            onBlur={(e) => saveField('materials_qty', e.target.value.trim() || null)}
            aria-label="Количество переданных материалов"
            style={{ maxWidth: 120 }}
          />
          <DateField
            showFormatHint={false}
            disabled={!canManage}
            value={op.materials_sent_on || ''}
            onChange={(v) => saveField('materials_sent_on', v || null)}
            aria-label="Дата передачи материалов"
          />
        </div>
      )}

      {/* Стоимость подряда (п. 12). Статус оплаты живёт в строке таблицы —
          он в производственных переходах не участвует и не должен читаться
          как шаг потока */}
      <div className={styles.addMatRow}>
        <span className={styles.subText}>Стоимость работ:</span>
        <input
          type="number"
          min="0"
          className={styles.input}
          placeholder="₽"
          defaultValue={op.cost ?? ''}
          disabled={!canManage}
          onBlur={(e) => saveField('cost', e.target.value === '' ? null : Number(e.target.value))}
          aria-label="Стоимость подрядных работ"
          style={{ maxWidth: 140 }}
        />
      </div>

      {/*
        Свободной формы «вид перемещения + количество» здесь БОЛЬШЕ НЕТ
        (правки 20.08). Ею можно было записать `accept` — то есть оформить
        приёмку мимо склада: `qty_done` этапа приращался, следующий этап
        открывался, а брак и недостача не фиксировались нигде.

        Передачу и возврат оформляют действия (`StageActions`), приёмку —
        склад задачей «Приёмка подряда». Журнал остаётся тем, чем он и был
        по смыслу: следом, а не пультом.
      */}

      {moves.length === 0
        ? <p className={styles.subText}>Перемещений пока нет.</p>
        : (
          <ul className={styles.stackTight}>
            {moves.map((m) => (
              <li key={m.id} className={styles.subText}>
                {formatDateShort(m.moved_on)} · {SUBCONTRACT_MOVE_LABELS[m.kind]} · {m.qty} шт
                {m.comment ? ` · ${m.comment}` : ''}
                {m.author ? ` · ${m.author}` : ''}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
