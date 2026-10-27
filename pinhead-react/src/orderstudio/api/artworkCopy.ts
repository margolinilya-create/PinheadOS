/**
 * Серверная копия файла заказа в папку другого заказа — «Повторить заказ»
 * (веха 5в, Э8). Второй и последний модуль, который пишет в `order-artworks`
 * (сторож `artworkWrites.test.ts`): ровно одна операция `copy`, в тот же бакет.
 * Отдельно от `artworks.ts` — тот в чанках оболочки Order и кэшей картинок,
 * а копию грузит только ленивый поток повтора (`workplace/repeatFlow.ts`).
 *
 * Права судит Storage: источник — `order_artworks_select` (заказ виден), приёмник —
 * `order_artworks_insert` (путь заказа, черновик, автор или руководство); тот же
 * бакет — тип и размер уже проверены при загрузке, перезаписи нет (`no_update`).
 * Ошибка — `null` без тоста: итог по всем файлам показывает повтор одним сообщением.
 */
import { supabase } from '../../lib/supabase';
import { repointPath } from '../model/orderPaths';
import { ARTWORK_BUCKET, isArtworkPath } from './artworks';

export async function copyArtwork(fromPath: string, toOrderId: string): Promise<string | null> {
  const to = repointPath(fromPath, toOrderId);
  if (!to || !isArtworkPath(toOrderId, to) || fromPath.includes('..')) return null;
  try {
    const { error } = await supabase.storage.from(ARTWORK_BUCKET).copy(fromPath, to);
    if (error) {
      console.error('copyArtwork', error);
      return null;
    }
    return to;
  } catch (e) {
    console.error('copyArtwork', e);
    return null;
  }
}
