import { useCallback, useState } from 'react';
import { handlePossibleUpdate } from '../../../lib/appUpdate';
import { toast } from '../../../store/useToastStore';

export const MSG_UPLOAD_UNAVAILABLE = 'Загрузка логотипа не открылась — обновите страницу и повторите';
/** Почему новый логотип не ставится: силуэт позиции — от другой модели (B1, веха 5в) */
export const MSG_ADD_BLOCKED_MISMATCH = 'Сначала перенесите нанесения на силуэт модели — новый логотип встанет уже на него.';

/**
 * Загрузчик конвейера логотипа (`assets/useAddArtwork`: проверка байтов,
 * pdfjs по требованию, бакет, `placeArtwork`) — единственный `import()`;
 * в тестах подменяется. Конвейер нужен только по действию («Загрузить
 * логотип», бросок файла на холст, «Логотипы заказа»), поэтому живёт в своём
 * чанке, а не в чанке холста (потолок 100 кБ gzip, README модуля).
 */
export const artworkPipeline = { load: () => import('../assets/useAddArtwork') };

async function pipeline() {
  try {
    return await artworkPipeline.load();
  } catch (e) {
    console.error('useArtworkActions: конвейер логотипа', e);
    if (!handlePossibleUpdate(e)) toast.error(MSG_UPLOAD_UNAVAILABLE);
    return null;
  }
}

/**
 * То же, что `useAddArtwork(target)`, но конвейер грузится по первому
 * действию. `target` — `null`, пока флэта нет или заказ только для чтения:
 * тогда действия ничего не делают. Ответ — ключ поставленного нанесения или `null`.
 * `blockedReason` — почему действие закрыто (силуэт не от модели): бросок файла
 * на холст и Ctrl+V тогда показывают её тостом, кнопки панели — текстом.
 */
export function useArtworkActions(target, blockedReason = '') {
  const [pending, setPending] = useState(0);
  const run = useCallback(async (fn) => {
    if (!target) {
      if (blockedReason) toast.error(blockedReason);
      return null;
    }
    setPending((n) => n + 1);
    try {
      const mod = await pipeline();
      return mod ? await fn(mod) : null;
    } finally {
      setPending((n) => n - 1);
    }
  }, [target, blockedReason]);
  const addFile = useCallback((file, opts) => run((m) => m.addArtworkFile(file, target, opts)), [run, target]);
  const addExisting = useCallback((entry, opts) => run((m) => m.addExistingArtwork(entry, target, opts)), [run, target]);
  return { addFile, addExisting, busy: pending > 0, blockedReason };
}
