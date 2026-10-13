import { useRef, useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { AttachmentList } from '../../components/AttachmentList';
import styles from '../../styles';

/**
 * РЕЗУЛЬТАТ ЭТАПА — ФАЙЛ (правка заказчика 12.09, вторая порция, баг 02).
 *
 * Документ: «дополнительная задача на разработку программы вышивки создаётся
 * как обычная производственная задача вышивки: в ней требуется указывать
 * „Вышито, шт" и „Брак, шт". Для разработки программы это неверный тип
 * результата… сделать отдельный результат: загрузка файла программы вышивки».
 *
 * Схема отчёта живёт у УЧАСТКА, и у цеха вышивки это числа: оба его этапа —
 * разработка программы и сама вышивка — получали одну форму. Здесь форма
 * другая, и включает её признак ЭТАПА (`result_kind`), а не имя операции:
 * имя — свободный текст, и опознание по строке ломалось бы от переименования.
 *
 * ФАЙЛ УХОДИТ В БАКЕТ ПРИ ВЫБОРЕ, а не по кнопке «Завершить»: правило проекта.
 * Иначе интерфейс показывает приложенным то, чего в Storage нет.
 */
export function StageResultFile({ order, item, stage, canUpload }) {
  const uploadStageFile = useErpStore((s) => s.uploadStageFile);
  const deleteStageFile = useErpStore((s) => s.deleteStageFile);
  const pick = useRef(null);
  const [busy, setBusy] = useState(false);

  const files = (order.attachments ?? []).filter(
    (a) => a.kind === 'stage_result' && a.stage_id === stage.id,
  );

  const add = async (file) => {
    if (!file) return;
    setBusy(true);
    await uploadStageFile({
      stageId: stage.id, orderId: order.id, itemId: item.id, file, kind: 'stage_result',
    });
    setBusy(false);
  };

  return (
    <div className={styles.queueBlockForm}>
      <span className={styles.queueReason}>
        <span className={styles.cellWithIcon}>
          <Icon name="file" size={14} />
          Результат этапа — файл программы вышивки. Количество здесь не вносится:
          вышивают на отдельном этапе после кроя.
        </span>
      </span>

      {files.length > 0 ? (
        <AttachmentList files={files} label="Программа вышивки" />
      ) : (
        <p className={styles.subText}>Файл ещё не приложен.</p>
      )}

      {canUpload && (
        <div className={styles.queueActions}>
          <input
            ref={pick}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              add(f);
            }}
          />
          <Button
            variant={files.length > 0 ? 'secondary' : 'primary'}
            loading={busy}
            disabled={busy}
            onClick={() => pick.current?.click()}
          >
            <Icon name="plus" size={14} />
            {files.length > 0 ? 'Добавить версию' : 'Приложить программу'}
          </Button>
          {files.length > 0 && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => deleteStageFile(order.id, files[files.length - 1].id)}
            >
              Убрать последний
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
