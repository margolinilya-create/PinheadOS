import { useRef } from 'react';
import { Icon } from './Icon';
import { Button } from './Button';
import { ATTACH_KIND_LABEL, attachmentUrl, isImageAttachment } from '../utils/attachmentView';
import styles from '../styles';

/**
 * ФАЙЛЫ ПАПКАМИ — ОДИН КОМПОНЕНТ НА ВЕСЬ РАЗДЕЛ (правка заказчика 21.09, п. 7).
 *
 * «Во вкладке „Файлы" экспериментального цеха нет полноценного управления
 * файлами. Нужно применить здесь ту же логику работы с файлами, которая уже
 * используется в заказе и других цехах».
 *
 * «Ту же» — это буквально тот же код, а не похожий: превью, ссылка, загрузка,
 * удаление с подтверждением и правило «файл уходит в бакет СРАЗУ по выбору»
 * живут здесь, а вызывающий приносит только папки и действия. Две реализации
 * одного и того же расходятся молча — в проекте это записанное правило,
 * и именно им объясняется, почему вкладка ЭКС была реестром на чтение.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Знания о том, КУДА привязывается файл: у заказа это
 * `order_id` и вид папки, у разработки — `experimental_id` и её виды.
 * Компонент про показ и жесты, привязка остаётся у владельца данных.
 */

/**
 * Карточка одного файла.
 *
 * `moveTo` — необязательное действие «переложить в другую папку»: у заказа
 * оно есть, у разработки его нет, и кнопка не рисуется. Кнопка, которой
 * сервер откажет (`erp_attachment_guard`), хуже отсутствующей.
 */
export function FileCard({ att, canManage, busy, onRemove, moveTo = null, subtitle = null }) {
  const url = attachmentUrl(att.file_path);
  const name = att.file_name || 'файл';

  return (
    <div className={styles.fileCard}>
      <a href={url} target="_blank" rel="noreferrer" className={styles.fileCardLink}>
        {isImageAttachment(att) ? (
          <img
            src={url} alt={name} className={styles.fileThumb} loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <span className={styles.fileThumbStub} aria-hidden="true">
            <Icon name="orders" size={28} />
          </span>
        )}
        <span className={styles.fileName}>
          {ATTACH_KIND_LABEL[att.kind] ? `${ATTACH_KIND_LABEL[att.kind]} · ` : ''}
          {name}
        </span>
      </a>
      {subtitle && <span className={styles.subText}>{subtitle}</span>}
      {canManage && (
        <div className={styles.fileCardActions}>
          {moveTo && (
            <Button
              variant="secondary" size="sm" disabled={busy}
              onClick={moveTo.onMove}
            >
              → {moveTo.title}
            </Button>
          )}
          <Button
            variant="secondary" size="sm" disabled={busy}
            aria-label={`Удалить файл ${name}`}
            onClick={() => onRemove(att)}
          >
            Удалить
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Одна папка: заголовок, кнопка загрузки, подсказка и сетка файлов.
 *
 * `folder` — `{ key, title, hint }`; файлы отбирает вызывающий, потому что
 * правило отбора у заказа и у разработки разное.
 */
export function FileFolder({
  folder, files, canManage, busy, onUpload, onRemove, moveTargetFor = null, emptyText,
}) {
  const inputRef = useRef(null);

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <strong>{folder.title}</strong>
        {canManage && onUpload && (
          <>
            <Button
              variant="secondary" size="sm" disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              Загрузить
            </Button>
            {/*
              Файл уходит в бакет СРАЗУ по выбору — правило проекта: интерфейс
              не должен показывать приложенным то, чего в Storage нет.
            */}
            <input
              ref={inputRef}
              type="file"
              multiple
              className={styles.visuallyHidden}
              aria-label={`Загрузить в «${folder.title}»`}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (picked.length > 0) onUpload(folder.key, picked);
              }}
            />
          </>
        )}
      </div>
      {folder.hint && <div className={styles.subText}>{folder.hint}</div>}
      {files.length === 0 ? (
        <div className={styles.subText}>{emptyText || 'Файлов нет.'}</div>
      ) : (
        <div className={styles.fileGrid}>
          {files.map((a) => (
            <FileCard
              key={a.id}
              att={a}
              canManage={canManage}
              busy={busy}
              onRemove={onRemove}
              moveTo={moveTargetFor ? moveTargetFor(a) : null}
              subtitle={a.subtitle ?? null}
            />
          ))}
        </div>
      )}
    </section>
  );
}
