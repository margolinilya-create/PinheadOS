/**
 * Подписи типов изделия и видов флэта (веха 5б, задача 1: переезд из
 * `admin/tabs/flatsView.ts`, чтобы их читали и холст, и редактор флэта, и
 * чистое ядро правки). Имя не `labels.ts`: оно созвучно `orderstudio/catalog/labels.ts`
 * (бирки вехи 4).
 */
import type { FlatViewKind, GarmentType } from '../types';

export const GARMENT_TYPE_LABELS: Record<GarmentType, string> = {
  tshirt: 'Футболка',
  polo: 'Поло',
  longsleeve: 'Лонгслив',
  sweatshirt: 'Свитшот',
  hoodie: 'Худи',
  zip_hoodie: 'Зип-худи',
  half_zip: 'Халф-зип',
  bomber: 'Бомбер',
  olympic: 'Олимпийка',
  pants: 'Штаны',
  shopper: 'Шоппер',
};

/** Виды в порядке показа: перед → спина → левый → правый рукав */
export const VIEW_LABELS: Record<FlatViewKind, string> = {
  front: 'Перед',
  back: 'Спина',
  sleeve_left: 'Левый рукав',
  sleeve_right: 'Правый рукав',
};
