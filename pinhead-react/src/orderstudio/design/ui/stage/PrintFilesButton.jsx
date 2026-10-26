import { useId, useState } from 'react';
import { handlePossibleUpdate } from '../../../../lib/appUpdate';
import { toast } from '../../../../store/useToastStore';
import { saveBlob } from '../../../../utils/saveBlob';
import styles from './stage.module.css';

export const MSG_NO_PRINT_FILES = 'Нет нанесений с макетом и размером в мм';
export const MSG_PRINT_FILES_FAILED = 'Файлы печати не собрались — обновите страницу и повторите';

/** Есть что печатать: макет и оба мм (как `printablePrints`, без загрузки модуля) */
const printable = (item) => item.prints.some((p) => p.artwork_path && p.width_mm > 0 && p.height_mm > 0);

/**
 * «Файлы печати» (веха 5в, Э4а): ZIP с PNG 300 dpi на каждое нанесение (вектор
 * и PDF — с исходником). Сборка — `import()` по клику; ничего не пишет в заказ
 * и бакет. Нечего печатать — `aria-disabled` с причиной; во время сборки — `disabled`.
 */
export default function PrintFilesButton({ order, item }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const can = printable(item);
  const run = async () => {
    if (!can || busy) return;
    setBusy(true);
    try {
      const [m, api] = await Promise.all([import('../../export/printFiles'), import('../../../api/artworks')]);
      const res = await m.buildPrintFiles(order, item, { download: api.downloadArtwork, rasterize: m.rasterizeInBrowser });
      saveBlob(new Blob([res.zip], { type: 'application/zip' }), res.fileName);
      if (res.notes.length) toast.warning(`Файлы печати: ${res.count}. ${res.notes.join('. ')}`);
      else toast.success(`Файлы печати: ${res.count} — архив скачан`);
    } catch (e) {
      console.error('PrintFilesButton', e);
      if (!handlePossibleUpdate(e)) toast.error(MSG_PRINT_FILES_FAILED);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={styles.chipBtn}
        aria-disabled={can ? undefined : 'true'}
        aria-describedby={can ? undefined : `${id}-why`}
        disabled={busy}
        onClick={run}
      >
        {busy ? 'Собираю файлы печати…' : 'Файлы печати'}
      </button>
      {!can && <span id={`${id}-why`} className={styles.hint}>{MSG_NO_PRINT_FILES}</span>}
    </>
  );
}
