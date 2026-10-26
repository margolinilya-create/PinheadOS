import { useEffect, useState } from 'react';
import { loadArtworkImage } from '../../assets/artworkImages';
import { artStatsOf } from '../../assets/artStats';

/**
 * Что видно в макетах нанесений (веха 5в, Э3) — по `print_key`. Картинки —
 * из кэша холста (`loadArtworkImage`, сеть не дёргается заново), подсчёт —
 * на уменьшенной копии и кэшируется на картинке. Ничего не пишет.
 */
export function useArtStats(orderId, placements) {
  const [stats, setStats] = useState({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out = {};
      for (const p of placements) {
        if (!p.artwork_path) continue;
        out[p.print_key] = artStatsOf(await loadArtworkImage(orderId, p.artwork_path, p.asset.has_preview));
      }
      if (alive) setStats(out);
    })();
    return () => { alive = false; };
  }, [orderId, placements]);
  return stats;
}
