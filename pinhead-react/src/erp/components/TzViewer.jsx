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

  /**
   * ЛОВУШКА ФОКУСА — НА КОРНЕ ДИАЛОГА, А НЕ НА ПАНЕЛИ КНОПОК (правка 03.09).
   *
   * `ref={trapRef}` стоял на `tzFullscreenBar`, то есть ловушка охватывала три
   * кнопки, а сам `<iframe>` с документом оставался ВНЕ её. Tab циклился по
   * «В новой вкладке» → «Скачать» → «Закрыть» и обратно, и до просмотрщика
   * добраться с клавиатуры было нельзя вовсе: PDF не пролистать и не прочитать.
   * Ровно тот случай, когда ловушка фокуса исключает то, ради чего открыт
   * диалог (WCAG 2.1.1). Обходные пути — «Скачать» и «В новой вкладке» —
   * существовали, но это выход ИЗ приложения, а не работа в нём.
   */
  return (
    <div
      className={styles.tzFullscreen}
      role="dialog"
      aria-modal="true"
      aria-label={tzCaption(doc)}
      ref={trapRef}
    >
      <div className={styles.tzFullscreenBar}>
        <strong className={styles.tzFullscreenName}>{tzCaption(doc)}</strong>
        <div className={styles.spacer} />
        <ButtonLink href={url} target="_blank" rel="noreferrer" variant="ghost">В новой вкладке ↗</ButtonLink>
        <ButtonLink href={url} download={doc.file_name || 'tz.pdf'} variant="secondary">Скачать</ButtonLink>
        <Button variant="ghost" onClick={onClose} autoFocus>
          <span className={styles.cellWithIcon}><Icon name="x" size={15} />Закрыть</span>
        </Button>
      </div>
      {/*
        `tabIndex={0}` — ЧАСТЬ ТОЙ ЖЕ ПОЧИНКИ. Ловушка фокуса ищет остановки
        селектором `a[href], button, textarea, input, select, [tabindex]`,
        и `iframe` в него не входит: перенести ref на корень было необходимо,
        но недостаточно — просмотрщик всё равно не стал бы остановкой Tab.
        Явный `tabIndex` делает его ею и позволяет листать PDF с клавиатуры.
      */}
      <iframe
        src={url}
        title={`ТЗ: ${tzCaption(doc)}`}
        className={styles.tzFullscreenFrame}
        tabIndex={0}
      />
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
        <iframe src={url} title={`ТЗ: ${tzCaption(doc)}`} className={styles.tzFrame} tabIndex={0} />
      )}
      {full && <TzFullscreen doc={doc} url={url} onClose={() => setFull(false)} />}
    </div>
  );
}
