/**
 * Технические задания в PDF (волна 4) — резолюция «этап → актуальный документ»
 * и проверка полноты назначений.
 *
 * Модель: документ живёт группой версий (`group_id`), назначение цеху ссылается на
 * группу, а не на версию. Поэтому «заменил файл — у всех цехов обновилось» получается
 * само: резолюция всегда берёт `is_current` версию группы.
 *
 * Гейт заказчика двухступенчатый:
 *  1) заказ нельзя создать, пока каждому этапу маршрута не назначено ТЗ —
 *     `validateTzAssignments` (форма создания);
 *  2) этап без ТЗ не становится «Готов к запуску» — `missingTzStages`/`stageHasTz`
 *     (страховка для заказов, заведённых раньше, и для этапов, добавленных переносом).
 */

import { isProductionDept } from '../data/departments';
import type { ProductionDeptLike } from '../data/departments';
import type { ErpTzAssignment, ErpTzDocument } from '../types';

/** Минимальная форма заказа для резолюции ТЗ (чтобы не тянуть весь ErpOrderFull) */
export interface TzSource {
  tz_documents?: ErpTzDocument[] | null;
  tz_assignments?: ErpTzAssignment[] | null;
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

/** Документы конкретной позиции + общие ТЗ заказа: всё, что можно назначить её этапу */
export function itemTzDocuments(order: TzSource, itemId: string): ErpTzDocument[] {
  return currentDocuments(order).filter((d) => d.item_id === null || d.item_id === itemId);
}

/** Версии одной группы, новые сверху — для истории замен */
export function documentHistory(order: TzSource, groupId: string): ErpTzDocument[] {
  return (order.tz_documents ?? [])
    .filter((d) => d.group_id === groupId)
    .sort((a, b) => b.version - a.version);
}

/** Назначение на пару «позиция × цех» */
export function tzAssignmentFor(
  order: TzSource,
  itemId: string,
  departmentId: string,
): ErpTzAssignment | null {
  return (order.tz_assignments ?? []).find(
    (a) => a.item_id === itemId && a.department_id === departmentId,
  ) ?? null;
}

/** Актуальный документ, который читает цех на этой позиции */
export function stageTzDocument(
  order: TzSource,
  itemId: string,
  departmentId: string,
): ErpTzDocument | null {
  const assignment = tzAssignmentFor(order, itemId, departmentId);
  if (!assignment) return null;
  return currentVersion(order.tz_documents, assignment.group_id);
}

/** Есть ли у этапа назначенное и реально существующее ТЗ */
export function stageHasTz(order: TzSource, itemId: string, departmentId: string): boolean {
  return stageTzDocument(order, itemId, departmentId) !== null;
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
  departmentId: string,
  dept?: ProductionDeptLike | null,
): boolean {
  if (!tzRequired(order)) return false;
  if (!deptNeedsTz(dept)) return false;
  return !stageHasTz(order, itemId, departmentId);
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
  departmentId: string;
}

/**
 * Этапы маршрута без назначенного ТЗ. Пропущенные этапы (skipped) не считаются —
 * работы там не будет, требовать на них ТЗ бессмысленно.
 *
 * Если у заказа `tz_required === false` (заведён до внедрения ТЗ), возвращается пусто:
 * гейт к нему не применяется.
 */
export function missingTzStages(
  order: TzSource & { items?: GateItem[] },
  /** id цеха → строка цеха: ТЗ требуют только производственные участки */
  departmentById: Map<string, ProductionDeptLike>,
): MissingTz[] {
  if (!tzRequired(order)) return [];
  const out: MissingTz[] = [];
  for (const item of order.items ?? []) {
    for (const stage of item.stages ?? []) {
      if (stage.status === 'skipped') continue;
      if (!deptNeedsTz(departmentById.get(stage.department_id))) continue;
      if (stageHasTz(order, item.id, stage.department_id)) continue;
      out.push({
        itemId: item.id,
        itemLabel: itemLabel(item),
        departmentId: stage.department_id,
      });
    }
  }
  return out;
}

/** Подпись позиции для сообщений об ошибке: «Футболка Regular» */
export function itemLabel(item: { product_type?: string; variant?: string | null }): string {
  return [item.product_type, item.variant].filter(Boolean).join(' ') || 'Позиция';
}

/**
 * Человекочитаемое сообщение по недостающим ТЗ, сгруппированное по позициям:
 * «Невозможно создать заказ: для позиции «Футболка Regular» не назначено ТЗ
 *  швейному цеху и ОТК».
 */
export function missingTzMessage(
  missing: MissingTz[],
  departmentNameById: Map<string, string>,
  prefix = 'Невозможно создать заказ',
): string | null {
  if (missing.length === 0) return null;
  const byItem = new Map<string, { label: string; depts: string[] }>();
  for (const m of missing) {
    const entry = byItem.get(m.itemId) ?? { label: m.itemLabel, depts: [] };
    const name = departmentNameById.get(m.departmentId) || 'цех';
    if (!entry.depts.includes(name)) entry.depts.push(name);
    byItem.set(m.itemId, entry);
  }
  const parts = [...byItem.values()].map(
    (e) => `для позиции «${e.label}» не назначено ТЗ: ${listRu(e.depts)}`,
  );
  return `${prefix}: ${parts.join('; ')}`;
}

/** «Швейка, ОТК и Закрой» — перечисление через запятую с «и» перед последним */
export function listRu(values: string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(', ')} и ${values[values.length - 1]}`;
}

/**
 * Валидация назначений в форме создания заказа: маршрут ещё не в БД, поэтому
 * позиции и этапы приходят как черновик формы, а назначения — как карта
 * «индекс позиции + код цеха → group_id».
 */
export interface DraftTzItem {
  /** Индекс позиции в форме — им же адресуются назначения в payload RPC */
  index: number;
  label: string;
  /** Цеха маршрута позиции: id + отображаемое имя */
  stages: { departmentId: string; departmentName: string }[];
}

export interface DraftTzValidation {
  missing: { index: number; label: string; departmentId: string; departmentName: string }[];
  message: string | null;
}

export function validateTzAssignments(
  items: DraftTzItem[],
  /** Ключ — `${index}:${departmentId}`, значение — group_id назначенного документа */
  assignments: Record<string, string | undefined>,
): DraftTzValidation {
  const missing: DraftTzValidation['missing'] = [];
  for (const item of items) {
    for (const stage of item.stages) {
      if (assignments[`${item.index}:${stage.departmentId}`]) continue;
      missing.push({
        index: item.index,
        label: item.label,
        departmentId: stage.departmentId,
        departmentName: stage.departmentName,
      });
    }
  }
  if (missing.length === 0) return { missing, message: null };
  const byItem = new Map<number, { label: string; depts: string[] }>();
  for (const m of missing) {
    const entry = byItem.get(m.index) ?? { label: m.label, depts: [] };
    if (!entry.depts.includes(m.departmentName)) entry.depts.push(m.departmentName);
    byItem.set(m.index, entry);
  }
  const parts = [...byItem.values()].map(
    (e) => `для позиции «${e.label}» не назначено ТЗ: ${listRu(e.depts)}`,
  );
  return { missing, message: `Невозможно создать заказ: ${parts.join('; ')}` };
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
 * Ключ хранения файла: tz/<scope>/<group_id>/v<N>-<имя>.
 * Имя обеззараживается: слэши и прочее уходят в «_», серии точек схлопываются —
 * иначе «../../» из имени файла уехало бы в ключ объекта.
 */
export function tzFilePath(scope: string, groupId: string, version: number, fileName: string): string {
  const safe = (fileName || '')
    .replace(/[^\w.\-А-Яа-яЁё ]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._\-\s]+/, '')
    .slice(-120) || 'tz.pdf';
  return `tz/${scope}/${groupId}/v${version}-${safe}`;
}
