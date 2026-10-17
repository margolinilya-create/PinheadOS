/**
 * Картинка логотипа нанесения для холста (веха 5а, задача 5) — React-обёртка
 * над кэшем `artworkImages` (там скачивание, проверка байтов, санитайзер
 * и object URL). Пока грузится или не вышло — `null`.
 *
 * `orderId` — заказ, которому принадлежит путь (проверка `isArtworkPath`
 * при скачивании); `hasPreview` — PDF/AI: рисуется PNG-превью рядом
 * с исходником (`layout.asset.has_preview`).
 */
import { useEffect, useState } from 'react';
import { loadArtworkImage } from './artworkImages';

export function useArtworkImage(orderId: string | null | undefined, path: string | null | undefined, hasPreview: boolean): HTMLImageElement | null {
  const key = orderId && path ? `${orderId}|${path}|${hasPreview ? 'p' : 's'}` : '';
  const [loaded, setLoaded] = useState<{ key: string; img: HTMLImageElement | null }>({ key: '', img: null });

  useEffect(() => {
    if (!orderId || !path) return undefined;
    let active = true;
    void loadArtworkImage(orderId, path, hasPreview).then((img) => {
      if (active) setLoaded({ key: `${orderId}|${path}|${hasPreview ? 'p' : 's'}`, img });
    });
    return () => { active = false; };
  }, [orderId, path, hasPreview]);

  return key && loaded.key === key ? loaded.img : null;
}
