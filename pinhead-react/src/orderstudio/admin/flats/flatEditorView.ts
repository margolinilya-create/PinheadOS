/**
 * Показ редактора флэта (веха 5б, задача 6б): тексты кнопок и итогов, прогресс,
 * подтверждения, история, адреса полей для «Перейти» и `aria-describedby`,
 * «Сделать точный силуэт для модели». Чистые функции — экран только рисует.
 */
import { pluralize } from '../../../utils/i18n';
import { VIEW_LABELS } from '../../design/catalog/flatLabels';
import { typesOfCategory } from '../../design/catalog/categoryMap';
import { calibrateView } from '../../design/edit/calibrate';
import type { RemovedItem } from '../../design/edit/newFlat';
import type { FlatIssue } from '../../design/edit/validateFlat';
import { flatSvgPathOf } from '../../design/limits';
import { FLAT_VIEW_KINDS, type FlatHistoryEntry, type FlatViewKind, type GarmentFlat, type GarmentType } from '../../design/types';
import type { SaveProgress } from './saveFlat';

/** Вкладки правой панели редактора */
export type FlatPanel = 'zones' | 'view' | 'pattern' | 'model' | 'history';

export const PANEL_LABELS: Record<FlatPanel, string> = {
  zones: 'Зоны',
  view: 'Вид',
  pattern: 'Лекала',
  model: 'Модель и подбор',
  history: 'История',
};

export const GEOMETRY_HINT = 'Меняет силуэт — сохранится новой версией';
export const READ_ONLY_TEXT = 'Флэты меняет администратор или директор';
export const PHONE_TEXT = 'Править — с компьютера';
export const OFF_TEXT = 'Снят с подбора — новым позициям не предлагается, заказы на нём не меняются';
export const ACTIVE_HINT = 'Снятый флэт остаётся в старых заказах';
export const NO_AREAS_TEXT = 'На этом виде нет зон — добавьте зону, иначе менеджер не сможет поставить сюда логотип';
export const NO_SLEEVES_TEXT = 'Рукавов нет — загрузите SVG одного рукава, второй можно сделать зеркально';
export const CALIBRATE_HINT = 'Кликните две точки с известным расстоянием (например, ширину по низу) и введите его в мм';
export const LOAD_ERROR_TEXT = 'Не удалось загрузить справочник флэтов.';
export const SANITIZE_FAILED_TEXT = 'Этот SVG не удалось безопасно прочитать — пересохраните его из редактора как «SVG 1.1»';
export const GRADE_TEXT = 'Ростовка задана в данных — правится позже';

/** Кнопка сохранения называет результат (К6) */
export function saveButtonLabel(p: { isNew: boolean; geometry: boolean; nextVersion: number }): string {
  if (p.isNew) return 'Создать флэт';
  return p.geometry ? `Выпустить версию ${p.nextVersion}` : 'Сохранить флэт';
}

/** Подсказка под кнопкой выпуска */
export function releaseHint(baseVersion: number): string {
  return `Нанесения в заказах останутся на версии ${baseVersion}, пока менеджер не перенесёт их`;
}

/** Итог сохранения (тост и строка статуса) */
export function saveDoneText(p: { isNew: boolean; released: number | null }): string {
  if (p.isNew) return 'Флэт создан';
  if (p.released !== null) return `Выпущена версия ${p.released}: новые нанесения пойдут по ней`;
  return 'Флэт сохранён';
}

/** Строка прогресса сохранения */
export function saveProgressText(p: SaveProgress | null): string {
  if (!p) return '';
  if (p.phase === 'catalog') return 'Сохраняю справочник флэтов…';
  return `Загружаю файлы флэта: ${p.done} из ${p.total}…`;
}

/**
 * Строка диктору: смена фазы, а не каждый файл (как прорежённый прогресс сида 5а).
 * Текст фазы постоянен, пока она идёт, — `aria-live` объявит его один раз
 */
export function spokenSaveText(p: SaveProgress | null): string {
  if (!p) return 'Готовлю сохранение флэта…';
  if (p.phase === 'catalog') return 'Сохраняю справочник флэтов…';
  return `Загружаю файлы флэта: ${p.total} ${pluralize(p.total, 'файл', 'файла', 'файлов')}…`;
}

/** Конфликт записи флэта (свой вариант текста вехи 4) */
export function flatConflictText(name: string): string {
  return `Флэт «${name}» уже изменил другой администратор. Ваши правки не сохранены, но остаются на экране, выбранные SVG — тоже. `
    + 'Нажмите «Загрузить свежую версию» и повторите правки зон и якорей';
}

