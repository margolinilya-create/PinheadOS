import {
  effectiveQty,
  fileNameFromPath,
  gridToPayload,
  type DraftForm,
  type DraftItem,
} from '../../../utils/orderForm';
import { garmentSourceOf } from '../../../utils/garmentSource';
import { TZ_MIME } from '../../../types';

/**
 * СБОРКА PAYLOAD ФОРМЫ ЗАКАЗА — чистые функции без стора и React.
 *
 * Вынесено из `CreateOrderModal` (обзор 26.09, «Резка крупных файлов»):
 * сабмит держал оба писателя — правку и создание — прямо в обработчике,
 * и проверить их можно было только через монтирование всей формы.
 *
 * ОБА ПИСАТЕЛЯ ЖИВУТ В ОДНОМ ФАЙЛЕ НАМЕРЕННО: сторожа `skuCardOrderLink`
 * и «цвет / поставщик доходит до цеха» (`orderForm.test.ts`) читают этот
 * исходник и требуют, чтобы поле было у ОБОИХ. Разнести их — значит дать
 * одному из них молча забыть колонку.
 */

/** Позиция формы в payload: у позиций из базы бывает ещё и заметка */
type PayloadItem = DraftItem & { notes?: string };

/** Позиции, которые уедут в заказ: с изделием и ненулевым тиражом */
export function payloadItems<T extends Pick<DraftItem, 'product_type' | 'qty' | 'size_grid'>>(
  items: T[],
): T[] {
  return items.filter((it) => it.product_type.trim() && effectiveQty(it) > 0);
}

/**
 * РЕЖИМ ПРАВКИ (правка 12.09, п. 7): обновляем ТОТ ЖЕ заказ.
 *
 * Создание собирает то, чего у правки нет и быть не должно: маршрут (он
 * правится конструктором в карточке — иначе правка срока стёрла бы факт
 * цеха), секцию ТЗ и привязку вложений по индексам новых строк. Сервер
 * сопоставляет позиции по `id`, а не по порядку: индекс сдвинулся бы,
 * и техблок уехал бы к чужому изделию.
 */
export function editOrderPayload(form: DraftForm, validItems: PayloadItem[]) {
  return {
    order: {
      bitrix_id: form.bitrix_id.trim() || null,
      title: form.title.trim(),
      customer: form.customer.trim() || null,
      manager: form.manager.trim() || null,
      launch_date: form.launch_date || null,
      due_date: form.due_date || null,
      packaging: form.packaging,
      packaging_note: form.packaging === 'other' ? form.packaging_note.trim() || null : null,
      packaging_width_mm: form.packaging_width_mm || null,
      packaging_height_mm: form.packaging_height_mm || null,
      stickers: form.stickers,
      stickers_note: form.stickers_note.trim() || null,
      no_chestny_znak: form.no_chestny_znak,
      purchase_required: form.purchase_required,
    },
    // Позиции без `id` — новые, и добавление позиций вне этой правки:
    // оно заводит этапы, а это отдельный разговор. Сервер их пропускает,
    // здесь отбор стоит ради честности payload
    items: validItems.filter((it) => it.id).map((it) => ({
      id: it.id,
      product_type: it.product_type.trim(),
      variant: it.variant.trim() || null,
      qty: effectiveQty(it),
      production_type: it.production_type,
      branding_on: it.branding_on,
      garment_source: it.garment_source,
      /**
       * Связь с моделью каталога (правка 14.09, п. 6). Ключ шлём ВСЕГДА,
       * в том числе пустым: сервер отличает «ключа нет» (не трогать —
       * так ведёт себя открытая старая вкладка) от «прислали пустое»
       * (отвязать модель). Без ключа снять ошибочно выбранную модель
       * было бы нечем.
       */
      sku_card_id: it.sku_card_id?.trim() || '',
      notes: it.notes?.trim() || null,
      size_grid: gridToPayload(it.size_grid),
      fit: it.fit.trim() || null,
      main_fabric: it.main_fabric.trim() || null,
      color_supplier: it.color_supplier.trim() || null,
      trim_material: it.trim_material.trim() || null,
      cutting_note: it.cutting_note.trim() || null,
      sewing_note: it.sewing_note.trim() || null,
      labels_note: it.labels_note.trim() || null,
      packaging: it.packaging,
      packaging_size: it.packaging_size?.trim() || null,
      sticker_place: it.sticker_place?.trim() || null,
      marking_place: it.marking_place?.trim() || null,
      packaging_note: it.packaging_note?.trim() || null,
      packaging_width_mm: it.packaging_width_mm || null,
      packaging_height_mm: it.packaging_height_mm || null,
      prints: (it.prints ?? []).map((p) => ({
        id: p.id ?? null,
        method: p.method,
        zone: p.zone?.trim() || null,
        width_mm: p.width_mm || null,
        height_mm: p.height_mm || null,
        offset_note: p.offset_note?.trim() || null,
        pantone: p.pantone?.trim() || null,
        special: p.special?.trim() || null,
        garment_kind: p.garment_kind?.trim() || null,
        comment: p.comment?.trim() || null,
      })),
      labels: (it.labels ?? []).map((l) => ({
        id: l.id ?? null,
        label_type: l.label_type?.trim() || null,
        place: l.place?.trim() || null,
        size: l.size?.trim() || null,
        comment: l.comment?.trim() || null,
      })),
    })),
  };
}

