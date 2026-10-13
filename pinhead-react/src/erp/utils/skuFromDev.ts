import type { DevFinalPackage, ErpExperimental } from '../types';

/**
 * ПЕРЕНОС ФИНАЛЬНОГО ПАКЕТА РАЗРАБОТКИ В КАТАЛОГ SKU (решение заказчика 21.08).
 *
 * ЗАЧЕМ. Документ формулирует смысл финального пакета одной фразой: «при
 * следующем заказе этой модели экспериментальный цех повторно не требуется».
 * Пока пакет лежит только в карточке разработки, менеджер, оформляющий
 * повторный заказ, о нём не знает — он открывает визард, не находит модель
 * в каталоге и заводит разработку заново. Перенос закрывает этот разрыв.
 *
 * ПОЧЕМУ ЭТО НЕ «СКОПИРОВАТЬ ПОЛЯ». Пакет описывает МОДЕЛЬ словами технолога:
 * «крой — оверсайз», «ткани — футер 3-нитка, кулирка». Каталог описывает
 * АРТИКУЛ числами прайса: код, категория, цена пошива, расход ткани, коды
 * тканей из справочника. Три поля каталога из пакета не выводятся вообще —
 * их знает только человек, и спрашивать их надо ЯВНО:
 *   · `code` — артикул, по которому модель будут искать всегда;
 *   · `category` — от неё зависят правила визарда (техники, размеры, MOQ);
 *   · `sewingPrice` и `mainFabricUsage` — по ним считается цена заказа.
 * Автоматический перенос «одной кнопкой» дал бы в каталоге артикул с нулевой
 * ценой и пустой категорией — визард на таком ломается молча, а чинит его
 * не тот, кто переносил.
 *
 * ПОЭТОМУ ЗДЕСЬ — ТОЛЬКО ЧЕРНОВИК И ПЕРЕЧЕНЬ НЕДОСТАЮЩЕГО. Форма сверки
 * показывает предзаполненное, спрашивает недостающее и зовёт `erp_sku_from_dev`.
 * Тем же приёмом устроен `utils/finalPackage`: перечень считает утилита,
 * а интерфейс его показывает.
 */

/** Крой в пакете — свободный текст технолога, в каталоге — перечисление */
const FIT_WORDS: Record<string, 'regular' | 'oversize' | 'free' | 'classic'> = {
  regular: 'regular', регуляр: 'regular', обычный: 'regular', прямой: 'regular',
  oversize: 'oversize', оверсайз: 'oversize', овер: 'oversize', свободный: 'free',
  free: 'free', классик: 'classic', classic: 'classic', классический: 'classic',
};

/** Категория угадывается по названию модели: «Худи оверсайз» → hoodies */
const CATEGORY_WORDS: [RegExp, string][] = [
  [/зип[- ]?худи|zip/i, 'ziphoodies'],
  [/худи|hoodie/i, 'hoodies'],
  [/свитшот/i, 'sweatshirts'],
  [/халф|half[- ]?zip/i, 'halfzips'],
  [/лонгслив/i, 'longsleeves'],
  [/поло|регбийк|олимпийк/i, 'polo'],
  [/бомбер/i, 'bombers'],
  [/штан|брюк/i, 'pants'],
  [/шорт/i, 'shorts'],
  [/футболк|tee|t-shirt/i, 'tshirts'],
  [/сумк|шоппер|кепк|бандан|аксессуар/i, 'accessories'],
];

/** Что человек обязан дозаполнить: пакет этого не знает */
export interface SkuDraftGaps {
  field: 'code' | 'category' | 'sewingPrice' | 'mainFabricUsage';
  label: string;
}

export interface SkuDraft {
  code: string;
  name: string;
  category: string;
  fit: 'regular' | 'oversize' | 'free' | 'classic' | null;
  sewingPrice: number | null;
  mainFabricUsage: number | null;
  description: string;
  /** Размерный ряд пакета → доступные размеры артикула */
  availableSizes: string[] | null;
  /** Названия тканей из пакета: сверяются со справочником в форме */
  fabricNames: string[];
  /** Допустимые нанесения из пакета */
  brandingNames: string[];
  /** Ценовая вилка разработки — подсказка при вводе цены, не сама цена */
  priceHint: { min: number | null; max: number | null };
}

/** Транслитерация для кода артикула: каталог ищут по латинскому коду */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e',
  ю: 'yu', я: 'ya', ь: '', ъ: '',
};

export function skuCodeFrom(name: string): string {
  return (name || '')
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function toNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Список из строки «S, M, L, XL» или из массива */
function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === 'string') {
    return v.split(/[,;/\n]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Черновик артикула из разработки. Ничего не сохраняет и не угадывает молча:
 * всё, что не выводится из пакета, попадает в `gaps` и спрашивается у человека.
 */
export function skuDraftFromDev(dev: ErpExperimental & { final_package?: DevFinalPackage | null }): {
  draft: SkuDraft;
  gaps: SkuDraftGaps[];
} {
  const pkg = dev.final_package ?? {};
  const name = (dev.tech_name || '').trim();

  const fitWord = (pkg.fit || '').toLowerCase().trim();
  const fit = FIT_WORDS[fitWord]
    ?? Object.entries(FIT_WORDS).find(([w]) => fitWord.includes(w))?.[1]
    ?? null;

  const category = CATEGORY_WORDS.find(([re]) => re.test(name))?.[1] ?? '';

  const draft: SkuDraft = {
    code: skuCodeFrom(name),
    name: name || 'Модель без названия',
    category,
    fit,
    // Цену пошива и расход ткани пакет не содержит ВООБЩЕ: это прайс, а не
    // описание модели. Подставить ноль значило бы завести артикул, по которому
    // заказ считается бесплатным
    sewingPrice: null,
    mainFabricUsage: null,
    description: [pkg.description, pkg.features, pkg.finishes, pkg.limits]
      .map((s) => (s || '').trim())
      .filter(Boolean)
      .join('\n\n'),
    availableSizes: toList(pkg.size_row).length > 0 ? toList(pkg.size_row) : null,
    fabricNames: toList(pkg.fabrics),
    brandingNames: toList(pkg.branding),
    priceHint: {
      min: toNumber((dev as { price_min?: unknown }).price_min),
      max: toNumber((dev as { price_max?: unknown }).price_max),
    },
  };

  const gaps: SkuDraftGaps[] = [];
  if (!draft.code) gaps.push({ field: 'code', label: 'Код артикула' });
  if (!draft.category) gaps.push({ field: 'category', label: 'Категория' });
  gaps.push({ field: 'sewingPrice', label: 'Цена пошива' });
  gaps.push({ field: 'mainFabricUsage', label: 'Расход основной ткани' });

  return { draft, gaps };
}

/**
 * Сопоставление названий пакета с кодами справочника.
 *
 * Технолог писал словами («Футер 3-нитка»), каталог хранит коды. Совпадение
 * ищется по нормализованному названию; не нашлось — значение остаётся
 * НЕсопоставленным и показывается человеку, а не отбрасывается молча:
 * пропавшая ткань превратила бы «шьём из трёх» в «шьём из двух».
 */
export function matchByName<T extends { code: string; name: string }>(
  names: readonly string[],
  catalog: readonly T[],
): { matched: string[]; unmatched: string[] } {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.]+/g, '');
  const byName = new Map(catalog.map((c) => [norm(c.name), c.code]));
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const n of names) {
    const code = byName.get(norm(n));
    if (code) matched.push(code);
    else unmatched.push(n);
  }
  return { matched, unmatched };
}
