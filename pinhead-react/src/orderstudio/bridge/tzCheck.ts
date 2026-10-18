/**
 * Шаг `tzcheck` запуска (веха 6+7, решения 42 и 45): МС заново строит модель
 * ТЗ каждой группы по данным заказа и ТЕКУЩИМ справочникам и сверяет хэш
 * содержимого с `-c<hash>` (и группу с `-g<hash>`) в `tz_pdf_path` каждой
 * позиции. Расхождение блокирует запуск: цех работал бы по PDF, который не
 * соответствует заказу. Смена справочника после отправки — тоже расхождение
 * (выход — «Вернуть менеджеру» и повторная отправка, PDF пересоберётся).
 *
 * Подделку байт PDF при верном хэше это не ловит — полная защита серверной
 * сборкой (веха 8). Дата оформления и ссылка подвала в хэш не входят, поэтому
 * они передаются пустыми.
 */
import type { SalesOrder } from '../model/types';
import { tzDocument } from '../tz/model/tzDocument';
import { tzGroups } from '../tz/model/tzGroups';
import { NO_CRYPTO_MESSAGE, defaultDigest, groupHashFromTzPath, hashFromTzPath, tzContentHash, type Digest } from '../tz/model/tzHash';
import type { TzCatalogs } from '../tz/model/tzDocTypes';

export const TZ_MISMATCH = 'ТЗ не соответствует текущим данным заказа или справочникам — верните менеджеру, он отправит заново';

export const LAUNCH_NO_CRYPTO = 'Запуск недоступен: браузер не дал криптографию (откройте сайт по https)';

export type TzCheck = { ok: true } | { ok: false; reason: string };

/** Сверка PDF ТЗ всех позиций с моделью по данным заказа */
export async function checkTzHashes(
  order: SalesOrder, cat: TzCatalogs, digest: Digest | null = defaultDigest(),
): Promise<TzCheck> {
  const dir = `orders/${order.id.toLowerCase()}/tz/`;
  try {
    for (const g of tzGroups(order)) {
      const hash = await tzContentHash(tzDocument(order, g, cat, { issuedOn: '', appOrigin: '' }), digest);
      for (const it of g.items) {
        const path = it.tz_pdf_path;
        if (!path.startsWith(dir) || hashFromTzPath(path) !== hash || groupHashFromTzPath(path) !== g.hash8) {
          return { ok: false, reason: TZ_MISMATCH };
        }
      }
    }
  } catch (e) {
    // Нет криптографии — её текст; сбой модели на данных заказа — расхождение
    const noCrypto = e instanceof Error && e.message === NO_CRYPTO_MESSAGE;
    return { ok: false, reason: noCrypto ? LAUNCH_NO_CRYPTO : TZ_MISMATCH };
  }
  return { ok: true };
}
