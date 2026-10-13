/**
 * ПОДПИСИ КАТАЛОГА МОДЕЛЕЙ — отдельным модулем, а не в `types.ts`.
 *
 * Причина та же, по которой из `types.ts` вынесли перечень прав
 * (`permissionKeys.ts`): этот файл попадает в чанк ОБОЛОЧКИ, а словари
 * каталога нужны ровно двум экранам — вкладке «Каталог SKU» и карточке
 * модели. Оба доменные, оба приезжают своим чанком; лежи подписи в `types.ts`,
 * их возил бы каждый, кто открыл обзор производства.
 *
 * Типы (`SkuCardStatus`, `SkuCardFileRole`) остаются там же, где сама
 * сущность: они стираются при сборке и веса не имеют.
 */

import type { SkuCardStatus, SkuCardFileRole } from '../types';

export const SKU_CARD_STATUS_LABELS: Record<SkuCardStatus, string> = {
  /** Так приходит карточка, созданная при завершении разработки */
  draft: 'Требует заполнения',
  active: 'В работе',
  /** Из выбора убрана, история заказов по ней осталась */
  archived: 'В архиве',
};

export const SKU_CARD_FILE_ROLE_LABELS: Record<SkuCardFileRole, string> = {
  pattern: 'Лекала',
  passport: 'Техпаспорт',
  photo: 'Фото образца',
  other: 'Прочее',
};
