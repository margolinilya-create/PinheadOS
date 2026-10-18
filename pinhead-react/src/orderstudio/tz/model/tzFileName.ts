/**
 * Имя файла PDF ТЗ (К1): `<PH-XXXX>-g<hash8>-c<hash12>-<модель-ascii>.pdf`.
 *
 * Хэши — В НАЧАЛЕ имени: `artworkPath` пропускает имя через `asciiFileName`,
 * а тот режет основу до 100 знаков с хвоста — длинное имя модели обрежется,
 * хэши останутся. Основа здесь уже ≤ 100 знаков. Путь целиком строит
 * `artworkPath(orderId, 'tz', name)` (`orders/<id>/tz/<uuid>-<имя>`).
 */
import type { SalesOrder } from '../../model/types';
import { translitAscii } from '../../../utils/asciiFileName';
import type { TzDoc } from './tzDocTypes';
import type { TzGroup } from './tzGroups';

/** Предел основы имени `asciiFileName` */
export const TZ_NAME_BASE_MAX = 100;

/** Часть имени: транслит, всё прочее — «_», без «_.-» по краям */
function namePart(s: string): string {
  return translitAscii(s.trim()).replace(/[^\w.-]+/g, '_').replace(/_{2,}/g, '_').replace(/^[._-]+|[._-]+$/g, '');
}

export function tzFileName(order: Pick<SalesOrder, 'number'>, group: Pick<TzGroup, 'hash8'>, doc: Pick<TzDoc, 'header'>, hash12: string): string {
  const head = `${namePart(order.number) || 'PH-draft'}-g${group.hash8}-c${hash12}-`;
  const model = (namePart(doc.header.productTitle) || 'tz').slice(0, TZ_NAME_BASE_MAX - head.length).replace(/[._-]+$/, '') || 'tz';
  return `${head}${model}.pdf`;
}
