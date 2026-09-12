import { useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { SlideConfirm } from './SlideConfirm';
import styles from './ConfirmDialog.module.css';

/**
 * ГЕЙТ ПРОТЯЖКИ — `pointer: coarse`, и ОСОЗНАННО НЕ `COMPACT_LAYOUT_QUERY`.
 *
 * Протяжка существует ровно для того, чтобы случайный тап ПАЛЬЦЕМ не запустил
 * необратимое действие, а `(pointer: coarse)` — это и есть «вводят пальцем».
 * Компактная раскладка раздела (`max-width: 1024px` ИЛИ `pointer: coarse`)
 * отвечает на другой вопрос — «хватает ли ширины под таблицу», — и по ней
 * слайдер достался бы суженному окну браузера на десктопе, где тянуть его
 * мышью просто неудобно. Похожие условия, разные вопросы.
 *
 * Строка объявлена здесь, а не импортирована из `erp/layout`: `ConfirmDialog`
 * живёт в общих компонентах и работает в обоих разделах — зависимость
 * «общее → erp» направлена не туда.
 */
const TOUCH_INPUT = '(pointer: coarse)';

/**
 * Shared confirmation dialog. Replaces window.confirm().
 *
 * Usage:
 *   const [confirmOpen, setConfirmOpen] = useState(false);
 *   <ConfirmDialog
 *     open={confirmOpen}
 *     title="Удалить заказ?"
 *     message="Действие нельзя отменить."
 *     confirmLabel="Удалить"
 *     variant="danger"
 *     onConfirm={() => { doDelete(); setConfirmOpen(false); }}
 *     onCancel={() => setConfirmOpen(false)}
 *   />
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  variant = 'default',
  /** { label, placeholder, required, type, initialValue } — поле вместо window.prompt() */
  prompt = null,
  onConfirm,
  onCancel,
}) {
  const ref = useFocusTrap(open, onCancel);
  // Поле чистится перемонтированием по nonce из стора (см. ConfirmDialogHost),
  // а не сбросом в эффекте — иначе прошлый комментарий подставился бы в новый перенос
  // Начальное значение приходит из стора и работает по той же механике:
  // диалог перемонтируется по `nonce`, поэтому предложение подставляется
  // при каждом открытии, а не один раз за жизнь приложения
  const [value, setValue] = useState(prompt?.initialValue || '');
  const touch = useMediaQuery(TOUCH_INPUT);

  if (!open) return null;
  const blocked = Boolean(prompt?.required) && !value.trim();
  const submit = () => { if (!blocked) onConfirm(value.trim()); };

  /**
   * Протяжка — ТОЛЬКО у необратимого действия и только под пальцем.
   *
   * Обычное «да/нет» ею не закрывают: цена ошибки там — один лишний тап,
   * а лишний жест на каждом подтверждении превратил бы защиту в повинность
   * и научил бы проводить не глядя. Текст последствий (`message`) при этом
   * остаётся на месте у обоих вариантов: протяжка заменяет кнопку, а не
   * объяснение.
   */
  const slide = variant === 'danger' && touch;

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        ref={ref}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div id="confirm-dialog-title" className={styles.title}>{title}</div>}
        {message && <div className={styles.message}>{message}</div>}
        {prompt && (
          <label className={styles.promptField}>
            <span className={styles.promptLabel}>{prompt.label}</span>
            <input
              className={styles.promptInput}
              type={prompt.type || 'text'}
              value={value}
              placeholder={prompt.placeholder || ''}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            />
          </label>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            {cancelLabel}
          </button>
          {slide ? (
            <SlideConfirm label={confirmLabel} disabled={blocked} onCommit={submit} />
          ) : (
            <button
              type="button"
              className={`${styles.confirm} ${variant === 'danger' ? styles.danger : ''}`}
              disabled={blocked}
              onClick={submit}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
