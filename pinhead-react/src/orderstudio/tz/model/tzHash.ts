/**
 * Хэш содержимого ТЗ (К1): первые 12 hex sha-256 канонического JSON документа
 * плюс версия раскладки `TZ_LAYOUT_V`. Он пишется в имя PDF (`-c<hash12>`):
 * повторная отправка без правок находит прежний PDF и не плодит файлы (К2),
 * МС при запуске сверяет хэш, собранный заново, с путём (`tzcheck`, решение 42).
 *
 * - Ключи отсортированы — порядок полей объекта на хэш не влияет.
 * - **Дата оформления и ссылка подвала в хэш не входят** (`TZ_HASH_EXCLUDE`):
 *   иначе хэш менялся бы от даты и адреса сборки.
 * - Дайджест — зависимостью (`digest`): в jsdom `crypto.subtle` нет, в браузере
 *   он есть только в безопасном контексте. Нет — понятный отказ, а не падение.
 */
import type { TzDoc } from './tzDocTypes';

/** Версия раскладки: меняется вместе с `layoutTz` — старые хэши перестают совпадать */
export const TZ_LAYOUT_V = 1;

export type Digest = (bytes: Uint8Array) => Promise<ArrayBuffer>;

export const TZ_HASH_EXCLUDE = ['header.issuedOn', 'footer.link'] as const;

export const NO_CRYPTO_MESSAGE = 'Отправка недоступна: браузер не дал криптографию (откройте сайт по https)';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Копия без исключённых путей */
function withoutExcluded(doc: TzDoc): Json {
  const copy = JSON.parse(JSON.stringify(doc)) as Record<string, Record<string, Json>>;
  for (const path of TZ_HASH_EXCLUDE) {
    const [head, key] = path.split('.');
    if (copy[head]) delete copy[head][key];
  }
  return copy as unknown as Json;
}

/** Канонический JSON для хэша: ключи по порядку, без даты оформления и ссылки, с версией раскладки */
export function canonicalTzForHash(doc: TzDoc): string {
  return canonical({ layoutV: TZ_LAYOUT_V, doc: withoutExcluded(doc) });
}

/** Дайджест sha-256 из `crypto` окружения; нет `subtle` — `null` */
export function defaultDigest(c: Pick<Crypto, 'subtle'> | undefined = globalThis.crypto): Digest | null {
  const subtle = c?.subtle;
  if (!subtle) return null;
  return (bytes) => subtle.digest('SHA-256', bytes as BufferSource);
}

/** Первые 12 hex sha-256; `digest` не передан — из окружения; `null` или нет криптографии — отказ */
export async function tzContentHash(doc: TzDoc, digest: Digest | null | undefined = defaultDigest()): Promise<string> {
  if (!digest) throw new Error(NO_CRYPTO_MESSAGE);
  const buf = await digest(new TextEncoder().encode(canonicalTzForHash(doc)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

const TZ_HASHES_RE = /-g([0-9a-f]{8})-c([0-9a-f]{12})-/;

/** Хэш содержимого из пути PDF ТЗ (`…/<uuid>-PH-…-g<8>-c<12>-<модель>.pdf`); нет — `null` */
export function hashFromTzPath(path: string | null | undefined): string | null {
  const name = (path ?? '').split('/').pop() ?? '';
  return TZ_HASHES_RE.exec(name)?.[2] ?? null;
}

/** Хэш группы из пути PDF ТЗ; нет — `null` */
export function groupHashFromTzPath(path: string | null | undefined): string | null {
  const name = (path ?? '').split('/').pop() ?? '';
  return TZ_HASHES_RE.exec(name)?.[1] ?? null;
}
