import { useEffect, useRef, useState } from 'react';
import { fileSizeText } from './tzUiText';
import styles from './tz.module.css';

/**
 * Предпросмотр ТЗ (К2): PDF собирается в память и НИКУДА не грузится. Браузеры
 * (Safari на iPad) блокируют `window.open` после `await`, поэтому по готовности
 * на месте кнопки — ссылка «Открыть … (PDF, 1,2 МБ)» (`target=_blank`, человек
 * жмёт сам) и «Скачать». Object URL отзывается при новой сборке и при уходе
 * со вкладки (размонтирование), а не по таймеру.
 *
 * @param {{
 *   label: string, idleText: string, fileName: string,
 *   loadEngine: () => Promise<object | null>,
 *   build: (engine: object) => Promise<Blob>,
 * }} props
 */
export default function TzPreviewButton({ label, idleText, fileName, loadEngine, build }) {
  const [state, setState] = useState({ busy: false, url: '', size: 0, error: '' });
  /** Живой object URL (объект-держатель: очистка при размонтировании видит последнее значение) */
  const holder = useRef({ url: '', gone: false });
  const errRef = useRef(null);

  const revoke = () => {
    const h = holder.current;
    if (h.url) URL.revokeObjectURL(h.url);
    h.url = '';
  };
  useEffect(() => {
    const h = holder.current;
    h.gone = false;
    return () => {
      h.gone = true;
      if (h.url) URL.revokeObjectURL(h.url);
    };
  }, []);
  useEffect(() => { if (state.error) errRef.current?.focus(); }, [state.error]);

  const run = async () => {
    revoke();
    setState({ busy: true, url: '', size: 0, error: '' });
    const engine = await loadEngine();
    if (!engine) {
      setState({ busy: false, url: '', size: 0, error: '' });
      return;
    }
    try {
      const blob = await build(engine);
      // Ушли со вкладки, пока шла сборка, — ссылку не заводим (её некому отозвать)
      if (holder.current.gone) return;
      const url = URL.createObjectURL(blob);
      holder.current.url = url;
      setState({ busy: false, url, size: blob.size, error: '' });
    } catch (e) {
      const known = e instanceof Error && e.name === 'TzPdfError';
      if (!known) console.error('Предпросмотр ТЗ', e);
      setState({ busy: false, url: '', size: 0, error: `ТЗ не собрано: ${known ? e.message : 'ошибка сборки PDF — сообщите администратору'}` });
    }
  };

  return (
    <div className={styles.actions}>
      {state.url ? (
        <>
          <a className={styles.action} href={state.url} target="_blank" rel="noopener noreferrer">
            Открыть {label} (PDF, {fileSizeText(state.size)})
          </a>
          <a className={styles.action} href={state.url} download={fileName}>Скачать</a>
          <button type="button" className="btn btn-ghost" onClick={run}>Собрать заново</button>
        </>
      ) : (
        <button type="button" className="btn btn-ghost" aria-busy={state.busy || undefined} disabled={state.busy} onClick={run}>
          {state.busy ? 'Собираем ТЗ…' : idleText}
        </button>
      )}
      {state.error && <p ref={errRef} tabIndex={-1} role="alert" className={styles.error}>{state.error}</p>}
    </div>
  );
}
