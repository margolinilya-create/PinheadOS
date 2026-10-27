import { useId, useState } from 'react';
import { handlePossibleUpdate } from '../../../../lib/appUpdate';
import { toast } from '../../../../store/useToastStore';
import { saveBlob } from '../../../../utils/saveBlob';
import styles from './stage.module.css';

export const MSG_ZIP_FAILED = 'Архив не собрался — обновите страницу и повторите';

/**
 * Кнопка «собрать архив и скачать» (веха 5в: «Файлы печати» Э4а, «Мокапы» Э5).
 * `build()` грузит сборку по `import()` и отдаёт `{ zip, fileName, count, notes }`;
 * ничего не пишет. Нечего собрать — `aria-disabled` с причиной; во время
 * сборки — `disabled`.
 */
export default function ZipExportButton({ label, busyLabel, reason, doneText, build }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (reason || busy) return;
    setBusy(true);
    try {
      const res = await build();
      saveBlob(new Blob([res.zip], { type: 'application/zip' }), res.fileName);
      if (res.notes.length) toast.warning(`${doneText(res.count)}. ${res.notes.join('. ')}`);
      else toast.success(`${doneText(res.count)} — архив скачан`);
    } catch (e) {
      console.error('ZipExportButton', label, e);
      if (!handlePossibleUpdate(e)) toast.error(MSG_ZIP_FAILED);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={styles.chipBtn}
        aria-disabled={reason ? 'true' : undefined}
        aria-describedby={reason ? `${id}-why` : undefined}
        disabled={busy}
        onClick={run}
      >
        {busy ? busyLabel : label}
      </button>
      {reason && <span id={`${id}-why`} className={styles.hint}>{reason}</span>}
    </>
  );
}
