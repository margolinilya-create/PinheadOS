/**
 * Путь файла заказа в папке другого заказа (веха 5в, Э8, повтор заказа).
 * Отдельный модуль без импортов: его читают писатель бакета `api/artworks.ts`
 * (он в чанках картинок и оболочки) и модель повтора — тянуть фабрику модели
 * в те чанки нельзя (бюджет «Кэши картинок»).
 */
const ORDER_PATH = /^orders\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(.+)$/;

/** Тот же файл в папке другого заказа; путь не заказа — `null` */
export function repointPath(path: string, toOrderId: string): string | null {
  const m = ORDER_PATH.exec(path);
  return m ? `orders/${toOrderId.toLowerCase()}/${m[1]}` : null;
}
