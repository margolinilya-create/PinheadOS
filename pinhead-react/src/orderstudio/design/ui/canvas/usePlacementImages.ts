/**
 * Картинки логотипов всех размещений вида разом (веха 5а, задача 6а) — поверх
 * кэша `assets/artworkImages` (скачивание, проверка байтов, санитайзер, object URL).
 *
 * Отдельно от `useArtworkImage` (одна картинка, задача 5): холсту нужно знать,
 * что ВСЕ картинки вида уже решились (пришли или не вышло — тост уже показан),
 * чтобы поставить `data-ready` для эталонного снимка (проверка скиллами, тесты).
 * Один файл на несколько нанесений грузится один раз.
 */
import { useEffect, useState } from 'react';
import { loadArtworkImage } from '../../assets/artworkImages';

export interface ImageRef {
  key: string;
  path: string;
  hasPreview: boolean;
}

const SEP = '\u0001';
const idOf = (orderId: string, path: string, hasPreview: boolean) => [orderId, path, hasPreview ? 'p' : 's'].join(SEP);

export interface PlacementImages {
  /** Картинка по ключу нанесения; ещё грузится или не вышло — `null` */
  images: Record<string, HTMLImageElement | null>;
  /** Все картинки решились (пришли или нет) */
  settled: boolean;
}

export function usePlacementImages(orderId: string, refs: ImageRef[]): PlacementImages {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, HTMLImageElement | null>>(() => new Map());
  const ids = refs.filter((r) => r.path).map((r) => idOf(orderId, r.path, r.hasPreview));
  const sig = [...new Set(ids)].sort().join('\n');

  useEffect(() => {
    if (!sig) return undefined;
    let active = true;
    for (const id of sig.split('\n')) {
      const [oid, path, mode] = id.split(SEP);
      void loadArtworkImage(oid, path, mode === 'p').then((img) => {
        if (active) setLoaded((m) => (m.has(id) && m.get(id) === img ? m : new Map(m).set(id, img)));
      });
    }
    return () => { active = false; };
  }, [sig]);

  const images: Record<string, HTMLImageElement | null> = {};
  for (const r of refs) images[r.key] = r.path ? loaded.get(idOf(orderId, r.path, r.hasPreview)) ?? null : null;
  return { images, settled: ids.every((id) => loaded.has(id)) };
}