export function missingText(id: string): string {
  return `Флэта «${id}» нет в справочнике — ссылка устарела или флэт ещё не сохранён.`;
}

export function brokenText(id: string): string {
  return `Запись флэта «${id}» повреждена. Что не так:`;
}

/** Файл больше 1 МБ — с размером */
export function tooBigText(bytes: number): string {
  const mb = (bytes / 1048576).toFixed(1).replace('.', ',');
  return `Файл весит ${mb} МБ — силуэт должен быть не больше 1 МБ. Упростите контур или уберите вложенные картинки`;
}

/** Строка истории (без дат — их в записи нет) */
export function historyText(e: FlatHistoryEntry): string {
  const views = e.views.length;
  const zones = e.views.reduce((n, v) => n + v.print_areas.length, 0);
  return `Версия ${e.version} · ${views} ${pluralize(views, 'вид', 'вида', 'видов')} · ${zones} ${pluralize(zones, 'зона', 'зоны', 'зон')}`
    + ` — по ней рисуются нанесения, размещённые на версии ${e.version}`;
}

const VIEW_ACC: Record<FlatViewKind, string> = {
  front: 'перед', back: 'спину', sleeve_left: 'левый рукав', sleeve_right: 'правый рукав', hood: 'капюшон', pocket: 'карман',
};

export const mirrorTarget = (from: FlatViewKind): FlatViewKind => (from === 'sleeve_left' ? 'sleeve_right' : 'sleeve_left');

/** Кнопка зеркала у рукава */
export function mirrorButtonLabel(from: FlatViewKind): string {
  return `Сделать ${VIEW_ACC[mirrorTarget(from)]} зеркально`;
}

/** Подтверждение замены рукава зеркальной копией */
export function mirrorConfirmText(from: FlatViewKind, targetZones: number, version: number): string {
  const to = mirrorTarget(from);
  return `Заменить ${VIEW_ACC[to]} зеркальной копией ${from === 'sleeve_left' ? 'левого' : 'правого'}? `
    + `Текущий ${VIEW_LABELS[to].toLowerCase()} (зон: ${targetZones}) уйдёт в версию ${version}, заказы на ней не изменятся`;
}

/** Подтверждение удаления вида */
export function removeViewConfirmText(kind: FlatViewKind, version: number): string {
  return `Удалить вид «${VIEW_LABELS[kind]}»? Сохранится новой версией; заказы на версии ${version} сохранят ${VIEW_ACC[kind]}`;
}

/** Итог «Из файла убрано» одной строкой — для `aria-live` */
export function removedSummary(items: readonly RemovedItem[]): string {
  const n = items.reduce((s, i) => s + i.count, 0);
  return n ? `Файл очищен: убрано ${n} ${pluralize(n, 'элемент', 'элемента', 'элементов')}, список ниже` : '';
}

// ── Адреса полей ───────────────────────────────────────────────────────────

const AREA_FIELDS = new Set(['name', 'zone_id', 'tz_row', 'polygon_mm', 'safe_inset_mm', 'methods', 'default_method', 'max_print_mm', 'min_print_mm']);
const VIEW_FIELDS = new Set(['scale_mm_per_unit', 'anchors', 'svg_path']);
const FLAT_FIELDS = new Set(['id', 'name', 'garment_type', 'typical', 'active', 'sku_codes', 'categories', 'fits', 'sizes', 'base_size']);

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');

/** DOM-id поля зоны */
export const areaFieldId = (kind: FlatViewKind, areaId: string, field: string) => `fa-${kind}-${safe(areaId)}-${field}`;
/** DOM-id поля вида */
export const viewFieldId = (kind: FlatViewKind, field: string) => `fv-${kind}-${field}`;
/** DOM-id поля флэта */
export const flatFieldId = (field: string) => `ff-${field}`;
/** DOM-id кнопки зоны в списке */
export const areaRowId = (kind: FlatViewKind, areaId: string) => `fz-${kind}-${safe(areaId)}`;
/** DOM-id вкладки вида */
export const viewTabId = (kind: FlatViewKind) => `flat-view-tab-${kind}`;

