/**
 * Отбор вложений заказа по тому, К ЧЕМУ они относятся (правки заказчика 16.08).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Файлов в заказе стало пять видов, и читателей у них
 * столько же: цех смотрит упаковку и техблок в карточке задания, закупщик —
 * референсы своей строки, карточка заказа — всё вместе. Правило «какой файл
 * чей» обязано жить в одном месте: копия в каждом экране — тот же способ,
 * которым в этом проекте уже разъезжались правила закупки и подряда.
 *
 * Все функции — чистые и терпимы к отсутствию поля. Вложения приезжают из двух
 * разных выборок (`ORDER_SELECT` и `ORDER_LIST_SELECT`), и в списочной их нет
 * вовсе: `undefined` обязан читаться как «файлов нет», а не ронять экран.
 */

/**
 * Вид вложения принимается СТРОКОЙ, а не перечислением `ErpAttachmentKind`.
 * Значение приходит из базы, где колонка объявлена `text`: вид, добавленный
 * миграцией раньше, чем типом, не должен ронять отбор — он просто ни во что
 * не попадёт. Сравнение всё равно идёт по значению.
 */
interface AttachLike {
  kind: string;
  item_id?: string | null;
  material_id?: string | null;
}

interface OrderLike {
  attachments?: AttachLike[];
}

/**
 * Файлы позиции по виду блока: упаковка или техблок.
 *
 * Файл ЗАКАЗА (`item_id = null`) сюда НЕ подмешивается. Соблазн велик — тем же
 * приёмом, что у ТЗ («своё → общее»), — но здесь он неверен: у ТЗ общий
 * документ описывает весь заказ и потому применим к любой позиции, а превью
 * упаковки одной позиции к другой отношения не имеет. Показать чужую схему
 * узла хуже, чем не показать никакой.
 */
export function itemAttachments<T extends AttachLike>(
  order: { attachments?: T[] } | null | undefined,
  itemId: string,
  kind: string,
): T[] {
  return (order?.attachments ?? []).filter(
    (a) => a.kind === kind && a.item_id === itemId,
  );
}

/** Файлы конкретной строки листа закупки — референсы для закупщика */
export function materialAttachments<T extends AttachLike>(
  order: { attachments?: T[] } | null | undefined,
  materialId: string,
): T[] {
  return (order?.attachments ?? []).filter(
    (a) => a.kind === 'purchase' && a.material_id === materialId,
  );
}

/**
 * Лист закупки, приложенный МЕНЕДЖЕРОМ при создании заказа (правки 20.08).
 *
 * Вид `purchase_list`, а не `purchase`, и это не педантизм: `purchase` занят
 * сгенерированным PDF и файлами строк-подсказок, а edge-функция при пересборке
 * УДАЛЯЕТ строку вложения со своим путём. Положи лист тем же видом — и первая
 * же пересборка снесла бы исходное задание закупщику.
 *
 * Файл ОДИН (форма не даёт приложить второй), но берём последний по списку:
 * замена до создания заказа могла оставить в бакете обе версии.
 */
export function purchaseListFile<T extends AttachLike>(
  order: { attachments?: T[] } | null | undefined,
): T | null {
  const list = (order?.attachments ?? []).filter((a) => a.kind === 'purchase_list');
  return list.length > 0 ? list[list.length - 1] : null;
}

/**
 * Есть ли у позиции хоть один файл блока — для подписи «фото: 2» рядом
 * с заголовком. Считаем, а не спрашиваем наличие: ноль и «поля нет вовсе»
 * должны выглядеть одинаково, и подпись в этом случае не рисуется.
 */
export function countItemAttachments(
  order: OrderLike | null | undefined,
  itemId: string,
  kinds: readonly string[],
): number {
  return (order?.attachments ?? []).filter(
    (a) => kinds.includes(a.kind) && a.item_id === itemId,
  ).length;
}
