import { useEffect, useMemo, useState } from 'react';
import { artworkDownloadUrl, artworkSignedUrl } from '../api/artworks';
import { tzGroups } from '../tz/model/tzGroups';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import styles from './Launch.module.css';

/** Ссылка живёт 10 минут; после 9 iframe пересоздаётся по возврату на вкладку */
const URL_REFRESH_MS = 9 * 60 * 1000;

/** Первые байты по ссылке — `%PDF-`? Не PDF (или не прочли) — без iframe */
async function isPdfAt(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-15' } });
    if (!res.ok) return false;
    const head = new Uint8Array(await res.arrayBuffer()).subarray(0, 5);
    return String.fromCharCode(...head) === '%PDF-';
  } catch {
    return false;
  }
}

/** Свежая подписанная ссылка и проверка байт: `{ path, url, pdf, at }` */
async function signAndCheck(path) {
  const url = await artworkSignedUrl(path);
  const pdf = url ? await isPdfAt(url) : false;
  return { path, url, pdf, at: Date.now() };
}

/**
 * PDF ТЗ на «К запуску» (К22). Файл лежит в приватном бакете — показывается по
 * подписанной ссылке на 10 минут. Перед iframe проверяются первые байты
 * (`%PDF-`): не PDF — только «Скачать» (SVG в iframe исполнился бы на origin
 * Storage). iframe — только при встроенном просмотрщике (`pdfViewerEnabled`)
 * и шире 760 px; иначе карточка с «Открыть» и «Скачать». Переключатель групп —
 * кнопки с `aria-pressed`, фокус при переключении не переносится.
 *
 * @param {{ order: import('../model/types').SalesOrder }} props
 */
export default function TzFrame({ order }) {
  const groups = useMemo(() => tzGroups(order).map((g) => ({
    index: g.index,
    total: g.total,
    path: g.items[0]?.tz_pdf_path ?? '',
    name: g.items[0]?.product_type.trim() || `Позиция ${g.index}`,
  })), [order]);
  const [sel, setSel] = useState(0);
  const [doc, setDoc] = useState({ path: '', url: null, pdf: null, at: 0 });
  const [error, setError] = useState('');
  const narrow = useMediaQuery('(max-width: 760px)');
  const viewer = !narrow && typeof navigator !== 'undefined' && navigator.pdfViewerEnabled === true;
  const g = groups[Math.min(sel, groups.length - 1)];
  const path = g?.path ?? '';
  // Ссылка выдаётся заново при смене группы и при возврате на вкладку после 9 минут
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) return undefined;
    let alive = true;
    void signAndCheck(path).then((d) => { if (alive) setDoc(d); });
    return () => { alive = false; };
  }, [path, nonce]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && doc.at && Date.now() - doc.at > URL_REFRESH_MS) setNonce((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [doc.at]);

  if (!g) return <p className={styles.muted}>У заказа нет ТЗ</p>;

  /** Окно — синхронно по клику (иначе браузер его заблокирует), ссылка — свежая */
  const openTab = async () => {
    setError('');
    const w = window.open('', '_blank');
    const url = await artworkSignedUrl(path);
    if (!url || !w) {
      w?.close();
      setError('Ссылка не получена — повторите');
      return;
    }
    w.opener = null;
    w.location.href = url;
  };

  const download = async () => {
    setError('');
    const url = await artworkDownloadUrl(path);
    if (!url) {
      setError('Ссылка не получена — повторите');
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.click();
  };

  const ready = doc.path === path;
  const title = `ТЗ к заказу ${order.number} — группа ${g.index} из ${g.total}`;
  return (
    <section className={styles.tz} aria-label="ТЗ заказа">
      {groups.length > 1 && (
        <div className={styles.groups} role="group" aria-label="Группы ТЗ">
          {groups.map((x, i) => (
            <button key={x.index} type="button" className={styles.groupBtn} aria-pressed={x === g} onClick={() => setSel(i)}>
              ТЗ {x.index} из {x.total}: {x.name}
            </button>
          ))}
        </div>
      )}
      {ready && doc.pdf && viewer ? (
        <iframe key={`${doc.url}`} className={styles.frame} title={title} src={doc.url} />
      ) : (
        <div className={styles.tzCard}>
          <p className={styles.tzCardTitle}>ТЗ {g.index} из {g.total} · PDF</p>
          {!ready && <p className={styles.muted}>Получаем ссылку…</p>}
          {ready && doc.pdf === false && <p className={styles.warn}>Файл не открывается как PDF — его можно только скачать</p>}
        </div>
      )}
      <div className={styles.tzActions}>
        {ready && doc.pdf && <button type="button" className="btn btn-ghost" onClick={openTab}>Открыть в новой вкладке</button>}
        <button type="button" className="btn btn-ghost" onClick={download}>Скачать</button>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </section>
  );
}