/** Куда ведёт «Перейти»: вкладка панели, вид, зона и поле для фокуса */
export function issueTarget(i: FlatIssue): { panel: FlatPanel; view?: FlatViewKind; areaId?: string; fieldId: string } {
  if (i.view && i.areaId) {
    const field = i.field && AREA_FIELDS.has(i.field) ? i.field : 'name';
    return { panel: 'zones', view: i.view, areaId: i.areaId, fieldId: areaFieldId(i.view, i.areaId, field) };
  }
  if (i.view) {
    const field = i.field && VIEW_FIELDS.has(i.field) ? i.field : 'scale_mm_per_unit';
    return { panel: 'view', view: i.view, fieldId: viewFieldId(i.view, field) };
  }
  if (i.field === 'history') return { panel: 'history', fieldId: 'flat-history' };
  return { panel: 'model', fieldId: flatFieldId(i.field && FLAT_FIELDS.has(i.field) ? i.field : 'name') };
}

/** id текста ошибки поля (`aria-describedby`) */
export const errorTextId = (fieldId: string) => `${fieldId}-err`;
/** id подсказки поля */
export const hintTextId = (fieldId: string) => `${fieldId}-hint`;

/** Контрол поля: `aria-invalid` и `aria-describedby` на ошибку и подсказку */
export function fieldAria(id: string, errors?: readonly string[], hint?: unknown): Record<string, string | boolean | undefined> {
  const bad = !!errors?.length;
  const ids = [bad ? errorTextId(id) : null, hint ? hintTextId(id) : null].filter(Boolean).join(' ');
  return { id, 'aria-invalid': bad || undefined, 'aria-describedby': ids || undefined };
}

/** Ошибки по адресу поля: зона (`view` + `areaId` + `field`), вид или флэт */
export function errorsAt(errors: readonly FlatIssue[], view: FlatViewKind | undefined, areaId: string | undefined, field: string): string[] {
  return errors.filter((e) => e.view === view && e.areaId === areaId && e.field === field).map((e) => e.text);
}

// ── Виды и правка ──────────────────────────────────────────────────────────

/** Виды флэта в порядке показа */
export function viewOrder(flat: GarmentFlat): FlatViewKind[] {
  return FLAT_VIEW_KINDS.filter((k) => flat.views.some((v) => v.kind === k));
}

/** Соседний вид после удаления: предыдущий, иначе следующий */
export function neighbourView(order: readonly FlatViewKind[], kind: FlatViewKind): FlatViewKind | null {
  const i = order.indexOf(kind);
  return order[i - 1] ?? order[i + 1] ?? null;
}

/** Калибровка вида флэта: все позиции × k (К11) */
export function calibrateFlatView(flat: GarmentFlat, kind: FlatViewKind, k: number): GarmentFlat {
  const views = flat.views.map((v) => (v.kind === kind ? calibrateView(v, k) : v));
  return views.some((v, i) => v !== flat.views[i]) ? { ...flat, views } : flat;
}

/** Ширина силуэта, мм: viewBox × масштаб, до десятых */
export const silhouetteWidth = (vbW: number, scale: number) => Math.round(vbW * scale * 10) / 10;

/** Тип изделия по категории модели (первый подходящий) */
export function typeOfCategory(category: string | undefined): GarmentType | null {
  return category ? typesOfCategory(category)[0] ?? null : null;
}

/**
 * «Применить выбранные файлы к свежей записи» (решение 25): виды с выбранными
 * файлами — из прежнего черновика (масштаб, якоря и зоны под этот файл),
 * остальное — свежая запись
 */
export function withViewsFrom(fresh: GarmentFlat, prev: GarmentFlat, kinds: readonly FlatViewKind[]): GarmentFlat {
  const views = [...fresh.views];
  for (const k of kinds) {
    const pv = prev.views.find((v) => v.kind === k);
    if (!pv) continue;
    const i = views.findIndex((v) => v.kind === k);
    if (i >= 0) views[i] = pv;
    else views.push(pv);
  }
  return { ...fresh, views };
}

/**
 * «Сделать точный силуэт для модели» (решение 16): черновик нового флэта
 * из прежнего — новые id и имя, версия 1, `typical: false`, без моделей и истории
 */
export function exactCopy(src: GarmentFlat, id: string, name: string): GarmentFlat {
  const { history: _h, ...rest } = src;
  return {
    ...rest,
    id, name, typical: false, active: false, version: 1, sku_codes: [],
    views: src.views.map((v) => ({ ...v, svg_path: flatSvgPathOf(id, 1, v.kind) })),
  };
}
