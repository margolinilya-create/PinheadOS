import { useMemo, useState } from 'react';
import { artworkDownloadUrl } from '../../api/artworks';
import { ddmm } from '../../payment/paymentText';
import { tzGroups } from '../model/tzGroups';
import { groupTitle } from './tzUiText';
import TzPreviewButton from './TzPreviewButton';
import styles from './tz.module.css';

/** Имя файла предпросмотра: номер заказа и номер ТЗ, ASCII */
const previewName = (order, suffix) => `${(order.number || 'PH-draft').replace(/[^\w-]+/g, '_')}-${suffix}.pdf`;

/** «Скачать» записанного PDF: подписанная ссылка с `download` (файл сохраняется, а не рисуется) */
function SentLink({ path, text }) {
  const [error, setError] = useState('');
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
  return (
    <div className={styles.actions}>
      <button type="button" className="btn btn-ghost" onClick={download}>{text}</button>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  );
}

/**
 * Раздел «ТЗ» вкладки «ТЗ и цена» (К2, К23): список групп, предпросмотр по
 * группе (сборка в память, без загрузки). Только в `draft` — «Скачать черновик
 * всех ТЗ (не отправлено)»: сборка всех групп одним файлом. Не в `draft` —
 * сборки нет (справочники могли смениться), только записанные PDF групп.
 *
 * @param {{
 *   order: import('../../model/types').SalesOrder,
 *   catalogs: import('../model/tzDocTypes').TzCatalogs | null,
 *   today: string, appOrigin: string,
 *   loadEngine: () => Promise<object | null>,
 * }} props
 */
export default function TzGroupsPanel({ order, catalogs, today, appOrigin, loadEngine }) {
  const groups = useMemo(() => tzGroups(order), [order]);
  const draft = order.status === 'draft';
  const input = (gs) => ({ order, groups: gs, catalogs, issuedOn: today, appOrigin });

  return (
    <section className={styles.panel} aria-labelledby="wp-tz-head">
      <h2 id="wp-tz-head" className={styles.title}>ТЗ</h2>
      {groups.length === 0 && <p className={styles.muted}>Добавьте изделие — ТЗ собирается по позициям заказа.</p>}
      {draft && groups.length > 0 && !catalogs && <p className={styles.muted} role="status">Загружаем справочники ТЗ…</p>}
      {groups.length > 0 && (
        <ul className={styles.groups}>
          {groups.map((g) => {
            const path = g.items[0].tz_pdf_path;
            return (
              <li key={g.key} className={styles.group}>
                <p className={styles.groupName}>{groupTitle(g, catalogs)}</p>
                {draft && catalogs && (
                  <TzPreviewButton
                    label={`ТЗ ${g.index} из ${g.total}`}
                    idleText="Предпросмотр ТЗ"
                    fileName={previewName(order, `TZ-${g.index}-preview`)}
                    loadEngine={loadEngine}
                    build={async (engine) => (await engine.buildTzPdf(input([g]))).blob}
                  />
                )}
                {!draft && path && <SentLink path={path} text={`Скачать ТЗ ${g.index} из ${g.total} (отправлено ${ddmm(order.sent_at)})`} />}
                {!draft && !path && <p className={styles.muted}>PDF не записан</p>}
              </li>
            );
          })}
        </ul>
      )}
      {draft && catalogs && groups.length > 1 && (
        <TzPreviewButton
          label="все ТЗ одним файлом"
          idleText="Скачать черновик всех ТЗ (не отправлено)"
          fileName={previewName(order, 'TZ-all-draft')}
          loadEngine={loadEngine}
          build={(engine) => engine.buildAllTzPdf(input(groups))}
        />
      )}
    </section>
  );
}
