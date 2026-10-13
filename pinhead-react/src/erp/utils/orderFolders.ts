/**
 * ПАПКИ ФАЙЛОВ ЗАКАЗА (правка заказчика 14.09, п. 3).
 *
 * Документ: «внутри сделки создать отдельную папку „Файлы производства"
 * для рабочих файлов, которыми пользуется непосредственно производство…
 * Общие файлы сделки и рабочие производственные файлы должны быть разделены».
 *
 * ПОЧЕМУ ПАПКИ — ЭТО ГРУППЫ ВИДОВ, А НЕ НОВАЯ КОЛОНКА. На бое 14.09 из 53
 * вложений 42 — макеты нанесений (`print`), 3 — макеты бирок, и это ровно те
 * файлы, о которых говорит документ («файлы для DTF, шелкографии и других
 * нанесений»). Они уже есть, уже привязаны к своему нанесению и уже видны цеху
 * в задании; заводить им вторую принадлежность значило бы хранить одно и то же
 * дважды и однажды разойтись. Не хватало не хранилища, а ЗОНЫ, где эти файлы
 * видно вместе, — её и даёт разбор по видам.
 *
 * СВОБОДНЫХ ВИДОВ ДВА (`attachment` и `production`), и только они ходят между
 * папками: у макета есть адресат (`print_id`), и смена вида оторвала бы его
 * от нанесения. Это же правило дословно повторяет серверный страж
 * `erp_attachment_guard` — расхождение дало бы «кнопка есть, действие падает».
 */

import type { ErpAttachmentKind, ErpOrderAttachment } from '../types';

export type OrderFolderKey = 'deal' | 'production';

/** Виды, попадающие в папку. Порядок внутри папки задаёт сам список */
const FOLDER_KINDS: Record<OrderFolderKey, ErpAttachmentKind[]> = {
  deal: ['attachment', 'preview', 'note', 'purchase_list', 'packaging', 'tech', 'purchase'],
  production: ['production', 'print', 'label', 'stage_result'],
};

export const ORDER_FOLDERS: Array<{
  key: OrderFolderKey;
  title: string;
  hint: string;
}> = [
  {
    key: 'deal',
    title: 'Файлы сделки',
    hint: 'Общие файлы заказа: превью, лист закупки, упаковка, заметки',
  },
  {
    key: 'production',
    title: 'Файлы производства',
    hint: 'Рабочие файлы цехов: макеты нанесений и бирок, исходники, результаты этапов',
  },
];

/**
 * Куда положен файл. Неизвестный вид уезжает в «Файлы сделки» — fail-open:
 * вид, заведённый позже и забытый здесь, обязан остаться ВИДИМЫМ, а не
 * пропасть из обеих папок. Пропажа файла куда хуже, чем файл не в той папке.
 */
export function folderOf(att: Pick<ErpOrderAttachment, 'kind'>): OrderFolderKey {
  return FOLDER_KINDS.production.includes(att.kind) ? 'production' : 'deal';
}

/** Файлы одной папки в порядке загрузки */
export function filesInFolder(
  attachments: ErpOrderAttachment[] | null | undefined,
  folder: OrderFolderKey,
): ErpOrderAttachment[] {
  return (attachments ?? []).filter((a) => folderOf(a) === folder);
}

/**
 * Можно ли переложить файл между папками.
 *
 * Только свободные виды: у макета нанесения и бирки есть адресат, у результата
 * этапа — сдавший его цех, у листа закупки — свой блок карточки. Перекладывать
 * их значило бы рвать связь, ради которой вид и заводился.
 */
export function canMoveBetweenFolders(att: Pick<ErpOrderAttachment, 'kind'>): boolean {
  return att.kind === 'attachment' || att.kind === 'production';
}

/** Вид, который получает файл при перекладывании в папку */
export function kindForFolder(folder: OrderFolderKey): ErpAttachmentKind {
  return folder === 'production' ? 'production' : 'attachment';
}

/** Куда переложить файл отсюда — вторая папка, если это вообще разрешено */
export function moveTargetOf(
  att: Pick<ErpOrderAttachment, 'kind'>,
): OrderFolderKey | null {
  if (!canMoveBetweenFolders(att)) return null;
  return folderOf(att) === 'production' ? 'deal' : 'production';
}
