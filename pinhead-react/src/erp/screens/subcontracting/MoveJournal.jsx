import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { SUBCONTRACT_MOVE_LABELS } from '../../types';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { AttachmentList } from '../../components/AttachmentList';
import { confirm } from '../../../store/useConfirmStore';
import { formatDateShort } from '../../utils/time';
import styles from '../../erp.module.css';

/**
 * Служебные блоки подрядного этапа: файлы · материалы · стоимость · даты ·
 * история перемещений.
 *
 * РАНЬШЕ ЭТО БЫЛ ОДИН БЛОК «ЖУРНАЛ», И В НЁМ ЖЕ ЖИЛО УПРАВЛЕНИЕ. Документ
 * (п. 3.3) на это жалуется прямо: «по названию этот блок воспринимается как
 * история, поэтому неочевидно, что внутри находится фактическое управление
 * этапом». Плюс всё разом было видно одновременно — маршрут, статусы, файлы,
 * материалы, стоимость, журнал, — и главное действие терялось.
 *
 * ТЕПЕРЬ КАЖДЫЙ БЛОК ОТДЕЛЬНЫЙ И СВЁРНУТ, а собирает их `StageDetails`.
 * Здесь только содержимое: разрезать по файлам смысла нет, блоки читают одну
 * и ту же карточку подрядчика и правятся одним и тем же `updateSubcontractOp`.
 *
 * Количества по-прежнему ПРИРАЩЕНИЯ: подрядчик отдаёт партию частями,
 * и абсолют с клиента здесь означал бы потерянное обновление ровно так же,
 * как у этапов цеха.
 */

/** Правка поля по blur: пишем только при реальном изменении */
function useFieldSaver(op) {
  const updateSubcontractOp = useErpStore(useShallow((s) => s.updateSubcontractOp));
  return (field, value) => {
    if (value === (op[field] ?? null)) return;
    updateSubcontractOp(op.id, { [field]: value });
  };
}

/**
 * ТЗ и файлы подрядного ЭТАПА — девятое поле подрядного шага из документа.
 * Они уезжают наружу вместе с партией, поэтому привязаны к ЭТАПУ: подрядных
 * этапов в позиции бывает несколько (сублимация полотна и варка готового),
 * и общая куча отдала бы подрядчику чужую схему.
 */
export function StageFilesBlock({ op, order, itemId, canManage }) {
  const { uploadStageFile, deleteStageFile } = useErpStore(
    useShallow((s) => ({
      uploadStageFile: s.uploadStageFile,
      deleteStageFile: s.deleteStageFile,
    })),
  );
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

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

  if (!op.stage_id || !order) return null;

  return (
    <div className={styles.attachBlock}>
      {canManage && (
        <div className={styles.checkRow}>
          <Button
            variant="ghost"
            size="sm"
            icon="paperclip"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? 'Загрузка…' : 'Приложить'}
          </Button>
        </div>
      )}
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
  );
}

/**
 * Материалы Pinhead: «что передано, количество, дату передачи».
 *
 * При материалах ПОДРЯДЧИКА блок не показывается вовсе — передавать нечего,
 * и это же снимает всякий соблазн «отдать 200 фиктивно» ради запуска этапа
 * (правка 22.08, п. 3.8).
 */
export function MaterialsBlock({ op, canManage }) {
  const saveField = useFieldSaver(op);
  if (op.material_source === 'contractor') {
    return (
      <p className={styles.subText}>
        Работа идёт на материалах подрядчика — передавать нечего.
      </p>
    );
  }
  return (
    <div className={styles.addMatRow}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Что передаём</span>
        <input
          className={styles.input}
          placeholder="крой, запечатанное полотно, фурнитура"
          defaultValue={op.materials_note || ''}
          disabled={!canManage}
          onBlur={(e) => saveField('materials_note', e.target.value.trim() || null)}
          aria-label="Что передано подрядчику"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Сколько</span>
        <input
          className={styles.input}
          placeholder="200 м / 200 компл."
          defaultValue={op.materials_qty || ''}
          disabled={!canManage}
          onBlur={(e) => saveField('materials_qty', e.target.value.trim() || null)}
          aria-label="Количество переданных материалов"
          style={{ maxWidth: 140 }}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Дата передачи</span>
        <DateField
          showFormatHint={false}
          disabled={!canManage}
          value={op.materials_sent_on || ''}
          onChange={(v) => saveField('materials_sent_on', v || null)}
          aria-label="Дата передачи материалов"
        />
      </label>
    </div>
  );
}

/**
 * Стоимость подряда. Статус оплаты живёт в строке таблицы — он
 * в производственных переходах не участвует и не должен читаться как шаг
 * потока.
 */
export function CostBlock({ op, canManage }) {
  const saveField = useFieldSaver(op);
  return (
    <div className={styles.addMatRow}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Стоимость работ, ₽</span>
        <input
          type="number"
          min="0"
          className={styles.input}
          defaultValue={op.cost ?? ''}
          disabled={!canManage}
          onBlur={(e) => saveField('cost', e.target.value === '' ? null : Number(e.target.value))}
          aria-label="Стоимость подрядных работ"
          style={{ maxWidth: 160 }}
        />
      </label>
    </div>
  );
}

/**
 * Подробности передачи и возврата: ответственный Pinhead, план и факт дат,
 * комментарий из маршрута.
 *
 * Эти поля менеджер задаёт В МАРШРУТЕ и до правки 20.08 они не показывались
 * нигде. Заполнять и не показывать — та же ошибка, что показывать
 * и не сохранять.
 */
export function HandoffBlock({ op }) {
  return (
    <div className={styles.stackTight}>
      <div className={styles.subText}>
        Ответственный Pinhead: <strong>{op.responsible || '—'}</strong>
      </div>
      <div className={styles.subText}>
        Передача план: <strong>{op.send_plan_date ? formatDateShort(op.send_plan_date) : '—'}</strong>
        {op.sent_date ? ` · факт ${formatDateShort(op.sent_date)}` : ''}
      </div>
      <div className={styles.subText}>
        Возврат план: <strong>{op.planned_date ? formatDateShort(op.planned_date) : '—'}</strong>
        {op.returned_date ? ` · факт ${formatDateShort(op.returned_date)}` : ''}
      </div>
      {op.comment && <div className={styles.subText}>Комментарий: {op.comment}</div>}
    </div>
  );
}

/**
 * Журнал перемещений: передали / вернулось / приняли / брак.
 *
 * ТЕПЕРЬ ЭТО ДЕЙСТВИТЕЛЬНО ИСТОРИЯ. Управление этапом уехало в шапку карточки
 * (`StageActions`), а приёмку оформляет склад. Свободной формы «вид
 * перемещения + количество» здесь нет с 20.08: ею можно было записать
 * `accept`, то есть оформить приёмку мимо склада — `qty_done` этапа
 * приращался, следующий этап открывался, а брак и недостача не фиксировались
 * нигде.
 */
export function MoveJournal({ op }) {
  const moves = [...(op.moves ?? [])].sort((a, b) => b.moved_on.localeCompare(a.moved_on));

  if (moves.length === 0) return <p className={styles.subText}>Перемещений пока нет.</p>;

  return (
    <ul className={styles.stackTight}>
      {moves.map((m) => (
        <li key={m.id} className={styles.subText}>
          {formatDateShort(m.moved_on)} · {SUBCONTRACT_MOVE_LABELS[m.kind] ?? m.kind} · {m.qty} шт
          {m.comment ? ` · ${m.comment}` : ''}
          {m.author ? ` · ${m.author}` : ''}
        </li>
      ))}
    </ul>
  );
}
