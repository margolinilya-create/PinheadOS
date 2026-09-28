/**
 * Снимок формы заказа в черновике: что в нём лежит и как он читается.
 *
 * Вынесено из `orderForm.ts` 27.09 (правка 12) — тот файл стоит на потолке
 * ратчета размера, а черновику здесь и место: это ЕДИНСТВЕННЫЙ читатель
 * снимка, и для локального переноса прежней версии, и для строки
 * `erp_order_drafts`. `orderForm.ts` реэкспортирует всё отсюда, поэтому
 * прежние импорты живы.
 */

import { storageGet, storageRemove } from '../../lib/storage';
import {
  EMPTY_ITEM,
  emptyOrderForm,
  emptyPurchaseRow,
  isFormEmpty,
  ORDER_DRAFT_KEY,
  type DraftForm,
  type DraftItem,
  type DraftPurchaseRow,
} from './orderForm';

/** Заметка к заказу в черновике формы (правка 22.08, п. 5.8) */
export interface DraftNote {
  key: string;
  text: string;
}

/**
 * Вложение блока (упаковка, техблок, макет, бирка, заметка) в черновике —
 * то, что отдаёт `useAttachmentUploads.draftSnapshot`: уже загруженный
 * объект без `File`. Путь обязателен — без него восстанавливать нечего.
 */
export interface DraftAttachment {
  uid: string;
  kind: string;
  itemIndex: number | null;
  ownerKey: string | null;
  name: string;
  state: 'uploaded';
  path: string;
}

/**
 * ТЗ в черновике. `name`/`type`/`size` — снимок полей `File`, который в JSON
 * не переживает: сабмиту нужны имя, тип и размер, а показу — имя. Черновики
 * до 27.09 этих трёх полей не несут — читатели берут имя из `path`.
 */
export interface DraftTzDoc {
  groupId: string;
  /** null — общее ТЗ заказа */
  itemIndex: number | null;
  state: 'uploaded';
  path: string;
  name?: string;
  type?: string;
  size?: number;
}

interface OrderDraftEnvelope {
  form: DraftForm;
  items: DraftItem[];
  /** Лист закупки; в старых черновиках его нет вовсе */
  purchase?: DraftPurchaseRow[];
  /** Заметки к заказу; в черновиках до 22.08 их нет */
  notes?: DraftNote[];
  /** Файлы блоков и ТЗ; в черновиках до 20.09 их нет */
  attachments?: DraftAttachment[];
  tzDocs?: DraftTzDoc[];
  savedAt?: string;
}

export interface OrderDraft {
  form: DraftForm;
  items: DraftItem[];
  purchase: DraftPurchaseRow[];
  notes: DraftNote[];
  attachments: DraftAttachment[];
  tzDocs: DraftTzDoc[];
}

/**
 * Привести снимок формы к нынешней структуре.
 *
 * ОДНА функция и для локального черновика, и для строки из базы (правка 22.08,
 * п. 5.5): снимки, сделанные раньше, лежат и там, и там, а дописывание ключей
 * нанесениям и подстановка новых полей — правило одно. Вторая копия рядом
 * означала бы, что часть черновиков чинится, а часть нет.
 *
 * `null` — снимка нет или он битый: форма откроется чистой, а не упадёт.
 */
export function normalizeDraft(raw: unknown): OrderDraft | null {
  const env = raw as OrderDraftEnvelope | null;
  if (!env || typeof env !== 'object') return null;
  if (!env.form || typeof env.form !== 'object') return null;
  if (!Array.isArray(env.items) || env.items.length === 0) return null;
  return normalizeEnvelope(env);
}

/** Восстановить локальный черновик прежней версии; null — его нет или он битый */
export function loadOrderDraft(): OrderDraft | null {
  return normalizeDraft(storageGet<OrderDraftEnvelope>(ORDER_DRAFT_KEY));
}

/**
 * Имя файла из ключа Storage — для ТЗ, сохранённых до того, как имя стало
 * ездить в снимке. Ключ — транслит (`tzFilePath`), то есть имя будет
 * латиницей; это честнее пустой строки и лучше падения на `file.name`.
 */
