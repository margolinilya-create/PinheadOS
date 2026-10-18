/**
 * id флэта в редакторе (веха 5б, задача 1; перенос DM `idError` с адаптацией):
 * форма — `FLAT_ID_RE` (та же, что в пути бакета и CHECK `order_items.flat_id`),
 * занятость — по всем записям справочника, включая снятые и битые: id после
 * создания не меняется и не переиспользуется. id предлагается транслитерацией
 * имени (решение 21).
 */
import { FLAT_ID_RE } from '../limits';

const MAX_ID_LEN = 63;

/** Ошибка id нового флэта; `null` — id годится */
export function idError(id: string, reserved: ReadonlySet<string>): string | null {
  if (!id.trim()) return 'Укажите id флэта';
  if (!FLAT_ID_RE.test(id)) return 'id: латиница в нижнем регистре, цифры и дефис, до 63 знаков, первый знак — буква или цифра';
  if (reserved.has(id)) return `id «${id}» уже занят — в том числе снятым или битым флэтом`;
  return null;
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Транслитерация имени под `FLAT_ID_RE`: «Поло классика» → `polo-klassika` */
export function slugOf(name: string): string {
  const latin = [...name.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
  return latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Предложить id по имени; занят — суффикс `-2`, `-3`… */
export function suggestFlatId(name: string, reserved: ReadonlySet<string>): string {
  const base = (slugOf(name) || 'flat').slice(0, MAX_ID_LEN - 4).replace(/-+$/, '');
  if (!reserved.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const id = `${base}-${n}`;
    if (!reserved.has(id)) return id;
  }
  return `${base}-${Date.now() % 1000}`;
}