/** Документ ТЗ формы — то, что читает сборщик (см. `useTzDocs`) */
export interface TzDocLike {
  groupId: string;
  itemIndex: number | null;
  state: string;
  path?: string | null;
  name?: string;
  type?: string;
  size?: number | null;
  file?: { name?: string; type?: string; size?: number } | null;
}

/**
 * Секция `tz.documents` создания заказа.
 *
 * Файлы ТЗ уже лежат в бакете (грузятся при выборе), заказ вместе с документами
 * создаётся одной транзакцией (RPC erp_create_order, секция tz). Иначе при сбое
 * дозагрузки остался бы заказ без ТЗ — ровно то, что запрещено.
 * Цена: файлы-сироты в tz/new/, если RPC упадёт или форму закроют; удалять из
 * бакета клиент не может (политика delete — только admin), поэтому префикс
 * намеренно отдельный.
 *
 * `item_index` — номер позиции В PAYLOAD, а не в форме: пустые позиции
 * в заказ не едут, и индекс формы указал бы на соседнее изделие.
 */
export function tzDocumentsPayload(
  items: Pick<DraftItem, 'product_type' | 'qty' | 'size_grid'>[],
  tzDocs: TzDocLike[],
  actor: string,
) {
  const formToPayloadIndex = new Map(
    items
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => it.product_type.trim() && effectiveQty(it) > 0)
      .map(({ index }, payloadIndex) => [index, payloadIndex]),
  );
  const tzDocuments = [];
  for (const d of tzDocs) {
    if (d.state !== 'uploaded' || !d.path) continue;
    const itemIndex = d.itemIndex === null ? null : formToPayloadIndex.get(d.itemIndex);
    if (d.itemIndex !== null && itemIndex === undefined) continue; // позиция выпала из заказа
    tzDocuments.push({
      group_id: d.groupId,
      item_index: itemIndex ?? null,
      file_path: d.path,
      // Восстановленный из черновика документ `File` не несёт (правка 27.09,
      // п. 12): имя, тип и размер едут в снимке; у черновиков до правки — из пути
      file_name: d.name || d.file?.name || fileNameFromPath(d.path),
      mime_type: d.type || d.file?.type || TZ_MIME,
      size_bytes: d.size ?? d.file?.size ?? null,
      uploaded_by: actor,
    });
  }
  return tzDocuments;
}

export interface NoteLike { key: string; text: string }
export interface AttachedFileLike { ownerKey?: string | null; state: string }

/**
 * Заметки, которые уедут в заказ (п. 5.8). Совсем пустая не едет: человек мог
 * нажать «+ Заметка» и передумать — то же правило, что у строк листа закупки
 * и бирок. Изображение без текста заметкой является: подпись необязательна,
 * а фото само по себе несёт смысл.
 *
 * Отбор ОДИН на ключи заметок и на секцию `notes_list`: по ключам изображение
 * находит свою заметку, и расхождение порядка увезло бы подпись к соседней
 * картинке.
 */