export function fileNameFromPath(path: string): string {
  const last = path.split('/').pop() ?? '';
  // `v1-` — префикс версии из `tzFilePath`; у вложений его нет
  return last.replace(/^v\d+-/, '');
}

/**
 * Только загруженные файлы с путём: снимок с `state: 'uploading'` мог
 * остаться от прежней версии формы, а путь в нём указывал бы в пустоту.
 */
function uploadedOnly<T extends { path?: string | null; state?: string }>(
  rows: unknown,
): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is T => Boolean(r)
    && typeof r === 'object'
    && typeof (r as T).path === 'string'
    && (r as T).state === 'uploaded');
}

function normalizeEnvelope(raw: OrderDraftEnvelope): OrderDraft {
  return {
    form: { ...emptyOrderForm(), ...raw.form },
    items: raw.items.map((it) => ({
      ...EMPTY_ITEM,
      ...it,
      /**
       * Ключи дописываются восстановленному черновику: он мог быть сохранён
       * до правки 22.08, а без ключа макет не к чему привязать. Ключ самой
       * позиции — по той же причине (черновики до 26.09 его не несли).
       */
      key: it.key || crypto.randomUUID(),
      prints: (Array.isArray(it.prints) ? it.prints : [])
        .map((p) => ({ ...p, key: p.key || crypto.randomUUID() })),
      labels: (Array.isArray(it.labels) ? it.labels : [])
        .map((l) => ({ ...l, key: l.key || crypto.randomUUID() })),
      // старые черновики без флага: брендирование — если есть нанесения
      has_branding: it.has_branding ?? (Array.isArray(it.prints) && it.prints.length > 0),
    })),
    /**
     * Черновик, сохранённый до появления листа закупки, отдаёт пустой лист,
     * а не роняет восстановление: человек мог начать заказ вчера.
     */
    purchase: Array.isArray(raw.purchase)
      ? raw.purchase.map((r, i) => ({ ...emptyPurchaseRow(r.key || `p${i}`), ...r }))
      : [],
    notes: Array.isArray(raw.notes)
      ? raw.notes.map((n) => ({ ...n, text: n.text ?? '', key: n.key || crypto.randomUUID() }))
      : [],
    /**
     * ФАЙЛЫ ПРОХОДЯТ ЧЕРЕЗ НОРМАЛИЗАЦИЮ (правка 27.09, п. 12). Снимок писал их
     * с 20.09, а читатель возвращал только `{form, items, purchase, notes}` —
     * в базе файлы лежали, форма открывалась без них, и человек прикладывал
     * ТЗ заново. Поле, которое пишется и не читается, выглядит сделанным.
     */
    attachments: uploadedOnly<DraftAttachment>(raw.attachments),
    tzDocs: uploadedOnly<DraftTzDoc>(raw.tzDocs)
      .map((d) => ({ ...d, name: d.name || fileNameFromPath(d.path) })),
  };
}

/*
  `saveOrderDraft` СНЯТ 07.09: писателя у localStorage-черновика больше нет.
  Снимок формы уходит в `erp_order_drafts` (таблица заведена 22.08), а
  localStorage остался ТОЛЬКО на чтение — разовый перенос того, что человек
  начал до перехода на базу. Живы `loadOrderDraft` и `clearOrderDraft`:
  первый этот перенос выполняет, второй убирает ключ после него.
*/

export function clearOrderDraft(): void {
  storageRemove(ORDER_DRAFT_KEY);
}

/**
 * ЧЕРНОВИК ПУСТ, ЕСЛИ ПУСТЫ И ПОЛЯ, И ФАЙЛЫ (правка 28.09). `isFormEmpty`
 * смотрит только на поля формы, и форма, где приложен один файл или ТЗ,
 * считалась пустой: автосохранение открытого черновика удаляло его вместе
 * с файлами, а «Сохранить в черновики» отвечало «черновик пустой».
 */
export function isDraftEmpty(
  form: Parameters<typeof isFormEmpty>[0],
  items: Parameters<typeof isFormEmpty>[1],
  initialLaunchDate: string,
  attachedCount: number,
): boolean {
  return attachedCount === 0 && isFormEmpty(form, items, initialLaunchDate);
}
