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
 *
 * ── ПРАВКА ЗАКАЗЧИКА 24.08 (пп. 4.5 и 4.6) ──────────────────────────────────
 *
 * ДВА НАБОРА, А НЕ ОДИН. Документ перечисляет обязательную техдокументацию
 * исчерпывающе — техническое название лекал, версия лекал, техпаспорт, фото
 * образца — и отдельно говорит: «Если переключатель [„Добавить модель
 * в каталог SKU"] выключен, технолог заполняет ТОЛЬКО обязательную
 * техническую документацию и завершает разработку». Значит поля карточки SKU
 * (описание, крой, размерный ряд, ткани, нанесения, модификации, ценовая
 * вилка) обязательны РОВНО тогда, когда модель идёт в каталог. Иначе
 * разработка «на пробу» не закрывается вовсе: технолог обязан выдумать
 * ценовую вилку и список модификаций для изделия, которое в каталог
 * не пойдёт.
 *
 * Признак живёт в самом пакете (`final_package.add_to_sku`), а не колонкой:
 * серверный страж читает тот же JSONB, и второй источник правды здесь
 * не нужен.
 *
 * «ФАЙЛ ЛЕКАЛ ИЛИ ССЫЛКА» СНЯТ («поле не нужно»). Вид вложения `dev_pattern`
 * и ключ `pattern_link` из схемы НЕ убираются: на проде 24.08 лежат один файл
 * лекал и две ссылки, то есть блок совместимости не пуст. Ввод исчезает,
 * вложенное продолжает показываться на чтение — исчезнувший файл читался бы
 * как потеря данных.
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
 * Идёт ли модель в каталог SKU — переключатель финального этапа (п. 4.6).
 *
 * Отдельная функция, а не `pkg.add_to_sku` по месту: спрашивают об этом
 * трое (перечень недостающего, форма, предложение перенести модель),
 * и `=== true` в каждом из них — тот же дубль правила. Сравнение строгое:
 * ключа у заведённых раньше разработок нет вовсе, и «не задано» обязано
 * читаться как «не идёт», иначе правка 24.08 не смягчила бы гейт никому.
 */
export function wantsSkuCard(dev: DevLike | null | undefined): boolean {
  return dev?.final_package?.add_to_sku === true;
}

/**
 * Чего не хватает, чтобы завершить разработку. Пустой массив — пакет полон.
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

  /**
   * ОБРАЗЕЦ — ПЕРВОЕ УСЛОВИЕ ДОКУМЕНТА (правка 30.08, п. 4): «Разработку
   * считать завершённой после того, как образец отшит И в заказ внесена
   * обязательная техническая документация». Проверялось только второе —
   * разработку закрывали, ни разу не собрав образец, и складская задача
   * «Приёмка готовой продукции» заводилась на вещь, которой нет.
   *
   * Доказательство «отшит» — проверка образца (`sample_approved_at`):
   * единственное место, где человек подтверждает, что образец собран
   * и осмотрен. Фото образца на этот вопрос не отвечает — файл прикладывают
   * и к незаконченной работе, и он уже стоит в перечне отдельной строкой.
   */
  if (!dev?.sample_approved_at) out.push('Образец отшит и проверен');

  // ── Техдокументация: нужна ВСЕГДА (п. 4.5) ────────────────────────────────
  if (!filled(dev?.pattern_tech_name)) out.push('Техническое название лекал');
  if (!filled(dev?.pattern_version)) out.push('Версия лекал');
  if (!has(DEV_ATTACHMENT_KINDS.passport)) out.push('Технический паспорт');
  if (!has(DEV_ATTACHMENT_KINDS.photo)) out.push('Фото образца');
  // «Комментарии и особенности производства» документ помечает словами
  // «при необходимости» — поле в форме есть, в этом перечне его нет

  // ── Карточка SKU: только если модель идёт в каталог (п. 4.6) ──────────────
  if (!wantsSkuCard(dev)) return out;

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

/**
 * Подпись прогресса пакета для карточки: «Заполнено 3 из 4».
 *
 * «Всего» считается В ТОМ ЖЕ РЕЖИМЕ, что и недостающее (п. 4.6): у разработки
 * без карточки SKU обязательных полей четыре, и знаменатель 12 показывал бы
 * «4 / 12» на полностью собранном пакете — то есть врал бы ровно там, где
 * человек ждёт подтверждения, что всё готово.
 */
export function finalPackageProgress(
  dev: DevLike | null | undefined,
  attachments: readonly AttachLike[] = [],
): { done: number; total: number } {
  const missing = missingFinalPackage(dev, attachments).length;
  // Полный набор считается той же функцией на пустой разработке — иначе
  // число «всего» пришлось бы держать константой рядом с перечнем проверок,
  // и оно разошлось бы с ним при первой же правке
  const total = missingFinalPackage(
    { final_package: { add_to_sku: wantsSkuCard(dev) } }, [],
  ).length;
  return { done: Math.max(0, total - missing), total };
}

export type { AttachLike as DevAttachLike };
export type DevWithPackage = ErpExperimental & DevLike;