export function notesToSend<T extends NoteLike>(notes: T[], files: AttachedFileLike[]): T[] {
  return notes.filter((n) => n.text.trim() || files.some(
    (f) => f.ownerKey === n.key && f.state === 'uploaded'));
}

export interface CreatePayloadInput {
  form: DraftForm;
  validItems: DraftItem[];
  notesList: NoteLike[];
  tzDocuments: ReturnType<typeof tzDocumentsPayload>;
  /** Секция вложений — `useAttachmentUploads().payload(...)` */
  attachments: unknown[];
}

/** Payload создания заказа (RPC `erp_create_order` через `createOrder` стора) */
export function createOrderPayload({
  form, validItems, notesList, tzDocuments, attachments,
}: CreatePayloadInput) {
  return {
    /*
      Секция `materials` уезжает ПУСТОЙ (правки 07.09, п. 14): строки-подсказки
      менеджера убраны, а строки закупки заводит закупщик у себя. Ключ секции
      оставлен — RPC его принимает, и убирать его из контракта ради пустого
      массива значило бы менять функцию БД без нужды.
    */
    materials: [],
    // Вложения блоков: упаковка, техблок, лист закупки. Файлы уже в бакете —
    // грузятся при выборе, RPC только привязывает их одной транзакцией
    attachments,
    notes_list: notesList.map((n, i) => ({ seq: i + 1, text: n.text.trim() || null })),
    tz_required: true,
    // assignments не заполняем: ТЗ принадлежит позиции и видно всему её маршруту
    tz: { documents: tzDocuments, assignments: [] },
    bitrix_id: form.bitrix_id.trim() || undefined,
    title: form.title.trim(),
    customer: form.customer.trim() || undefined,
    manager: form.manager.trim() || undefined,
    launch_date: form.launch_date || undefined,
    due_date: form.due_date || undefined,
    // `buffer_days` не шлём (правки 07.09, п. 2) — RPC подставит дефолт 0
    packaging: form.packaging,
    packaging_note: form.packaging === 'other' ? form.packaging_note.trim() || undefined : undefined,
    // Размер упаковки (п. 16). У «Нет» размера не бывает — не шлём вовсе
    packaging_width_mm: form.packaging === 'none'
      ? undefined : Number(form.packaging_width_mm) || undefined,
    packaging_height_mm: form.packaging === 'none'
      ? undefined : Number(form.packaging_height_mm) || undefined,
    stickers: form.stickers,
    stickers_note: form.stickers === 'other' ? form.stickers_note.trim() || undefined : undefined,
    no_chestny_znak: form.no_chestny_znak,
    // Отметка «Закупка не требуется»: заказ не появится у закупщика,
    // и этап «Закупка» в маршрут не попадёт (`buildItemRoute`)
    purchase_required: form.purchase_required !== false,
    items: validItems.map(createItemPayload),
  };
}

