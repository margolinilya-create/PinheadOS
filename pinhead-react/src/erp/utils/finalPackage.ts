import type { DevFinalPackage, ErpExperimental } from '../types';

/**
 * Финальный технический пакет разработки (правки заказчика 20.08).
 *
 * ЗАЧЕМ. «Кнопка "Готово к серии" становится доступна только после заполнения
 * обязательного финального пакета… Если чего-то не хватает, система должна
 * показать, какие поля ещё не заполнены». Смысл требования — не запрет,
 * а ПОВТОРНОЕ ПРОИЗВОДСТВО: «при следующем заказе этой модели экспериментальный
 * цех повторно не требуется». Разработка, закрытая без пакета, стоит ровно
 * столько же, сколько незакрытая, — модель придётся разрабатывать заново.
 *
 * ЧТО ЗДЕСЬ ЖИВЁТ. Только перечень недостающего. Гейт кнопки берёт его длину,
 * подпись — сам перечень, а серверный страж `erp_dev_package_guard` повторяет
 * ЭТИ ЖЕ проверки: расхождение дало бы либо «кнопка есть, действие падает»,
 * либо дыру. Сторожит `finalPackage.test.ts`, читающий текст миграции.
 *
 * ОТСТУПЛЕНИЕ, НАЗВАННОЕ ВСЛУХ. Из семи полей карточки SKU обязательными
 * сделаны три — описание, крой/посадка, размерный ряд. «Конструктивные
 * особенности», «обработки» и «ограничения» у простой модели пусты по существу,
 * и обязательность родила бы строку «нет» в каждой второй карточке: поле,
 * заполняемое ради галочки, перестаёт читаться. Решение выносится заказчику.
 */

export interface DevLike {
  pattern_tech_name?: string | null;
  pattern_version?: string | null;
  price_min?: number | string | null;
  price_max?: number | string | null;
  final_package?: DevFinalPackage | null;
  sample_approved_at?: string | null;
}

interface AttachLike {
  kind: string;
}

/** Виды файлов финального пакета */
export const DEV_ATTACHMENT_KINDS = {
  pattern: 'dev_pattern',
  passport: 'dev_passport',
  photo: 'dev_photo',
} as const;

const filled = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;
const filledList = (v: unknown): boolean => Array.isArray(v) && v.some(filled);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Чего не хватает для «Готово к серии». Пустой массив — пакет полон.
 *
 * Формулировки — ИМЕНАМИ ПОЛЕЙ документа, чтобы человек искал в форме то же
 * слово, которое прочитал в списке.
 */
export function missingFinalPackage(
  dev: DevLike | null | undefined,
  attachments: readonly AttachLike[] = [],
): string[] {
  const pkg = dev?.final_package ?? {};
  const has = (kind: string) => (attachments ?? []).some((a) => a.kind === kind);
  const out: string[] = [];

  if (!filled(dev?.pattern_tech_name)) out.push('Техническое название лекал');
  if (!filled(dev?.pattern_version)) out.push('Версия лекал');
  // «Файл или ссылка на лекала» — документ допускает оба варианта
  if (!has(DEV_ATTACHMENT_KINDS.pattern) && !filled(pkg.pattern_link)) {
    out.push('Файл или ссылка на лекала');
  }
  if (!has(DEV_ATTACHMENT_KINDS.passport)) out.push('Технический паспорт');
  if (!has(DEV_ATTACHMENT_KINDS.photo)) out.push('Фото образца');

  if (!filled(pkg.description)) out.push('Описание изделия');
  if (!filled(pkg.fit)) out.push('Крой / посадка');
  if (!filled(pkg.size_row)) out.push('Размерный ряд');

  if (!filledList(pkg.fabrics)) out.push('Доступные ткани');
  if (!filledList(pkg.branding)) out.push('Доступные нанесения');
  if (!filledList(pkg.modifications)) out.push('Возможные модификации');

  const min = num(dev?.price_min);
  const max = num(dev?.price_max);
  if (min === null || max === null) out.push('Ценовая вилка');
  else if (min > max) out.push('Ценовая вилка: «от» больше «до»');

  return out;
}

/**
 * Готов ли пакет. Отдельная функция, потому что читателей двое (кнопка и
 * бейдж состояния), и `.length === 0` в каждом из них — тот же дубль правила.
 */
export function isFinalPackageReady(
  dev: DevLike | null | undefined,
  attachments: readonly AttachLike[] = [],
): boolean {
  return missingFinalPackage(dev, attachments).length === 0;
}

/** Вложения ЭТОЙ разработки нужного вида */
export function devAttachments<T extends AttachLike & { experimental_id?: string | null }>(
  attachments: readonly T[] | null | undefined,
  devId: string,
  kind?: string,
): T[] {
  return (attachments ?? []).filter(
    (a) => a.experimental_id === devId && (!kind || a.kind === kind),
  );
}

/** Подпись прогресса пакета для карточки: «Заполнено 9 из 12» */
export function finalPackageProgress(
  dev: DevLike | null | undefined,
  attachments: readonly AttachLike[] = [],
): { done: number; total: number } {
  const missing = missingFinalPackage(dev, attachments).length;
  // Полный набор считается той же функцией на пустой разработке — иначе
  // число «всего» пришлось бы держать константой рядом с перечнем проверок,
  // и оно разошлось бы с ним при первой же правке
  const total = missingFinalPackage({}, []).length;
  return { done: Math.max(0, total - missing), total };
}

export type { AttachLike as DevAttachLike };
export type DevWithPackage = ErpExperimental & DevLike;
