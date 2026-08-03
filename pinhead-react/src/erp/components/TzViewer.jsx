import { useEffect, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { formatDateShort } from '../utils/time';
import { tzCaption, tzFileUrl } from '../utils/tzFile';
import styles from '../erp.module.css';
import { Icon } from './Icon';
import { Button, ButtonLink } from '../components/Button';

/**
 * Просмотр PDF-ТЗ внутри ERP (волна 4). Решение заказчика — встроенный просмотрщик
 * браузера: `<iframe>` со ссылкой на файл, без новых npm-зависимостей.
 *
 * Мобильный Safari PDF в iframe не рисует, поэтому «Открыть в новой вкладке» —
 * не украшение, а запасной путь; «Скачать» есть всегда.
 */

/** Полноэкранный слой просмотра (по образцу Lightbox, но с focus-trap — внутри есть кнопки) */
function TzFullscreen({ doc, url, onClose }) {
  const trapRef = useFocusTrap(true, onClose);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.tzFullscreen} role="dialog" aria-modal="true" aria-label={tzCaption(doc)}>
      <div className={styles.tzFullscreenBar} ref={trapRef}>
        <strong className={styles.tzFullscreenName}>{tzCaption(doc)}</strong>
        <div className={styles.spacer} />
        <ButtonLink href={url} target="_blank" rel="noreferrer" variant="ghost">В новой вкладке ↗</ButtonLink>
        <ButtonLink href={url} download={doc.file_name || 'tz.pdf'} variant="secondary">Скачать</ButtonLink>
        <Button variant="ghost" onClick={onClose} autoFocus>
          <span className={styles.cellWithIcon}><Icon name="x" size={15} />Закрыть</span>
        </Button>
      </div>
      <iframe src={url} title={`ТЗ: ${tzCaption(doc)}`} className={styles.tzFullscreenFrame} />
    </div>
  );
}

/**
 * Карточка документа ТЗ. `compact` — только шапка с кнопкой «Открыть ТЗ»
 * (очередь и карточка заказа), иначе сразу рисуется встроенный просмотр.
 */
export function TzViewer({ doc, compact = false, badge = null, actions = null }) {
  const [full, setFull] = useState(false);
  const [inline, setInline] = useState(!compact);
  if (!doc) return null;
  const url = tzFileUrl(doc.file_path);

  return (
    <div className={styles.tzDoc}>
      <div className={styles.tzDocHead}>
        <span className={styles.tzDocIcon}><Icon name="file" size={16} /></span>
        <span className={styles.tzDocName} title={tzCaption(doc)}>
          {doc.file_name || 'ТЗ.pdf'}
          {doc.version > 1 && <span className={styles.tzDocVersion}> v{doc.version}</span>}
        </span>
        {badge}
        <div className={styles.spacer} />
        {compact && (
          <Button variant="secondary" aria-expanded={inline} onClick={() => setInline((v) => !v)}>
            {inline ? 'Свернуть ТЗ' : 'Открыть ТЗ'}
          </Button>
        )}
        <Button variant="ghost" onClick={() => setFull(true)}>
          На весь экран
        </Button>
        <ButtonLink href={url} download={doc.file_name || 'tz.pdf'} variant="ghost">Скачать</ButtonLink>
        {actions}
      </div>
      <div className={styles.tzDocMeta}>
        {doc.uploaded_by ? `${doc.uploaded_by} · ` : ''}{formatDateShort(doc.created_at)}
        {doc.note ? ` · ${doc.note}` : ''}
      </div>
      {inline && (
        <iframe src={url} title={`ТЗ: ${tzCaption(doc)}`} className={styles.tzFrame} />
      )}
      {full && <TzFullscreen doc={doc} url={url} onClose={() => setFull(false)} />}
    </div>
  );
}
