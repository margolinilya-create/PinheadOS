import { useRef } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import styles from '../erp.module.css';

/**
 * Выбор файлов и превью для блока формы (правки заказчика 16.08).
 *
 * Документ просит файлы в шести местах — упаковка, техблок, лист закупки, факт
 * закупки, подрядный этап, ТЗ этапа, — и это ОДИН и тот же элемент. Отдельная
 * реализация в каждом блоке означала бы шесть разных ответов на вопрос «что
 * будет, если загрузка не прошла», а он в этом проекте уже стоил создания
 * заказов: файл, показанный приложенным до того, как он попал в Storage.
 *
 * Состояние держит вызывающий (`useAttachmentUploads`) — здесь только разметка
 * и три действия. Причина та же, что у конструктора маршрута: одно и то же
 * состояние в форме создания уезжает в payload, а в карточке заказа пишется
 * сразу, и решать это должен тот, кто знает, куда именно.
 *
 * `multiple` — прямое требование документа («добавить возможность загружать
 * НЕСКОЛЬКО файлов / изображений»), причём во всех шести местах.
 */

const STATE_ICON = {
  uploading: 'clock',
  uploaded: 'checkCircle',
  error: 'alert',
};

export function AttachmentPicker({
  label,
  files,
  kind,
  itemIndex = null,
  ownerKey = null,
  accept = 'image/*,application/pdf',
  onAdd,
  onRetry,
  onRemove,
  hint,
  /**
   * Несколько файлов — значение по умолчанию: документ требовал этого
   * во всех шести местах, где примитив стоит. Лист закупки — исключение
   * (правки 20.08): он ОДИН, и «заменить файл до создания заказа» читается
   * как замена, а не как добавление второго рядом.
   */
  multiple = true,
}) {
  const inputRef = useRef(null);
  const mine = files.filter((f) => f.kind === kind
    && f.itemIndex === itemIndex && f.ownerKey === ownerKey);

  return (
    <div className={styles.attachBlock}>
      <div className={styles.checkRow}>
        <Button
          variant="ghost"
          size="sm"
          icon="paperclip"
          onClick={() => inputRef.current?.click()}
        >
          {label}
        </Button>
        {hint && <span className={styles.subText}>{hint}</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className={styles.visuallyHidden}
        aria-label={label}
        onChange={(e) => {
          // Диалог отдаёт FileList; берём все и СБРАСЫВАЕМ значение, иначе
          // повторный выбор того же файла не поднимет событие change вовсе
          for (const file of e.target.files ?? []) onAdd(file, kind, itemIndex, ownerKey);
          e.target.value = '';
        }}
      />

      {mine.length > 0 && (
        <ul className={styles.attachList}>
          {mine.map((f) => (
            <li key={f.uid} className={styles.attachRow}>
              <Icon name={STATE_ICON[f.state]} size={13} />
              <span className={styles.attachName} title={f.name}>{f.name}</span>
              {f.state === 'error' && (
                <>
                  <span className={styles.overdue}>{f.error}</span>
                  <Button variant="ghost" size="sm" onClick={() => onRetry(f.uid)}>
                    Загрузить заново
                  </Button>
                </>
              )}
              {f.state === 'uploading' && <span className={styles.subText}>загружается…</span>}
              <Button
                variant="ghost"
                size="sm"
                icon="x"
                iconOnly
                aria-label={`Убрать файл ${f.name}`}
                onClick={() => onRemove(f.uid)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