function createItemPayload(it: DraftItem) {
  const prints = it.has_branding ? it.prints : [];
  return {
    product_type: it.product_type.trim(),
    variant: it.variant.trim() || undefined,
    // сетка заполнена → количество из сетки, иначе ручной ввод
    qty: effectiveQty(it),
    production_type: it.production_type,
    /**
     * Сценарий готового изделия (правки 07.09, п. 4). У прочих типов
     * колонка остаётся NULL: вопрос «чьё изделие» им не задавался,
     * и записанный ответ читался бы как решение человека.
     */
    garment_source: it.production_type === 'ready_garment'
      ? garmentSourceOf(it) : undefined,
    // Модель каталога — ссылкой; поля позиции остаются её собственным
    // снимком, и правка карточки задним числом заказ не переписывает
    sku_card_id: it.sku_card_id?.trim() || undefined,
    // Технический блок и упаковка позиции (правки заказчика 16.08).
    // Пустое поле уходит undefined, а не пустой строкой: иначе колонка
    // хранит '' и «не заполняли» становится неотличимо от «заполнили
    // пустым» — а по этому различию считается, показывать ли блок цеху.
    fit: it.fit.trim() || undefined,
    // Основная ткань — отдельным полем (правка 22.08, п. 5.1)
    main_fabric: it.main_fabric.trim() || undefined,
    color_supplier: it.color_supplier.trim() || undefined,
    trim_material: it.trim_material.trim() || undefined,
    cutting_note: it.cutting_note.trim() || undefined,
    sewing_note: it.sewing_note.trim() || undefined,
    labels_note: it.labels_note.trim() || undefined,
    packaging: it.packaging || 'inherit',
    packaging_size: it.packaging_size.trim() || undefined,
    sticker_place: it.sticker_place.trim() || undefined,
    marking_place: it.marking_place.trim() || undefined,
    packaging_note: it.packaging_note.trim() || undefined,
    // Размер упаковки позиции (п. 16). Пусто — берётся размер заказа
    packaging_width_mm: Number(it.packaging_width_mm) || undefined,
    packaging_height_mm: Number(it.packaging_height_mm) || undefined,
    // Подряд (волна 4.2): тип и источник материалов только для типа «Подряд»
    ...(it.production_type === 'outsource'
      ? { subcontract_kind: it.subcontract_kind || 'finished_product',
          material_source: it.material_source || 'pinhead',
          // Операция (правка 4.2.3) — только для отдельной операции
          subcontract_operation: (it.subcontract_kind || 'finished_product') === 'operation'
            ? (it.subcontract_operation?.trim() || undefined) : undefined,
          // Следующий участок — только если для отдельной операции нужна доработка
          return_dept: (it.subcontract_kind || 'finished_product') === 'operation' && it.needs_further
            ? (it.return_dept || null) : null }
      : {}),
    // маршрут строится по техникам из блоков «Нанесение №N»
    branding_methods: [...new Set(prints.map((p) => p.method))],
    /**
     * Правка маршрута человеком едет как есть; не тронутый маршрут —
     * `undefined`, и стор посчитает его сам тем же `formItemRoute`.
     * Передаём именно ПРАВКУ, а не готовый маршрут: правило «правка или
     * расчёт» должно остаться в одном месте, иначе форма и стор начнут
     * решать это по-разному.
     */
    route: it.route,
    branding_on: it.branding_on,
    size_grid: gridToPayload(it.size_grid),
    prints: prints.map((p) => ({
      // Ключ уезжает в стор, а не на сервер: по нему макет находит
      // своё нанесение, пока строки `erp_item_prints` ещё не существует
      key: p.key,
      method: p.method,
      zone: p.zone.trim() || undefined,
      width_mm: Number(p.width_mm) || null,
      height_mm: Number(p.height_mm) || null,
      offset_note: p.offset_note.trim() || undefined,
      pantone: p.pantone.trim() || undefined,
      /*
        Эффект и тип изделия — величины РАЗНЫХ техник (пп. 10 и 11),
        и каждая едет только со своей: эффект, оставшийся от переключения
        на вышивку, читался бы цехом как требование к вышивке.
      */
      special: p.method === 'silkscreen'
        ? (p.special?.trim() || undefined) : undefined,
      garment_kind: p.method === 'embroidery'
        ? (p.garment_kind || undefined) : undefined,
      comment: p.comment.trim() || undefined,
    })),
    /**
     * Бирки позиции (правка 22.08, п. 5.3). Совсем пустая строка
     * не едет: человек мог нажать «+ Бирка» и передумать — тем же
     * правилом отбрасываются пустые строки листа закупки.
     */
    labels: (it.labels ?? [])
      .filter((l) => l.label_type.trim() || l.place.trim()
        || l.size.trim() || l.comment.trim())
      .map((l) => ({
        key: l.key,
        label_type: l.label_type.trim() || undefined,
        place: l.place.trim() || undefined,
        size: l.size.trim() || undefined,
        comment: l.comment.trim() || undefined,
      })),
  };
}
