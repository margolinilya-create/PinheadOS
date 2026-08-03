/**
 * Технические задания в PDF — резолюция «позиция → актуальный документ»
 * и проверка, что ТЗ вообще есть.
 *
 * Модель: документ живёт группой версий (`group_id`), резолюция всегда берёт
 * `is_current` версию группы. Поэтому «заменил файл — у всех цехов обновилось»
 * получается само.
 *
 * ТЗ принадлежит ПОЗИЦИИ, а не паре «позиция × цех» (правка менеджера от 2026-08-03).
 * Внутри одной позиции техническое задание единое для всего производственного
 * маршрута: загрузил один файл — его видят и закрой, и швейка, и ВТО, и ОТК.
 * Прежнее поцеховое назначение (`erp_tz_assignments`) требовало выбрать один и тот же
 * файл в N выпадающих списках и блокировало создание заказа, если хоть один пропущен.
 *
 * Приоритет резолюции: собственное ТЗ позиции → общее ТЗ заказа (`item_id = null`).
 *
 * Гейт заказчика двухступенчатый:
 *  1) заказ нельзя создать, пока у позиции с производственным маршрутом нет ТЗ —
 *     `validateTzDocs` (форма создания);
 *  2) этап без ТЗ не становится «Готов к запуску» — `stageMissingTz`/`missingTzItems`
 *     (страховка для заказов, заведённых раньше, и для этапов, добавленных переносом).
 */

import { isProductionDept } from '../data/departments';
import type { ProductionDeptLike } from '../data/departments';
import type { ErpTzDocument } from '../types';

/** Минимальная форма заказа для резолюции ТЗ (чтобы не тянуть весь ErpOrderFull) */
export interface TzSource {
  tz_documents?: ErpTzDocument[] | null;
  tz_required?: boolean;
}

/** Актуальная версия группы. Если `is_current` почему-то нет — берём старшую версию. */
export function currentVersion(
  documents: ErpTzDocument[] | null | undefined,
  groupId: string,
): ErpTzDocument | null {
  const group = (documents ?? []).filter((d) => d.group_id === groupId);
  if (group.length === 0) return null;
  return group.find((d) => d.is_current)
    ?? group.reduce((best, d) => (d.version > best.version ? d : best));
}

/** Все актуальные документы заказа (по одному на группу), в порядке загрузки */
export function currentDocuments(order: TzSource): ErpTzDocument[] {
  const docs = order.tz_documents ?? [];
  const seen = new Set<string>();
  const out: ErpTzDocument[] = [];
  for (const d of docs) {
    if (seen.has(d.group_id)) continue;
    seen.add(d.group_id);
    const cur = currentVersion(docs, d.group_id);
    if (cur) out.push(cur);
  }
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Общее ТЗ заказа (item_id = null). Их может быть несколько — берём все актуальные. */
export function orderTzDocuments(order: TzSource): ErpTzDocument[] {
  return currentDocuments(order).filter((d) => d.item_id === null);
}

/** Документы конкретной позиции + общие ТЗ заказа: всё, что относится к позиции */
export function itemTzDocuments(order: TzSource, itemId: string): ErpTzDocument[] {
  return currentDocuments(order).filter((d) => d.item_id === null || d.item_id === itemId);
}

/** Версии одной группы, новые сверху — для истории замен */
export function documentHistory(order: TzSource, groupId: string): ErpTzDocument[] {
  return (order.tz_documents ?? [])
    .filter((d) => d.group_id === groupId)
    .sort((a, b) => b.version - a.version);
}

/**
 * Актуальное ТЗ позиции — один документ на весь её производственный маршрут.
 * Своё ТЗ позиции имеет приоритет над общим ТЗ заказа; если своих несколько
 * (загрузили два файла до правки), берётся последний по времени.
 */
export function itemTzDocument(order: TzSource, itemId: string): ErpTzDocument | null {
  const docs = currentDocuments(order);
  const own = docs.filter((d) => d.item_id === itemId);
  if (own.length > 0) return own[own.length - 1];
  const general = docs.filter((d) => d.item_id === null);
  return general.length > 0 ? general[general.length - 1] : null;
}

/** Есть ли у позиции ТЗ, которое увидит цех */
export function itemHasTz(order: TzSource, itemId: string): boolean {
  return itemTzDocument(order, itemId) !== null;
}

/**
 * Требует ли заказ ТЗ. Гейт срабатывает только при явном `true`: отсутствие поля
 * (старый кэш, урезанный select, тестовая фикстура) не должно останавливать цех —
 * это блокировка производства, она обязана быть fail-open.
 */
export function tzRequired(order: TzSource): boolean {
  return order.tz_required === true;
}

/**
 * Нужен ли этому участку PDF-ТЗ. Требуем только у производственных цехов
 * (закрой, нанесения, швейка, ВТО, ОТК) — закупка, логистика и склады работают
 * по материалам и заявкам, документ по образцу заказчика им не адресуется.
 *
 * Принимает строку цеха, а не код: признак живёт в `erp_departments.is_production`
 * и правится в админке, поэтому новый участок сразу попадает под гейт.
 */
export function deptNeedsTz(dept: ProductionDeptLike | null | undefined): boolean {
  return isProductionDept(dept);
}

/**
 * Блокирует ли отсутствие ТЗ запуск этапа — гейт для `isStageReady`/`waitingReason`.
 * Заказы, заведённые до внедрения ТЗ (`tz_required === false`), гейтом не трогаются.
 * Неизвестный код цеха тоже не блокирует: остановка производства обязана быть fail-open.
 */
export function stageMissingTz(
  order: TzSource,
  itemId: string,
  dept?: ProductionDeptLike | null,
): boolean {
  if (!tzRequired(order)) return false;
  if (!deptNeedsTz(dept)) return false;
  return !itemHasTz(order, itemId);
}

/** Минимум этапа для проверки гейта */
interface GateStage {
  department_id: string;
  status?: string;
}
interface GateItem {
  id: string;
  product_type?: string;
  variant?: string | null;
  stages?: GateStage[];
}

export interface MissingTz {
  itemId: string;
  itemLabel: string;
}

/**
 * Позиции с производственным маршрутом, у которых нет ТЗ. Пропущенные этапы
 * (skipped) не считаются — работы там не будет, требовать ТЗ бессмысленно;
 * позиция вообще без производственных этапов (чистый подряд) в гейт не попадает.
 *
 * Считается по позициям, а не по парам «позиция × цех»: ТЗ у позиции одно на весь
 * маршрут, и «швейке назначено, ОТК нет» больше не бывает по построению.
 *
 * Если у заказа `tz_required === false` (заведён до внедрения ТЗ), возвращается пусто:
 * гейт к нему не применяется.
 */
export function missingTzItems(
  order: TzSource & { items?: GateItem[] },
  /** id цеха → строка цеха: ТЗ требуют только производственные участки */
  departmentById: Map<string, ProductionDeptLike>,
): MissingTz[] {
  if (!tzRequired(order)) return [];
  const out: MissingTz[] = [];
  for (const item of order.items ?? []) {
    const needsTz = (item.stages ?? []).some(
      (stage) => stage.status !== 'skipped' && deptNeedsTz(departmentById.get(stage.department_id)),
    );
    if (!needsTz) continue;
    if (itemHasTz(order, item.id)) continue;
    out.push({ itemId: item.id, itemLabel: itemLabel(item) });
  }
  return out;
}

/** Подпись позиции для сообщений об ошибке: «Футболка Regular» */
export function itemLabel(item: { product_type?: string; variant?: string | null }): string {
  return [item.product_type, item.variant].filter(Boolean).join(' ') || 'Позиция';
}

/**
 * Человекочитаемое сообщение по недостающим ТЗ:
 * «Невозможно создать заказ: не загружено ТЗ для позиций «Футболка Regular» и «Худи».
 */
export function missingTzMessage(
  missing: MissingTz[],
  prefix = 'Невозможно создать заказ',
): string | null {
  if (missing.length === 0) return null;
  const labels: string[] = [];
  for (const m of missing) {
    if (!labels.includes(m.itemLabel)) labels.push(`«${m.itemLabel}»`);
  }
  const noun = labels.length === 1 ? 'позиции' : 'позиций';
  return `${prefix}: не загружено ТЗ для ${noun} ${listRu(labels)}`;
}

/** «Швейка, ОТК и Закрой» — перечисление через запятую с «и» перед последним */
export function listRu(values: string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(', ')} и ${values[values.length - 1]}`;
}

/**
 * Валидация ТЗ в форме создания заказа: маршрут ещё не в БД, поэтому позиции
 * и этапы приходят как черновик формы, а файлы — как список «индекс позиции → файл»
 * (`itemIndex === null` — общее ТЗ заказа).
 *
 * Проверяется одно: у каждой позиции с производственным маршрутом есть ТЗ — своё
 * или общее на заказ. Поцехового комплекта назначений больше нет.
 */
export interface DraftTzItem {
  /** Индекс позиции в форме — им же адресуются документы в payload RPC */
  index: number;
  label: string;
  /** Цеха маршрута позиции: id + отображаемое имя */
  stages: { departmentId: string; departmentName: string }[];
}

/** Файл ТЗ в черновике формы: `itemIndex === null` — общее ТЗ заказа */
export interface DraftTzDoc {
  itemIndex: number | null;
  /** Загруженный в бакет файл. Незагруженный ТЗ не считается — заказ бы упал на RPC */
  uploaded?: boolean;
}

export interface DraftTzValidation {
  missing: { index: number; label: string }[];
  message: string | null;
}

export function validateTzDocs(
  items: DraftTzItem[],
  docs: DraftTzDoc[],
): DraftTzValidation {
  const ready = docs.filter((d) => d.uploaded !== false);
  const hasGeneral = ready.some((d) => d.itemIndex === null);
  const missing: DraftTzValidation['missing'] = [];
  for (const item of items) {
    if (item.stages.length === 0) continue; // маршрут без производственных цехов
    if (hasGeneral || ready.some((d) => d.itemIndex === item.index)) continue;
    missing.push({ index: item.index, label: item.label });
  }
  return {
    missing,
    message: missingTzMessage(
      missing.map((m) => ({ itemId: String(m.index), itemLabel: m.label })),
    ),
  };
}

/**
 * ТЗ обновили уже после того, как цех взял задание, — исполнителю надо показать
 * заметный бейдж, иначе он доделает по старому файлу.
 */
export function tzUpdatedAfterStart(
  document: Pick<ErpTzDocument, 'version' | 'created_at'> | null,
  stage: { started_at?: string | null } | null | undefined,
): boolean {
  if (!document || document.version <= 1) return false;
  const started = stage?.started_at;
  if (!started) return false;
  return document.created_at > started;
}

/**
 * Кириллица → латиница. Нужна не для красоты: Supabase Storage проверяет ключ
 * объекта регуляркой из S3-safe символов, где `\w` объявлен БЕЗ флага `u`, то есть
 * только ASCII. Любая русская буква в ключе — ответ `InvalidKey`, и файл не
 * загружается вообще. Имя для человека живёт в `erp_tz_documents.file_name`,
 * в ключе оно нужно только чтобы объект можно было опознать глазами.
 */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Транслитерация с сохранением регистра: «ТЗ» → «TZ», «Швейка» → «Shveyka» */
export function translitAscii(value: string): string {
  let out = '';
  for (const ch of value) {
    const lower = ch.toLowerCase();
    const mapped = TRANSLIT[lower];
    if (mapped === undefined) {
      out += ch;
    } else if (ch === lower) {
      out += mapped;
    } else {
      out += mapped.charAt(0).toUpperCase() + mapped.slice(1);
    }
  }
  return out;
}

/** Всё, что не ASCII-буква, цифра, `_`, `-` или точка, схлопывается в один «_» */
function sanitizeKeyPart(value: string): string {
  return value
    .replace(/[^\w.-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/_{2,}/g, '_')
    .replace(/^[._\-\s]+/, '')
    .replace(/[._\-\s]+$/, '');
}

/**
 * Ключ хранения файла: tz/<scope>/<group_id>/v<N>-<имя>.
 *
 * Имя транслитерируется и обеззараживается: результат строго ASCII (иначе Storage
 * отвечает `InvalidKey`), слэши и скобки уходят в «_», серии точек схлопываются —
 * иначе «../../» из имени файла уехало бы в ключ объекта. Расширение отделяется
 * заранее: иначе имя целиком из непереводимых символов съело бы и его.
 */
export function tzFilePath(scope: string, groupId: string, version: number, fileName: string): string {
  const raw = fileName || '';
  const dot = raw.lastIndexOf('.');
  const ext = dot > 0 ? sanitizeKeyPart(translitAscii(raw.slice(dot + 1))).slice(0, 8) : '';
  // Голова, а не хвост: расширение уже отделено, а опознают файл по началу имени
  const base = sanitizeKeyPart(sanitizeKeyPart(translitAscii(dot > 0 ? raw.slice(0, dot) : raw)).slice(0, 100));
  const name = base || 'tz';
  return `tz/${scope}/${groupId}/v${version}-${name}.${ext || 'pdf'}`;
}
